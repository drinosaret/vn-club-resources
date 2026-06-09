"""Movie Night - persistent pool + always-open voting (one long-lived cycle).

- /movie_nominate (member): add a film to the pool any time
- /movie_vote     (member): open a personal voting menu
- /manage_movie_night (admin): pick the winner, reopen, start a new vote, set the
  showtime, pause/resume, post the board, configure; see views/movie_night.py

Voting is ALWAYS open (no "open a round" step) unless an admin pauses it. The pool
and votes PERSIST; one film is flagged as this week's pick (winner_nomination_id) and
published to /events, but it stays in the pool, marked 👑. The admin picks the leader
(or hand-picks via Manage pool), can Reopen to clear the pick, and uses Start new vote
to wipe the pool/votes for a fresh round. At the showtime deadline the scheduler
auto-picks the leader only if nothing has been picked yet.
"""

import asyncio
import io
import logging
from datetime import datetime, timedelta, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import BotConfig
from app.services import movie_night_service as mn
from app.services import tmdb_client as tmdb
from app.services.movie_banner import render_winner_banner
from discord_bot.permissions import is_admin
from discord_bot.views.base import BaseView
from discord_bot.views.movie_night import MovieNightAdminView
from discord_bot.views.movie_vote import (
    MovieVoteView,
    build_vote_embed,
    build_vote_options,
    check_vote_role,
    refresh_public_vote_message,
)

logger = logging.getLogger(__name__)

CONFIG_MOVIE_CHANNEL = "movie_night_channel_id"  # optional: the channel the cycle auto-runs in
CONFIG_MOVIE_SHOW_WEEKDAY = "movie_night_show_weekday"  # 0=Mon .. 6=Sun
CONFIG_MOVIE_SHOW_TIME = "movie_night_show_time"  # "HH:MM" UTC
CONFIG_MOVIE_VOTE_ROLE = mn.CONFIG_VOTE_ROLE  # optional role gate on voting
DEFAULT_SHOW_TIME = "12:00"  # UTC; the weekly default time when none is configured
AUTO_RESET_AFTER = timedelta(hours=2)  # hands-off mode: wait this long past showtime before the next round

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
COLOR = 0xE11D48
TMDB_MOVIE_URL = "https://www.themoviedb.org/movie/{tmdb_id}?language=ja-JP"
_UNSET = object()


class MovieNightCog(commands.Cog):
    """Movie Night pool, voting rounds, and admin dashboard."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._board_lock = asyncio.Lock()  # serialize board posting (scheduler + manual)
        self._channel_id = 0  # configured Movie Night channel (0 = none; manual mode)
        self._show_weekday: int | None = None
        self._show_time = DEFAULT_SHOW_TIME
        self._vote_role_id: int | None = None

    async def cog_load(self) -> None:
        await self._load_config()
        self.scheduler_loop.start()

    async def cog_unload(self) -> None:
        self.scheduler_loop.cancel()

    # ── Config (channel + default weekly schedule) ────────────

    async def _load_config(self) -> None:
        keys = [CONFIG_MOVIE_CHANNEL, CONFIG_MOVIE_SHOW_WEEKDAY, CONFIG_MOVIE_SHOW_TIME, CONFIG_MOVIE_VOTE_ROLE]
        try:
            async with async_session_maker() as db:
                result = await db.execute(select(BotConfig).where(BotConfig.key.in_(keys)))
                cfg = {row.key: row.value for row in result.scalars()}
        except Exception as e:
            logger.warning("Failed to load movie-night config: %s", e)
            return
        self._channel_id = int(cfg.get(CONFIG_MOVIE_CHANNEL) or 0)
        wd = cfg.get(CONFIG_MOVIE_SHOW_WEEKDAY)
        self._show_weekday = int(wd) if wd not in (None, "") else None
        self._show_time = cfg.get(CONFIG_MOVIE_SHOW_TIME) or DEFAULT_SHOW_TIME
        vr = cfg.get(CONFIG_MOVIE_VOTE_ROLE)
        self._vote_role_id = int(vr) if vr not in (None, "") else None

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
        self, *, channel_id=_UNSET, show_weekday=_UNSET, show_time=_UNSET, vote_role_id=_UNSET
    ) -> None:
        if channel_id is not _UNSET:
            await self._save_config(CONFIG_MOVIE_CHANNEL, "" if channel_id is None else str(channel_id))
        if show_weekday is not _UNSET:
            await self._save_config(CONFIG_MOVIE_SHOW_WEEKDAY, "" if show_weekday is None else str(show_weekday))
        if show_time is not _UNSET:
            await self._save_config(CONFIG_MOVIE_SHOW_TIME, show_time or "")
        if vote_role_id is not _UNSET:
            await self._save_config(CONFIG_MOVIE_VOTE_ROLE, "" if vote_role_id is None else str(vote_role_id))
        await self._load_config()

    def default_showtime_hint(self) -> str:
        dt = self._next_default_showtime(datetime.now(timezone.utc))
        return dt.strftime("%Y-%m-%d %H:%M") if dt else ""

    def _next_default_showtime(self, now: datetime) -> datetime | None:
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
    def _closes_for(showtime: datetime, now: datetime) -> datetime:
        """Voting deadline: a day before the showtime, but never in the past. A showtime
        under a day out closes at the showtime itself instead of a deadline that already
        passed (which would make the next scheduler tick auto-pick instantly)."""
        closes = showtime - timedelta(days=1)
        return closes if closes > now else showtime

    # ── Embeds ────────────────────────────────────────────────

    def admin_embed(self, cycle, standings) -> discord.Embed:
        embed = discord.Embed(title="🎬 Movie Night: Admin", color=COLOR)
        pool_n = len(standings)
        paused = bool(cycle and cycle.phase == "paused")
        if paused:
            embed.description = f"**Voting is PAUSED.** Resume to reopen it. **Pool:** {pool_n} film(s)."
        else:
            embed.description = (
                f"**Voting is open** - members vote any time. **Pool:** {pool_n} film(s). "
                "Add films with **/movie_nominate**."
            )
            if cycle and cycle.scheduled_for:
                embed.add_field(name="Showtime", value=f"<t:{int(cycle.scheduled_for.timestamp())}:F>", inline=True)
            if cycle and cycle.closes_at and cycle.winner_nomination_id is None:
                embed.add_field(name="Voting closes", value=f"<t:{int(cycle.closes_at.timestamp())}:R>", inline=True)
            if not (cycle and cycle.scheduled_for):
                embed.add_field(name="Showtime", value="*not set - use Set showtime*", inline=True)
        pick = next((n for n, _ in standings if cycle and n.id == cycle.winner_nomination_id), None)
        if pick:
            embed.add_field(name="🏆 This week's pick", value=pick.title, inline=False)
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
                "🟢 Fully automatic - posts the board, picks the winner, and starts the next vote each week."
                if auto
                else "🔧 Manual - set a channel + weekly day/time in Configure to run hands-off."
            ),
            inline=False,
        )
        return embed

    def config_embed(self) -> discord.Embed:
        channel = self.bot.get_channel(self._channel_id) if self._channel_id else None
        sched = "Not set"
        if self._show_weekday is not None and self._show_time:
            sched = f"{WEEKDAY_NAMES[self._show_weekday]} at {self._show_time} UTC"
        embed = discord.Embed(
            title="⚙️ Movie Night: Configure",
            description="Set a channel + weekly day/time to run Movie Night fully hands-off: the bot posts "
            "the board, auto-picks the winner at the deadline, posts the banner, and starts the next week's "
            "vote on its own. Leave the channel unset to drive it manually with Post vote board.",
            color=COLOR,
        )
        embed.add_field(
            name="Channel",
            value=channel.mention if channel else "*not set (manual mode)*",
            inline=False,
        )
        embed.add_field(name="Default schedule", value=sched, inline=False)
        vote_access = f"<@&{self._vote_role_id}> only" if self._vote_role_id else "Everyone"
        embed.add_field(name="Who can vote", value=vote_access, inline=False)
        return embed

    def pool_embed(self, cycle, standings, selected_id=None) -> discord.Embed:
        embed = discord.Embed(title="🎬 Movie Night: Manage pool", color=COLOR)
        if not standings:
            embed.description = "The pool is empty. Members add films with **/movie_nominate**."
            return embed
        lines = []
        for i, (nom, count) in enumerate(standings, 1):
            year = f" ({nom.release_year})" if nom.release_year else ""
            plural = "s" if count != 1 else ""
            marker = "➡️ " if selected_id == nom.id else ""
            crown = " 👑" if cycle and nom.id == cycle.winner_nomination_id else ""
            lines.append(f"{marker}**{i}. {nom.title}{year}**{crown} · {count} vote{plural}")
        embed.description = "\n".join(lines)[:4000]
        if cycle and cycle.scheduled_for:
            embed.set_footer(text="👑 = this week's pick. Pick a film, then set it as the pick or remove it.")
        else:
            embed.set_footer(text="Set a showtime before you can set the pick.")
        return embed

    # ── Vote board helpers ────────────────────────────────────

    async def _post_vote_message(self, channel, cycle, standings) -> "discord.Message | None":
        """Post a fresh public vote board to `channel`. Persists the cycle's channel +
        message id ONLY after the send succeeds (so a failed send never leaves the cycle
        pointing at a board that isn't there). Returns the message, or None on failure."""
        noms = [n for n, _ in standings]
        view = MovieVoteView(cycle.id, build_vote_options(noms))
        try:
            msg = await channel.send(
                embed=await build_vote_embed(self.bot, cycle, standings),
                view=view,
                allowed_mentions=discord.AllowedMentions.none(),
            )
        except discord.HTTPException as e:
            logger.warning("Movie Night: couldn't post the board to %s: %s", channel.id, e)
            return None
        self.bot.add_view(view, message_id=msg.id)
        async with async_session_maker() as db:
            cyc = await mn.get_cycle(db, cycle.id)
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
                await old.unpin(reason="Movie Night board moved")
            except discord.HTTPException:
                pass  # wasn't pinned / no permission - fine, the new board is pinned
        except (discord.NotFound, discord.Forbidden, discord.HTTPException) as e:
            logger.debug("post_board: old-board redirect skipped: %s", e)

    async def _pin_board(self, message: "discord.Message") -> None:
        """Pin the live vote board so members can find it without an admin pinning it
        each week. Best-effort: needs Manage Messages, and the channel's 50-pin limit
        applies; either failure just logs and the board still works unpinned."""
        try:
            await message.pin(reason="Movie Night vote board")
        except discord.Forbidden:
            logger.info("Movie Night: can't pin the board (grant the bot Manage Messages there)")
        except discord.HTTPException as e:
            logger.warning("Movie Night: pinning the board failed: %s", e)

    async def _ensure_board(self, cycle, standings) -> None:
        """Refresh the standing vote board if one is live, reposting only if the message
        is genuinely gone (NotFound). A transient channel/API hiccup leaves it alone. Only
        refreshes; it doesn't pick the channel."""
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

    # ── Admin actions (called by MovieNightAdminView) ─────────

    async def set_showtime(self, showtime: datetime | None = None) -> tuple[bool, str]:
        """Set the next showtime (None = weekly default) and refresh the board if one
        has been posted. Voting is already open; this only dates the next round."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        if showtime is None:
            showtime = self._next_default_showtime(now)
            if showtime is None:
                return False, "Set a default day/time (Configure) or enter a showtime."
        if showtime <= now:
            return False, "That showtime is in the past - pick a future date and time."
        closes_at = self._closes_for(showtime, now)
        async with async_session_maker() as db:
            cycle = await mn.ensure_active_cycle(db)
            cycle = await mn.set_schedule(db, cycle.id, scheduled_for=showtime, closes_at=closes_at)
            standings = await mn.tally(db, cycle.id)
        await self._ensure_board(cycle, standings)
        return True, "ok"

    async def post_board(self, channel_id: int | None = None) -> tuple[bool, str]:
        """Post the public vote board, redirecting any previous board so there's only one
        live menu. Targets the configured Movie Night channel if one is set, else the
        given channel (the one the admin ran the command in). The cycle's channel +
        message id are persisted only after a successful send. Serialized so the scheduler
        and a manual press can't post two boards at once."""
        await self._load_config()
        target = self._channel_id or channel_id
        if not target:
            return False, "No channel set. Configure one, or run this in the channel you want."
        channel = self.bot.get_channel(target)
        if channel is None:
            try:
                channel = await self.bot.fetch_channel(target)
            except discord.HTTPException:
                channel = None
        if channel is None:
            logger.warning("Movie Night: configured channel %s is not reachable", target)
            return False, "Couldn't reach that channel - check it exists and the bot can see it."
        async with self._board_lock:
            async with async_session_maker() as db:
                cycle = await mn.ensure_active_cycle(db)
                old_channel_id, old_message_id = cycle.channel_id, cycle.message_id
                standings = await mn.tally(db, cycle.id)
            new_msg = await self._post_vote_message(channel, cycle, standings)
            if new_msg is None:
                return False, "Couldn't post the board there - check the bot's permissions in that channel."
            if old_message_id and (old_channel_id != target or old_message_id != new_msg.id):
                await self._redirect_old_board(old_channel_id, old_message_id, new_msg.jump_url)
        return True, "ok"

    async def pause(self) -> bool:
        async with async_session_maker() as db:
            cycle = await mn.ensure_active_cycle(db)
            await mn.set_paused(db, cycle.id, True)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def resume(self) -> bool:
        async with async_session_maker() as db:
            cycle = await mn.ensure_active_cycle(db)
            await mn.set_paused(db, cycle.id, False)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def pick_active(self) -> bool:
        """Flag the current vote leader as this week's pick. Needs a showtime to date
        the calendar entry. Returns False if the pool is empty."""
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
        if not cycle or cycle.phase == "paused" or not cycle.scheduled_for:
            return False
        winner = await self._do_pick(cycle.id)
        return winner is not None

    async def set_winner(self, nomination_id: int) -> bool:
        """Admin override: flag a specific pool film as the pick instead of the vote
        leader (the previous pick reverts to a normal entry). Needs a showtime; returns
        False if that film has left the pool meanwhile."""
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
        if not cycle or cycle.phase == "paused" or not cycle.scheduled_for:
            return False
        winner = await self._do_pick(cycle.id, winner_nomination_id=nomination_id)
        return winner is not None

    async def reopen(self) -> bool:
        """Clear this week's pick (reopen). Pool + votes stay; the calendar entry is
        removed. Refreshes the public board."""
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            if not cycle:
                return False
            await mn.clear_pick(db, cycle.id)
        await refresh_public_vote_message(self.bot, cycle.id)
        return True

    async def start_new_vote(self) -> bool:
        """Hard reset: clear all films, votes, and the pick, and set the next showtime
        from the weekly default. With a configured channel, post a fresh board for the
        new round; otherwise just refresh the existing board."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        nxt = self._next_default_showtime(now)
        next_closes = self._closes_for(nxt, now) if nxt else None
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            if not cycle:
                return False
            await mn.start_new_vote(db, cycle.id, next_scheduled=nxt, next_closes=next_closes)
        if self._channel_id:
            await self.post_board(self._channel_id)  # fresh board for the new round
        else:
            # No configured channel: keep the board in whatever channel it was last
            # posted to - refresh it if it's live, repost (and re-pin) it if it's gone,
            # so a new round always has a board.
            async with async_session_maker() as db:
                cycle = await mn.get_active_cycle(db)
                standings = await mn.tally(db, cycle.id)
            await self._ensure_board(cycle, standings)
        return True

    async def remove_from_pool(self, nomination_id: int) -> str | None:
        """Admin curation: drop a film (and its votes) from the pool. Returns the
        removed title, or None if it wasn't in the pool. Refreshes the public board."""
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            if not cycle:
                return None
            title = await mn.remove_nomination(db, cycle.id, nomination_id)
        if title:
            await refresh_public_vote_message(self.bot, cycle.id)
        return title

    async def remove_vote(self, user_id: int) -> bool:
        """Admin: delete a specific user's vote from the current round, then refresh
        the public board. Returns False if that user had no vote."""
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            if not cycle:
                return False
            ok = await mn.remove_user_vote(db, cycle.id, user_id)
        if ok:
            await refresh_public_vote_message(self.bot, cycle.id)
        return ok

    async def _do_pick(
        self, cycle_id: int, *, winner_nomination_id: int | None = None
    ) -> "mn.WinnerInfo | None":
        """Flag the pick (vote leader, or a hand-picked film), refresh the board so the
        pick shows, and announce it. The pool + votes are untouched. Returns the picked
        film, or None if there was nothing to pick."""
        async with async_session_maker() as db:
            winner, cycle = await mn.pick_winner(db, cycle_id, winner_nomination_id=winner_nomination_id)

        if cycle.message_id and cycle.channel_id:
            await refresh_public_vote_message(self.bot, cycle.id)

        if winner is None:
            return None
        channel = self.bot.get_channel(cycle.channel_id) if cycle.channel_id else None
        if channel is None:
            return winner

        # Pick announcement: rendered banner + rich embed + TMDB link.
        try:
            year = f" ({winner.release_year})" if winner.release_year else ""
            plural = "s" if winner.votes != 1 else ""
            embed = discord.Embed(
                title="🏆 Movie Night Pick",
                description=f"**{winner.title}{year}** is this week's movie ({winner.votes} vote{plural})!",
                color=COLOR,
            )
            if winner.showtime:
                embed.add_field(name="Showtime", value=f"<t:{int(winner.showtime.timestamp())}:F>", inline=False)
            view = discord.ui.View()
            view.add_item(
                discord.ui.Button(
                    label="View on TMDB",
                    url=TMDB_MOVIE_URL.format(tmdb_id=winner.tmdb_id),
                    style=discord.ButtonStyle.link,
                )
            )
            showtime_str = winner.showtime.strftime("%a, %b %d %Y · %H:%M UTC") if winner.showtime else ""
            banner = await render_winner_banner(
                poster_url=winner.poster_url,
                title=f"{winner.title}{year}",
                subtitle=showtime_str,
                meta=f"{winner.votes} vote{plural}",
            )
            if banner:
                embed.set_image(url="attachment://movie_night.png")
                await channel.send(
                    embed=embed, view=view, file=discord.File(io.BytesIO(banner), filename="movie_night.png")
                )
            elif winner.poster_url:
                embed.set_image(url=winner.poster_url)
                await channel.send(embed=embed, view=view)
            else:
                await channel.send(embed=embed, view=view)
        except discord.HTTPException:
            pass
        return winner

    # ── Scheduler: keep the weekly showtime set + auto-pick at the deadline ───

    @tasks.loop(minutes=10)
    async def scheduler_loop(self):
        await self._tick()

    @scheduler_loop.before_loop
    async def before_scheduler(self):
        await self.bot.wait_until_ready()

    @scheduler_loop.error
    async def scheduler_error(self, error: Exception):
        logger.error("Movie Night scheduler error: %s", error, exc_info=True)

    async def _auto_ensure_board(self) -> None:
        """Fully-auto mode: keep a live board in the configured channel. Reposts only when
        the board is genuinely gone (NotFound) or lives in a different channel; a transient
        cache miss / API hiccup leaves the existing board alone so the loop can't spawn a
        duplicate."""
        if not self._channel_id:
            return
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
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
        """Scheduler. Always: keep the weekly showtime populated and, at the deadline,
        auto-pick the leader if nothing's picked. When a channel is ALSO configured
        (fully hands-off): keep a live board posted in it, and once the showtime has
        passed (+ a short grace) auto-start the next week's round (fresh pool + board).
        The picked film and its /events entry stay as history. Paused cycles skipped."""
        await self._load_config()
        now = datetime.now(timezone.utc)
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
        if not cycle or cycle.phase != "voting":
            return
        auto = bool(self._channel_id and self._next_default_showtime(now))  # needs a channel + schedule

        # Keep the next showtime populated from the weekly default.
        if not cycle.scheduled_for and self._next_default_showtime(now):
            await self.set_showtime(None)
            async with async_session_maker() as db:
                cycle = await mn.get_active_cycle(db)

        # Keep a live board in the configured channel.
        if auto:
            await self._auto_ensure_board()
            async with async_session_maker() as db:
                cycle = await mn.get_active_cycle(db)

        # At the deadline, auto-pick the leader if nothing's picked - BEFORE any reset, so
        # a caught-up round (bot down across the deadline) still gets a winner + /events row.
        if cycle and cycle.closes_at and now >= cycle.closes_at and cycle.winner_nomination_id is None:
            async with async_session_maker() as db:
                pool_n = await mn.count_nominations(db, cycle.id)
            if pool_n > 0:
                await self._do_pick(cycle.id)
                async with async_session_maker() as db:
                    cycle = await mn.get_active_cycle(db)

        # Auto-cycle: once the showtime has passed (+ grace), roll to the next round.
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
                pool_n = await mn.count_nominations(db, cycle.id)
            if pool_n:
                logger.info("Movie Night: auto-starting next round (showtime passed; clearing %d film(s))", pool_n)
            await self.start_new_vote()  # resets pool/votes/pick, advances showtime, posts a fresh board

    # ── Member commands ───────────────────────────────────────

    @app_commands.command(name="movie_nominate", description="Nominate a film for Movie Night")
    @app_commands.describe(query="Film title to search for")
    async def movie_nominate(self, interaction: discord.Interaction, query: str):
        await interaction.response.defer(ephemeral=True)
        # Same role gate as voting: if a vote-role is set, nominating needs it too,
        # so a member who can't vote can't stuff the pool either (mirrors hikaru).
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.followup.send(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return
        if not tmdb.is_configured():
            await interaction.followup.send(
                "Film search isn't set up yet. An admin needs to add a TMDB API key.", ephemeral=True
            )
            return
        try:
            results = await tmdb.search_movies(query, limit=25)
        except tmdb.TMDBError:
            results = []
        if not results:
            await interaction.followup.send(f"No films found for **{query}**.", ephemeral=True)
            return
        async with async_session_maker() as db:
            cycle = await mn.ensure_active_cycle(db)
        view = NominatePickView(interaction.user.id, self, cycle.id, results)
        await interaction.followup.send("Select the film to add to the pool:", view=view, ephemeral=True)

    @app_commands.command(name="movie_vote", description="Open a personal Movie Night voting menu")
    async def movie_vote(self, interaction: discord.Interaction):
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.response.send_message(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return
        async with async_session_maker() as db:
            # Voting is always open (no "round" to wait for) unless paused.
            cycle = await mn.ensure_active_cycle(db)
            if cycle.phase == "paused":
                await interaction.response.send_message(
                    "Movie Night voting is paused right now. Check back soon!", ephemeral=True
                )
                return
            standings = await mn.tally(db, cycle.id)
            noms = [n for n, _ in standings]
        view = MovieVoteView(cycle.id, build_vote_options(noms))
        embed = await build_vote_embed(self.bot, cycle, standings)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="movie", description="Show the next Movie Night selection")
    @app_commands.describe(banner="Show a banner image (default) or a plain embed")
    async def movie(self, interaction: discord.Interaction, banner: bool = True):
        await interaction.response.defer()
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            ev = await mn.get_pick_event(db, datetime.now(timezone.utc))
        if not ev:
            if cycle and cycle.phase == "paused":
                msg = "Movie Night is paused right now."
            else:
                msg = "No Movie Night has been picked yet - voting is open, cast yours with **/movie_vote**."
            await interaction.followup.send(msg)
            return
        extra = ev.extra_data or {}
        name = (extra.get("title_jp") or ev.title or "").replace("Movie Night: ", "", 1)
        embed = discord.Embed(title="🎬 Next Movie Night", description=f"**{name}**", color=COLOR)
        if ev.start_at:
            embed.add_field(name="Showtime", value=f"<t:{int(ev.start_at.timestamp())}:F>", inline=False)
        # Only nudge people to vote when the round is genuinely undecided. Once a winner
        # is picked (even early), voting is effectively settled for this showtime, so
        # pointing at /movie_vote (which reopens the same decided vote) would mislead.
        if cycle and cycle.phase == "voting" and not cycle.winner_nomination_id:
            embed.add_field(name="Heads up", value="Voting is open - cast yours with **/movie_vote**", inline=False)
        view = discord.ui.View()
        if ev.url:
            view.add_item(discord.ui.Button(label="View on TMDB", url=ev.url, style=discord.ButtonStyle.link))
        if banner:
            showtime_str = ev.start_at.strftime("%a, %b %d %Y · %H:%M UTC") if ev.start_at else ""
            png = await render_winner_banner(
                poster_url=ev.image_url, title=name, subtitle=showtime_str, eyebrow="NEXT MOVIE NIGHT"
            )
            if png:
                embed.set_image(url="attachment://movie.png")
                await interaction.followup.send(
                    embed=embed, view=view, file=discord.File(io.BytesIO(png), filename="movie.png")
                )
                return
        if ev.image_url:
            embed.set_image(url=ev.image_url)
        await interaction.followup.send(embed=embed, view=view)

    # ── Admin dashboard ───────────────────────────────────────

    @app_commands.command(
        name="manage_movie_night",
        description="[ADMIN] Movie Night dashboard - pick winner, reopen, new vote, showtime, pause, configure",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def manage_movie_night(self, interaction: discord.Interaction):
        await self._load_config()
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            standings = await mn.tally(db, cycle.id) if cycle else []
        view = MovieNightAdminView(interaction.user.id, self, cycle, standings)
        await interaction.response.send_message(embed=view.get_embed(), view=view, ephemeral=True)
        view.message = await interaction.original_response()


class NominatePickView(BaseView):
    """Ephemeral picker shown after a TMDB search; adds the choice to the pool."""

    def __init__(self, user_id: int, cog: MovieNightCog, cycle_id: int, results: list[dict]):
        super().__init__(user_id, timeout=120)
        self.cog = cog
        self.cycle_id = cycle_id
        self.results = results
        options = []
        for i, film in enumerate(results[:25]):
            year = f" ({film['release_year']})" if film.get("release_year") else ""
            label = f"{film['title']}{year}"[:100]
            desc = (film.get("overview") or "")[:100]
            options.append(discord.SelectOption(label=label, value=str(i), description=desc or None))
        self.add_item(NominatePickSelect(options))


class NominatePickSelect(discord.ui.Select):
    def __init__(self, options: list[discord.SelectOption]):
        super().__init__(placeholder="Choose a film...", options=options, min_values=1, max_values=1)

    async def callback(self, interaction: discord.Interaction) -> None:
        view: NominatePickView = self.view
        film = view.results[int(self.values[0])]
        async with async_session_maker() as db:
            _, status = await mn.add_nomination(db, view.cycle_id, film, interaction.user.id)

        if status == "cap":
            await interaction.response.edit_message(
                content="The pool is full (25). Vote for one with **/movie_vote**.", view=None
            )
            return
        if status == "duplicate":
            await interaction.response.edit_message(
                content=f"**{film['title']}** is already in the pool.", view=None
            )
            return
        if status == "same":
            await interaction.response.edit_message(
                content=f"You've already nominated **{film['title']}**.", view=None
            )
            return

        # One nomination per person: a new film for someone who already nominated
        # replaces their old pick rather than stacking.
        verb = "Swapped your nomination to" if status == "swapped" else "Added"
        await interaction.response.edit_message(content=f"✅ {verb} **{film['title']}**!", view=None)
        await refresh_public_vote_message(interaction.client, view.cycle_id)


async def setup(bot: commands.Bot):
    await bot.add_cog(MovieNightCog(bot))
