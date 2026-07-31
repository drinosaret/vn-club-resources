"""Weekly Roudoku admin dashboard.

Ephemeral panel for the always-open vote: pick this week's winner (the leader stays
in the pool, marked 👑), Reopen to clear the pick, Start new round to wipe the pool,
set the session, post the board, pause/resume, manage the pool/votes/calendar rows,
or configure the weekly default, length cap, vote-role gate, and session ping. A
port of views/movie_night.py; the length cap and the per-VN cover mode are the two
panels Movie Night has no equivalent for. Opened by /manage_roudoku.
"""

import logging
from datetime import datetime, timezone

import discord
from discord import ui

from app.db.database import async_session_maker
from app.services import length_utils
from app.services import roudoku_service as rd
from discord_bot.modals.event import EventModal
from discord_bot.utils.embeds import inert_text
from discord_bot.views.base import BaseView, ConfirmView, resolve_voter_names
from discord_bot.views.roudoku_vote import safe_title

logger = logging.getLogger(__name__)

WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
COLOR = 0xD946EF  # keep in sync with views/roudoku_vote.py and event-meta.ts
MAX_LENGTH_CEILING = 100_000  # ~69 days; a cap beyond this is a typo, not an intent

COVER_MODE_LABELS = {
    "auto": "Auto - swap an adult cover for jiten's SFW one, else blur",
    "shown": "Shown - always post the VNDB cover as-is",
    "blurred": "Blurred - always blur the VNDB cover",
    "hidden": "Hidden - no cover art at all",
}


class _Btn(ui.Button):
    def __init__(self, handler, label, style, emoji=None, row=0):
        super().__init__(label=label, style=style, emoji=emoji, row=row)
        self._handler = handler

    async def callback(self, interaction: discord.Interaction) -> None:
        await self._handler(interaction)


class RoudokuAdminView(BaseView):
    def __init__(self, user_id: int, cog, cycle, standings):
        super().__init__(user_id, timeout=300)
        self.cog = cog
        self.cycle = cycle
        self.standings = standings
        self._build()

    def _build(self) -> None:
        self.clear_items()
        paused = bool(self.cycle and self.cycle.phase == "paused")
        pick_set = bool(self.cycle and self.cycle.winner_nomination_id)
        if paused:
            self.add_item(_Btn(self._resume, "Resume voting", discord.ButtonStyle.success, "▶️"))
        else:
            self.add_item(_Btn(self._pick, "Pick winner", discord.ButtonStyle.primary, "🏆"))
            self.add_item(_Btn(self._set_session, "Set session", discord.ButtonStyle.secondary, "📅"))
            self.add_item(_Btn(self._post_board, "Post vote board", discord.ButtonStyle.secondary, "📋"))
            self.add_item(_Btn(self._pause, "Pause voting", discord.ButtonStyle.danger, "⏸"))
        self.add_item(_Btn(self._manage_pool, "Manage pool", discord.ButtonStyle.secondary, "📚", row=1))
        self.add_item(_Btn(self._manage_votes, "Manage votes", discord.ButtonStyle.secondary, "🗳", row=1))
        self.add_item(_Btn(self._manage_events, "Roudoku events", discord.ButtonStyle.secondary, "📆", row=1))
        self.add_item(_Btn(self._configure, "Configure", discord.ButtonStyle.secondary, "⚙️", row=1))
        self.add_item(_Btn(self._refresh, "Refresh", discord.ButtonStyle.secondary, "🔄", row=1))
        if pick_set:
            self.add_item(_Btn(self._reopen, "Reopen (clear pick)", discord.ButtonStyle.secondary, "↩️", row=2))
        self.add_item(_Btn(self._start_new_vote, "Start new round", discord.ButtonStyle.danger, "🆕", row=2))

    def get_embed(self) -> discord.Embed:
        return self.cog.admin_embed(self.cycle, self.standings)

    async def reload(self) -> None:
        async with async_session_maker() as db:
            self.cycle = await rd.get_active_cycle(db)
            self.standings = await rd.tally(db, self.cycle.id) if self.cycle else []
        await self.cog._load_config()
        self._build()

    async def _rerender(self, interaction: discord.Interaction) -> None:
        await self.reload()
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    # --- actions ---------------------------------------------------------

    async def _set_session(self, interaction: discord.Interaction) -> None:
        modal = _SessionModal(self.cog.default_session_hint())
        await interaction.response.send_modal(modal)
        await modal.wait()
        if modal.session is None and not modal.use_default:
            return
        ok, msg = await self.cog.set_session(modal.session)
        await self._rerender(interaction)
        if not ok:
            await interaction.followup.send(f"⚠️ {msg}", ephemeral=True)

    async def _post_board(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        ok, msg = await self.cog.post_board(interaction.channel_id)
        await self._rerender(interaction)
        if not ok:
            await interaction.followup.send(f"⚠️ {msg}", ephemeral=True)

    async def _pause(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.cog.pause()
        await self._rerender(interaction)

    async def _resume(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.cog.resume()
        await self._rerender(interaction)

    async def _pick(self, interaction: discord.Interaction) -> None:
        if not (self.cycle and self.cycle.scheduled_for):
            await interaction.response.send_message(
                "Set a session first - the pick is published for that date.", ephemeral=True
            )
            return
        await self._confirm_then(
            interaction,
            "Flag the current vote leader as this week's pick? It stays in the pool "
            "(marked 👑), the votes are kept, and it's published to the calendar.",
            "Pick winner",
            self.cog.pick_active,
            fail_note="Nothing to pick - the pool is empty.",
        )

    async def _reopen(self, interaction: discord.Interaction) -> None:
        await self._confirm_then(
            interaction,
            "Clear this week's pick? Voting stays open and the pool + votes are kept; "
            "the calendar entry for it is removed.",
            "Reopen",
            self.cog.reopen,
        )

    async def _start_new_vote(self, interaction: discord.Interaction) -> None:
        await self._confirm_then(
            interaction,
            "Start a brand-new round? This permanently clears ALL VNs and votes from "
            "the pool and removes the current pick. This can't be undone.",
            "Start new round",
            self.cog.start_new_vote,
        )

    async def _confirm_then(self, interaction, prompt, confirm_label, action, fail_note=None) -> None:
        confirm = ConfirmView(interaction.user.id, confirm_label=confirm_label, cancel_label="Back", timeout=30)
        await interaction.response.edit_message(content=prompt, embed=None, view=confirm)
        await confirm.wait()
        ok = True
        if confirm.value:
            ok = await action()
        await self._rerender(interaction)
        if confirm.value and ok is False and fail_note:
            await interaction.followup.send(fail_note, ephemeral=True)

    async def _refresh(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self._rerender(interaction)

    async def _configure(self, interaction: discord.Interaction) -> None:
        view = RoudokuConfigView(self)
        await interaction.response.edit_message(content=None, embed=view.get_embed(), view=view)

    async def _manage_pool(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.reload()  # open on a fresh pool + session
        view = RoudokuPoolView(self, self.cycle, self.standings)
        await interaction.edit_original_response(content=None, embed=view.get_embed(), view=view)

    async def _manage_votes(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.reload()
        async with async_session_maker() as db:
            votes = await rd.list_votes(db, self.cycle.id) if self.cycle else []
        names = await resolve_voter_names(interaction.guild, self.cog.bot, {uid for uid, *_ in votes})
        view = RoudokuVotesView(self, self.cycle, votes, names)
        await interaction.edit_original_response(content=None, embed=view.get_embed(), view=view)

    async def _manage_events(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        async with async_session_maker() as db:
            events = await rd.list_roudoku_events(db)
        view = RoudokuEventsView(self, events)
        await interaction.edit_original_response(content=None, embed=view.get_embed(), view=view)


class _SessionModal(ui.Modal, title="Schedule Weekly Roudoku"):
    def __init__(self, default_hint: str = ""):
        super().__init__()
        self.session: datetime | None = None
        self.use_default = False
        self.session_input = ui.TextInput(
            label="Session UTC (blank = weekly default)",
            placeholder=default_hint or "2026-06-21 12:00",
            default=default_hint or None,
            required=False,
            max_length=16,
        )
        self.add_item(self.session_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self.session_input.value.strip()
        if not raw:
            self.use_default = True
            await interaction.response.defer()
            return
        try:
            self.session = datetime.strptime(raw, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            await interaction.response.send_message(
                "Invalid session time. Use YYYY-MM-DD HH:MM (UTC), or leave blank for the weekly default.",
                ephemeral=True,
            )
            return
        await interaction.response.defer()


# --- Configure sub-panel (channel + schedule + length cap + roles) --------

class RoudokuConfigView(BaseView):
    def __init__(self, parent: RoudokuAdminView):
        super().__init__(parent.user_id, timeout=300)
        self.parent = parent
        self.cog = parent.cog
        self._build()

    def _build(self) -> None:
        self.clear_items()
        self.add_item(_ChannelSelect(self))
        self.add_item(_WeekdaySelect(self))
        self.add_item(_VoteRoleSelect(self))
        self.add_item(_NotifyRoleSelect(self))
        self.add_item(_Btn(self._edit_time, "Set time", discord.ButtonStyle.secondary, "🕒", row=4))
        self.add_item(_Btn(self._edit_max_length, "Set max length", discord.ButtonStyle.secondary, "📏", row=4))
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=4))

    def get_embed(self) -> discord.Embed:
        return self.cog.config_embed()

    async def _rerender(self, interaction: discord.Interaction) -> None:
        await self.cog._load_config()
        self._build()
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _edit_time(self, interaction: discord.Interaction) -> None:
        modal = _TimeModal(self.cog)
        await interaction.response.send_modal(modal)
        await modal.wait()
        if modal.saved:
            await self._rerender(interaction)

    async def _edit_max_length(self, interaction: discord.Interaction) -> None:
        modal = _MaxLengthModal(self.cog)
        await interaction.response.send_modal(modal)
        await modal.wait()
        if modal.saved:
            await self._rerender(interaction)

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)


class _ChannelSelect(ui.ChannelSelect):
    """Optional Roudoku channel. Pick one to run the cycle hands-off there; deselect
    to go back to manual (Post vote board posts to the channel you run it in)."""

    def __init__(self, view: RoudokuConfigView):
        super().__init__(
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
            placeholder="Weekly Roudoku channel (deselect = manual)…",
            min_values=0,
            max_values=1,
            row=0,
        )
        self.cfg_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        channel_id = self.values[0].id if self.values else None
        await self.cfg_view.cog.set_config(channel_id=channel_id)
        await self.cfg_view._rerender(interaction)


class _WeekdaySelect(ui.Select):
    def __init__(self, view: RoudokuConfigView):
        cur = view.cog._show_weekday
        options = [discord.SelectOption(label="Off (manual session each time)", value="off", default=cur is None)]
        for i, name in enumerate(WEEKDAY_LABELS):
            options.append(discord.SelectOption(label=f"Default day: {name}", value=str(i), default=cur == i))
        super().__init__(placeholder="Default day of week…", options=options, row=1)
        self.cfg_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        val = self.values[0]
        await self.cfg_view.cog.set_config(show_weekday=None if val == "off" else int(val))
        await self.cfg_view._rerender(interaction)


class _VoteRoleSelect(ui.RoleSelect):
    """Optional role gate on voting. Pick a role to restrict voting; deselect to
    reopen voting to everyone."""

    def __init__(self, view: RoudokuConfigView):
        super().__init__(
            placeholder="Restrict voting to a role (deselect = everyone)…",
            min_values=0,
            max_values=1,
            row=2,
        )
        self.cfg_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        role_id = self.values[0].id if self.values else None
        await self.cfg_view.cog.set_config(vote_role_id=role_id)
        await self.cfg_view._rerender(interaction)


class _NotifyRoleSelect(ui.RoleSelect):
    """Optional role pinged in the Roudoku channel when the session arrives;
    deselect for no ping."""

    def __init__(self, view: RoudokuConfigView):
        super().__init__(
            placeholder="Ping a role at the session (deselect = no ping)…",
            min_values=0,
            max_values=1,
            row=3,
        )
        self.cfg_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        role_id = self.values[0].id if self.values else None
        await self.cfg_view.cog.set_config(notify_role_id=role_id)
        await self.cfg_view._rerender(interaction)


class _TimeModal(ui.Modal, title="Default session time"):
    def __init__(self, cog):
        super().__init__()
        self.cog = cog
        self.saved = False
        self.time_input = ui.TextInput(
            label="Default time (HH:MM UTC)",
            placeholder="12:00",
            default=cog._show_time or None,
            required=False,
            max_length=5,
        )
        self.add_item(self.time_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        t = self.time_input.value.strip()
        if t:
            try:
                hh, mm = (int(x) for x in t.split(":"))
                if not (0 <= hh < 24 and 0 <= mm < 60):
                    raise ValueError
            except ValueError:
                await interaction.response.send_message("Invalid time. Use HH:MM (24h UTC).", ephemeral=True)
                return
        await self.cog.set_config(show_time=t)
        self.saved = True
        await interaction.response.defer()


class _MaxLengthModal(ui.Modal, title="Nomination length cap"):
    """The cap is parsed on every nominate, so it is validated here on the way in
    rather than trusted on the way out."""

    def __init__(self, cog):
        super().__init__()
        self.cog = cog
        self.saved = False
        self.length_input = ui.TextInput(
            label="Max length (e.g. 120, or 2h)",
            placeholder="120",
            default=str(cog._max_length),
            required=True,
            max_length=8,
        )
        self.add_item(self.length_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self.length_input.value.strip().lower()
        try:
            minutes = int(round(float(raw[:-1]) * 60)) if raw.endswith("h") else int(raw)
        except ValueError:
            await interaction.response.send_message(
                "Invalid length. Enter minutes (e.g. `120`) or hours (e.g. `2h`).", ephemeral=True
            )
            return
        if not (1 <= minutes <= MAX_LENGTH_CEILING):
            await interaction.response.send_message(
                f"Length must be between 1 and {MAX_LENGTH_CEILING} minutes.", ephemeral=True
            )
            return
        await self.cog.set_config(max_length=minutes)
        self.saved = True
        await interaction.response.defer()


# --- Manage pool sub-panel (curate the pool, hand-pick, set cover mode) ---

class RoudokuPoolView(BaseView):
    """Admin pool curation: pick a VN from the pool to remove it, declare it the winner
    directly (overriding the vote), or change how its cover is rendered."""

    def __init__(self, parent: RoudokuAdminView, cycle, standings):
        super().__init__(parent.user_id, timeout=300)
        self.parent = parent
        self.cog = parent.cog
        self.cycle = cycle
        self.standings = standings
        self.selected_id: int | None = None
        self._build()

    def _build(self) -> None:
        self.clear_items()
        if self.standings:
            self.add_item(_PoolSelect(self))
        chosen = self.selected_id is not None
        has_session = bool(self.cycle and self.cycle.scheduled_for)
        paused = bool(self.cycle and self.cycle.phase == "paused")
        win = _Btn(self._set_winner, "Set as winner", discord.ButtonStyle.primary, "🏆", row=1)
        win.disabled = not (chosen and has_session and not paused)
        cover = _Btn(self._cover_mode, "Cover mode", discord.ButtonStyle.secondary, "🖼", row=1)
        cover.disabled = not chosen
        remove = _Btn(self._remove, "Remove from pool", discord.ButtonStyle.danger, "🗑", row=1)
        remove.disabled = not chosen
        self.add_item(win)
        self.add_item(cover)
        self.add_item(remove)
        self.add_item(_Btn(self._add, "Add a VN", discord.ButtonStyle.success, "➕", row=2))
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=2))

    def get_embed(self) -> discord.Embed:
        return self.cog.pool_embed(self.cycle, self.standings, self.selected_id)

    def _vn_label(self, nom_id: int) -> str:
        """Only used inside confirm-prompt message bodies, so it is escaped."""
        for nom, _ in self.standings:
            if nom.id == nom_id:
                return safe_title(nom)
        return "this VN"

    def _selected_nom(self):
        return next((nom for nom, _ in self.standings if nom.id == self.selected_id), None)

    async def reload(self) -> None:
        async with async_session_maker() as db:
            self.cycle = await rd.get_active_cycle(db)
            self.standings = await rd.tally(db, self.cycle.id) if self.cycle else []
        if self.selected_id not in {nom.id for nom, _ in self.standings}:
            self.selected_id = None  # drop a selection that's no longer in the pool
        self._build()

    async def _set_winner(self, interaction: discord.Interaction) -> None:
        sel = self.selected_id
        if sel is None:
            await interaction.response.defer()
            return
        title = self._vn_label(sel)
        confirm = ConfirmView(interaction.user.id, confirm_label="Set as pick", cancel_label="Back", timeout=30)
        await interaction.response.edit_message(
            content=(
                f"Set **{title}** as this week's pick (overriding the vote)? It stays in the "
                "pool marked 👑, the votes are kept, and it's announced + published to the "
                "calendar. Any previous pick reverts to a normal entry."
            ),
            embed=None,
            view=confirm,
        )
        await confirm.wait()
        if confirm.value:
            ok = await self.cog.set_winner(sel)
            await self.reload()  # pool persists; show the new 👑 in place
            await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)
            if not ok:
                await interaction.followup.send(
                    "⚠️ Couldn't set that VN as the pick - it's no longer in the pool.", ephemeral=True
                )
        else:
            await self.reload()
            await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _add(self, interaction: discord.Interaction) -> None:
        modal = _AddVNModal()
        await interaction.response.send_modal(modal)
        await modal.wait()
        if not modal.query:
            return
        note = await self.cog.admin_add_to_pool(
            modal.on_behalf_of or interaction.user.id, modal.query
        )
        await self.reload()
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)
        if note:
            await interaction.followup.send(note, ephemeral=True,
                                            allowed_mentions=discord.AllowedMentions.none())

    async def _cover_mode(self, interaction: discord.Interaction) -> None:
        nom = self._selected_nom()
        if nom is None:
            await interaction.response.defer()
            return
        view = _CoverModeView(self, nom)
        await interaction.response.edit_message(content=None, embed=view.get_embed(), view=view)

    async def _remove(self, interaction: discord.Interaction) -> None:
        sel = self.selected_id
        if sel is None:
            await interaction.response.defer()
            return
        title = self._vn_label(sel)
        confirm = ConfirmView(interaction.user.id, confirm_label="Remove", cancel_label="Back", timeout=30)
        await interaction.response.edit_message(
            content=f"Remove **{title}** from the pool? Any votes for it are cleared.",
            embed=None,
            view=confirm,
        )
        await confirm.wait()
        if confirm.value:
            await self.cog.remove_from_pool(sel)
        await self.reload()
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)


class _AddVNModal(ui.Modal, title="Add a VN to the pool"):
    """Admin hand-add, which skips the length gate.

    The gate rejects VNs with no length data on VNDB and tells members to ask an
    admin, so this is the path that makes that instruction true.
    """

    def __init__(self):
        super().__init__()
        self.query: str | None = None
        self.on_behalf_of: int | None = None
        self.query_input = ui.TextInput(
            label="VNDB id or title",
            placeholder="v17, or part of the title",
            required=True,
            max_length=200,
        )
        # The pool holds one nomination per member, so without this the add would
        # consume the admin's own slot (and swap away their nomination) instead of
        # giving the VN to the member who asked for it.
        self.user_input = ui.TextInput(
            label="Add for member (user ID, blank = yourself)",
            placeholder="123456789012345678",
            required=False,
            max_length=20,
        )
        self.add_item(self.query_input)
        self.add_item(self.user_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self.user_input.value.strip()
        if raw:
            if not raw.isdigit():
                await interaction.response.send_message(
                    "That doesn't look like a user ID. Turn on Developer Mode and use "
                    "Copy User ID, or leave it blank to nominate as yourself.",
                    ephemeral=True,
                )
                return
            self.on_behalf_of = int(raw)
        self.query = self.query_input.value.strip()
        await interaction.response.defer()


class _PoolSelect(ui.Select):
    def __init__(self, view: RoudokuPoolView):
        options = []
        for nom, count in view.standings[:25]:
            plural = "s" if count != 1 else ""
            length = length_utils.format_length(rd.nomination_length_minutes(nom))
            options.append(
                discord.SelectOption(
                    label=rd.display_title(nom)[:100],
                    value=str(nom.id),
                    description=f"{length} · {count} vote{plural}"[:100],
                    default=view.selected_id == nom.id,
                )
            )
        super().__init__(placeholder="Choose a VN…", options=options, min_values=1, max_values=1, row=0)
        self.pool_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        self.pool_view.selected_id = int(self.values[0])
        self.pool_view._build()
        await interaction.response.edit_message(embed=self.pool_view.get_embed(), view=self.pool_view)


class _CoverModeView(BaseView):
    """Override how one nomination's cover art is rendered in the announcement banner
    and on the calendar."""

    def __init__(self, parent: RoudokuPoolView, nom):
        super().__init__(parent.user_id, timeout=180)
        self.parent = parent
        self.cog = parent.cog
        self.nom = nom
        self.add_item(_CoverModeSelect(self))
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=1))

    def get_embed(self) -> discord.Embed:
        current = self.nom.cover_mode or "auto"
        embed = discord.Embed(
            title=f"🖼 Cover mode · {rd.display_title(self.nom)}",
            description=(
                f"**Current:** {COVER_MODE_LABELS.get(current, current)}\n\n"
                "Auto suits almost every VN. Use the others when a cover needs a call "
                "the NSFW score doesn't capture."
            ),
            color=COLOR,
        )
        score = self.nom.image_sexual
        embed.add_field(
            name="VNDB NSFW score",
            value="unrated" if score is None else f"{score:.2f}",
            inline=True,
        )
        return embed

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)


class _CoverModeSelect(ui.Select):
    def __init__(self, view: _CoverModeView):
        current = view.nom.cover_mode or "auto"
        options = [
            discord.SelectOption(label=mode.capitalize(), value=mode, description=label[:100], default=mode == current)
            for mode, label in COVER_MODE_LABELS.items()
        ]
        super().__init__(placeholder="Choose how to render the cover…", options=options, row=0)
        self.cover_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        mode = self.values[0]
        await self.cover_view.cog.set_cover_mode(self.cover_view.nom.id, mode)
        self.cover_view.nom.cover_mode = mode
        self.cover_view.clear_items()
        self.cover_view.add_item(_CoverModeSelect(self.cover_view))
        self.cover_view.add_item(
            _Btn(self.cover_view._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=1)
        )
        await interaction.edit_original_response(embed=self.cover_view.get_embed(), view=self.cover_view)


# --- Manage votes sub-panel (remove a voter's vote) ----------------------

class RoudokuVotesView(BaseView):
    """Admin vote moderation: pick a cast vote and remove it (troll/duplicate).
    Surgical per-vote removal, paginated, and refreshes the public board."""

    PAGE = 25

    def __init__(self, parent: RoudokuAdminView, cycle, votes, names):
        super().__init__(parent.user_id, timeout=300)
        self.parent = parent
        self.cog = parent.cog
        self.cycle = cycle
        self.votes = votes  # [(user_id, nomination_id, title, created_at)] newest first
        self.names = names  # {user_id: display_name}, pre-resolved
        self.page = 0
        self.selected_user_id: int | None = None
        self._build()

    def _pages(self) -> int:
        return max(1, (len(self.votes) + self.PAGE - 1) // self.PAGE)

    def _page_votes(self):
        start = self.page * self.PAGE
        return self.votes[start:start + self.PAGE]

    def _name(self, user_id: int) -> str:
        return self.names.get(user_id) or f"User {user_id}"

    def _build(self) -> None:
        self.clear_items()
        if self.votes:
            self.add_item(_VoteSelect(self))
        remove = _Btn(self._remove, "Remove vote", discord.ButtonStyle.danger, "🗑", row=1)
        remove.disabled = self.selected_user_id is None
        self.add_item(remove)
        if self._pages() > 1:
            prev = _Btn(self._prev, "Newer", discord.ButtonStyle.secondary, "◀️", row=1)
            prev.disabled = self.page <= 0
            nxt = _Btn(self._next, "Older", discord.ButtonStyle.secondary, "▶️", row=1)
            nxt.disabled = self.page >= self._pages() - 1
            self.add_item(prev)
            self.add_item(nxt)
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=2))

    def get_embed(self) -> discord.Embed:
        embed = discord.Embed(title="📚 Weekly Roudoku: Manage votes", color=COLOR)
        if not self.votes:
            embed.description = "No votes have been cast yet."
            return embed
        lines = []
        for uid, _nid, title, ts in self._page_votes():
            marker = "➡️ " if uid == self.selected_user_id else ""
            when = f" · <t:{int(ts.timestamp())}:R>" if ts else ""
            lines.append(f"{marker}**{inert_text(self._name(uid), 40)}** → {inert_text(title, 60)}{when}")
        embed.description = "\n".join(lines)[:4000]
        pages = self._pages()
        suffix = f" · page {self.page + 1}/{pages}" if pages > 1 else ""
        embed.set_footer(text=f"{len(self.votes)} vote(s){suffix} · pick one to remove it")
        return embed

    async def reload(self) -> None:
        async with async_session_maker() as db:
            self.cycle = await rd.get_active_cycle(db)
            self.votes = await rd.list_votes(db, self.cycle.id) if self.cycle else []
        if self.page >= self._pages():
            self.page = self._pages() - 1
        if self.selected_user_id not in {uid for uid, *_ in self.votes}:
            self.selected_user_id = None
        self._build()

    async def _remove(self, interaction: discord.Interaction) -> None:
        uid = self.selected_user_id
        if uid is None:
            await interaction.response.defer()
            return
        await interaction.response.defer()
        await self.cog.remove_vote(uid)
        await self.reload()
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _prev(self, interaction: discord.Interaction) -> None:
        self.page = max(0, self.page - 1)
        self.selected_user_id = None
        self._build()
        await interaction.response.edit_message(embed=self.get_embed(), view=self)

    async def _next(self, interaction: discord.Interaction) -> None:
        self.page = min(self._pages() - 1, self.page + 1)
        self.selected_user_id = None
        self._build()
        await interaction.response.edit_message(embed=self.get_embed(), view=self)

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)


class _VoteSelect(ui.Select):
    def __init__(self, view: RoudokuVotesView):
        options = []
        for uid, _nid, title, _ts in view._page_votes():
            label = f"{view._name(uid)} → {title}"[:100]
            options.append(
                discord.SelectOption(label=label, value=str(uid), default=view.selected_user_id == uid)
            )
        super().__init__(placeholder="Choose a vote to remove…", options=options, min_values=1, max_values=1, row=0)
        self.votes_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        self.votes_view.selected_user_id = int(self.values[0])
        self.votes_view._build()
        await interaction.response.edit_message(embed=self.votes_view.get_embed(), view=self.votes_view)


# --- Manage roudoku events sub-panel (calendar rows, not the live vote) ---

class RoudokuEventsView(BaseView):
    """Manage the roudoku calendar rows directly: add one on any date, edit or move it,
    or delete it. Separate from the live vote - picked VNs also land here once
    published, so this is also where you fix or remove a past pick's entry."""

    def __init__(self, parent: RoudokuAdminView, events):
        super().__init__(parent.user_id, timeout=300)
        self.parent = parent
        self.cog = parent.cog
        self.events = events  # [Event], latest date first
        self._build()

    def _build(self) -> None:
        self.clear_items()
        if self.events:
            self.add_item(_RoudokuEventSelect(self))
        self.add_item(_Btn(self._create, "Add roudoku event", discord.ButtonStyle.success, "➕", row=1))
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️", row=1))

    def get_embed(self) -> discord.Embed:
        embed = discord.Embed(title="📆 Weekly Roudoku: Calendar events", color=0x5865F2)
        if not self.events:
            embed.description = (
                "No roudoku events on the calendar yet.\n\n"
                "Use **Add roudoku event** to put one on any date."
            )
            return embed
        now = datetime.now(timezone.utc)
        lines = []
        for ev in self.events:
            tag = "" if ev.start_at >= now else " · past"
            lines.append(f"📚 **{ev.start_at:%Y-%m-%d}** · {ev.title}{tag}")
        embed.description = "\n".join(lines)[:4000]
        embed.set_footer(text=f"{len(self.events)} event(s) · pick one to edit or delete")
        return embed

    async def reload(self) -> None:
        async with async_session_maker() as db:
            self.events = await rd.list_roudoku_events(db)
        self._build()

    async def _create(self, interaction: discord.Interaction) -> None:
        modal = EventModal()
        await interaction.response.send_modal(modal)
        await modal.wait()
        if not modal.result:
            return
        r = modal.result
        async with async_session_maker() as db:
            _ev, status = await rd.create_roudoku_event(
                db,
                title=r["title"],
                start_at=r["start_at"],
                all_day=r["all_day"],
                image_url=r["image_url"],
                description=r["description"],
            )
        await self.reload()
        if status == "conflict":
            await interaction.followup.send(
                f"⚠️ There's already a roudoku event on {r['start_at']:%Y-%m-%d}. Edit that one instead.",
                ephemeral=True,
            )
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)


class _RoudokuEventSelect(ui.Select):
    def __init__(self, view: RoudokuEventsView):
        options = []
        for ev in view.events[:25]:
            when = ev.start_at.strftime("%Y-%m-%d" if ev.all_day else "%Y-%m-%d %H:%M")
            options.append(
                discord.SelectOption(label=ev.title[:100], value=str(ev.id), description=when[:100])
            )
        super().__init__(placeholder="Choose a roudoku event…", options=options, min_values=1, max_values=1, row=0)
        self.events_view = view

    async def callback(self, interaction: discord.Interaction) -> None:
        event_id = int(self.values[0])
        ev = next((e for e in self.events_view.events if e.id == event_id), None)
        if not ev:
            await interaction.response.send_message("That event is no longer available.", ephemeral=True)
            return
        action = RoudokuEventActionView(self.events_view, ev)
        await interaction.response.edit_message(embed=action.get_embed(), view=action)


class RoudokuEventActionView(BaseView):
    """Edit/move or delete a single roudoku calendar row."""

    def __init__(self, parent: RoudokuEventsView, event):
        super().__init__(parent.user_id, timeout=300)
        self.parent = parent
        self.cog = parent.cog
        self.event = event
        self.add_item(_Btn(self._edit, "Edit / move date", discord.ButtonStyle.primary, "✏️"))
        self.add_item(_Btn(self._delete, "Delete", discord.ButtonStyle.danger, "🗑"))
        self.add_item(_Btn(self._back, "Back", discord.ButtonStyle.secondary, "⬅️"))

    def get_embed(self) -> discord.Embed:
        ev = self.event
        when = ev.start_at.strftime("%Y-%m-%d" if ev.all_day else "%Y-%m-%d %H:%M UTC")
        embed = discord.Embed(
            title=ev.title, description=ev.description or "(no description)", color=0x5865F2
        )
        embed.add_field(name="When", value=when, inline=True)
        if ev.image_url:
            embed.set_thumbnail(url=ev.image_url)
        return embed

    async def _edit(self, interaction: discord.Interaction) -> None:
        modal = EventModal(event=self.event)
        await interaction.response.send_modal(modal)
        await modal.wait()
        if not modal.result:
            return
        r = modal.result
        async with async_session_maker() as db:
            ev, status = await rd.update_roudoku_event(
                db,
                self.event.id,
                title=r["title"],
                start_at=r["start_at"],
                all_day=r["all_day"],
                image_url=r["image_url"],
                description=r["description"],
            )
        if status == "conflict":
            await interaction.followup.send(
                f"⚠️ There's already a roudoku event on {r['start_at']:%Y-%m-%d}. Pick a different date.",
                ephemeral=True,
            )
            return
        if status == "is_live_pick":
            await interaction.followup.send(
                "⚠️ That's this week's live pick, so its date can't be moved from here - "
                "the vote would still point at the old date. Reopen the pick first, or "
                "use Set session to move the whole round.",
                ephemeral=True,
            )
            return
        if ev:
            self.event = ev
        await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _delete(self, interaction: discord.Interaction) -> None:
        confirm = ConfirmView(interaction.user.id, confirm_label="Delete", cancel_label="Back", timeout=30)
        await interaction.response.edit_message(
            content=f"Delete the roudoku event **{self.event.title}** ({self.event.start_at:%Y-%m-%d})?",
            embed=None,
            view=confirm,
        )
        await confirm.wait()
        if confirm.value:
            async with async_session_maker() as db:
                await rd.delete_roudoku_event(db, self.event.id)
            await self.parent.reload()
            await interaction.edit_original_response(
                content=None, embed=self.parent.get_embed(), view=self.parent
            )
        else:
            await interaction.edit_original_response(content=None, embed=self.get_embed(), view=self)

    async def _back(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        await self.parent.reload()
        await interaction.edit_original_response(content=None, embed=self.parent.get_embed(), view=self.parent)
