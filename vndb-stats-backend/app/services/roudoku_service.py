"""Weekly Roudoku business logic (one long-lived cycle, single channel).

Structurally the same as Movie Night: voting is ALWAYS open (members nominate
into the pool and vote any time) unless an admin PAUSES it, and at most one VN
is flagged as this week's pick via cycle.winner_nomination_id and published to
/events. Unlike Movie Night the pool is meant to turn over weekly, so the cog's
rollover calls start_new_vote after each session.

Roudoku (朗読) is reading aloud: the club reads one very short VN aloud together
in a single sitting, which is what the length cap is protecting.

Two things are specific to reading a VN rather than watching a film:
  - nominations are gated on length (see length_utils.passes_length_gate), with
    the cap stored in bot_config so an admin can loosen it without a deploy
  - covers go through jiten_covers.resolve_display_cover, since VN cover art is
    frequently adult and a Discord channel has no click-to-reveal

phases: voting (open, the default) | paused
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BotConfig, Event, RoudokuCycle, RoudokuNomination, RoudokuVote, VisualNovel
from app.services import events_service, jiten_covers, length_utils
from app.services.vndb_text import clean_vndb_description

logger = logging.getLogger(__name__)

MAX_POOL = 25  # Discord select hard cap
VNDB_URL = "https://vndb.org/{vndb_id}"
CONFIG_VOTE_ROLE = "roudoku_vote_role_id"  # optional role gate on voting
CONFIG_MAX_LENGTH = "roudoku_max_length_minutes"
DEFAULT_MAX_LENGTH_MIN = length_utils.VERY_SHORT_MAX_MINUTES  # 120 = VNDB "Very Short"
DESCRIPTION_LIMIT = 1000

COVER_MODES = ("auto", "shown", "blurred", "hidden")

EVENT_TYPE = "roudoku"
EVENT_TITLE_PREFIX = "Weekly Roudoku"


# ── Config ─────────────────────────────────────────────────

async def _config(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(select(BotConfig).where(BotConfig.key == key))).scalar_one_or_none()
    return row.value if row else None


async def get_vote_role_id(db: AsyncSession) -> int | None:
    """The role required to vote, or None if voting is open to everyone."""
    value = await _config(db, CONFIG_VOTE_ROLE)
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        logger.warning("%s holds a non-numeric value; ignoring the role gate", CONFIG_VOTE_ROLE)
        return None


async def get_max_length_minutes(db: AsyncSession) -> int:
    """The nomination length cap in minutes. Read on every nominate, so a bad
    stored value falls back to the default rather than throwing at the gate."""
    value = await _config(db, CONFIG_MAX_LENGTH)
    try:
        parsed = int(value) if value else 0
    except (TypeError, ValueError):
        parsed = 0
    return parsed if parsed > 0 else DEFAULT_MAX_LENGTH_MIN


@dataclass
class RoudokuPick:
    """Snapshot of the picked VN, so the caller can render the announcement
    banner + embed without re-fetching the nomination."""

    vndb_id: str
    title: str
    title_jp: str | None
    title_romaji: str | None
    released: date | None
    cover_url: str | None  # already resolved through jiten_covers
    cover_blur: bool
    cover_show: bool
    length_minutes: float | None
    description: str | None
    votes: int
    session_at: datetime | None


# ── VN lookup (local dump; no VNDB API) ────────────────────

def _vn_to_dict(row) -> dict:
    return {
        "vndb_id": row.id,
        "title": row.title,
        "title_jp": row.title_jp,
        "title_romaji": row.title_romaji,
        "released": row.released,
        "image_url": row.image_url,
        "image_sexual": row.image_sexual,
        "length": row.length,
        "length_minutes": row.length_minutes,
        "description": clean_vndb_description(row.description, limit=DESCRIPTION_LIMIT)
        if row.description
        else None,
    }


_VN_COLUMNS = (
    VisualNovel.id,
    VisualNovel.title,
    VisualNovel.title_jp,
    VisualNovel.title_romaji,
    VisualNovel.released,
    VisualNovel.image_url,
    VisualNovel.image_sexual,
    VisualNovel.length,
    VisualNovel.length_minutes,
    VisualNovel.description,
)


async def search_vns(db: AsyncSession, query: str, *, limit: int = 25) -> list[dict]:
    """Title search over the local dump. Matches romaji and Japanese as well as
    the main title, since members search in both."""
    pattern = f"%{query}%"
    res = await db.execute(
        select(*_VN_COLUMNS)
        .where(
            or_(
                VisualNovel.title.ilike(pattern),
                VisualNovel.title_romaji.ilike(pattern),
                VisualNovel.title_jp.ilike(pattern),
            )
        )
        .order_by(VisualNovel.votecount.desc().nullslast())
        .limit(limit)
    )
    return [_vn_to_dict(r) for r in res.all()]


async def get_vn(db: AsyncSession, vndb_id: str) -> dict | None:
    res = await db.execute(select(*_VN_COLUMNS).where(VisualNovel.id == vndb_id))
    row = res.first()
    return _vn_to_dict(row) if row else None


def _field(vn: dict | RoudokuNomination, name: str) -> str | None:
    """Read a title field off either a search dict or a nomination row, treating
    an empty string as absent (the dump stores '' as often as NULL)."""
    value = vn.get(name) if isinstance(vn, dict) else getattr(vn, name, None)
    return value or None


def display_title(vn: dict | RoudokuNomination) -> str:
    """The original Japanese title, which is what the bot shows everywhere.

    title_jp is often empty for short VNs, so `title` (VNDB's main title, which is
    already in the original language) is the fallback rather than the
    romanization, so a JP-original VN stays in Japanese instead of dropping to
    romaji just because the separate JP field is blank.
    """
    return (
        _field(vn, "title_jp")
        or _field(vn, "title")
        or _field(vn, "title_romaji")
        or _field(vn, "vndb_id")
        or "Unknown"
    )


def romaji_title(vn: dict | RoudokuNomination) -> str:
    """The romanized title, for the site's romaji preference and as the banner's
    secondary line so a title nobody can read yet is still identifiable."""
    return (
        _field(vn, "title_romaji")
        or _field(vn, "title")
        or _field(vn, "vndb_id")
        or "Unknown"
    )


def nomination_length_minutes(nom: RoudokuNomination) -> float | None:
    return length_utils.effective_length_minutes(nom.length, nom.length_minutes)


# ── Calendar publishing ────────────────────────────────────

def _event_key(cycle: RoudokuCycle) -> str:
    # Keyed by session date so each week is its own /events row (history). The
    # cycle id is reused across rounds, so it can't be the key. Callers must have
    # a session set; set_schedule re-keys the row when the date moves.
    if not cycle.scheduled_for:
        raise ValueError("cannot key a Weekly Roudoku event without a session date")
    return f"roudoku:{cycle.scheduled_for:%Y-%m-%d}"


async def _resolve_cover(
    db: AsyncSession, nom: RoudokuNomination
) -> tuple[str | None, bool, bool]:
    """The cover to display for a nomination, re-reading the VN's current NSFW
    score. A dump import can reclassify a cover between nomination and pick, and
    the snapshot would happily push a now-adult cover into an embed."""
    score = nom.image_sexual
    image_url = nom.image_url
    row = (
        await db.execute(
            select(VisualNovel.image_url, VisualNovel.image_sexual).where(
                VisualNovel.id == nom.vndb_id
            )
        )
    ).first()
    if row:
        image_url = row.image_url or image_url
        # Only let a live rating replace the snapshot when there actually is one:
        # an unrated re-read must not downgrade a known-adult cover to "safe".
        if row.image_sexual is not None:
            score = row.image_sexual
    return await jiten_covers.resolve_display_cover(
        nom.vndb_id, image_url, score, mode=nom.cover_mode or "auto"
    )


async def resolve_nomination_cover(
    db: AsyncSession, nomination_id: int
) -> tuple[str | None, bool, bool]:
    """Public wrapper over the cover resolution, for renderers that can blur.

    The stored events row nulls its image whenever a blur was needed (JSON-LD and
    Discord embeds can't blur), so anything drawing its own banner has to
    re-resolve instead of reading that row, or "blurred" silently renders as
    "hidden". Returns (url, blur, show); all-safe defaults if the row is gone.
    """
    nom = await db.get(RoudokuNomination, nomination_id)
    if nom is None:
        return None, False, False
    return await _resolve_cover(db, nom)


async def _publish_pick(
    db: AsyncSession, cycle: RoudokuCycle, nom: RoudokuNomination, votes: int
) -> None:
    """Upsert the /events calendar row for the picked VN, keyed by the session
    date. Needs cycle.scheduled_for to be set.

    Note this commits (upsert_by_external_key does), so callers flush their own
    cycle mutations first and treat this as the transaction boundary.

    `url` stays None on purpose. events_service.event_to_dict falls back to
    _vn_url_from_extra, which composes /vn/<n>/ from extra_data.vndb_id. Setting
    a vndb.org link here would silently break three things at once: the calendar
    would link off-site, enrich_with_covers would stop matching (so the site
    would lose cover_url/image_sexual and the NSFW blur with it), and the
    frontend's per-VN reveal persistence would stop resolving.
    """
    # The site has its own romaji/Japanese toggle, so the row carries both and
    # lets the visitor's preference decide; only the bot's own output is
    # unconditionally Japanese. Keep the base title romaji so a roudoku row
    # reads the same way as a vn_of_month one for the default (romaji) visitor.
    romaji = romaji_title(nom)
    jp = display_title(nom)
    title = f"{EVENT_TITLE_PREFIX}: {romaji}"
    cover_url, blur, show = await _resolve_cover(db, nom)
    # A blur is something only the rendered banner can apply. If the cover needed
    # one (adult art with no jiten SFW alternative), the events row gets no image
    # at all rather than the raw URL, since image_url is what JSON-LD and Discord
    # embeds read and neither of them can blur anything.
    safe_cover = cover_url if (show and not blur) else None
    extra = {
        "vndb_id": nom.vndb_id,
        "votes": votes,
        "title_romaji": title,
        "length_minutes": nomination_length_minutes(nom),
        "cover_mode": nom.cover_mode,
    }
    if jp and jp != romaji:
        extra["title_jp"] = f"{EVENT_TITLE_PREFIX}: {jp}"
    await events_service.upsert_by_external_key(
        db,
        external_key=_event_key(cycle),
        event_type=EVENT_TYPE,
        title=title,
        start_at=cycle.scheduled_for,
        description=nom.description,
        all_day=False,
        # Only ever a cover that passed the safety check; the website still shows
        # the real art (blurred) via cover_url, which enrich_with_covers attaches.
        image_url=safe_cover,
        url=None,
        location=None,
        created_by="ichijou",
        extra_data=extra,
    )
    await events_service.invalidate_events_cache()


# ── Cycle ──────────────────────────────────────────────────

async def get_active_cycle(db: AsyncSession) -> RoudokuCycle | None:
    """The current Weekly Roudoku = the latest cycle (voting or paused)."""
    result = await db.execute(select(RoudokuCycle).order_by(RoudokuCycle.id.desc()))
    return result.scalars().first()


async def get_cycle(db: AsyncSession, cycle_id: int) -> RoudokuCycle | None:
    return await db.get(RoudokuCycle, cycle_id)


async def ensure_active_cycle(db: AsyncSession, *, channel_id: int | None = None) -> RoudokuCycle:
    """Return the current cycle, creating one (voting = open) if none exists."""
    cycle = await get_active_cycle(db)
    if cycle:
        return cycle
    cycle = RoudokuCycle(phase="voting", channel_id=channel_id)
    db.add(cycle)
    await db.commit()
    await db.refresh(cycle)
    return cycle


async def set_paused(db: AsyncSession, cycle_id: int, paused: bool) -> RoudokuCycle | None:
    """Pause (stop voting) or resume (reopen voting) the cycle."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not cycle:
        return None
    cycle.phase = "paused" if paused else "voting"
    await db.commit()
    await db.refresh(cycle)
    return cycle


# ── Pool / nominations ─────────────────────────────────────

async def count_nominations(db: AsyncSession, cycle_id: int) -> int:
    res = await db.execute(
        select(func.count(RoudokuNomination.id)).where(RoudokuNomination.cycle_id == cycle_id)
    )
    return res.scalar_one()


async def list_nominations(db: AsyncSession, cycle_id: int) -> list[RoudokuNomination]:
    res = await db.execute(
        select(RoudokuNomination)
        .where(RoudokuNomination.cycle_id == cycle_id)
        .order_by(RoudokuNomination.created_at, RoudokuNomination.id)
    )
    return list(res.scalars().all())


async def get_nomination(db: AsyncSession, nomination_id: int) -> RoudokuNomination | None:
    return await db.get(RoudokuNomination, nomination_id)


def _build_nomination(cycle_id: int, vn: dict, user_id: int) -> RoudokuNomination:
    return RoudokuNomination(
        cycle_id=cycle_id,
        vndb_id=vn["vndb_id"],
        title=vn["title"],
        title_jp=vn.get("title_jp"),
        title_romaji=vn.get("title_romaji"),
        released=vn.get("released"),
        image_url=vn.get("image_url"),
        image_sexual=vn.get("image_sexual"),
        length=vn.get("length"),
        length_minutes=vn.get("length_minutes"),
        description=vn.get("description"),
        nominated_by=user_id,
    )


async def add_nomination(
    db: AsyncSession, cycle_id: int, vn: dict, user_id: int, *, enforce_length: bool = True
) -> tuple[RoudokuNomination | None, str]:
    """Add a VN to the pool, one nomination per user (mirrors hikaru). Returns
    (nomination, status):
      'ok'        - added a new nomination
      'swapped'   - replaced the user's previous nomination (no others had voted for it)
      'locked'    - the user's nomination already has votes from others; left unchanged
      'same'      - the user already holds exactly this VN; nothing changed
      'duplicate' - another member already nominated this VN
      'cap'       - the pool is full (only reachable when the user holds none yet)
      'too_long'  - over the length cap
      'no_length' - VNDB has no length data, so the cap can't be checked

    The length gate runs first and is the single enforcement point; an admin
    hand-adding a VN passes enforce_length=False rather than taking a separate
    path that could drift from this one. Gating before the duplicate/cap checks
    means an over-long VN gets the length message, which is the useful one.
    """
    if enforce_length:
        max_minutes = await get_max_length_minutes(db)
        ok, reason = length_utils.passes_length_gate(
            vn.get("length"), vn.get("length_minutes"), max_minutes
        )
        if not ok:
            return None, reason

    # A VN lives in the pool once (unique (cycle_id, vndb_id)); if another member
    # already nominated it, this user can't take it.
    other = (
        await db.execute(
            select(RoudokuNomination).where(
                RoudokuNomination.cycle_id == cycle_id,
                RoudokuNomination.vndb_id == vn["vndb_id"],
                RoudokuNomination.nominated_by != user_id,
            )
        )
    ).scalar_one_or_none()
    if other is not None:
        return None, "duplicate"

    mine = list(
        (
            await db.execute(
                select(RoudokuNomination).where(
                    RoudokuNomination.cycle_id == cycle_id,
                    RoudokuNomination.nominated_by == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if len(mine) == 1 and mine[0].vndb_id == vn["vndb_id"]:
        return mine[0], "same"

    if mine:
        # Don't let a member swap away a nomination once OTHER people have voted
        # for it: that would silently wipe their votes and invites abuse (gather
        # votes, then swap the VN out). Their own vote doesn't count. Admins can
        # still change it via Manage pool.
        others = (
            await db.execute(
                select(func.count(RoudokuVote.user_id)).where(
                    RoudokuVote.nomination_id.in_([n.id for n in mine]),
                    RoudokuVote.user_id != user_id,
                )
            )
        ).scalar_one()
        if others:
            return mine[0], "locked"
        cycle = await db.get(RoudokuCycle, cycle_id)
        was_pick = cycle is not None and cycle.winner_nomination_id in {n.id for n in mine}
        await db.execute(
            delete(RoudokuVote).where(RoudokuVote.nomination_id.in_([n.id for n in mine]))
        )
        for n in mine:
            await db.delete(n)
        if was_pick:
            cycle.winner_nomination_id = None
            cycle.closes_at = None  # disarm the deadline, like remove_nomination
            if cycle.scheduled_for:
                await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
        # Flush the deletes before inserting so re-picking a VN the user already
        # held doesn't collide on unique (cycle_id, vndb_id).
        await db.flush()
        nom = _build_nomination(cycle_id, vn, user_id)
        db.add(nom)
        await db.commit()
        await db.refresh(nom)
        if was_pick:
            await events_service.invalidate_events_cache()
        return nom, "swapped"

    if await count_nominations(db, cycle_id) >= MAX_POOL:
        return None, "cap"
    nom = _build_nomination(cycle_id, vn, user_id)
    db.add(nom)
    try:
        await db.commit()
    except IntegrityError:
        # Race: another member nominated this VN between the check and the insert.
        await db.rollback()
        return None, "duplicate"
    await db.refresh(nom)
    return nom, "ok"


async def set_cover_mode(db: AsyncSession, cycle_id: int, nomination_id: int, mode: str) -> bool:
    """Override how a nomination's cover is rendered. Re-publishes when the VN is
    the live pick, so the calendar can't keep serving the old image."""
    if mode not in COVER_MODES:
        return False
    nom = await db.get(RoudokuNomination, nomination_id)
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not nom or not cycle or nom.cycle_id != cycle_id:
        return False
    nom.cover_mode = mode
    is_pick = cycle.winner_nomination_id == nomination_id and cycle.scheduled_for is not None
    if is_pick:
        votes = (
            await db.execute(
                select(func.count(RoudokuVote.user_id)).where(
                    RoudokuVote.cycle_id == cycle_id, RoudokuVote.nomination_id == nomination_id
                )
            )
        ).scalar() or 0
        await db.flush()
        await _publish_pick(db, cycle, nom, votes)  # commits + invalidates
    else:
        await db.commit()
    return True


async def remove_nomination(db: AsyncSession, cycle_id: int, nomination_id: int) -> str | None:
    """Admin curation: drop a VN (and any votes for it) from the pool. Returns the
    removed VN's title, or None if it wasn't in this cycle's pool. If the removed
    VN was this week's pick, the pick (and its /events row) is cleared too."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    nom = await db.get(RoudokuNomination, nomination_id)
    if not cycle or not nom or nom.cycle_id != cycle_id:
        return None
    title = display_title(nom)
    was_pick = cycle.winner_nomination_id == nomination_id
    await db.execute(delete(RoudokuVote).where(RoudokuVote.nomination_id == nomination_id))
    await db.delete(nom)
    if was_pick:
        cycle.winner_nomination_id = None
        cycle.closes_at = None  # disarm the deadline (like reopen) so removing the pick
        # doesn't make the next scheduler tick auto-pick a replacement unprompted
        if cycle.scheduled_for:
            await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
    await db.commit()
    if was_pick:
        await events_service.invalidate_events_cache()
    return title


# ── Round lifecycle ────────────────────────────────────────

async def set_schedule(
    db: AsyncSession, cycle_id: int, *, scheduled_for: datetime, closes_at: datetime
) -> RoudokuCycle | None:
    """Set the next session + close time on the always-open cycle. Voting is
    already open; this just dates the next round (and resumes if it was paused).
    If a pick is set and the session DATE moves, the pick's /events row is
    re-keyed to the new date so the old row doesn't orphan."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not cycle:
        return None
    old_key = _event_key(cycle) if cycle.scheduled_for else None
    cycle.phase = "voting"
    cycle.scheduled_for = scheduled_for
    cycle.closes_at = closes_at
    new_key = _event_key(cycle)
    republished = False
    dropped = False
    if cycle.winner_nomination_id and old_key and old_key != new_key:
        await db.execute(delete(Event).where(Event.external_key == old_key))
        dropped = True
        nom = await db.get(RoudokuNomination, cycle.winner_nomination_id)
        if nom:
            votes = (
                await db.execute(
                    select(func.count(RoudokuVote.user_id)).where(
                        RoudokuVote.cycle_id == cycle_id, RoudokuVote.nomination_id == nom.id
                    )
                )
            ).scalar() or 0
            await db.flush()
            await _publish_pick(db, cycle, nom, votes)  # commits + invalidates
            republished = True
    await db.commit()
    # The delete has to invalidate even when nothing was re-published (a pick
    # whose nomination has since gone), or the calendar serves a deleted row
    # until the 5-minute cache expires.
    if dropped and not republished:
        await events_service.invalidate_events_cache()
    await db.refresh(cycle)
    return cycle


async def set_vote_message(db: AsyncSession, cycle_id: int, message_id: int) -> None:
    cycle = await db.get(RoudokuCycle, cycle_id)
    if cycle:
        cycle.message_id = message_id
        await db.commit()


async def cast_vote(db: AsyncSession, cycle_id: int, user_id: int, nomination_id: int) -> None:
    existing = await db.get(RoudokuVote, {"cycle_id": cycle_id, "user_id": user_id})
    if existing:
        existing.nomination_id = nomination_id
    else:
        db.add(RoudokuVote(cycle_id=cycle_id, user_id=user_id, nomination_id=nomination_id))
    try:
        await db.commit()
    except IntegrityError:
        # Same user voting twice at once: the row now exists, so switch to updating it.
        await db.rollback()
        existing = await db.get(RoudokuVote, {"cycle_id": cycle_id, "user_id": user_id})
        if existing:
            existing.nomination_id = nomination_id
            await db.commit()


async def get_user_vote(db: AsyncSession, cycle_id: int, user_id: int) -> RoudokuVote | None:
    return await db.get(RoudokuVote, {"cycle_id": cycle_id, "user_id": user_id})


async def remove_user_vote(db: AsyncSession, cycle_id: int, user_id: int) -> bool:
    vote = await db.get(RoudokuVote, {"cycle_id": cycle_id, "user_id": user_id})
    if not vote:
        return False
    await db.delete(vote)
    await db.commit()
    return True


async def voters_for_nomination(
    db: AsyncSession, cycle_id: int, nomination_id: int
) -> list[tuple[int, datetime]]:
    res = await db.execute(
        select(RoudokuVote.user_id, RoudokuVote.created_at)
        .where(RoudokuVote.cycle_id == cycle_id, RoudokuVote.nomination_id == nomination_id)
        .order_by(RoudokuVote.created_at.desc())
    )
    return [(uid, ts) for uid, ts in res.all()]


async def list_votes(db: AsyncSession, cycle_id: int) -> list[tuple[int, int, str, datetime]]:
    """Every cast vote as (user_id, nomination_id, vn_title, cast_at), newest first.
    Backs the admin vote-moderation panel."""
    res = await db.execute(
        select(
            RoudokuVote.user_id,
            RoudokuVote.nomination_id,
            # Japanese first, matching display_title. NULLIF because the dump
            # stores blank titles as '' as well as NULL, and coalesce alone
            # would happily return the empty string.
            func.coalesce(
                func.nullif(RoudokuNomination.title_jp, ""),
                func.nullif(RoudokuNomination.title, ""),
                RoudokuNomination.title_romaji,
            ),
            RoudokuVote.created_at,
        )
        .join(RoudokuNomination, RoudokuNomination.id == RoudokuVote.nomination_id)
        .where(RoudokuVote.cycle_id == cycle_id)
        .order_by(RoudokuVote.created_at.desc())
    )
    return [(uid, nid, title, ts) for uid, nid, title, ts in res.all()]


async def tally(db: AsyncSession, cycle_id: int) -> list[tuple[RoudokuNomination, int]]:
    """Nominations with vote counts, ranked by votes desc then earliest nomination."""
    res = await db.execute(
        select(RoudokuNomination, func.count(RoudokuVote.user_id))
        .outerjoin(RoudokuVote, RoudokuVote.nomination_id == RoudokuNomination.id)
        .where(RoudokuNomination.cycle_id == cycle_id)
        .group_by(RoudokuNomination.id)
        .order_by(
            func.count(RoudokuVote.user_id).desc(),
            RoudokuNomination.created_at,
            RoudokuNomination.id,
        )
    )
    return [(nom, count) for nom, count in res.all()]


async def get_pick_event(db: AsyncSession, now: datetime) -> Event | None:
    """The selected VN for the next session: the soonest upcoming stored winner
    event, else the most recent one. Reads the persisted /events row (created on
    pick), not the live cycle, so it stays valid across restarts."""
    base = select(Event).where(Event.event_type == EVENT_TYPE, Event.created_by == "ichijou")
    upcoming = (
        await db.execute(base.where(Event.start_at >= now).order_by(Event.start_at.asc()).limit(1))
    ).scalar_one_or_none()
    if upcoming:
        return upcoming
    return (await db.execute(base.order_by(Event.start_at.desc()).limit(1))).scalar_one_or_none()


async def pick_winner(
    db: AsyncSession, cycle_id: int, *, winner_nomination_id: int | None = None
) -> tuple[RoudokuPick | None, RoudokuCycle | None]:
    """Flag a VN as this week's pick (the current vote leader, or a hand-picked
    nomination) and publish it to /events. The VN STAYS in the pool, votes are
    untouched, and voting stays open. Returns a RoudokuPick snapshot, or None if
    there was nothing to pick (empty pool, or a hand-pick that has left it)."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not cycle:
        return None, None
    standings = await tally(db, cycle_id)
    winner = None
    winner_votes = 0
    if winner_nomination_id is not None:
        for nom, count in standings:
            if nom.id == winner_nomination_id:
                winner, winner_votes = nom, count
                break
        if winner is None:
            return None, cycle  # hand-picked VN is no longer in the pool
    elif standings:
        winner, winner_votes = standings[0]
    if winner is None:
        return None, cycle  # empty pool

    cycle.winner_nomination_id = winner.id
    cover_url, cover_blur, cover_show = await _resolve_cover(db, winner)
    info = RoudokuPick(
        vndb_id=winner.vndb_id,
        title=display_title(winner),  # Japanese
        title_jp=winner.title_jp,
        title_romaji=romaji_title(winner),
        released=winner.released,
        cover_url=cover_url,
        cover_blur=cover_blur,
        cover_show=cover_show,
        length_minutes=nomination_length_minutes(winner),
        description=winner.description,
        votes=winner_votes,
        session_at=cycle.scheduled_for,
    )

    # Publish the pick to /events (needs a session date), keyed by that date.
    if cycle.scheduled_for:
        await db.flush()
        await _publish_pick(db, cycle, winner, winner_votes)  # commits + invalidates
    else:
        await db.commit()
    await db.refresh(cycle)
    return info, cycle


async def clear_pick(
    db: AsyncSession, cycle_id: int, *, remove_event: bool = True
) -> RoudokuCycle | None:
    """Clear this week's pick (reopen). Voting stays open and the pool + votes are
    kept; by default the published /events row for the session is removed too. The
    close deadline is cleared so the scheduler won't immediately re-auto-pick after
    a deliberate reopen (Set session or Start new round re-arms it)."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not cycle:
        return None
    cycle.winner_nomination_id = None
    cycle.closes_at = None
    dropped = False
    if remove_event and cycle.scheduled_for:
        await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
        dropped = True
    await db.commit()
    if dropped:
        await events_service.invalidate_events_cache()
    await db.refresh(cycle)
    return cycle


async def start_new_vote(
    db: AsyncSession,
    cycle_id: int,
    *,
    next_scheduled: datetime | None = None,
    next_closes: datetime | None = None,
) -> RoudokuCycle | None:
    """Hard reset for a fresh week: clear every VN, vote, and the pick, then set
    the next session (or clear it). If the cleared pick's session hasn't happened
    yet, its /events row is removed too (you're cancelling an upcoming session); a
    pick whose session already passed stays on the calendar as history, which is
    what the weekly auto-rollover relies on."""
    cycle = await db.get(RoudokuCycle, cycle_id)
    if not cycle:
        return None
    # Key off the OLD session date before we overwrite it below.
    drop_event = bool(
        cycle.winner_nomination_id
        and cycle.scheduled_for
        and cycle.scheduled_for > datetime.now(timezone.utc)
    )
    if drop_event:
        await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
    cycle.winner_nomination_id = None  # no FK on this column, safe to clear first
    await db.execute(delete(RoudokuVote).where(RoudokuVote.cycle_id == cycle_id))
    await db.execute(delete(RoudokuNomination).where(RoudokuNomination.cycle_id == cycle_id))
    cycle.scheduled_for = next_scheduled
    cycle.closes_at = next_closes
    cycle.phase = "voting"
    await db.commit()
    if drop_event:
        await events_service.invalidate_events_cache()
    await db.refresh(cycle)
    return cycle


# ── Manual roudoku events (calendar rows, independent of the live vote) ────
#
# A session on the calendar is just an events row keyed roudoku:<date>. Picks
# publish one (see _publish_pick); these let an admin add/move/delete one on any
# date directly, e.g. a one-off session or fixing a past entry. Same key + the
# "ichijou" creator, so they dedupe the weekly placeholder and read as real
# sessions (get_pick_event). The date and the key move together so neither orphans.

async def list_roudoku_events(db: AsyncSession, *, limit: int = 25) -> list[Event]:
    """Stored roudoku calendar rows (picked + manually added), latest date first."""
    res = await db.execute(
        select(Event)
        .where(Event.event_type == EVENT_TYPE)
        .order_by(Event.start_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


async def create_roudoku_event(
    db: AsyncSession,
    *,
    title: str,
    start_at: datetime,
    all_day: bool = False,
    image_url: str | None = None,
    description: str | None = None,
) -> tuple[Event | None, str]:
    """Add a session to the calendar on any date. Returns (event, 'ok'|'conflict');
    conflict means a roudoku event already exists on that date (one per date)."""
    key = f"roudoku:{start_at:%Y-%m-%d}"
    if (await db.execute(select(Event).where(Event.external_key == key))).scalar_one_or_none():
        return None, "conflict"
    try:
        ev = await events_service.create_event(
            db,
            event_type=EVENT_TYPE,
            title=title,
            start_at=start_at,
            description=description,
            all_day=all_day,
            image_url=image_url,
            external_key=key,
            created_by="ichijou",
        )
    except IntegrityError:
        await db.rollback()
        return None, "conflict"
    await events_service.invalidate_events_cache()
    return ev, "ok"


async def update_roudoku_event(
    db: AsyncSession,
    event_id: int,
    *,
    title: str,
    start_at: datetime,
    all_day: bool = False,
    image_url: str | None = None,
    description: str | None = None,
) -> tuple[Event | None, str]:
    """Edit a session row, including moving its date (the key moves with it so it
    keeps deduping the placeholder). Returns
    (event, 'ok'|'conflict'|'not_found'|'is_live_pick')."""
    ev = await db.get(Event, event_id)
    if not ev or ev.event_type != EVENT_TYPE:
        return None, "not_found"
    new_key = f"roudoku:{start_at:%Y-%m-%d}"
    if new_key != ev.external_key:
        # Moving the live pick's row would leave the cycle pointing at the OLD
        # key, so Reopen/Start new round would delete nothing and this row would
        # linger on the calendar with no way to remove it from the dashboard.
        cycle = await get_active_cycle(db)
        if (
            cycle
            and cycle.winner_nomination_id
            and cycle.scheduled_for
            and _event_key(cycle) == ev.external_key
        ):
            return None, "is_live_pick"
        clash = (
            await db.execute(
                select(Event).where(Event.external_key == new_key, Event.id != event_id)
            )
        ).scalar_one_or_none()
        if clash:
            return None, "conflict"
        ev.external_key = new_key
    ev.title = title
    ev.start_at = start_at
    ev.all_day = all_day
    ev.image_url = image_url
    ev.description = description
    # A manual edit carries one title; drop a prior pick's stored romaji/JP
    # variants so the edited title is what the site shows (it renders those by
    # title preference, which would otherwise override the edit). Reassign, don't
    # mutate, so SQLAlchemy flags the JSON column dirty.
    if ev.extra_data and ("title_jp" in ev.extra_data or "title_romaji" in ev.extra_data):
        extra = {k: v for k, v in ev.extra_data.items() if k not in ("title_jp", "title_romaji")}
        ev.extra_data = extra or None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None, "conflict"
    await db.refresh(ev)
    await events_service.invalidate_events_cache()
    return ev, "ok"


async def delete_roudoku_event(db: AsyncSession, event_id: int) -> bool:
    """Delete a session calendar row. If it's the live cycle's published pick, the
    pick marker is cleared too so the dashboard and calendar don't disagree."""
    ev = await db.get(Event, event_id)
    if not ev or ev.event_type != EVENT_TYPE:
        return False
    cycle = await get_active_cycle(db)
    if (
        cycle
        and cycle.winner_nomination_id
        and cycle.scheduled_for
        and _event_key(cycle) == ev.external_key
    ):
        cycle.winner_nomination_id = None
        # Disarm the deadline too, as clear_pick and remove_nomination do. By the
        # time a pick exists closes_at is already past, so leaving it set makes
        # the next scheduler tick re-pick and re-announce, undoing this delete.
        cycle.closes_at = None
    await db.delete(ev)
    await db.commit()
    await events_service.invalidate_events_cache()
    return True
