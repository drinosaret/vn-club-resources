"""Plan the native Discord scheduled events that mirror the club calendar.

Two halves, both free of discord.py: a planner that turns a window of calendar
items into the set of events that should exist, and the store for the
calendar-item to Discord-event mapping. Holding the decisions here rather than
in the cog is what makes them testable, since the container that runs the suite
does not mount the bot package.

Identity is the whole point. A weekly session is one Discord event from the
moment its slot is known until it has been and gone, through the rename and the
cover it gains when the vote resolves, so the key has to survive a change of
title, of cover and of showtime. external_key does not: it carries the showtime
date for a session and the winning VN for a monthly pick, and both of those move.
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiscordScheduledEvent, VisualNovel
from app.services import jiten_covers, recurring_events
from app.services.vndb_text import plain_vndb_description

logger = logging.getLogger(__name__)

# Config keys, all held in bot_config so the club can point the mirror at its own
# channels without a deploy.
CONFIG_ENABLED = "event_mirror_enabled"
CONFIG_CHANNEL_DEFAULT = "event_mirror_channel_default"
CONFIG_CHANNEL_PREFIX = "event_mirror_channel_"
# Where a type is organised (nominations, discussion), as opposed to where it
# happens. Named in the description beside the place, never used as the venue.
CONFIG_TALK_PREFIX = "event_mirror_talk_"
TALK = "💬"
CONFIG_ROLES_HINT = "event_mirror_roles_hint"

# Discord's own ceilings.
NAME_LIMIT = 100
DESCRIPTION_LIMIT = 1000
LOCATION_LIMIT = 100
GUILD_EVENT_CAP = 100

HORIZON = timedelta(days=30)
# An item this long is a span the club is inside rather than a sitting it turns
# up to, so one already under way is still worth publishing.
SPAN_MIN = timedelta(days=1)
# A session's placeholder is an all-day row at midnight, which is not when
# anything happens, so a configured show time replaces the hour.
DEFAULT_SHOW_TIME = "12:00"
DEFAULT_ROLES_HINT = "/roles for notification roles"
# Made literal wherever calendar text lands in a field that reads markdown.
_MARKDOWN_SPECIAL = frozenset("\\`*_~|[]")
# Room a channel or role name may take in the description before it crowds out
# the calendar text.
LABEL_LIMIT = 80
# The calendar blurb is the part that folds on the event card, so it is kept
# short rather than allowed to fill the whole field.
BLURB_LIMIT = 300
# Lines the event card shows before it folds.
LEAD_LINES = 3

PIN = "\U0001f4cd"
LINK = "\U0001f517"
FILM = "\U0001f3ac"
BOOK = "\U0001f4d6"
BELL = "\U0001f514"
CALENDAR = "\U0001f5d3\ufe0f"


def channel_key(event_type: str) -> str:
    """bot_config key holding the channel this type's events happen in."""
    return f"{CONFIG_CHANNEL_PREFIX}{event_type}"


def talk_key(event_type: str) -> str:
    """bot_config key holding the channel this type is organised in."""
    return f"{CONFIG_TALK_PREFIX}{event_type}"


@dataclass(frozen=True)
class TypeStyle:
    """How one calendar type presents itself in the Events tab."""

    emoji: str
    accent: tuple[int, int, int]
    eyebrow: str
    # Name while the slot is still open. Only meaningful for a type whose row
    # exists before its subject is known.
    idle_name: str
    # Name prefix once the row names a pick.
    pick_prefix: str
    # How the calendar titles this type. Empty when its titles already describe
    # themselves and should be mirrored verbatim.
    calendar_label: str
    # Length to give an event whose row names no end.
    duration: timedelta


STYLES: dict[str, TypeStyle] = {
    "movie_night": TypeStyle(
        emoji="🎬",
        accent=(244, 63, 94),
        eyebrow="KINOPLEX",
        idle_name="Kinoplex (Movie Night)",
        pick_prefix="Kinoplex",
        calendar_label="Movie Night",
        duration=timedelta(hours=3),
    ),
    "roudoku": TypeStyle(
        emoji="📚",
        accent=(217, 70, 239),
        eyebrow="WEEKLY ROUDOKU",
        idle_name="Weekly Roudoku",
        pick_prefix="Roudoku",
        calendar_label="Weekly Roudoku",
        duration=timedelta(hours=2),
    ),
    "vn_of_month": TypeStyle(
        emoji="✨",
        accent=(139, 92, 246),
        eyebrow="VN OF THE MONTH",
        idle_name="VN of the Month",
        pick_prefix="VN of the Month",
        calendar_label="VN of the Month",
        duration=timedelta(hours=2),
    ),
    "vn_of_season": TypeStyle(
        emoji="🍃",
        accent=(16, 185, 129),
        eyebrow="VN OF THE SEASON",
        idle_name="VN of the Season",
        pick_prefix="VN of the Season",
        calendar_label="VN of the Season",
        duration=timedelta(hours=2),
    ),
    "vn_month_voting": TypeStyle(
        emoji="🗳️",
        accent=(59, 130, 246),
        eyebrow="VOTING OPEN",
        idle_name="VN of the Month voting",
        pick_prefix="",
        calendar_label="",
        duration=timedelta(hours=2),
    ),
    "vn_season_voting": TypeStyle(
        emoji="🗳️",
        accent=(59, 130, 246),
        eyebrow="VOTING OPEN",
        idle_name="VN of the Season voting",
        pick_prefix="",
        calendar_label="",
        duration=timedelta(hours=2),
    ),
    "custom": TypeStyle(
        emoji="📌",
        accent=(99, 102, 241),
        eyebrow="VN CLUB",
        idle_name="VN Club event",
        pick_prefix="",
        calendar_label="",
        duration=timedelta(hours=2),
    ),
    "anniversary": TypeStyle(
        emoji="🎉",
        accent=(234, 179, 8),
        eyebrow="ANNIVERSARY",
        idle_name="Anniversary",
        pick_prefix="",
        calendar_label="",
        duration=timedelta(hours=2),
    ),
    "season_start": TypeStyle(
        emoji="🍂",
        accent=(20, 184, 166),
        eyebrow="NEW SEASON",
        idle_name="New season",
        pick_prefix="",
        calendar_label="",
        duration=timedelta(hours=2),
    ),
}

MIRRORED_TYPES = tuple(STYLES)

# Types that happen somewhere, in the order the admin panel lists them, with
# the label it shows. A marker such as the start of a season happens nowhere,
# so it takes no channel and is never offered one.
CHANNEL_TYPES = (
    ("movie_night", "Kinoplex"),
    ("roudoku", "Weekly Roudoku"),
    ("vn_of_month", "VN of the Month"),
    ("vn_of_season", "VN of the Season"),
    ("vn_month_voting", "VN of the Month voting"),
    ("vn_season_voting", "VN of the Season voting"),
    ("custom", "Custom events"),
)
NO_CHANNEL_TYPES = tuple(t for t in MIRRORED_TYPES if t not in {t for t, _ in CHANNEL_TYPES})

# Types whose row is one instance of a weekly slot, and the weekday that slot is
# anchored on. Their identity is the slot rather than the row.
SESSION_WEEKDAY = {
    "movie_night": recurring_events.MOVIE_NIGHT_WEEKDAY,
    "roudoku": recurring_events.ROUDOKU_WEEKDAY,
}
# Types whose row covers a period and can be re-picked within it.
PERIOD_TYPES = ("vn_of_month", "vn_of_season")
# Types whose row is authoritative about its cover: the club decides per pick
# whether art may show, and writes nothing when it may not.
OWN_COVER_TYPES = ("roudoku", "movie_night", "custom")


@dataclass(frozen=True)
class ChannelTarget:
    """Where a type's events point, already resolved against the guild."""

    channel_id: int | None = None
    # Voice and stage carry a channel; anything else has to be an external event,
    # since Discord will not attach one to a text channel.
    entity: str = "external"
    # Display name, used as the external location, which is a plain text field.
    label: str | None = None
    # The channel as a mention, for the description, which renders one as a
    # link into the channel.
    mention: str | None = None
    # Where the thing is organised, when that is a different channel from
    # where it happens: the nominations and the talk around it.
    talk_mention: str | None = None


@dataclass(frozen=True)
class MirrorConfig:
    """Everything the planner needs that does not come from the calendar."""

    calendar_url: str = "https://vnclub.org"
    targets: dict[str, ChannelTarget] = field(default_factory=dict)
    show_times: dict[str, str] = field(default_factory=dict)
    # The showtime the club has actually set for the next session of a type,
    # which is known before a pick is published and therefore before the
    # calendar carries anything but the generic weekly slot.
    sessions: dict[str, datetime] = field(default_factory=dict)
    # The weekday the club actually meets on, where it has set one. The calendar
    # draws its weekly placeholders on a fixed weekday, so the two can disagree.
    weekdays: dict[str, int] = field(default_factory=dict)
    roles_hint: str = DEFAULT_ROLES_HINT

    def target(self, event_type: str) -> ChannelTarget:
        if event_type in NO_CHANNEL_TYPES:
            return ChannelTarget()
        return self.targets.get(event_type) or ChannelTarget()

    def show_time(self, event_type: str) -> str:
        return self.show_times.get(event_type) or DEFAULT_SHOW_TIME

    def session(self, event_type: str) -> datetime | None:
        return self.sessions.get(event_type)

    def weekday(self, event_type: str) -> int | None:
        return self.weekdays.get(event_type)


@dataclass(frozen=True)
class PlannedEvent:
    """One scheduled event the guild should be holding."""

    sync_key: str
    event_type: str
    name: str
    description: str
    start_at: datetime
    end_at: datetime
    entity: str
    channel_id: int | None
    location: str | None
    image_url: str | None
    content_hash: str = ""

    @property
    def is_span(self) -> bool:
        """Whether this covers a stretch of days rather than a single sitting."""
        return self.end_at - self.start_at >= SPAN_MIN


def _parse(value) -> datetime | None:
    """Read a calendar timestamp, which is UTC but not always tz-marked."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value)
        except ValueError:
            return None
    else:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def clip(text: str, limit: int) -> str:
    """Trim to a Discord field's ceiling, marking the cut."""
    if limit <= 0 or len(text) <= limit:
        return text
    if limit == 1:
        return text[:1]
    return text[: limit - 1].rstrip() + "\u2026"


def one_line(text: str | None, limit: int | None = None) -> str:
    """Collapse a stored value to a single line, optionally clipped.

    Calendar text reaches Discord from third-party catalogues and from admin
    input, so line breaks and runs of whitespace are flattened before it lands in
    a field with a length ceiling.
    """
    flat = " ".join(_no_controls(text).split())
    return clip(flat, limit) if limit else flat


def _no_controls(text: str | None) -> str:
    # The catalogue dump writes a line break as the two-character sequence, the
    # same form the site turns back into a break.
    text = str(text or "").replace("\\n", " ").replace("\\r", " ")
    return "".join(" " if ord(ch) < 32 else ch for ch in text)


def inert_line(text: str | None, limit: int | None = None) -> str:
    """One literal line, safe to place in a field that reads markdown.

    A scheduled-event description renders markdown and label-and-address link
    syntax, and the calendar carries text this app did not write: catalogue
    blurbs and hand-typed event copy. The special characters are made literal in
    a single pass, because escaping an already-escaped character consumes the
    escape and restores its meaning.

    The limit applies to the escaped result, since that is what the field
    ceiling counts, and a cut is never left between an escape and the character
    it escapes.
    """
    flat = one_line(text)
    if not flat:
        return ""
    out: list[str] = []
    for ch in flat:
        if ch in _MARKDOWN_SPECIAL:
            out.append("\\")
        out.append(ch)
    escaped = "".join(out)
    if limit is None or len(escaped) <= limit:
        return escaped
    if limit <= 1:
        return escaped[:limit]
    cut = escaped[: limit - 1]
    trailing = len(cut) - len(cut.rstrip("\\"))
    if trailing % 2:
        cut = cut[:-1]
    return cut.rstrip() + "…"


def is_placeholder(item: dict) -> bool:
    """Whether a calendar item is a computed weekly slot rather than a stored row."""
    return str(item.get("external_key") or "").startswith("auto:")


def slot_date(event_type: str, start: datetime) -> str:
    """ISO date of the weekly slot a session belongs to.

    SLOT_MATCH_DAYS is the widest span that stays unambiguous on a seven-day
    cycle, so every date is within reach of exactly one occurrence of the slot
    weekday and a session moved off its usual day still names its own slot.
    """
    weekday = SESSION_WEEKDAY[event_type]
    day = start.astimezone(timezone.utc).date()
    forward = (weekday - day.weekday()) % 7
    offset = forward if forward <= recurring_events.SLOT_MATCH_DAYS else forward - 7
    return (day + timedelta(days=offset)).isoformat()


def sync_key(item: dict) -> str | None:
    """Stable identity for a calendar item, or None when it has none.

    Sessions key on their weekly slot so the placeholder and the resolved pick
    are one event. A monthly or seasonal pick keys on its period, so a re-pick
    renames the event rather than leaving the first one running beside a
    second. Every other type keys on its own external_key, which does not move
    for those types; a row without one, meaning an admin-created custom event,
    keys on its database id.
    """
    event_type = item.get("event_type")
    if event_type in SESSION_WEEKDAY:
        start = _parse(item.get("start_at"))
        return f"{event_type}:{slot_date(event_type, start)}" if start else None
    if event_type in PERIOD_TYPES:
        start = _parse(item.get("start_at"))
        return f"{event_type}:{start.date().isoformat()}" if start else None
    key = item.get("external_key")
    if key:
        return str(key)
    item_id = item.get("id")
    return f"{event_type}:{item_id}" if event_type and item_id is not None else None


_VN_URL = re.compile(r"^/vn/([0-9]+)/?$")


def _pick_from_title(title: str, calendar_label: str) -> str | None:
    """The subject a calendar title names, or None while the slot is open."""
    if not calendar_label:
        return None
    prefix = f"{calendar_label}: "
    if not title.startswith(prefix):
        return None
    return title[len(prefix):].strip() or None


def build_name(item: dict, style: TypeStyle) -> str:
    """The event's name, which is what the Events tab leads with.

    The original-script title is used where the row carries one: the site lets
    a reader choose a script, but the bot's own output is Japanese throughout.
    """
    title = one_line(item.get("title"))
    pick = _pick_from_title(title, style.calendar_label)
    japanese = one_line(item.get("title_jp"))
    if japanese:
        # A row's own Japanese title carries the calendar label; one filled in
        # from the catalogue is the bare title, and stands in for the pick.
        jp_pick = _pick_from_title(japanese, style.calendar_label)
        if jp_pick:
            pick = jp_pick
        elif pick:
            pick = japanese
        elif not style.calendar_label:
            title = japanese
    if pick and style.pick_prefix:
        body = f"{style.pick_prefix}: {pick}"
    elif pick:
        body = pick
    elif style.calendar_label and title == style.calendar_label:
        body = style.idle_name
    else:
        body = title or style.idle_name
    return clip(f"{style.emoji} {body}".strip(), NAME_LIMIT)


def _where_line(target: ChannelTarget) -> str | None:
    if not target.label and not target.mention:
        return None
    shown = target.mention or inert_line(target.label, LABEL_LIMIT)
    # A voice channel's mention already carries the speaker mark, so the kind
    # of channel is not spelled out.
    line = f"{PIN} In {shown}"
    if target.talk_mention and target.talk_mention != target.mention:
        line = f"{line} · {TALK} {target.talk_mention}"
    return line


def _what_line(item: dict, config: MirrorConfig) -> str | None:
    """A link to the thing itself: the film page, or the VN page on the site."""
    url = (item.get("url") or "").strip()
    if not url:
        return None
    vn = _VN_URL.match(url)
    if vn:
        url = f"https://vndb.org/v{vn.group(1)}"
    elif url.startswith("/"):
        url = f"{config.calendar_url.rstrip('/')}{url}"
    elif not url.lower().startswith(("http://", "https://")):
        return None
    event_type = item.get("event_type") or ""
    if event_type == "movie_night":
        mark = FILM
    elif event_type in ("roudoku", "vn_of_month", "vn_of_season"):
        mark = BOOK
    else:
        mark = LINK
    return f"{mark} {clip(one_line(url), LABEL_LIMIT * 2)}"


def build_description(item: dict, config: MirrorConfig, start: datetime) -> str:
    """Where it happens, how to be told about the next one, and what it is.

    The practical lines lead and the calendar's own text follows with whatever
    room is left: the event card shows only the first few lines before folding,
    and the channel and the calendar link are what a member needs from those.
    """
    event_type = item.get("event_type") or ""
    # Kept generic on purpose: the role a session pings is not necessarily one a
    # member can pick up, so naming it would send people looking for it.
    hint = inert_line(config.roles_hint or DEFAULT_ROLES_HINT, LABEL_LIMIT * 2)
    day = start.astimezone(timezone.utc).date().isoformat()
    # What a member needs first, in the order they need it: where, what, when
    # on the calendar, then how to get pinged. The event card shows only the
    # first few lines and slices the next one in half, so the top block is held
    # to LEAD_LINES and the rest drops below a blank line, where it folds whole.
    where = _where_line(config.target(event_type))
    first = f"{where} · {BELL} {hint}" if where else f"{BELL} {hint}"
    lead = [
        line
        for line in (
            first,
            _what_line(item, config),
            f"{CALENDAR} {config.calendar_url.rstrip('/')}/events?date={day}",
        )
        if line
    ]
    blocks = ["\n".join(lead[:LEAD_LINES])]
    if lead[LEAD_LINES:]:
        blocks.append("\n".join(lead[LEAD_LINES:]))
    head = "\n\n".join(blocks)
    room = min(BLURB_LIMIT, DESCRIPTION_LIMIT - len(head) - 2)
    body = inert_line(item.get("description"), room) if room > 0 else ""
    return clip(f"{head}\n\n{body}" if body else head, DESCRIPTION_LIMIT)


def _start_of(item: dict, config: MirrorConfig) -> datetime | None:
    """When the event actually begins.

    A row that names its own time is taken at its word. A weekly placeholder
    names none, since the calendar stores it as an all-day row so it can be
    drawn on the day, so the club is asked instead, in order of how much it
    knows: the armed cycle for that slot, then the weekday and time it has
    configured, then the day the calendar drew.
    """
    start = _parse(item.get("start_at"))
    if start is None:
        return None
    event_type = item.get("event_type") or ""
    if event_type not in SESSION_WEEKDAY or not item.get("all_day"):
        return start
    if is_placeholder(item):
        # The club may have moved this week off the usual weekday, which the
        # calendar only learns when the pick is published. The armed session
        # is the better answer for the slot it falls in.
        armed = config.session(event_type)
        if armed is not None and slot_date(event_type, armed) == slot_date(event_type, start):
            return armed.astimezone(timezone.utc)
        start = _on_club_weekday(start, event_type, config.weekday(event_type))
    # A dated row an admin made keeps its day and only gains the hour.
    raw = config.show_time(event_type)
    try:
        hour, minute = (int(part) for part in str(raw).split(":", 1))
        return start.replace(hour=hour, minute=minute, second=0, microsecond=0)
    except (TypeError, ValueError):
        logger.warning("Event mirror: unreadable show time %r for %s", raw, event_type)
    return start


def _on_club_weekday(start: datetime, event_type: str, weekday: int | None) -> datetime:
    """Move a weekly placeholder onto the weekday the club actually meets.

    The calendar draws every weekly slot on a fixed weekday, so a club that has
    set a different one would otherwise be told to turn up on the wrong day. The
    slot the event belongs to does not change, only the day it names: the
    nearest occurrence is taken, which SLOT_MATCH_DAYS keeps inside the slot.
    """
    if weekday is None or weekday == SESSION_WEEKDAY.get(event_type):
        return start
    span = recurring_events.SLOT_MATCH_DAYS
    offset = ((weekday - start.weekday() + span) % 7) - span
    return start + timedelta(days=offset)


def _end_of(item: dict, start: datetime, style: TypeStyle) -> datetime:
    """When the event ends. An external event cannot be created without one."""
    end = _parse(item.get("end_at"))
    if end is not None and end > start:
        return end
    if item.get("all_day") and item.get("event_type") not in SESSION_WEEKDAY:
        return start.replace(hour=23, minute=59, second=0, microsecond=0)
    return start + style.duration


def content_hash(entry: PlannedEvent) -> str:
    """Fingerprint of everything an edit would carry, so a tick that changes
    nothing sends nothing."""
    parts = (
        entry.name,
        entry.description,
        entry.start_at.isoformat(),
        entry.end_at.isoformat(),
        entry.entity,
        entry.channel_id,
        entry.location,
        entry.image_url,
    )
    joined = "\u0000".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def plan(
    items: list[dict],
    config: MirrorConfig,
    now: datetime,
    *,
    horizon: timedelta = HORIZON,
) -> list[PlannedEvent]:
    """The events the guild should be holding for this calendar window.

    An item that has already started is kept as long as it has not ended, so a
    live event is left in place rather than pruned out from under the members
    watching it. Whether one can still be created is the caller's question, since
    Discord refuses a start time in the past.
    """
    horizon_end = now + horizon
    planned: dict[str, PlannedEvent] = {}
    for item in items:
        event_type = item.get("event_type") or ""
        style = STYLES.get(event_type)
        if style is None:
            continue
        start = _start_of(item, config)
        if start is None or start >= horizon_end:
            continue
        end = _end_of(item, start, style)
        if end <= now:
            continue
        key = sync_key(item)
        if not key:
            logger.warning("Event mirror: a %s item carries no stable key, skipped", event_type)
            continue
        target = config.target(event_type)
        entity = target.entity if target.channel_id else "external"
        location = None
        if entity == "external":
            fallback = f"{config.calendar_url.rstrip('/')}/events"
            location = clip(target.label or fallback, LOCATION_LIMIT)
        entry = PlannedEvent(
            sync_key=key,
            event_type=event_type,
            name=build_name(item, style),
            description=build_description(item, config, start),
            start_at=start,
            end_at=end,
            entity=entity,
            channel_id=target.channel_id if entity != "external" else None,
            location=location,
            image_url=item.get("image_url") or None,
        )
        entry = replace(entry, content_hash=content_hash(entry))
        clash = planned.get(key)
        if clash is not None:
            # Two rows can fall inside one weekly slot. The earlier one owns it,
            # so the tab shows the session that comes first instead of flipping
            # between them from tick to tick.
            winner, loser = (clash, entry) if clash.start_at <= entry.start_at else (entry, clash)
            logger.info(
                "Event mirror: slot %s is filled by the %s session, skipping the %s one",
                key,
                winner.start_at.date().isoformat(),
                loser.start_at.date().isoformat(),
            )
            planned[key] = winner
            continue
        planned[key] = entry
    return sorted(planned.values(), key=lambda entry: entry.start_at)


BLURB_SOURCE_LIMIT = 600


def plain_blurb(text: str | None) -> str:
    """Catalogue prose as one plain line, spoilers left out."""
    return one_line(plain_vndb_description(text), BLURB_SOURCE_LIMIT)


async def attach_catalogue_blurbs(db: AsyncSession, items: list[dict]) -> list[dict]:
    """Give a monthly or seasonal pick a blurb where its row carries none.

    Those rows come from the reading-club import, which names the VN and
    nothing else; the catalogue holds a description for it. Mutates and
    returns items.
    """
    wanted: dict[str, list[dict]] = {}
    for item in items:
        if item.get("event_type") not in PERIOD_TYPES or item.get("description"):
            continue
        match = _VN_URL.match(item.get("url") or "")
        if match:
            wanted.setdefault(f"v{match.group(1)}", []).append(item)
    if not wanted:
        return items
    rows = await db.execute(
        select(VisualNovel.id, VisualNovel.description).where(VisualNovel.id.in_(list(wanted)))
    )
    for vid, description in rows.all():
        blurb = plain_blurb(description)
        if blurb:
            for item in wanted.get(vid, []):
                item["description"] = blurb
    return items


async def attach_safe_covers(items: list[dict]) -> list[dict]:
    """Give a VN-linked item a cover it can publish where its row carries none.

    The row's own image_url is what the site publishes as metadata and is used
    as-is. A row without one still names its VN, and the catalogue cover comes
    attached as cover_url with its rating; that art is taken through the same
    rule the channel banners use, so a flagged cover is swapped for the SFW one
    where a deck exists and left out where it would need blurring, which a
    Discord cover cannot do. Mutates and returns items.
    """
    for item in items:
        if item.get("image_url") or not item.get("cover_url"):
            continue
        if item.get("event_type") in OWN_COVER_TYPES:
            continue
        match = _VN_URL.match(item.get("url") or "")
        if not match:
            continue
        try:
            url, blur, show = await jiten_covers.resolve_display_cover(
                f"v{match.group(1)}", item["cover_url"], item.get("image_sexual")
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Event mirror: cover check failed for %s: %s", item.get("external_key"), e)
            continue
        if show and not blur and url:
            item["image_url"] = url
    return items


# ── Mapping store ─────────────────────────────────────────────


@dataclass(frozen=True)
class Mapping:
    """A recorded mirror, detached from the session that read it."""

    sync_key: str
    discord_event_id: int
    content_hash: str


async def load_mappings(db: AsyncSession, guild_id: int) -> dict[str, Mapping]:
    """Every mirrored event this guild is known to hold, by sync key.

    Read out as plain values: the reconcile commits repeatedly while it works,
    and detached rows keep it free of any lazy load part way through.
    """
    result = await db.execute(
        select(
            DiscordScheduledEvent.sync_key,
            DiscordScheduledEvent.discord_event_id,
            DiscordScheduledEvent.content_hash,
        ).where(DiscordScheduledEvent.guild_id == guild_id)
    )
    return {
        sync_key: Mapping(sync_key, discord_event_id, content_hash or "")
        for sync_key, discord_event_id, content_hash in result.all()
    }


async def save_mapping(
    db: AsyncSession,
    *,
    guild_id: int,
    sync_key: str,
    discord_event_id: int,
    content_hash: str,
) -> None:
    """Record which Discord event a calendar item currently owns."""
    result = await db.execute(
        select(DiscordScheduledEvent).where(
            DiscordScheduledEvent.guild_id == guild_id,
            DiscordScheduledEvent.sync_key == sync_key,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = DiscordScheduledEvent(guild_id=guild_id, sync_key=sync_key)
        db.add(row)
    row.discord_event_id = discord_event_id
    row.content_hash = content_hash
    row.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        # Another tick claimed the same key first, and its row is the live one.
        await db.rollback()


async def drop_mapping(db: AsyncSession, *, guild_id: int, sync_key: str) -> None:
    """Forget a mirrored event, so the next tick treats the key as new."""
    result = await db.execute(
        select(DiscordScheduledEvent).where(
            DiscordScheduledEvent.guild_id == guild_id,
            DiscordScheduledEvent.sync_key == sync_key,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
