"""Movie Night business logic (one long-lived cycle, single channel).

Voting is ALWAYS open (members nominate into the pool and vote any time) unless an
admin PAUSES it. The pool and votes PERSIST - they are never wiped on a pick.

At most one film is flagged as this week's pick via cycle.winner_nomination_id and
published to /events; the film stays in the pool, marked 👑. pick_winner, the
Manage-pool hand-pick, and the deadline auto-pick all just set that marker; clear_pick
(reopen) clears it; only start_new_vote wipes the pool + votes for a fresh round. An
admin sets a showtime (or a weekly default does); at the deadline the leader is
auto-picked only if nothing is picked yet.

phases: voting (open, the default) | paused
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BotConfig, Event, MovieNightCycle, MovieNomination, MovieVote
from app.services import events_service
from app.services import tmdb_client

logger = logging.getLogger(__name__)

MAX_POOL = 25  # Discord select hard cap
TMDB_MOVIE_URL = "https://www.themoviedb.org/movie/{tmdb_id}?language=ja-JP"
CONFIG_VOTE_ROLE = "movie_night_vote_role_id"  # optional role gate on voting


async def get_vote_role_id(db: AsyncSession) -> int | None:
    """The role required to vote, or None if voting is open to everyone."""
    row = (
        await db.execute(select(BotConfig).where(BotConfig.key == CONFIG_VOTE_ROLE))
    ).scalar_one_or_none()
    return int(row.value) if row and row.value else None


@dataclass
class WinnerInfo:
    """Snapshot of the picked film, so the caller can render the announcement
    banner + embed without re-fetching the nomination."""

    title: str
    release_year: int | None
    tmdb_id: int
    poster_url: str | None
    overview: str | None
    votes: int
    showtime: datetime | None


def _event_key(cycle: MovieNightCycle) -> str:
    # Keyed by showtime date so each week is its own /events row (history). The cycle
    # id is reused across rounds, so it can't be the key. set_schedule re-keys the row
    # when the showtime date moves while a pick is set (else the old row would orphan).
    return f"movie_night:{cycle.scheduled_for:%Y-%m-%d}" if cycle.scheduled_for else f"movie_night:{cycle.id}"


async def _publish_pick(db: AsyncSession, cycle: MovieNightCycle, nom: MovieNomination, votes: int) -> None:
    """Upsert the /events calendar row for the picked film, keyed by the showtime date.
    Caller commits. Needs cycle.scheduled_for to be set."""
    suffix = f" ({nom.release_year})" if nom.release_year else ""
    jp_name = nom.title  # nominations store the JP-preferred title
    en_name = jp_name
    try:
        en = await tmdb_client.get_movie(nom.tmdb_id, language="en-US")
        if en and en.get("title"):
            en_name = en["title"]
    except Exception:
        pass
    title = f"Movie Night: {en_name}{suffix}"
    extra = {"tmdb_id": nom.tmdb_id, "votes": votes, "title_romaji": title}
    if jp_name and jp_name != en_name:
        extra["title_jp"] = f"Movie Night: {jp_name}{suffix}"
    await events_service.upsert_by_external_key(
        db,
        external_key=_event_key(cycle),
        event_type="movie_night",
        title=title,
        start_at=cycle.scheduled_for,
        description=nom.overview,
        all_day=False,
        image_url=nom.poster_url,
        url=TMDB_MOVIE_URL.format(tmdb_id=nom.tmdb_id),
        location=None,
        created_by="ichijou",
        extra_data=extra,
    )
    await events_service.invalidate_events_cache()


async def get_active_cycle(db: AsyncSession) -> MovieNightCycle | None:
    """The current movie night = the latest cycle (voting or paused)."""
    result = await db.execute(select(MovieNightCycle).order_by(MovieNightCycle.id.desc()))
    return result.scalars().first()


async def get_cycle(db: AsyncSession, cycle_id: int) -> MovieNightCycle | None:
    return await db.get(MovieNightCycle, cycle_id)


async def ensure_active_cycle(db: AsyncSession, *, channel_id: int | None = None) -> MovieNightCycle:
    """Return the current cycle, creating one (voting = open) if none exists.

    Voting is open by default, so a fresh cycle starts in 'voting' - members can
    vote the moment a film is in the pool, with no admin step.
    """
    cycle = await get_active_cycle(db)
    if cycle:
        return cycle
    cycle = MovieNightCycle(phase="voting", channel_id=channel_id)
    db.add(cycle)
    await db.commit()
    await db.refresh(cycle)
    return cycle


async def set_paused(db: AsyncSession, cycle_id: int, paused: bool) -> MovieNightCycle | None:
    """Pause (stop voting) or resume (reopen voting) the cycle."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    if not cycle:
        return None
    cycle.phase = "paused" if paused else "voting"
    await db.commit()
    await db.refresh(cycle)
    return cycle


# ── Pool / nominations ─────────────────────────────────────

async def count_nominations(db: AsyncSession, cycle_id: int) -> int:
    res = await db.execute(
        select(func.count(MovieNomination.id)).where(MovieNomination.cycle_id == cycle_id)
    )
    return res.scalar_one()


async def list_nominations(db: AsyncSession, cycle_id: int) -> list[MovieNomination]:
    res = await db.execute(
        select(MovieNomination)
        .where(MovieNomination.cycle_id == cycle_id)
        .order_by(MovieNomination.created_at, MovieNomination.id)
    )
    return list(res.scalars().all())


async def get_nomination(db: AsyncSession, nomination_id: int) -> MovieNomination | None:
    return await db.get(MovieNomination, nomination_id)


def _build_nomination(cycle_id: int, film: dict, user_id: int) -> MovieNomination:
    return MovieNomination(
        cycle_id=cycle_id,
        tmdb_id=film["tmdb_id"],
        title=film["title"],
        release_year=film.get("release_year"),
        poster_url=film.get("poster_url"),
        overview=film.get("overview"),
        nominated_by=user_id,
    )


async def add_nomination(
    db: AsyncSession, cycle_id: int, film: dict, user_id: int
) -> tuple[MovieNomination | None, str]:
    """Add a film to the pool, one nomination per user (mirrors hikaru). Returns
    (nomination, status):
      'ok'        - added a new nomination
      'swapped'   - replaced the user's previous nomination (no others had voted for it)
      'locked'    - the user's nomination already has votes from others; left unchanged
      'same'      - the user already holds exactly this film; nothing changed
      'duplicate' - another member already nominated this film
      'cap'       - the pool is full (only reachable when the user holds none yet)
    """
    # A film lives in the pool once (unique (cycle_id, tmdb_id)); if another member
    # already nominated it, this user can't take it.
    other = (
        await db.execute(
            select(MovieNomination).where(
                MovieNomination.cycle_id == cycle_id,
                MovieNomination.tmdb_id == film["tmdb_id"],
                MovieNomination.nominated_by != user_id,
            )
        )
    ).scalar_one_or_none()
    if other is not None:
        return None, "duplicate"

    # The user's current nomination(s): normally 0 or 1, but a legacy pool may hold
    # more, so collapse them all on the next nominate.
    mine = list(
        (
            await db.execute(
                select(MovieNomination).where(
                    MovieNomination.cycle_id == cycle_id,
                    MovieNomination.nominated_by == user_id,
                )
            )
        ).scalars().all()
    )
    if len(mine) == 1 and mine[0].tmdb_id == film["tmdb_id"]:
        return mine[0], "same"

    if mine:
        # Don't let a member swap away a nomination once OTHER people have voted for it:
        # that would silently wipe their votes and invites abuse (gather votes, then swap
        # the film out). Their own vote doesn't count. Admins can still change it via
        # Manage pool.
        others = (
            await db.execute(
                select(func.count(MovieVote.user_id)).where(
                    MovieVote.nomination_id.in_([n.id for n in mine]),
                    MovieVote.user_id != user_id,
                )
            )
        ).scalar_one()
        if others:
            return mine[0], "locked"
        # Swap: drop the user's old film(s) and any votes for them, then add the new
        # one. If an old film was this week's pick, clear the pick + its /events row,
        # same as an admin removal.
        cycle = await db.get(MovieNightCycle, cycle_id)
        was_pick = cycle is not None and cycle.winner_nomination_id in {n.id for n in mine}
        await db.execute(
            delete(MovieVote).where(MovieVote.nomination_id.in_([n.id for n in mine]))
        )
        for n in mine:
            await db.delete(n)
        if was_pick:
            cycle.winner_nomination_id = None
            cycle.closes_at = None  # disarm the deadline, like remove_nomination
            if cycle.scheduled_for:
                await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
        # Flush the deletes before inserting so re-picking a film the user already
        # held (legacy multi-nom) doesn't collide on unique (cycle_id, tmdb_id).
        await db.flush()
        nom = _build_nomination(cycle_id, film, user_id)
        db.add(nom)
        await db.commit()
        await db.refresh(nom)
        if was_pick:
            await events_service.invalidate_events_cache()
        return nom, "swapped"

    # User holds nothing yet: a genuine add, subject to the pool cap.
    if await count_nominations(db, cycle_id) >= MAX_POOL:
        return None, "cap"
    nom = _build_nomination(cycle_id, film, user_id)
    db.add(nom)
    try:
        await db.commit()
    except IntegrityError:
        # Race: another member nominated this film between the check and the insert.
        await db.rollback()
        return None, "duplicate"
    await db.refresh(nom)
    return nom, "ok"


async def remove_nomination(db: AsyncSession, cycle_id: int, nomination_id: int) -> str | None:
    """Admin curation: drop a film (and any votes for it) from the pool. Returns the
    removed film's title, or None if it wasn't in this cycle's pool. If the removed
    film was this week's pick, the pick (and its /events row) is cleared too."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    nom = await db.get(MovieNomination, nomination_id)
    if not cycle or not nom or nom.cycle_id != cycle_id:
        return None
    title = nom.title
    was_pick = cycle.winner_nomination_id == nomination_id
    await db.execute(delete(MovieVote).where(MovieVote.nomination_id == nomination_id))
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
) -> MovieNightCycle:
    """Set the next showtime + close time on the always-open cycle. Voting is
    already open; this just dates the next round (and resumes if it was paused). The
    vote board (and its channel) is set by Post vote board, not here. If a pick is set
    and the showtime DATE moves, the pick's /events row is re-keyed to the new date so
    the old row doesn't orphan."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    old_key = _event_key(cycle) if cycle.scheduled_for else None
    cycle.phase = "voting"
    cycle.scheduled_for = scheduled_for
    cycle.closes_at = closes_at
    new_key = _event_key(cycle) if cycle.scheduled_for else None
    if cycle.winner_nomination_id and old_key and old_key != new_key:
        await db.execute(delete(Event).where(Event.external_key == old_key))
        nom = await db.get(MovieNomination, cycle.winner_nomination_id)
        if nom and cycle.scheduled_for:
            votes_res = await db.execute(
                select(func.count(MovieVote.user_id)).where(
                    MovieVote.cycle_id == cycle_id, MovieVote.nomination_id == nom.id
                )
            )
            await _publish_pick(db, cycle, nom, votes_res.scalar() or 0)
    await db.commit()
    await db.refresh(cycle)
    return cycle


async def set_vote_message(db: AsyncSession, cycle_id: int, message_id: int) -> None:
    cycle = await db.get(MovieNightCycle, cycle_id)
    if cycle:
        cycle.message_id = message_id
        await db.commit()


async def cast_vote(db: AsyncSession, cycle_id: int, user_id: int, nomination_id: int) -> None:
    existing = await db.get(MovieVote, {"cycle_id": cycle_id, "user_id": user_id})
    if existing:
        existing.nomination_id = nomination_id
    else:
        db.add(MovieVote(cycle_id=cycle_id, user_id=user_id, nomination_id=nomination_id))
    try:
        await db.commit()
    except IntegrityError:
        # Same user voting twice at once: the row now exists, so switch to updating it.
        await db.rollback()
        existing = await db.get(MovieVote, {"cycle_id": cycle_id, "user_id": user_id})
        if existing:
            existing.nomination_id = nomination_id
            await db.commit()


async def get_user_vote(db: AsyncSession, cycle_id: int, user_id: int) -> MovieVote | None:
    return await db.get(MovieVote, {"cycle_id": cycle_id, "user_id": user_id})


async def remove_user_vote(db: AsyncSession, cycle_id: int, user_id: int) -> bool:
    vote = await db.get(MovieVote, {"cycle_id": cycle_id, "user_id": user_id})
    if not vote:
        return False
    await db.delete(vote)
    await db.commit()
    return True


async def voters_for_nomination(db: AsyncSession, cycle_id: int, nomination_id: int) -> list[tuple[int, datetime]]:
    res = await db.execute(
        select(MovieVote.user_id, MovieVote.created_at)
        .where(MovieVote.cycle_id == cycle_id, MovieVote.nomination_id == nomination_id)
        .order_by(MovieVote.created_at.desc())
    )
    return [(uid, ts) for uid, ts in res.all()]


async def list_votes(db: AsyncSession, cycle_id: int) -> list[tuple[int, int, str, datetime]]:
    """Every cast vote as (user_id, nomination_id, film_title, cast_at), newest first.
    Backs the admin vote-moderation panel."""
    res = await db.execute(
        select(MovieVote.user_id, MovieVote.nomination_id, MovieNomination.title, MovieVote.created_at)
        .join(MovieNomination, MovieNomination.id == MovieVote.nomination_id)
        .where(MovieVote.cycle_id == cycle_id)
        .order_by(MovieVote.created_at.desc())
    )
    return [(uid, nid, title, ts) for uid, nid, title, ts in res.all()]


async def tally(db: AsyncSession, cycle_id: int) -> list[tuple[MovieNomination, int]]:
    """Nominations with vote counts, ranked by votes desc then earliest nomination."""
    res = await db.execute(
        select(MovieNomination, func.count(MovieVote.user_id))
        .outerjoin(MovieVote, MovieVote.nomination_id == MovieNomination.id)
        .where(MovieNomination.cycle_id == cycle_id)
        .group_by(MovieNomination.id)
        .order_by(func.count(MovieVote.user_id).desc(), MovieNomination.created_at, MovieNomination.id)
    )
    return [(nom, count) for nom, count in res.all()]


async def get_pick_event(db: AsyncSession, now: datetime) -> Event | None:
    """The selected film for the next Movie Night: the soonest upcoming stored
    winner event, else the most recent one. Reads the persisted /events row (created
    on pick), not the live cycle, so it stays valid across restarts."""
    base = select(Event).where(Event.event_type == "movie_night", Event.created_by == "ichijou")
    upcoming = (
        await db.execute(base.where(Event.start_at >= now).order_by(Event.start_at.asc()).limit(1))
    ).scalar_one_or_none()
    if upcoming:
        return upcoming
    return (await db.execute(base.order_by(Event.start_at.desc()).limit(1))).scalar_one_or_none()


async def pick_winner(
    db: AsyncSession,
    cycle_id: int,
    *,
    winner_nomination_id: int | None = None,
) -> tuple[WinnerInfo | None, MovieNightCycle]:
    """Flag a film as this week's pick (the current vote leader, or a hand-picked
    nomination) and publish it to /events. The film STAYS in the pool, votes are
    untouched, and voting stays open - the pick is just a marker (winner_nomination_id)
    on the cycle. Returns a WinnerInfo snapshot, or None if there was nothing to pick
    (empty pool, or a hand-pick that has left the pool)."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    standings = await tally(db, cycle_id)
    winner = None
    winner_votes = 0
    if winner_nomination_id is not None:
        for nom, count in standings:
            if nom.id == winner_nomination_id:
                winner, winner_votes = nom, count
                break
        if winner is None:
            return None, cycle  # hand-picked film is no longer in the pool
    elif standings:
        winner, winner_votes = standings[0]
    if winner is None:
        return None, cycle  # empty pool

    cycle.winner_nomination_id = winner.id
    info = WinnerInfo(
        title=winner.title,
        release_year=winner.release_year,
        tmdb_id=winner.tmdb_id,
        poster_url=winner.poster_url,
        overview=winner.overview,
        votes=winner_votes,
        showtime=cycle.scheduled_for,
    )

    # Publish the pick to /events (needs a showtime to date it), keyed by showtime.
    if cycle.scheduled_for:
        await _publish_pick(db, cycle, winner, winner_votes)

    await db.commit()
    await db.refresh(cycle)
    return info, cycle


async def clear_pick(db: AsyncSession, cycle_id: int, *, remove_event: bool = True) -> MovieNightCycle | None:
    """Clear this week's pick (reopen). Voting stays open and the pool + votes are
    kept; by default the published /events row for the showtime is removed too. The
    close deadline is cleared so the scheduler won't immediately re-auto-pick after a
    deliberate reopen (Set showtime or Start new vote re-arms it)."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    if not cycle:
        return None
    cycle.winner_nomination_id = None
    cycle.closes_at = None
    if remove_event and cycle.scheduled_for:
        await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
    await db.commit()
    if remove_event:
        await events_service.invalidate_events_cache()
    await db.refresh(cycle)
    return cycle


async def start_new_vote(
    db: AsyncSession,
    cycle_id: int,
    *,
    next_scheduled: datetime | None = None,
    next_closes: datetime | None = None,
) -> MovieNightCycle | None:
    """Hard reset for a fresh round: clear every film, vote, and the pick, then set
    the next showtime (or clear it). If the cleared pick's showtime hasn't happened
    yet, its /events row is removed too (you're cancelling an upcoming movie night); a
    pick whose showtime already passed stays on the calendar as history (what the
    weekly auto-rollover relies on)."""
    cycle = await db.get(MovieNightCycle, cycle_id)
    if not cycle:
        return None
    # Key off the OLD showtime before we overwrite it below.
    drop_event = bool(
        cycle.winner_nomination_id
        and cycle.scheduled_for
        and cycle.scheduled_for > datetime.now(timezone.utc)
    )
    if drop_event:
        await db.execute(delete(Event).where(Event.external_key == _event_key(cycle)))
    cycle.winner_nomination_id = None  # no FK on this column, safe to clear first
    await db.execute(delete(MovieVote).where(MovieVote.cycle_id == cycle_id))
    await db.execute(delete(MovieNomination).where(MovieNomination.cycle_id == cycle_id))
    cycle.scheduled_for = next_scheduled
    cycle.closes_at = next_closes
    cycle.phase = "voting"
    await db.commit()
    if drop_event:
        await events_service.invalidate_events_cache()
    await db.refresh(cycle)
    return cycle


# ── Manual movie events (calendar rows, independent of the live vote) ──────
#
# A movie night on the calendar is just an events row keyed movie_night:<date>.
# Picks publish one (see _publish_pick); these let an admin add/move/delete one on
# any date directly, e.g. a one-off screening or fixing a past entry. Same key + the
# "ichijou" creator, so they dedupe the weekly placeholder and read as real movie
# nights (get_pick_event). The date and the key move together so neither orphans.

async def list_movie_events(db: AsyncSession, *, limit: int = 25) -> list[Event]:
    """Stored movie_night calendar rows (picked + manually added), latest date first."""
    res = await db.execute(
        select(Event)
        .where(Event.event_type == "movie_night")
        .order_by(Event.start_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


async def create_movie_event(
    db: AsyncSession,
    *,
    title: str,
    start_at: datetime,
    all_day: bool = False,
    image_url: str | None = None,
    description: str | None = None,
) -> tuple[Event | None, str]:
    """Add a movie night to the calendar on any date. Returns (event, 'ok'|'conflict');
    conflict means a movie event already exists on that date (one per date)."""
    key = f"movie_night:{start_at:%Y-%m-%d}"
    if (await db.execute(select(Event).where(Event.external_key == key))).scalar_one_or_none():
        return None, "conflict"
    try:
        ev = await events_service.create_event(
            db,
            event_type="movie_night",
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


async def update_movie_event(
    db: AsyncSession,
    event_id: int,
    *,
    title: str,
    start_at: datetime,
    all_day: bool = False,
    image_url: str | None = None,
    description: str | None = None,
) -> tuple[Event | None, str]:
    """Edit a movie night row, including moving its date (the key moves with it so it
    keeps deduping the placeholder). Returns (event, 'ok'|'conflict'|'not_found')."""
    ev = await db.get(Event, event_id)
    if not ev or ev.event_type != "movie_night":
        return None, "not_found"
    new_key = f"movie_night:{start_at:%Y-%m-%d}"
    if new_key != ev.external_key:
        clash = (
            await db.execute(select(Event).where(Event.external_key == new_key, Event.id != event_id))
        ).scalar_one_or_none()
        if clash:
            return None, "conflict"
        ev.external_key = new_key
    ev.title = title
    ev.start_at = start_at
    ev.all_day = all_day
    ev.image_url = image_url
    ev.description = description
    # A manual edit carries one title; drop a prior pick's stored romaji/JP variants
    # so the edited title is what the site shows (it renders those by title preference,
    # which would otherwise override the edit). Reassign, don't mutate, so SQLAlchemy
    # flags the JSON column dirty.
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


async def delete_movie_event(db: AsyncSession, event_id: int) -> bool:
    """Delete a movie night calendar row. If it's the live cycle's published pick, the
    pick marker is cleared too so the dashboard and calendar don't disagree."""
    ev = await db.get(Event, event_id)
    if not ev or ev.event_type != "movie_night":
        return False
    cycle = await get_active_cycle(db)
    if cycle and cycle.winner_nomination_id and cycle.scheduled_for and _event_key(cycle) == ev.external_key:
        cycle.winner_nomination_id = None
    await db.delete(ev)
    await db.commit()
    await events_service.invalidate_events_cache()
    return True
