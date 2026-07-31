"""Weekly Roudoku - persistent pool + always-open voting (one long-lived cycle).

Roudoku (朗読) is reading aloud: each week the club picks one very short VN and
reads it aloud together in a single sitting. That is why the length gate exists
and why it is strict by default.

- /roudoku_nominate (member): add a VN to the pool any time
- /roudoku_vote     (member): open a personal voting menu
- /roudoku          (public): show the VN picked for the next session
- /manage_roudoku   (admin):  pick the winner, reopen, start a new round, set the
  session, pause/resume, post the board, configure; see views/roudoku.py

Structurally a port of Movie Night (see cogs/movie_night.py), with two additions:
nominations are gated on VNDB length, and covers go through jiten_covers so adult
cover art is swapped for a SFW one or blurred rather than posted as-is.

Voting is ALWAYS open (no "open a round" step) unless an admin pauses it. The pool
and votes persist within a week; one VN is flagged as this week's pick
(winner_nomination_id) and published to /events, but it stays in the pool, marked
👑. At the deadline the scheduler auto-picks the leader only if nothing has been
picked yet, and a few hours after the session it rolls the pool over for the week.
"""

import asyncio
import io
import logging
import re
from datetime import datetime, timedelta, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import BotConfig
from app.services import length_utils
from app.services import roudoku_service as rd
from app.services.movie_banner import render_winner_banner
from discord_bot.permissions import is_admin
from discord_bot.views.base import BaseView
from discord_bot.views.roudoku import RoudokuAdminView
from discord_bot.views.roudoku_vote import (
    COLOR,
    RoudokuVoteView,
    build_vote_embed,
    build_vote_options,
    check_vote_role,
    jiten_url,
    refresh_public_vote_message,
    safe_title,
    vn_url,
)
from discord_bot.utils.embeds import inert_text

logger = logging.getLogger(__name__)

CONFIG_ROUDOKU_CHANNEL = "roudoku_channel_id"  # optional: the channel the cycle auto-runs in
CONFIG_ROUDOKU_SHOW_WEEKDAY = "roudoku_show_weekday"  # 0=Mon .. 6=Sun
CONFIG_ROUDOKU_SHOW_TIME = "roudoku_show_time"  # "HH:MM" UTC
CONFIG_ROUDOKU_VOTE_ROLE = rd.CONFIG_VOTE_ROLE  # optional role gate on voting
CONFIG_ROUDOKU_NOTIFY_ROLE = "roudoku_notify_role_id"  # optional role pinged at the session
CONFIG_ROUDOKU_NOTIFIED_FOR = "roudoku_notified_session"  # session the ping already went out for
CONFIG_ROUDOKU_MAX_LENGTH = rd.CONFIG_MAX_LENGTH

# Unlike Movie Night (which stays inert until an admin picks a day), Weekly Roudoku
# ships with its day set, so a fresh install already has a session to aim at.
DEFAULT_SHOW_WEEKDAY = 6  # Sunday
DEFAULT_SHOW_TIME = "12:00"  # UTC
# Longer than Movie Night's 2h: a reading session runs longer than a screening.
AUTO_RESET_AFTER = timedelta(hours=3)
NOTIFY_GRACE = timedelta(minutes=30)  # past this, a caught-up session is stale: skip the ping
VOTE_LEAD = timedelta(days=1)  # the session is streamed, so the pick only needs announcing

ACCENT_RGB = (217, 70, 239)  # the banner's accent bar; COLOR in views/roudoku_vote.py as RGB

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_VNDB_ID_RE = re.compile(r"^v\d+$")
_UNSET = object()


async def _vn_links_view(vndb_id: str | None) -> discord.ui.View:
    """VNDB + jiten link buttons for a VN. The jiten button is dropped when the VN
    has no deck there, rather than linking to a page that doesn't exist."""
    view = discord.ui.View()
    if not vndb_id:
        return view
    view.add_item(
        discord.ui.Button(label="VNDB", url=vn_url(vndb_id), style=discord.ButtonStyle.link)
    )
    jiten = await jiten_url(vndb_id)
    if jiten:
        view.add_item(discord.ui.Button(label="Jiten", url=jiten, style=discord.ButtonStyle.link))
    return view


def format_cap(minutes: int) -> str:
    """The length cap as it reads in copy, e.g. '2h (Very Short)'."""
    return f"{length_utils.format_length(minutes)} ({length_utils.length_bucket_label(minutes)})"


async def roudoku_vn_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    """VN search over the local dump, annotated with eligibility.

    Ineligible VNs are shown with a ⛔ rather than filtered out: a member who types
    a long VN and gets an empty list has no idea why, whereas one who sees it
    greyed with its length learns the rule in a single interaction.
    """
    if not current or len(current) < 2:
        return []
    try:
        async with async_session_maker() as db:
            max_minutes = await rd.get_max_length_minutes(db)
            results = await rd.search_vns(db, current, limit=25)
    except Exception as e:  # autocomplete must never raise back at Discord
        logger.warning("Roudoku autocomplete failed: %s", e)
        return []
    choices = []
    for vn in results:
        ok, _reason = length_utils.passes_length_gate(
            vn.get("length"), vn.get("length_minutes"), max_minutes
        )
        mark = "✅" if ok else "⛔"
        length = length_utils.format_length(
            length_utils.effective_length_minutes(vn.get("length"), vn.get("length_minutes"))
        )
        label = f"{mark} {rd.display_title(vn)} ({vn['vndb_id']}) · {length}"
        choices.append(app_commands.Choice(name=label[:100], value=vn["vndb_id"]))
    return choices


class RoudokuCog(commands.Cog):
    """Weekly Roudoku pool, voting rounds, and admin dashboard."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._board_lock = asyncio.Lock()  # serialize board posting (scheduler + manual)
        self._channel_id = 0  # configured Roudoku channel (0 = none; manual mode)
        self._show_weekday: int | None = DEFAULT_SHOW_WEEKDAY
        self._show_time = DEFAULT_SHOW_TIME
        self._vote_role_id: int | None = None
        self._notify_role_id: int | None = None
        self._notified_session = ""  # session (ISO) the ping already went out for
        self._max_length = rd.DEFAULT_MAX_LENGTH_MIN

    async def cog_load(self) -> None:
        await self._load_config()
        self.scheduler_loop.start()
        self.session_notify_loop.start()

    async def cog_unload(self) -> None:
        self.scheduler_loop.cancel()
        self.session_notify_loop.cancel()

    # ── Config (channel + default weekly schedule + length cap) ───

    @staticmethod
    def _as_int(value, fallback=None):
        """bot_config values are free-form text; a bad row must not take the whole
        config reload down with it."""
        try:
            return int(value) if value not in (None, "") else fallback
        except (TypeError, ValueError):
            return fallback

    async def _load_config(self) -> None:
        keys = [
            CONFIG_ROUDOKU_CHANNEL,
            CONFIG_ROUDOKU_SHOW_WEEKDAY,
            CONFIG_ROUDOKU_SHOW_TIME,
            CONFIG_ROUDOKU_VOTE_ROLE,
            CONFIG_ROUDOKU_NOTIFY_ROLE,
            CONFIG_ROUDOKU_NOTIFIED_FOR,
            CONFIG_ROUDOKU_MAX_LENGTH,
        ]
        try:
            async with async_session_maker() as db:
                result = await db.execute(select(BotConfig).where(BotConfig.key.in_(keys)))
                cfg = {row.key: row.value for row in result.scalars()}
        except Exception as e:
            logger.warning("Failed to load roudoku config: %s", e)
            return
        self._channel_id = self._as_int(cfg.get(CONFIG_ROUDOKU_CHANNEL), 0) or 0
        # An explicitly stored "" means the admin turned the weekly day off; a
        # missing row means it was never configured, which keeps the Sunday default.
        raw_weekday = cfg.get(CONFIG_ROUDOKU_SHOW_WEEKDAY)
        if CONFIG_ROUDOKU_SHOW_WEEKDAY not in cfg:
            self._show_weekday = DEFAULT_SHOW_WEEKDAY
        else:
            self._show_weekday = self._as_int(raw_weekday, None)
        self._show_time = cfg.get(CONFIG_ROUDOKU_SHOW_TIME) or DEFAULT_SHOW_TIME
        self._vote_role_id = self._as_int(cfg.get(CONFIG_ROUDOKU_VOTE_ROLE), None)
        self._notify_role_id = self._as_int(cfg.get(CONFIG_ROUDOKU_NOTIFY_ROLE), None)
        self._notified_session = cfg.get(CONFIG_ROUDOKU_NOTIFIED_FOR) or ""
        cap = self._as_int(cfg.get(CONFIG_ROUDOKU_MAX_LENGTH), 0) or 0
        self._max_length = cap if cap > 0 else rd.DEFAULT_MAX_LENGTH_MIN

    async def _save_config(self, key: str, value: str) -> None:
        async with async_session_maker() as db:
            existing = await db.execute(select(BotConfig).where(BotConfig.key == key))
            row = existing.scalar_one_or_none()
            if row:
                row.value = value
                row.updated_at = datetime.now(timezone.utc)
            else:
                db.add(BotConfig(key=key, value=value))
            await db.commit()

    async def set_config(
        self,
        *,
        channel_id=_UNSET,
        show_weekday=_UNSET,
        show_time=_UNSET,
        vote_role_id=_UNSET,
        notify_role_id=_UNSET,
        max_length=_UNSET,
    ) -> None:
        if channel_id is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_CHANNEL, "" if channel_id is None else str(channel_id))
        if show_weekday is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_SHOW_WEEKDAY, "" if show_weekday is None else str(show_weekday))
        if show_time is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_SHOW_TIME, show_time or "")
        if vote_role_id is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_VOTE_ROLE, "" if vote_role_id is None else str(vote_role_id))
        if notify_role_id is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_NOTIFY_ROLE, "" if notify_role_id is None else str(notify_role_id))
        if max_length is not _UNSET:
            await self._save_config(CONFIG_ROUDOKU_MAX_LENGTH, str(int(max_length)))
        await self._load_config()

    def default_session_hint(self) -> str:
        dt = self._next_default_session(datetime.now(timezone.utc))
        return dt.strftime("%Y-%m-%d %H:%M") if dt else ""

    def _next_default_session(self, now: datetime) -> datetime | None:
        if self._show_weekday is None or not self._show_time:
            return None
        try:
            hh, mm = (int(x) for x in self._show_time.split(":"))
        except ValueError:
            return None
        days_ahead = (self._show_weekday - now.weekday()) % 7
        cand = now.replace(hour=hh, minute=mm, second=0, microsecond=0) + timedelta(days=days_ahead)
        if cand <= now:
            cand += timedelta(days=7)
        return cand

    @staticmethod
    def _closes_for(session: datetime, now: datetime) -> datetime:
        """Voting deadline: VOTE_LEAD before the session, but never in the past. A
        session under the lead time out closes at the session itself instead of a
        deadline that already passed (which would make the next scheduler tick
        auto-pick instantly)."""
        closes = session - VOTE_LEAD
        return closes if closes > now else session

    # ── Embeds ────────────────────────────────────────────────

    def admin_embed(self, cycle, standings) -> discord.Embed:
        embed = discord.Embed(title="📚 Weekly Roudoku: Admin", color=COLOR)
        pool_n = len(standings)
        paused = bool(cycle and cycle.phase == "paused")
        if paused:
            embed.description = f"**Voting is PAUSED.** Resume to reopen it. **Pool:** {pool_n} VN(s)."
        else:
            embed.description = (
                f"**Voting is open** - members vote any time. **Pool:** {pool_n} VN(s). "
                "Add VNs with **/roudoku_nominate**."
            )
            if cycle and cycle.scheduled_for:
                embed.add_field(name="Session", value=f"<t:{int(cycle.scheduled_for.timestamp())}:F>", inline=True)
            if cycle and cycle.closes_at and cycle.winner_nomination_id is None:
                embed.add_field(name="Voting closes", value=f"<t:{int(cycle.closes_at.timestamp())}:R>", inline=True)
            if not (cycle and cycle.scheduled_for):
                embed.add_field(name="Session", value="*not set - use Set session*", inline=True)
        pick = next((n for n, _ in standings if cycle and n.id == cycle.winner_nomination_id), None)
        if pick:
            embed.add_field(name="🏆 This week's pick", value=safe_title(pick), inline=False)
            embed.add_field(name="Pick cover", value=self._cover_hint(pick), inline=True)
        embed.add_field(name="Length cap", value=f"{format_cap(self._max_length)} · set in Configure", inline=True)
        configured = self.bot.get_channel(self._channel_id) if self._channel_id else None
        board_channel = self.bot.get_channel(cycle.channel_id) if (cycle and cycle.channel_id) else None
        sched = "Not set"
        if self._show_weekday is not None and self._show_time:
            sched = f"{WEEKDAY_NAMES[self._show_weekday]} at {self._show_time} UTC"
        chan = configured or board_channel
        embed.add_field(
            name="Channel",
            value=chan.mention if chan else "*not set - Post vote board here, or Configure a channel*",
            inline=False,
        )
        embed.add_field(name="Default schedule", value=sched, inline=False)
        auto = bool(self._channel_id and self._show_weekday is not None and self._show_time)
        embed.add_field(
            name="Mode",
            value=(
                "🟢 Fully automatic - posts the board, picks the winner, and starts the next round each week."
                if auto
                else "🔧 Manual - set a channel + weekly day/time in Configure to run hands-off."
            ),
            inline=False,
        )
        return embed

    @staticmethod
    def _cover_hint(nom) -> str:
        """What the pick's cover will look like when posted, so the admin can see it
        without waiting for the announcement."""
        mode = nom.cover_mode or "auto"
        if mode != "auto":
            return mode
        from app.services.jiten_covers import COVER_BLUR_THRESHOLD

        if (nom.image_sexual or 0) < COVER_BLUR_THRESHOLD:
            return "auto (cover shown)"
        return "auto (SFW swap, else blurred)"

    def config_embed(self) -> discord.Embed:
        channel = self.bot.get_channel(self._channel_id) if self._channel_id else None
        sched = "Not set"
        if self._show_weekday is not None and self._show_time:
            sched = f"{WEEKDAY_NAMES[self._show_weekday]} at {self._show_time} UTC"
        embed = discord.Embed(
            title="⚙️ Weekly Roudoku: Configure",
            description="Set a channel + weekly day/time to run Weekly Roudoku fully hands-off: the bot posts "
            "the board, auto-picks the winner at the deadline, posts the banner, and starts the next week's "
            "round on its own. Leave the channel unset to drive it manually with Post vote board.",
            color=COLOR,
        )
        embed.add_field(
            name="Channel",
            value=channel.mention if channel else "*not set (manual mode)*",
            inline=False,
        )
        embed.add_field(name="Default schedule", value=sched, inline=False)
        embed.add_field(
            name="Length cap",
            value=f"{format_cap(self._max_length)} - VNs longer than this can't be nominated.",
            inline=False,
        )
        vote_access = f"<@&{self._vote_role_id}> only" if self._vote_role_id else "Everyone"
        embed.add_field(name="Who can vote", value=vote_access, inline=False)
        ping = f"<@&{self._notify_role_id}> at the session" if self._notify_role_id else "Off"
        embed.add_field(name="Session ping", value=ping, inline=False)
        return embed

    def pool_embed(self, cycle, standings, selected_id=None) -> discord.Embed:
        embed = discord.Embed(title="📚 Weekly Roudoku: Manage pool", color=COLOR)
        if not standings:
            embed.description = "The pool is empty. Members add VNs with **/roudoku_nominate**."
            return embed
        lines = []
        for i, (nom, count) in enumerate(standings, 1):
            plural = "s" if count != 1 else ""
            marker = "➡️ " if selected_id == nom.id else ""
            crown = " 👑" if cycle and nom.id == cycle.winner_nomination_id else ""
            length = length_utils.format_length(rd.nomination_length_minutes(nom))
            lines.append(
                f"{marker}**{i}. {safe_title(nom)}**{crown} · {length} · {count} vote{plural}"
            )
        embed.description = "\n".join(lines)[:4000]
        if cycle and cycle.scheduled_for:
            embed.set_footer(text="👑 = this week's pick. Pick a VN, then set it as the pick, change its cover, or remove it.")
        else:
            embed.set_footer(text="Set a session before you can set the pick.")
        return embed

    # ── Vote board helpers ────────────────────────────────────

    async def _post_vote_message(self, channel, cycle, standings) -> "discord.Message | None":
        """Post a fresh public vote board to `channel`. Persists the cycle's channel +
        message id ONLY after the send succeeds (so a failed send never leaves the cycle
        pointing at a board that isn't there). Returns the message, or None on failure."""
        noms = [n for n, _ in standings]
        view = RoudokuVoteView(cycle.id, build_vote_options(noms))
        try:
            msg = await channel.send(
                embed=await build_vote_embed(self.bot, cycle, standings),
                view=view,
                allowed_mentions=discord.AllowedMentions.none(),
            )
        except discord.HTTPException as e:
            logger.warning("Weekly Roudoku: couldn't post the board to %s: %s", channel.id, e)
            return None
        self.bot.add_view(view, message_id=msg.id)
        async with async_session_maker() as db:
            cyc = await rd.get_cycle(db, cycle.id)
            cyc.channel_id = channel.id
            cyc.message_id = msg.id
            await db.commit()
        await self._pin_board(msg)
        return msg

    async def _redirect_old_board(self, channel_id: int | None, message_id: int, jump_url: str) -> None:
        """Turn the previous vote board into a pointer at the new one, clearing its
        embed + buttons so only one live board remains. Best-effort: a deleted or
        uneditable old message is fine (the new board is what matters)."""
        channel = self.bot.get_channel(channel_id) if channel_id else None
        if channel is None:
            return
        try:
            old = await channel.fetch_message(message_id)
            await old.edit(content=f"🔁 The voting board moved: {jump_url}", embed=None, view=None)
            try:
                await old.unpin(reason="Weekly Roudoku board moved")
            except discord.HTTPException:
                pass  # wasn't pinned / no permission - fine, the new board is pinned
        except (discord.NotFound, discord.Forbidden, discord.HTTPException) as e:
            logger.debug("post_board: old-board redirect skipped: %s", e)

    async def _pin_board(self, message: "discord.Message") -> None:
        """Pin the live vote board so members can find it without an admin pinning it
        each week. Best-effort: needs Manage Messages, and the channel's 50-pin limit
        applies; either failure just logs and the board still works unpinned."""
        try:
            await message.pin(reason="Weekly Roudoku vote board")
        except discord.Forbidden:
            logger.info("Weekly Roudoku: can't pin the board (grant the bot Manage Messages there)")
        except discord.HTTPException as e:
            logger.warning("Weekly Roudoku: pinning the board failed: %s", e)

    async def _ensure_board(self, cycle, standings) -> None:
        """Refresh the standing vote board if one is live, reposting only if the message
        is genuinely gone (NotFound). A transient channel/API hiccup leaves it alone."""
        if not cycle.channel_id:
            return
        channel = self.bot.get_channel(cycle.channel_id)
        if channel is None:
            return  # can't resolve right now -> don't churn the board
        if cycle.message_id:
            try:
                await channel.fetch_message(cycle.message_id)
                await refresh_public_vote_message(self.bot, cycle.id)
                return
            except discord.NotFound:
                pass  # genuinely gone -> repost
            except discord.HTTPException:
                return  # transient -> leave it
        await self._post_vote_message(channel, cycle, standings)

    async def _resolve_channel(self, channel_id: int | None):
        """Resolve a channel from cache, falling back to a REST fetch. None if it can't
        be reached (gone, or the bot can't see it)."""
        if not channel_id:
            return None
        channel = self.bot.get_channel(channel_id)
        if channel is not None:
            return channel
        try:
            return await self.bot.fetch_channel(channel_id)
        except discord.HTTPException:
            return None

    # ── Admin actions (called by RoudokuAdminView) ────────────

    async def set_session(self, session: datetime | None = None) -> tuple[bool, str]:
        """Set the next session (None = weekly default) and refresh the board if one
        has been posted. Voting is already open; this only dates the next round."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        if session is None:
            session = self._next_default_session(now)
            if session is None:
                return False, "Set a default day/time (Configure) or enter a session date."
        if session <= now:
            return False, "That session is in the past - pick a future date and time."
        closes_at = self._closes_for(session, now)
        async with async_session_maker() as db:
            cycle = await rd.ensure_active_cycle(db)
            cycle = await rd.set_schedule(db, cycle.id, scheduled_for=session, closes_at=closes_at)
            standings = await rd.tally(db, cycle.id)
        await self._ensure_board(cycle, standings)
        return True, "ok"

    async def post_board(self, channel_id: int | None = None) -> tuple[bool, str]:
        """Post the public vote board, redirecting any previous board so there's only one
        live menu. Targets the configured Roudoku channel if one is set, else the given
        channel (the one the admin ran the command in). Serialized so the scheduler and a
        manual press can't post two boards at once."""
        await self._load_config()
        target = self._channel_id or channel_id
        if not target:
            return False, "No channel set. Configure one, or run this in the channel you want."
        channel = await self._resolve_channel(target)
        if channel is None:
            logger.warning("Weekly Roudoku: configured channel %s is not reachable", target)
            return False, "Couldn't reach that channel - check it exists and the bot can see it."
        async with self._board_lock:
            async with async_session_maker() as db:
                cycle = await rd.ensure_active_cycle(db)
                old_channel_id, old_message_id = cycle.channel_id, cycle.message_id
                standings = await rd.tally(db, cycle.id)
            new_msg = await self._post_vote_message(channel, cycle, standings)
            if new_msg is None:
                return False, "Couldn't post the board there - check the bot's permissions in that channel."
            if old_message_id and (old_channel_id != target or old_message_id != new_msg.id):
                await self._redirect_old_board(old_channel_id, old_message_id, new_msg.jump_url)
        return True, "ok"

    async def pause(self) -> bool:
        async with async_session_maker() as db:
            cycle = await rd.ensure_active_cycle(db)
            await rd.set_paused(db, cycle.id, True)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def resume(self) -> bool:
        async with async_session_maker() as db:
            cycle = await rd.ensure_active_cycle(db)
            await rd.set_paused(db, cycle.id, False)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def pick_active(self) -> bool:
        """Flag the current vote leader as this week's pick. Needs a session to date
        the calendar entry. Returns False if the pool is empty."""
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
        if not cycle or cycle.phase == "paused" or not cycle.scheduled_for:
            return False
        winner = await self._do_pick(cycle.id)
        return winner is not None

    async def set_winner(self, nomination_id: int) -> bool:
        """Admin override: flag a specific pool VN as the pick instead of the vote
        leader. Needs a session; returns False if that VN has left the pool meanwhile."""
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
        if not cycle or cycle.phase == "paused" or not cycle.scheduled_for:
            return False
        winner = await self._do_pick(cycle.id, winner_nomination_id=nomination_id)
        return winner is not None

    async def admin_add_to_pool(self, user_id: int, query: str) -> str:
        """Add a VN to the pool as `user_id`, skipping the length gate.

        This is the escape hatch the no_length rejection points members at: the
        gate fails closed on VNs VNDB has no length for, and without a way to add
        one by hand a legitimately short VN would be permanently unnominatable.
        `user_id` is the member the nomination belongs to (the pool is one per
        member), not necessarily the admin running it. Returns a status line.
        """
        async with async_session_maker() as db:
            vn = None
            if _VNDB_ID_RE.match(query.lower()):
                vn = await rd.get_vn(db, query.lower())
            if vn is None:
                results = await rd.search_vns(db, query, limit=2)
                if not results:
                    return f"⚠️ No VN found for **{inert_text(query, 80)}**."
                if len(results) > 1:
                    return (
                        f"⚠️ **{inert_text(query, 80)}** matches more than one VN - "
                        "use the exact VNDB id (e.g. `v17`)."
                    )
                vn = results[0]
            cycle = await rd.ensure_active_cycle(db)
            _nom, status = await rd.add_nomination(
                db, cycle.id, vn, user_id, enforce_length=False
            )
        title = safe_title(vn)
        # Phrased about "that member" rather than "you": the nomination belongs to
        # whoever the admin added it for, which is usually not the admin.
        whose = f"<@{user_id}>"
        if status in ("ok", "swapped"):
            await refresh_public_vote_message(self.bot, cycle.id)
            length = length_utils.format_length(
                length_utils.effective_length_minutes(vn.get("length"), vn.get("length_minutes"))
            )
            verb = "Swapped" if status == "swapped" else "Added"
            return f"✅ {verb} **{title}** for {whose} ({length}, length gate skipped)."
        reasons = {
            "same": f"**{title}** is already {whose}'s nomination.",
            "duplicate": f"**{title}** is already in the pool under another member.",
            "locked": (
                f"{whose} already has a nomination with votes on it, so it can't be "
                "swapped. Remove it from the pool first."
            ),
            "cap": "The pool is full (25).",
        }
        return "⚠️ " + reasons.get(status, f"Couldn't add **{title}** ({status}).")

    async def set_cover_mode(self, nomination_id: int, mode: str) -> bool:
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            if not cycle:
                return False
            return await rd.set_cover_mode(db, cycle.id, nomination_id, mode)

    async def reopen(self) -> bool:
        """Clear this week's pick (reopen). Pool + votes stay; the calendar entry is
        removed. Refreshes the public board."""
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            if not cycle:
                return False
            await rd.clear_pick(db, cycle.id)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def start_new_vote(self) -> bool:
        """Hard reset: clear all VNs, votes, and the pick, and set the next session from
        the weekly default. With a configured channel, post a fresh board for the new
        round; otherwise just refresh the existing board."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        nxt = self._next_default_session(now)
        next_closes = self._closes_for(nxt, now) if nxt else None
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            if not cycle:
                return False
            await rd.start_new_vote(db, cycle.id, next_scheduled=nxt, next_closes=next_closes)
        if self._channel_id:
            await self.post_board(self._channel_id)  # fresh board for the new round
        else:
            # No configured channel: keep the board in whatever channel it was last
            # posted to - refresh it if it's live, repost (and re-pin) it if it's gone,
            # so a new round always has a board.
            async with async_session_maker() as db:
                cycle = await rd.get_active_cycle(db)
                standings = await rd.tally(db, cycle.id)
            await self._ensure_board(cycle, standings)
        return True

    async def remove_from_pool(self, nomination_id: int) -> str | None:
        """Admin curation: drop a VN (and its votes) from the pool. Returns the removed
        title, or None if it wasn't in the pool. Refreshes the public board."""
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            if not cycle:
                return None
            title = await rd.remove_nomination(db, cycle.id, nomination_id)
        if title:
            await refresh_public_vote_message(self.bot, cycle.id)
        return title

    async def remove_vote(self, user_id: int) -> bool:
        """Admin: delete a specific user's vote from the current round, then refresh
        the public board. Returns False if that user had no vote."""
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            if not cycle:
                return False
            ok = await rd.remove_user_vote(db, cycle.id, user_id)
        if ok:
            await refresh_public_vote_message(self.bot, cycle.id)
        return ok

    async def _do_pick(
        self, cycle_id: int, *, winner_nomination_id: int | None = None
    ) -> "rd.RoudokuPick | None":
        """Flag the pick (vote leader, or a hand-picked VN), refresh the board so the
        pick shows, and announce it. The pool + votes are untouched."""
        async with async_session_maker() as db:
            winner, cycle = await rd.pick_winner(
                db, cycle_id, winner_nomination_id=winner_nomination_id
            )
        if cycle is None:
            return None

        if cycle.message_id and cycle.channel_id:
            await refresh_public_vote_message(self.bot, cycle.id)

        if winner is None:
            return None
        channel = self.bot.get_channel(cycle.channel_id) if cycle.channel_id else None
        if channel is None:
            return winner

        # Pick announcement: rendered banner + rich embed + VN link.
        try:
            plural = "s" if winner.votes != 1 else ""
            length = length_utils.format_length(winner.length_minutes)
            # Japanese leads; the romanization rides underneath so a member who
            # can't read the title yet can still tell which VN it is.
            desc = (
                f"**{inert_text(winner.title, 80)}** is what we're reading aloud this week "
                f"({winner.votes} vote{plural})."
            )
            if winner.title_romaji and winner.title_romaji != winner.title:
                desc += f"\n-# {inert_text(winner.title_romaji, 80)}"
            embed = discord.Embed(title="🏆 Weekly Roudoku Pick", description=desc, color=COLOR)
            embed.add_field(name="Length", value=length, inline=True)
            if winner.session_at:
                embed.add_field(
                    name="Session", value=f"<t:{int(winner.session_at.timestamp())}:F>", inline=True
                )
            view = await _vn_links_view(winner.vndb_id)
            session_str = (
                winner.session_at.strftime("%a, %b %d %Y · %H:%M UTC") if winner.session_at else ""
            )
            sub = winner.title_romaji if winner.title_romaji != winner.title else ""
            banner = await render_winner_banner(
                poster_url=winner.cover_url,
                title=winner.title,
                subtitle=sub,
                meta=" · ".join(x for x in (session_str, f"{winner.votes} vote{plural}", length) if x),
                eyebrow="WEEKLY ROUDOKU PICK",
                blur=winner.cover_blur,
                show_cover=winner.cover_show,
                accent=ACCENT_RGB,
            )
            if banner:
                embed.set_image(url="attachment://roudoku.png")
                await channel.send(
                    embed=embed, view=view,
                    file=discord.File(io.BytesIO(banner), filename="roudoku.png"),
                )
            else:
                # Fall back to a bare embed rather than Movie Night's raw-poster
                # fallback: a cover that needed blurring must not reach the channel
                # unblurred just because PIL failed.
                if winner.cover_show and not winner.cover_blur and winner.cover_url:
                    embed.set_image(url=winner.cover_url)
                await channel.send(embed=embed, view=view)
        except discord.HTTPException:
            pass
        return winner

    # ── Scheduler: keep the weekly session set + auto-pick at the deadline ───

    @tasks.loop(minutes=10)
    async def scheduler_loop(self):
        await self._tick()

    @scheduler_loop.before_loop
    async def before_scheduler(self):
        await self.bot.wait_until_ready()

    @scheduler_loop.error
    async def scheduler_error(self, error: Exception):
        logger.error("Weekly Roudoku scheduler error: %s", error, exc_info=True)

    async def _auto_ensure_board(self) -> None:
        """Fully-auto mode: keep a live board in the configured channel. Reposts only when
        the board is genuinely gone (NotFound) or lives in a different channel; a transient
        cache miss / API hiccup leaves the existing board alone so the loop can't spawn a
        duplicate."""
        if not self._channel_id:
            return
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
        if not cycle:
            return
        if cycle.channel_id == self._channel_id and cycle.message_id:
            channel = self.bot.get_channel(cycle.channel_id)
            if channel is None:
                try:
                    channel = await self.bot.fetch_channel(cycle.channel_id)
                except discord.HTTPException:
                    return  # can't resolve right now -> don't repost
            try:
                await channel.fetch_message(cycle.message_id)
                return  # board is live
            except discord.NotFound:
                pass  # genuinely gone -> repost below
            except discord.HTTPException:
                return  # transient -> leave it
        await self.post_board(self._channel_id)

    async def _tick(self) -> None:
        """Scheduler. Always: keep the weekly session populated and, at the deadline,
        auto-pick the leader if nothing's picked. When a channel is ALSO configured
        (fully hands-off): keep a live board posted in it, and once the session has
        passed (+ a short grace) auto-start the next week's round (fresh pool + board).
        The picked VN and its /events entry stay as history. Paused cycles skipped."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
        if not cycle or cycle.phase != "voting":
            return
        # Unlike Movie Night, this feature ships with a default weekday, so
        # _next_default_session returns a date on a brand-new install. Without
        # this guard one member's /roudoku_nominate would arm a session and the
        # deadline auto-pick would publish a VN to the public calendar with no
        # channel, no announcement and no admin ever setting the club up. Treat
        # "no channel configured and no board ever posted" as not-in-use.
        if not (self._channel_id or cycle.channel_id):
            return
        auto = bool(self._channel_id and self._next_default_session(now))  # needs a channel + schedule

        # Keep the next session populated from the weekly default.
        if not cycle.scheduled_for and self._next_default_session(now):
            await self.set_session(None)
            async with async_session_maker() as db:
                cycle = await rd.get_active_cycle(db)

        # Keep a live board in the configured channel.
        if auto:
            await self._auto_ensure_board()
            async with async_session_maker() as db:
                cycle = await rd.get_active_cycle(db)

        # At the deadline, auto-pick the leader if nothing's picked - BEFORE any reset, so
        # a caught-up round (bot down across the deadline) still gets a winner + /events row.
        if cycle and cycle.closes_at and now >= cycle.closes_at and cycle.winner_nomination_id is None:
            async with async_session_maker() as db:
                pool_n = await rd.count_nominations(db, cycle.id)
            if pool_n > 0:
                await self._do_pick(cycle.id)
                async with async_session_maker() as db:
                    cycle = await rd.get_active_cycle(db)

        # Auto-cycle: once the session has passed (+ grace), roll to the next week.
        # A round deliberately disarmed (reopened with no pick: closes_at + winner both
        # cleared) is skipped so it isn't silently wiped before the admin re-decides.
        if (
            auto
            and cycle
            and cycle.scheduled_for
            and (cycle.closes_at or cycle.winner_nomination_id)
            and now >= cycle.scheduled_for + AUTO_RESET_AFTER
        ):
            async with async_session_maker() as db:
                pool_n = await rd.count_nominations(db, cycle.id)
            if pool_n:
                logger.info(
                    "Weekly Roudoku: auto-starting next round (session passed; clearing %d VN(s))", pool_n
                )
            await self.start_new_vote()

    # ── Session ping ──────────────────────────────────────────

    @tasks.loop(minutes=1)
    async def session_notify_loop(self):
        await self._notify_tick()

    @session_notify_loop.before_loop
    async def before_notify(self):
        await self.bot.wait_until_ready()

    @session_notify_loop.error
    async def notify_error(self, error: Exception):
        logger.error("Weekly Roudoku session ping error: %s", error, exc_info=True)

    def _ping_mentions(self, channel) -> discord.AllowedMentions:
        """Let only the configured role ping (so a VN title can't smuggle one in).
        @everyone is the guild's default role, whose id is the guild id, and needs the
        everyone flag rather than a role allow-list."""
        guild = getattr(channel, "guild", None)
        if guild and self._notify_role_id == guild.id:
            return discord.AllowedMentions(everyone=True, users=False, roles=False)
        return discord.AllowedMentions(
            everyone=False, users=False, roles=[discord.Object(id=self._notify_role_id)]
        )

    async def _mark_notified(self, stamp: str) -> None:
        await self._save_config(CONFIG_ROUDOKU_NOTIFIED_FOR, stamp)
        self._notified_session = stamp

    async def _notify_tick(self) -> None:
        """Ping the configured role in the Roudoku channel when the session arrives. Own
        loop rather than the 10-minute scheduler so the ping lands on the minute. The
        session it fired for is stored, so a restart can't ping twice; a session only
        caught up on long after the fact (bot was down) is marked without pinging."""
        if not self._notify_role_id:
            return
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
        if not cycle or cycle.phase != "voting" or not cycle.scheduled_for:
            return
        now = datetime.now(timezone.utc)
        if now < cycle.scheduled_for:
            return
        stamp = cycle.scheduled_for.isoformat()
        if self._notified_session == stamp:
            return
        if now > cycle.scheduled_for + NOTIFY_GRACE:
            await self._mark_notified(stamp)
            return
        if cycle.winner_nomination_id is None:
            return  # nothing picked yet: an admin pick within the grace window still pings
        async with async_session_maker() as db:
            nom = await rd.get_nomination(db, cycle.winner_nomination_id)
        if nom is None:
            return
        channel = await self._resolve_channel(self._channel_id or cycle.channel_id)
        if channel is None:
            logger.warning("Weekly Roudoku: no reachable channel for the session ping")
            return
        try:
            await channel.send(
                f"<@&{self._notify_role_id}> 📚 **Weekly Roudoku** starts now: **{safe_title(nom)}**",
                allowed_mentions=self._ping_mentions(channel),
            )
        except discord.HTTPException as e:
            logger.warning("Weekly Roudoku: session ping failed: %s", e)
            return
        await self._mark_notified(stamp)

    # ── Member commands ───────────────────────────────────────

    async def _add_to_pool(self, interaction: discord.Interaction, vn: dict, *, edit: bool) -> None:
        """Add a resolved VN to the pool and report the outcome. Shared by the direct
        nominate path and the disambiguation picker."""
        async with async_session_maker() as db:
            cycle = await rd.ensure_active_cycle(db)
            nom, status = await rd.add_nomination(db, cycle.id, vn, interaction.user.id)
            locked_title = safe_title(nom) if status == "locked" and nom else None
            max_minutes = await rd.get_max_length_minutes(db)

        # Every branch below interpolates this into message content, so it is
        # escaped once here rather than at each use.
        title = safe_title(vn)
        cap = format_cap(max_minutes)
        effective = length_utils.effective_length_minutes(vn.get("length"), vn.get("length_minutes"))
        messages = {
            "cap": "The pool is full (25). Vote for one with **/roudoku_vote**.",
            "duplicate": f"**{title}** is already in the pool.",
            "same": f"You've already nominated **{title}**.",
            "locked": f"Your current pick **{locked_title}** already has votes, so it can't be swapped.",
            "too_long": (
                f"⛔ **{title}** is too long for Weekly Roudoku.\n\n"
                f"VNDB puts it at **{length_utils.length_bucket_label(effective)}** "
                f"(~{length_utils.format_length(effective)}). We read one VN aloud together in a "
                f"single sitting, so nominations are capped at **{cap}**.\n\n"
                "Pick something shorter - `/roudoku_nominate` shows the length next to every result."
            ),
            "no_length": (
                f"⛔ **{title}** has no length data on VNDB, so it can't be nominated.\n\n"
                f"Weekly Roudoku only takes VNs VNDB rates at **{cap}** or shorter, and there's no "
                "way to check this one, so it's a no by default rather than a maybe.\n\n"
                "Pick another VN, or ask an admin to add it by hand if you know it's short."
            ),
        }
        if status in messages:
            content = messages[status]
        else:
            # One nomination per person: a new VN for someone who already nominated
            # replaces their old pick rather than stacking.
            verb = "Swapped your nomination to" if status == "swapped" else "Added"
            content = f"✅ {verb} **{title}**!"

        mentions = discord.AllowedMentions.none()
        if edit:
            await interaction.response.edit_message(content=content, view=None)
        else:
            await interaction.followup.send(content, ephemeral=True, allowed_mentions=mentions)
        if status in ("ok", "swapped"):
            async with async_session_maker() as db:
                cycle = await rd.get_active_cycle(db)
            await refresh_public_vote_message(interaction.client, cycle.id)

    @app_commands.command(
        name="roudoku_nominate",
        description="Nominate a short VN for the club to read aloud this week",
    )
    @app_commands.describe(vn="Search for a visual novel by title")
    @app_commands.autocomplete(vn=roudoku_vn_autocomplete)
    async def roudoku_nominate(self, interaction: discord.Interaction, vn: str):
        await interaction.response.defer(ephemeral=True)
        # Same role gate as voting: if a vote-role is set, nominating needs it too,
        # so a member who can't vote can't stuff the pool either (mirrors hikaru).
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.followup.send(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return

        # Discord lets a member submit free text instead of picking a suggestion, so
        # anything that isn't a VNDB id has to be searched again here.
        if _VNDB_ID_RE.match(vn.strip()):
            async with async_session_maker() as db:
                found = await rd.get_vn(db, vn.strip())
            if not found:
                await interaction.followup.send(f"No VN found with id **{vn}**.", ephemeral=True)
                return
            await self._add_to_pool(interaction, found, edit=False)
            return

        async with async_session_maker() as db:
            results = await rd.search_vns(db, vn, limit=25)
            max_minutes = await rd.get_max_length_minutes(db)
            cycle = await rd.ensure_active_cycle(db)
        if not results:
            await interaction.followup.send(
                f"No visual novels found for **{vn}**.", ephemeral=True,
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        if len(results) == 1:
            await self._add_to_pool(interaction, results[0], edit=False)
            return
        view = NominatePickView(interaction.user.id, self, cycle.id, results, max_minutes)
        await interaction.followup.send(
            "Select the VN to add to the pool:", view=view, ephemeral=True
        )

    @app_commands.command(name="roudoku_vote", description="Open a personal Weekly Roudoku voting menu")
    async def roudoku_vote(self, interaction: discord.Interaction):
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.response.send_message(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return
        async with async_session_maker() as db:
            # Voting is always open (no "round" to wait for) unless paused.
            cycle = await rd.ensure_active_cycle(db)
            if cycle.phase == "paused":
                await interaction.response.send_message(
                    "Weekly Roudoku voting is paused right now. Check back soon!", ephemeral=True
                )
                return
            standings = await rd.tally(db, cycle.id)
            noms = [n for n, _ in standings]
        view = RoudokuVoteView(cycle.id, build_vote_options(noms))
        embed = await build_vote_embed(self.bot, cycle, standings)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(
        name="roudoku",
        description="Show the VN the club is reading aloud next",
    )
    @app_commands.describe(banner="Show a banner image (default) or a plain embed")
    async def roudoku(self, interaction: discord.Interaction, banner: bool = True):
        await interaction.response.defer()
        now = datetime.now(timezone.utc)
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            ev = await rd.get_pick_event(db, now)
            pick_nom = (
                await rd.get_nomination(db, cycle.winner_nomination_id)
                if cycle and cycle.winner_nomination_id
                else None
            )
        # A stored pick whose session already passed is history. While the pick is
        # still flagged it's the current answer, but once a fresh round is open,
        # showing it as "next" misleads - explain that it's voting time instead.
        if ev and ev.start_at and ev.start_at < now and not (cycle and cycle.winner_nomination_id):
            ev = None
        if not ev:
            if cycle and cycle.phase == "paused":
                msg = "Weekly Roudoku is paused right now."
            else:
                msg = (
                    "This week's VN hasn't been picked yet - voting is open, cast yours with "
                    "**/roudoku_vote**."
                )
                if cycle and cycle.scheduled_for and cycle.scheduled_for > now:
                    msg += f"\nNext session: <t:{int(cycle.scheduled_for.timestamp())}:F>"
            await interaction.followup.send(msg)
            return
        extra = ev.extra_data or {}
        # The row stores both variants for the site's toggle; the bot always
        # shows the Japanese one, falling back to the stored base title.
        strip = lambda s: (s or "").replace(f"{rd.EVENT_TITLE_PREFIX}: ", "", 1)
        name = strip(extra.get("title_jp")) or strip(ev.title)
        romaji = strip(extra.get("title_romaji")) or strip(ev.title)
        desc = f"**{inert_text(name, 80)}**"
        if romaji and romaji != name:
            desc += f"\n-# {inert_text(romaji, 80)}"
        embed = discord.Embed(title="📚 Next Weekly Roudoku", description=desc, color=COLOR)
        length = extra.get("length_minutes")
        if length:
            embed.add_field(name="Length", value=length_utils.format_length(length), inline=True)
        if ev.start_at:
            embed.add_field(name="Session", value=f"<t:{int(ev.start_at.timestamp())}:F>", inline=True)
        # Only nudge people to vote when the round is genuinely undecided.
        if cycle and cycle.phase == "voting" and not cycle.winner_nomination_id:
            embed.add_field(
                name="Heads up", value="Voting is open - cast yours with **/roudoku_vote**", inline=False
            )
        view = await _vn_links_view(extra.get("vndb_id"))
        # The stored row nulls its image whenever a blur was needed, so re-resolve
        # from the nomination rather than reading ev.image_url: otherwise a pick
        # set to "blurred" would render here as if it were "hidden".
        cover_url, blur, show_cover = ev.image_url, False, True
        if pick_nom:
            async with async_session_maker() as db:
                cover_url, blur, show_cover = await rd.resolve_nomination_cover(db, pick_nom.id)
        if banner:
            session_str = ev.start_at.strftime("%a, %b %d %Y · %H:%M UTC") if ev.start_at else ""
            png = await render_winner_banner(
                poster_url=cover_url,
                title=name,
                subtitle=romaji if romaji != name else "",
                meta=session_str,
                eyebrow="NEXT WEEKLY ROUDOKU",
                blur=blur,
                show_cover=show_cover,
                accent=ACCENT_RGB,
            )
            if png:
                embed.set_image(url="attachment://roudoku.png")
                await interaction.followup.send(
                    embed=embed, view=view, file=discord.File(io.BytesIO(png), filename="roudoku.png")
                )
                return
        # Plain-embed fallback can't blur, so it only ever carries a safe cover.
        if cover_url and show_cover and not blur:
            embed.set_image(url=cover_url)
        await interaction.followup.send(embed=embed, view=view)

    # ── Admin dashboard ───────────────────────────────────────

    @app_commands.command(
        name="manage_roudoku",
        description="[ADMIN] Weekly Roudoku dashboard - pick winner, reopen, new round, session, pause, configure",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def manage_roudoku(self, interaction: discord.Interaction):
        await self._load_config()
        async with async_session_maker() as db:
            cycle = await rd.get_active_cycle(db)
            standings = await rd.tally(db, cycle.id) if cycle else []
        view = RoudokuAdminView(interaction.user.id, self, cycle, standings)
        await interaction.response.send_message(embed=view.get_embed(), view=view, ephemeral=True)
        view.message = await interaction.original_response()


class NominatePickView(BaseView):
    """Ephemeral picker shown when a title search is ambiguous."""

    def __init__(
        self, user_id: int, cog: RoudokuCog, cycle_id: int, results: list[dict], max_minutes: int
    ):
        super().__init__(user_id, timeout=120)
        self.cog = cog
        self.cycle_id = cycle_id
        self.results = results
        options = []
        for i, vn in enumerate(results[:25]):
            ok, _ = length_utils.passes_length_gate(
                vn.get("length"), vn.get("length_minutes"), max_minutes
            )
            effective = length_utils.effective_length_minutes(
                vn.get("length"), vn.get("length_minutes")
            )
            year = vn["released"].year if vn.get("released") else "?"
            label = f"{'✅' if ok else '⛔'} {rd.display_title(vn)}"[:100]
            desc = f"{length_utils.format_length(effective)} · {year} · {vn['vndb_id']}"[:100]
            options.append(discord.SelectOption(label=label, value=str(i), description=desc))
        self.add_item(NominatePickSelect(options))


class NominatePickSelect(discord.ui.Select):
    def __init__(self, options: list[discord.SelectOption]):
        super().__init__(placeholder="Choose a VN...", options=options, min_values=1, max_values=1)

    async def callback(self, interaction: discord.Interaction) -> None:
        view: NominatePickView = self.view
        vn = view.results[int(self.values[0])]
        await view.cog._add_to_pool(interaction, vn, edit=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(RoudokuCog(bot))
