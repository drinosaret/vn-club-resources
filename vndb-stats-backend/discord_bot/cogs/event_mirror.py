"""Mirror the club calendar into the guild's native Events tab.

- /manage_event_sync (admin): channels, the master switch, and a manual run

A background reconcile keeps one Discord scheduled event per upcoming calendar
item. A weekly session appears as soon as its slot is known and is renamed and
given its cover in place when the vote resolves, so members keep one event to be
interested in rather than watching one vanish and another take its place.

The decisions live in app/services/event_mirror.py; this holds only the Discord
side, so the reconcile can be reasoned about without a guild in front of it.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import BotConfig
from app.services import event_mirror as em
from app.services import events_service
from app.services import movie_night_service as mn
from app.services import roudoku_service as rd
from app.services.event_banner import render_event_cover, when_label
from discord_bot.config import get_bot_settings
from discord_bot.permissions import is_admin

logger = logging.getLogger(__name__)

SYNC_INTERVAL_MINUTES = 15
# Discord refuses a start time in the past, so an event is only creatable with a
# little room to spare.
CREATE_LEAD = timedelta(minutes=2)
# Room left under Discord's per-guild ceiling so the mirror never crowds out an
# event somebody made by hand.
CREATE_HEADROOM = 5
# Creates carry a cover upload each and are paced; edits are cheap, and the cap
# only needs to sit above the number of events a horizon can hold so a
# change to every description lands in one tick.
MAX_CREATES_PER_TICK = 8
MAX_EDITS_PER_TICK = 40
# How close two start times have to be for an unmapped event to be recognised as
# this bot's own after the mapping row was lost.
ADOPT_TOLERANCE = timedelta(minutes=1)

REASON = "Mirroring the VN Club calendar"

_ENTITY = {
    "voice": discord.EntityType.voice,
    "stage": discord.EntityType.stage_instance,
    "external": discord.EntityType.external,
}

# Config keys owned elsewhere that the mirror reads rather than duplicates.
SHOW_TIME_KEYS = {"movie_night": "movie_night_show_time", "roudoku": "roudoku_show_time"}
WEEKDAY_KEYS = {"movie_night": "movie_night_show_weekday", "roudoku": "roudoku_show_weekday"}

TRUTHY = ("1", "true", "yes", "on")


def _as_id(raw) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


class EventMirrorCog(commands.Cog):
    """Keeps the Events tab in step with the calendar."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._config: dict[str, str] = {}
        self._enabled = False
        # The loop and the panel's manual run share one reconcile, so a slow tick
        # cannot be overtaken and produce a second event for the same slot.
        self._lock = asyncio.Lock()
        self._last_status = "Not run yet"

    async def cog_load(self) -> None:
        await self.load_config()
        self.sync_loop.start()

    async def cog_unload(self) -> None:
        self.sync_loop.cancel()

    # ── Config ────────────────────────────────────────────────

    async def load_config(self) -> None:
        try:
            async with async_session_maker() as db:
                result = await db.execute(select(BotConfig))
                self._config = {row.key: row.value for row in result.scalars().all()}
        except Exception as e:
            logger.warning("Event mirror: config load failed: %s", e)
            return
        self._enabled = str(self._config.get(em.CONFIG_ENABLED, "")).strip().lower() in TRUTHY

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def last_status(self) -> str:
        return self._last_status

    @property
    def config(self) -> dict[str, str]:
        """The loaded bot_config snapshot, so the panel renders what the loop sees."""
        return self._config

    async def save_setting(self, key: str, value: str) -> None:
        """Write one setting and reload, so the next tick uses it immediately."""
        async with async_session_maker() as db:
            existing = await db.execute(select(BotConfig).where(BotConfig.key == key))
            row = existing.scalar_one_or_none()
            if row is not None:
                row.value = value
                row.updated_at = datetime.now(timezone.utc)
            else:
                db.add(BotConfig(key=key, value=value))
            await db.commit()
        await self.load_config()

    def _resolve_target(self, guild: discord.Guild, event_type: str) -> em.ChannelTarget | None:
        """Where this type's events point.

        None when a channel is configured but not available. That has to stop
        the tick rather than fall back, because falling back rewrites every
        event to the generic location and writes them all back the moment the
        channel returns.

        The channel is named as picked: an admin chose it for events that are
        visible server wide, and on a server where the club channels sit behind
        a member role, gating the name on the everyone role would blank it.
        """
        talk_raw = self._config.get(em.talk_key(event_type))
        talk = guild.get_channel(_as_id(talk_raw)) if talk_raw else None
        if talk_raw and talk is None:
            return None
        talk_mention = talk.mention if talk is not None else None
        raw = self._config.get(em.channel_key(event_type)) or self._config.get(
            em.CONFIG_CHANNEL_DEFAULT
        )
        if not raw and talk is not None:
            # Organised somewhere but happening nowhere in particular: the
            # organising channel is the closest thing to a place.
            return em.ChannelTarget(entity="external", label=f"#{talk.name}", mention=talk_mention)
        if not raw:
            return em.ChannelTarget()
        channel = guild.get_channel(_as_id(raw))
        if channel is None:
            return None
        mention = channel.mention
        if isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
            label = channel.name
            perms = channel.permissions_for(guild.me)
            if perms.view_channel and perms.connect:
                entity = "stage" if isinstance(channel, discord.StageChannel) else "voice"
                return em.ChannelTarget(
                    channel_id=channel.id, entity=entity, label=label,
                    mention=mention, talk_mention=talk_mention,
                )
            # A voice event the bot cannot see or join would be refused outright,
            # so the channel is named instead of pointed at.
            return em.ChannelTarget(entity="external", label=label, mention=mention, talk_mention=talk_mention)
        return em.ChannelTarget(
            entity="external", label=f"#{channel.name}", mention=mention, talk_mention=talk_mention
        )

    async def armed_sessions(self) -> dict[str, datetime]:
        """The showtime the club has set for each weekly session.

        The calendar only learns it when the pick is published, so until then
        the generic weekly slot is all it can offer.
        """
        out: dict[str, datetime] = {}
        try:
            async with async_session_maker() as db:
                for event_type, service in (("movie_night", mn), ("roudoku", rd)):
                    cycle = await service.get_active_cycle(db)
                    when = getattr(cycle, "scheduled_for", None)
                    if when is not None:
                        out[event_type] = (
                            when if when.tzinfo else when.replace(tzinfo=timezone.utc)
                        )
        except Exception as e:
            logger.warning("Event mirror: reading the armed sessions failed: %s", e)
        return out

    def build_config(self, guild: discord.Guild, sessions=None) -> em.MirrorConfig | None:
        targets = {}
        for event_type, _label in em.CHANNEL_TYPES:
            target = self._resolve_target(guild, event_type)
            if target is None:
                logger.warning(
                    "Event mirror: the channel configured for %s is not available", event_type
                )
                return None
            targets[event_type] = target
        show_times = {
            event_type: self._config.get(key)
            for event_type, key in SHOW_TIME_KEYS.items()
            if self._config.get(key)
        }
        weekdays = {}
        for event_type, key in WEEKDAY_KEYS.items():
            raw = self._config.get(key)
            if raw not in (None, ""):
                try:
                    weekdays[event_type] = int(raw)
                except (TypeError, ValueError):
                    logger.warning("Event mirror: unreadable weekday %r for %s", raw, event_type)
        return em.MirrorConfig(
            calendar_url=get_bot_settings().frontend_url,
            targets=targets,
            show_times=show_times,
            sessions=sessions or {},
            weekdays=weekdays,
            roles_hint=self._config.get(em.CONFIG_ROLES_HINT) or em.DEFAULT_ROLES_HINT,
        )

    # ── Discord writes ────────────────────────────────────────

    async def _cover(self, entry: em.PlannedEvent) -> bytes | None:
        style = em.STYLES.get(entry.event_type)
        if style is None:
            return None
        headline = entry.name[len(style.emoji):].strip() or entry.name
        prefix = f"{style.pick_prefix}: "
        if style.pick_prefix and headline.startswith(prefix):
            headline = headline[len(prefix):] or headline
        return await render_event_cover(
            image_url=entry.image_url,
            eyebrow=style.eyebrow,
            title=headline,
            subtitle=when_label(entry.start_at, entry.end_at),
            accent=style.accent,
        )

    def _placement(self, guild: discord.Guild, entry: em.PlannedEvent) -> dict | None:
        """The entity-type half of a payload, or None when the channel is gone."""
        if entry.entity == "external":
            return {"entity_type": _ENTITY["external"], "location": entry.location}
        channel = guild.get_channel(entry.channel_id or 0)
        if channel is None:
            return None
        return {"entity_type": _ENTITY[entry.entity], "channel": channel}

    async def _create(
        self, guild: discord.Guild, entry: em.PlannedEvent, start_at: datetime
    ) -> discord.ScheduledEvent | None:
        placement = self._placement(guild, entry)
        if placement is None:
            logger.warning("Event mirror: %s has no reachable channel, not created", entry.sync_key)
            return None
        payload = {
            "name": entry.name,
            "description": entry.description,
            "start_time": start_at,
            "end_time": entry.end_at,
            "privacy_level": discord.PrivacyLevel.guild_only,
            "reason": REASON,
            **placement,
        }
        cover = await self._cover(entry)
        if cover:
            payload["image"] = cover
        return await guild.create_scheduled_event(**payload)

    async def _apply(
        self, guild: discord.Guild, event: discord.ScheduledEvent, entry: em.PlannedEvent
    ) -> bool:
        """Bring an existing event in line. An event whose start has passed keeps
        its times, whether or not Discord has marked it live: members were told
        when it is, and a start moved to now would run past the end."""
        payload = {"name": entry.name, "description": entry.description, "reason": REASON}
        upcoming = event.status is discord.EventStatus.scheduled and entry.start_at > (
            datetime.now(timezone.utc) + CREATE_LEAD
        )
        if upcoming:
            placement = self._placement(guild, entry)
            if placement is None:
                logger.warning("Event mirror: %s has no reachable channel, left as it was", entry.sync_key)
                return False
            payload.update(placement)
            payload["start_time"] = entry.start_at
            payload["end_time"] = entry.end_at
        elif entry.entity == "external" and event.entity_type is discord.EntityType.external:
            # A running event keeps its times and its kind, but where an external
            # one says it happens is only a label, and a month-long pick would
            # otherwise name the wrong channel until it ended.
            payload["location"] = entry.location
        cover = await self._cover(entry)
        if cover:
            payload["image"] = cover
        await event.edit(**payload)
        return True

    def _adoptable(
        self,
        entry: em.PlannedEvent,
        events: list[discord.ScheduledEvent],
        claimed: set[int],
    ) -> discord.ScheduledEvent | None:
        """An event this bot already made for this slot, when the mapping row for
        it has been lost. Restricted to the bot's own events at the same start
        time, so nothing made by hand is ever taken over."""
        me = self.bot.user
        if me is None:
            return None
        for event in events:
            if event.id in claimed or event.creator_id != me.id:
                continue
            if event.status is not discord.EventStatus.scheduled or event.start_time is None:
                continue
            if abs(event.start_time - entry.start_at) <= ADOPT_TOLERANCE:
                return event
        return None

    # ── Mapping writes ────────────────────────────────────────

    async def _save(self, guild_id: int, entry: em.PlannedEvent, discord_event_id: int) -> None:
        async with async_session_maker() as db:
            await em.save_mapping(
                db,
                guild_id=guild_id,
                sync_key=entry.sync_key,
                discord_event_id=discord_event_id,
                content_hash=entry.content_hash,
            )

    async def _drop(self, guild_id: int, sync_key: str) -> None:
        async with async_session_maker() as db:
            await em.drop_mapping(db, guild_id=guild_id, sync_key=sync_key)

    # ── Reconcile ─────────────────────────────────────────────

    async def sync(self) -> str:
        """Bring the Events tab in line with the calendar. Returns what happened."""
        async with self._lock:
            try:
                self._last_status = await self._reconcile()
            except Exception as e:
                logger.error("Event mirror: reconcile failed: %s", e, exc_info=True)
                self._last_status = "The sync failed. The log carries the detail."
        return self._last_status

    async def _reconcile(self) -> str:
        if not self._enabled:
            return "The mirror is off. Turn it on from this panel to start publishing events."
        settings = get_bot_settings()
        guild = self.bot.get_guild(settings.guild_id) if settings.guild_id else None
        if guild is None:
            return "No home server is configured, so there is nothing to mirror."
        me = guild.me
        if me is None or not (me.guild_permissions.manage_events or me.guild_permissions.create_events):
            return "The bot needs the Manage Events permission in this server before it can publish anything."

        now = datetime.now(timezone.utc)
        try:
            async with async_session_maker() as db:
                items = await events_service.get_window_merged(db, now, now + em.HORIZON)
                items = await em.attach_catalogue_blurbs(db, items)
            items = await em.attach_safe_covers(items)
        except Exception as e:
            logger.error("Event mirror: calendar read failed: %s", e, exc_info=True)
            return "The calendar could not be read, so nothing was changed."

        config = self.build_config(guild, await self.armed_sessions())
        if config is None:
            return "A configured channel is not available right now, so nothing was changed."
        planned = em.plan(items, config, now)

        try:
            existing = await guild.fetch_scheduled_events()
        except discord.HTTPException as e:
            logger.error("Event mirror: listing the guild events failed: %s", e)
            return "The events in this server could not be read, so nothing was changed."

        by_id = {event.id: event for event in existing}
        live = sum(
            1
            for event in existing
            if event.status in (discord.EventStatus.scheduled, discord.EventStatus.active)
        )

        created = edited = adopted = removed = 0
        deferred = capped = failed = 0

        async with async_session_maker() as db:
            mappings = await em.load_mappings(db, guild.id)
        claimed = {row.discord_event_id for row in mappings.values()}

        if not planned and mappings:
            # A window that yields nothing is indistinguishable from a read
            # that went wrong, and the recurring rhythms alone should always
            # fill one. Changing nothing is the safe answer.
            logger.warning(
                "Event mirror: the calendar window came back empty while %d event(s) are "
                "mirrored, so they were left alone",
                len(mappings),
            )
            mappings = {}

        for entry in planned:
            row = mappings.pop(entry.sync_key, None)
            event = by_id.get(row.discord_event_id) if row else None
            if row is not None and event is None:
                # The listing omits what was canceled or completed as well as
                # what was deleted, and only the last of those may be made
                # again. Anything else is left exactly as it is.
                try:
                    gone = await guild.fetch_scheduled_event(row.discord_event_id)
                except discord.NotFound:
                    await self._drop(guild.id, entry.sync_key)
                    row = None
                except discord.HTTPException as e:
                    logger.warning("Event mirror: could not check %s: %s", entry.sync_key, e)
                    continue
                else:
                    if gone.status in (discord.EventStatus.completed, discord.EventStatus.canceled):
                        continue
                    event = gone

            if event is None:
                event = self._adoptable(entry, existing, claimed)
                if event is not None:
                    claimed.add(event.id)
                    adopted += 1

            if event is None:
                start_at = entry.start_at
                if start_at <= now + CREATE_LEAD:
                    # Discord will not take a start time in the past. A
                    # sitting that has begun is left alone; a stretch of days
                    # the club is already inside still belongs on the tab, so
                    # it is published as running from now.
                    if not entry.is_span:
                        deferred += 1
                        continue
                    start_at = now + CREATE_LEAD
                over_cap = live + created >= em.GUILD_EVENT_CAP - CREATE_HEADROOM
                if created >= MAX_CREATES_PER_TICK or over_cap:
                    capped += 1
                    continue
                try:
                    event = await self._create(guild, entry, start_at)
                except (discord.HTTPException, TypeError, ValueError) as e:
                    failed += 1
                    logger.warning("Event mirror: creating %s failed: %s", entry.sync_key, e)
                    continue
                if event is None:
                    failed += 1
                    continue
                created += 1
                claimed.add(event.id)
                await self._save(guild.id, entry, event.id)
                continue

            if event.status in (discord.EventStatus.completed, discord.EventStatus.canceled):
                continue
            if row is not None and row.content_hash == entry.content_hash:
                continue
            if edited >= MAX_EDITS_PER_TICK:
                capped += 1
                continue
            try:
                applied = await self._apply(guild, event, entry)
            except (discord.HTTPException, TypeError, ValueError) as e:
                failed += 1
                logger.warning("Event mirror: updating %s failed: %s", entry.sync_key, e)
                continue
            if not applied:
                failed += 1
                continue
            edited += 1
            await self._save(guild.id, entry, event.id)

        for sync_key, row in list(mappings.items()):
            event = by_id.get(row.discord_event_id)
            if event is None:
                await self._drop(guild.id, sync_key)
                continue
            if event.status is not discord.EventStatus.scheduled:
                # It began or finished. Taking it away would erase something
                # that happened, so only the record lapses.
                continue
            try:
                await event.delete(reason=REASON)
            except discord.NotFound:
                pass
            except (discord.HTTPException, TypeError, ValueError) as e:
                logger.warning("Event mirror: removing %s failed: %s", sync_key, e)
                continue
            await self._drop(guild.id, sync_key)
            removed += 1

        done = [
            f"{created} created" if created else "",
            f"{edited} updated" if edited else "",
            f"{removed} removed" if removed else "",
            f"{adopted} reclaimed" if adopted else "",
        ]
        summary = ", ".join(part for part in done if part) or "nothing to change"
        held = [
            f"{deferred} already under way" if deferred else "",
            f"{capped} held back for the next run" if capped else "",
            f"{failed} failed" if failed else "",
        ]
        note = ", ".join(part for part in held if part)

        if created or edited or removed or adopted:
            logger.info("Event mirror: %s (%d planned)", summary, len(planned))
        else:
            logger.debug("Event mirror: %s (%d planned)", summary, len(planned))
        if capped or failed:
            logger.warning("Event mirror: %s", note)

        status = f"{len(planned)} event(s) on the calendar; {summary}."
        return f"{status} ({note})" if note else status

    async def remove_published(self) -> str:
        """Take back every published event that has not started yet.

        Turning the mirror off stops it writing but leaves what it already
        wrote, so there has to be a way to clear the tab without deleting a
        dozen events by hand. Anything already under way is left, since removing
        it would erase something that happened.
        """
        async with self._lock:
            settings = get_bot_settings()
            guild = self.bot.get_guild(settings.guild_id) if settings.guild_id else None
            if guild is None:
                return "No home server is configured, so there is nothing to remove."
            try:
                existing = {e.id: e for e in await guild.fetch_scheduled_events()}
            except discord.HTTPException as e:
                logger.error("Event mirror: listing the guild events failed: %s", e)
                return "The events in this server could not be read, so nothing was changed."
            removed = kept = 0
            async with async_session_maker() as db:
                mapped = await em.load_mappings(db, guild.id)
            for sync_key, row in mapped.items():
                event = existing.get(row.discord_event_id)
                if event is not None:
                    if event.status is not discord.EventStatus.scheduled:
                        kept += 1
                        continue
                    try:
                        await event.delete(reason=REASON)
                        removed += 1
                    except discord.NotFound:
                        pass
                    except (discord.HTTPException, TypeError, ValueError) as e:
                        logger.warning("Event mirror: removing %s failed: %s", sync_key, e)
                        continue
                await self._drop(guild.id, sync_key)
            logger.info("Event mirror: removed %d published event(s), left %d under way", removed, kept)
            self._last_status = f"Removed {removed} published event(s)."
            if kept:
                self._last_status += f" {kept} already under way were left in place."
            return self._last_status

    # ── Loop ──────────────────────────────────────────────────

    @tasks.loop(minutes=SYNC_INTERVAL_MINUTES)
    async def sync_loop(self) -> None:
        await self.load_config()
        await self.sync()

    @sync_loop.before_loop
    async def before_sync_loop(self) -> None:
        await self.bot.wait_until_ready()
        logger.info("Event mirror: sync loop started (%dm cadence)", SYNC_INTERVAL_MINUTES)

    @sync_loop.error
    async def sync_loop_error(self, error: Exception) -> None:
        logger.error("Event mirror sync error: %s", error, exc_info=True)

    # ── Command ───────────────────────────────────────────────

    @app_commands.command(
        name="manage_event_sync",
        description="[ADMIN] Mirror the calendar to the Events tab in this server",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def manage_event_sync(self, interaction: discord.Interaction) -> None:
        from discord_bot.views.event_mirror import EventMirrorView

        view = EventMirrorView(user_id=interaction.user.id, cog=self)
        await view.refresh()
        await interaction.response.send_message(
            embed=view.build_embed(), view=view, ephemeral=True
        )
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(EventMirrorCog(bot))
