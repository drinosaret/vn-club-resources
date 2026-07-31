"""Weekly Roudoku vote views (a port of the Movie Night board, VN-flavoured).

The standing vote board shows two sections - Choices (A-Z, nominator usertag,
VN link, length) and Standings (ranked by votes, %) - plus a nominee Select, a
Participants button (who voted for what) and a Manage-your-vote button.
/roudoku_vote opens an ephemeral copy of the same. Voting is always open unless
the cycle is paused. Persistent (timeout=None) so the board survives restarts.

Every custom_id is prefixed roudoku_ rather than movie_: discord.py keys
persistent views by custom_id, so sharing one with Movie Night would route
clicks to the wrong feature after a restart.
"""

import logging

import discord
from discord import ui

from app.db.database import async_session_maker
from app.db.models import RoudokuCycle, RoudokuNomination
from app.services import jiten_covers, length_utils
from app.services import roudoku_service as rd
from discord_bot.utils.embeds import inert_text

logger = logging.getLogger(__name__)

COLOR = 0xD946EF  # fuchsia, matching the site's roudoku chip in event-meta.ts
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXY"  # Discord select caps at 25
_PARTICIPANTS_PAGE = 10


JITEN_DECK_URL = "https://jiten.moe/decks/media/{deck_id}/detail"


def vn_url(vndb_id: str) -> str:
    """Where the bot points members for a VN: VNDB, the source of the metadata."""
    return rd.VNDB_URL.format(vndb_id=vndb_id)


async def jiten_url(vndb_id: str) -> str | None:
    """The VN's jiten.moe deck page, or None when it isn't on jiten. Uses the same
    cached deck lookup as the cover swap, so this costs nothing extra."""
    try:
        deck_id = await jiten_covers.resolve_deck_id(vndb_id)
    except Exception as exc:  # noqa: BLE001 - a missing link is not worth failing over
        logger.warning("jiten deck lookup failed for %s: %s", vndb_id, type(exc).__name__)
        return None
    return JITEN_DECK_URL.format(deck_id=deck_id) if deck_id else None


def _length_label(nom: RoudokuNomination) -> str:
    return length_utils.format_length(rd.nomination_length_minutes(nom))


def safe_title(vn, limit: int = 80) -> str:
    """A VN title made literal for embed body text.

    Titles come from the VNDB dump, which anyone can edit, so they are never
    interpolated raw. For markdown link labels use safe_link_label instead.
    """
    return inert_text(rd.display_title(vn), limit=limit)


# Only the brackets can terminate a [label](url) early, and Discord does NOT
# honour backslash escapes inside a link label - it renders the backslashes
# literally. So labels swap the brackets for their fullwidth twins, which read
# the same and cannot close the label. At least one live title is `[red](R)`,
# which would otherwise open an attacker-chosen link on the public board.
_LABEL_SAFE = str.maketrans({"[": "［", "]": "］"})


def safe_link_label(vn, limit: int = 80) -> str:
    text = rd.display_title(vn)
    if len(text) > limit:
        text = text[:limit] + "..."
    return text.translate(_LABEL_SAFE)


async def _tag(bot: discord.Client, user_id: int) -> str:
    """Resolve a user_id to a plain @username (no ping), best-effort."""
    user = bot.get_user(user_id)
    if user is not None:
        return user.name
    try:
        user = await bot.fetch_user(user_id)
        return user.name
    except Exception:
        return "unknown-user"


async def check_vote_role(interaction: discord.Interaction) -> str | None:
    """If voting is gated to a role and the member lacks it, return a rejection
    message; otherwise None (voting allowed for everyone)."""
    async with async_session_maker() as db:
        role_id = await rd.get_vote_role_id(db)
    if not role_id:
        return None
    member = interaction.user if isinstance(interaction.user, discord.Member) else None
    if member is None:
        return "You can only vote from within the server."
    if any(r.id == role_id for r in member.roles):
        return None
    return f"You need the <@&{role_id}> role to take part in Weekly Roudoku."


def _voting_closed_reason(cycle: RoudokuCycle | None) -> str | None:
    """Why a vote can't be cast, changed, or removed right now, or None if voting is
    open. Once a winner is picked the round is decided, so votes lock until the next
    round (otherwise someone could pull the vote that produced the pick)."""
    if cycle is None:
        return "Weekly Roudoku isn't running right now."
    if cycle.phase == "paused":
        return "Weekly Roudoku voting is paused right now."
    if cycle.winner_nomination_id is not None:
        return "This week's pick is locked in - voting reopens with the next round."
    return None


def build_vote_options(noms: list[RoudokuNomination]) -> list[discord.SelectOption]:
    options = []
    for nom in noms[:25]:
        options.append(
            discord.SelectOption(
                label=rd.display_title(nom)[:100],
                value=str(nom.id),
                description=_length_label(nom)[:100],
            )
        )
    return options


async def build_vote_embed(
    bot, cycle: RoudokuCycle, standings: list[tuple[RoudokuNomination, int]]
) -> discord.Embed:
    """Two-section embed: Choices (nomination order, A-Z) + Standings (vote order)."""
    noms_by_creation = sorted((n for n, _ in standings), key=lambda n: n.id)
    letter_of = {n.id: _LETTERS[i] for i, n in enumerate(noms_by_creation) if i < len(_LETTERS)}

    tags: dict[int, str] = {}
    for n in noms_by_creation:
        if n.nominated_by and n.nominated_by not in tags:
            tags[n.nominated_by] = await _tag(bot, n.nominated_by)

    meta = []
    if cycle.scheduled_for:
        meta.append(f"**Session:** <t:{int(cycle.scheduled_for.timestamp())}:F>")
    # Once a pick is made or voting is paused the deadline is moot; don't leave a stale
    # "Voting closes: X ago" line next to the pick.
    if cycle.closes_at and cycle.phase != "paused" and cycle.winner_nomination_id is None:
        meta.append(f"**Voting closes:** <t:{int(cycle.closes_at.timestamp())}:R>")

    pick_id = cycle.winner_nomination_id
    choices = []
    for i, n in enumerate(noms_by_creation):
        letter = _LETTERS[i] if i < len(_LETTERS) else "?"
        title = safe_link_label(n)
        tag = tags.get(n.nominated_by, "unknown-user")
        crown = " 👑" if n.id == pick_id else ""
        choices.append(
            f"`{letter}` · [{title}]({vn_url(n.vndb_id)}) · @{tag} · {_length_label(n)}{crown}"
        )

    total_votes = sum(c for _, c in standings)
    standings_lines, zero = [], []
    prev_count, rank = None, 0
    for idx, (n, c) in enumerate(standings):  # standings is vote-desc from tally()
        letter = letter_of.get(n.id, "?")
        if c <= 0:
            zero.append(letter)
            continue
        if c != prev_count:
            rank = idx + 1
            prev_count = c
        pct = (c / total_votes * 100) if total_votes else 0
        standings_lines.append(
            f"`{rank:>2}.` `{letter}` · {safe_title(n, limit=40)} · **{pct:.1f}%** ({c})"
        )

    pick_nom = next((n for n in noms_by_creation if n.id == pick_id), None)
    lines = []
    if cycle.phase == "paused":
        lines += ["⏸ **Voting is paused.**", ""]
    lines += list(meta)
    if pick_nom:
        lines.append(f"🏆 **This week's pick:** {safe_title(pick_nom)}")
    if meta or pick_nom:
        lines.append("")
    lines.append("📋 **Choices**")
    lines += choices or ["No VNs yet - add one with **/roudoku_nominate**."]
    lines += ["", f"📊 **Standings** · {total_votes} vote{'s' if total_votes != 1 else ''}"]
    lines += standings_lines or ["_No votes yet._"]
    if zero:
        lines.append(f"_No votes: {', '.join(zero)}_")
    if cycle.winner_nomination_id is not None and cycle.phase != "paused":
        lines += ["", "🔒 Voting is closed - this week's pick is locked in."]
    else:
        lines += ["", "Tap below or use **/roudoku_vote** for a personal voting menu."]

    return discord.Embed(
        title="📚 Weekly Roudoku: Vote", description="\n".join(lines)[:4000], color=COLOR
    )


async def refresh_public_vote_message(bot, cycle_id: int) -> None:
    """Re-render the public vote message in place (embed + view)."""
    async with async_session_maker() as db:
        cycle = await rd.get_cycle(db, cycle_id)
        if not cycle or not cycle.message_id or not cycle.channel_id:
            return
        standings = await rd.tally(db, cycle_id)
    channel = bot.get_channel(cycle.channel_id)
    if channel is None:
        return
    try:
        msg = await channel.fetch_message(cycle.message_id)
        view = RoudokuVoteView(cycle.id, build_vote_options([n for n, _ in standings]))
        embed = await build_vote_embed(bot, cycle, standings)
        await msg.edit(embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none())
        bot.add_view(view, message_id=cycle.message_id)
    except discord.HTTPException:
        pass


class RoudokuVoteSelect(ui.Select):
    def __init__(self, cycle_id: int, options: list[discord.SelectOption]):
        super().__init__(
            placeholder="Vote for a VN...",
            custom_id=f"roudoku_vote:{cycle_id}",
            min_values=1,
            max_values=1,
            options=options or [discord.SelectOption(label="(no VNs yet)", value="0")],
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        nomination_id = int(self.values[0])
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.response.send_message(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return
        async with async_session_maker() as db:
            cycle = await rd.get_cycle(db, self.cycle_id)
            reason = _voting_closed_reason(cycle)
            if reason:
                await interaction.response.send_message(reason, ephemeral=True)
                return
            if nomination_id == 0:
                await interaction.response.send_message(
                    "No VNs to vote for yet - add one with /roudoku_nominate.", ephemeral=True
                )
                return
            # Validate the nomination still exists in THIS cycle before casting: a
            # persistent board can outlive its pool (a VN removed, or a new round
            # started), and casting a vote for a deleted nomination would hit an FK error.
            nom = await rd.get_nomination(db, nomination_id)
            if not nom or nom.cycle_id != self.cycle_id:
                await interaction.response.send_message(
                    "That VN is no longer in the pool - it may have just been picked or removed.",
                    ephemeral=True,
                )
                return
            title = safe_title(nom)
            prev = await rd.get_user_vote(db, self.cycle_id, interaction.user.id)
            replaced = prev is not None and prev.nomination_id != nomination_id
            await rd.cast_vote(db, self.cycle_id, interaction.user.id, nomination_id)
        logger.info(
            "Roudoku vote cast: user=%s cycle=%s nomination=%s vndb=%s replaced=%s",
            interaction.user.id, self.cycle_id, nomination_id, nom.vndb_id, replaced,
        )
        verb = "Replaced your vote with" if replaced else "Voted for"
        await interaction.response.send_message(
            f"✅ {verb} **{title}**.", ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )
        await refresh_public_vote_message(interaction.client, self.cycle_id)


class ParticipantsButton(ui.Button):
    def __init__(self, cycle_id: int):
        super().__init__(
            style=discord.ButtonStyle.secondary, emoji="👥", label="Participants",
            custom_id=f"roudoku_participants:{cycle_id}", row=1,
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await rd.get_cycle(db, self.cycle_id)
            noms = await rd.list_nominations(db, self.cycle_id) if cycle else []
        if not noms:
            await interaction.response.send_message("No VNs in this round yet.", ephemeral=True)
            return
        view = ParticipantsView(interaction.client, self.cycle_id, noms)
        await interaction.response.send_message(embed=await view.render(), view=view, ephemeral=True)


class ManageVotesButton(ui.Button):
    def __init__(self, cycle_id: int):
        super().__init__(
            style=discord.ButtonStyle.secondary, emoji="🗑", label="Manage your vote",
            custom_id=f"roudoku_manage:{cycle_id}", row=1,
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await rd.get_cycle(db, self.cycle_id)
            vote = await rd.get_user_vote(db, self.cycle_id, interaction.user.id)
            nom = await rd.get_nomination(db, vote.nomination_id) if vote else None
        if not vote or not nom:
            await interaction.response.send_message(
                "You haven't voted in this round yet.", ephemeral=True
            )
            return
        # Escaped for the message body, raw for the button label: button labels
        # are plain text, so escaping there would just show the backslashes.
        safe = safe_title(nom)
        reason = _voting_closed_reason(cycle)
        if reason:
            await interaction.response.send_message(
                f"Your vote: **{safe}**. {reason}", ephemeral=True,
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        view = ui.View(timeout=120)
        view.add_item(_RemoveVoteButton(self.cycle_id, rd.display_title(nom)))
        await interaction.response.send_message(
            f"Your vote: **{safe}**. Remove it below.", view=view, ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )


class _RemoveVoteButton(ui.Button):
    def __init__(self, cycle_id: int, title: str):
        super().__init__(style=discord.ButtonStyle.danger, label=f"Remove vote ({title[:60]})")
        self.cycle_id = cycle_id
        self.title = title

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await rd.get_cycle(db, self.cycle_id)
            reason = _voting_closed_reason(cycle)
            if reason:
                await interaction.response.edit_message(content=reason, view=None)
                return
            removed = await rd.remove_user_vote(db, self.cycle_id, interaction.user.id)
        if removed:
            logger.info(
                "Roudoku vote removed: user=%s cycle=%s", interaction.user.id, self.cycle_id
            )
        await interaction.response.edit_message(content="🗑 Vote removed.", view=None)
        await refresh_public_vote_message(interaction.client, self.cycle_id)


class RoudokuVoteView(ui.View):
    def __init__(self, cycle_id: int, options: list[discord.SelectOption]):
        super().__init__(timeout=None)
        self.add_item(RoudokuVoteSelect(cycle_id, options))
        self.add_item(ParticipantsButton(cycle_id))
        self.add_item(ManageVotesButton(cycle_id))


# ── Participants panel (per-nominee voters, paginated) ─────

class ParticipantsView(ui.View):
    def __init__(self, bot, cycle_id: int, noms: list[RoudokuNomination]):
        super().__init__(timeout=600)
        self.bot = bot
        self.cycle_id = cycle_id
        self.noms = noms
        self.letter_of = {
            n.id: _LETTERS[i]
            for i, n in enumerate(sorted(noms, key=lambda n: n.id))
            if i < len(_LETTERS)
        }
        self.selected = noms[0].id
        self.page = 0
        self._build()

    def _build(self) -> None:
        self.clear_items()
        self.add_item(_NomineeSelect(self))
        self.add_item(_PageButton(self, -1, "◀"))
        self.add_item(_PageButton(self, 1, "▶"))

    async def render(self) -> discord.Embed:
        async with async_session_maker() as db:
            voters = await rd.voters_for_nomination(db, self.cycle_id, self.selected)
            nom = await rd.get_nomination(db, self.selected)
        letter = self.letter_of.get(self.selected, "?")
        pages = max(1, (len(voters) + _PARTICIPANTS_PAGE - 1) // _PARTICIPANTS_PAGE)
        self.page = max(0, min(self.page, pages - 1))
        start = self.page * _PARTICIPANTS_PAGE
        slice_ = voters[start:start + _PARTICIPANTS_PAGE]
        lines = []
        for uid, ts in slice_:
            tag = await _tag(self.bot, uid)
            when = f" · <t:{int(ts.timestamp())}:R>" if ts else ""
            lines.append(f"• @{tag} (<@{uid}>){when}")
        embed = discord.Embed(
            title=f"👥 Participants · {letter} {rd.display_title(nom) if nom else ''}",
            description=f"**{len(voters)} voter(s)**\n" + ("\n".join(lines) or "_No votes yet._"),
            color=COLOR,
        )
        if pages > 1:
            embed.set_footer(text=f"Page {self.page + 1}/{pages}")
        return embed


class _NomineeSelect(ui.Select):
    def __init__(self, view: ParticipantsView):
        options = []
        for n in sorted(view.noms, key=lambda n: n.id)[:25]:
            letter = view.letter_of.get(n.id, "?")
            options.append(
                discord.SelectOption(
                    label=f"{letter} · {rd.display_title(n)}"[:100],
                    value=str(n.id),
                    default=(n.id == view.selected),
                )
            )
        super().__init__(
            placeholder="Pick a VN to see who voted…", options=options, min_values=1, max_values=1
        )
        self.pview = view

    async def callback(self, interaction: discord.Interaction) -> None:
        self.pview.selected = int(self.values[0])
        self.pview.page = 0
        self.pview._build()
        await interaction.response.edit_message(embed=await self.pview.render(), view=self.pview)


class _PageButton(ui.Button):
    def __init__(self, view: ParticipantsView, delta: int, label: str):
        super().__init__(style=discord.ButtonStyle.secondary, label=label, row=1)
        self.pview = view
        self.delta = delta

    async def callback(self, interaction: discord.Interaction) -> None:
        self.pview.page += self.delta
        await interaction.response.edit_message(embed=await self.pview.render(), view=self.pview)


async def register_persistent_roudoku_views(bot: discord.Client) -> None:
    """Re-attach the standing vote board's view on boot so its buttons keep working
    through restarts (whether voting is open or paused)."""
    try:
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            noms = await rd.list_nominations(db, cycle.id) if cycle else []
        if cycle and cycle.message_id:
            bot.add_view(RoudokuVoteView(cycle.id, build_vote_options(noms)), message_id=cycle.message_id)
            logger.info("Re-registered Weekly Roudoku vote view")
    except Exception as e:
        logger.error("Failed to register Weekly Roudoku vote views: %s", e, exc_info=True)
