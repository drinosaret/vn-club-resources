"""Build every catalogue board and write it to Redis.

Runs once a day, after the dump import. The shape of the work is: load the facts each board
needs, walk the two big tables once each, derive all thirty-odd boards from those walks, and
store fully-rendered rows so serving a board later is a cache read and nothing more.

Why nightly rather than on request: a board over ulist_labels is a full scan of 13M rows,
which cannot be done inside a request timeout, and the underlying data only changes once a
day anyway. Computing it hourly would cost the same and tell nobody anything new.

Nothing here creates a table. Results live in Redis, where the whole catalogue is a couple
of megabytes.
"""

from __future__ import annotations

import json
import logging
import time
from sys import intern
from dataclasses import fields as dataclass_fields
from datetime import date, datetime, timezone
from typing import NamedTuple

from sqlalchemy import func, select, text

from app.db.database import async_session
from app.db.models import (
    CharacterVN,
    GlobalVote,
    Producer,
    Release,
    ReleaseProducer,
    ReleaseVN,
    Staff,
    Tag,
    VisualNovel,
    VNDifficulty,
    VNRelation,
    VNSeiyuu,
    VNStaff,
    VNTag,
    VndbUser,
)

from .aggregate import (
    BacklogGap,
    Bucket,
    GlobalRates,
    RATE_PRIOR_KEY,
    global_rates,
    bayesian_average,
    _order,
    global_mean_vote,
    LabelCounts,
    ReaderScan,
    RankedEntry,
    VoteActivity,
    accumulate_chunk,
    build_buckets,
    percentile_sketch,
    prepare_plan,
    rank_catalogue_floor,
    rank_discovery_lag,
    rank_label_board,
    rank_reader_scan,
    rank_reader_share,
    rank_backlog_gap,
    rank_reader_value,
    rank_series_span,
    rank_terminal,
    rank_title_aggregate,
    rank_title_average,
    rank_rating_as_of,
    rank_reputation_board,
    rank_velocity_board,
    rank_vote_board,
    reading_trends,
    reputation_shift,
    roll_up_by_entity,
)
from .facets import VNFacts, describe, describe_kind, matches
from .thresholds import (
    MIN_LIST_ENTRIES_FOR_RATE,
    MIN_RATERS_FOR_TERMINAL,
    MIN_RESPONSE_FIT,
    MIN_SPAN_FOR_STEADINESS,
    MIN_TERMINAL_OBSERVED,
    MIN_PER_SIDE_FOR_BACKLOG,
    MIN_VOTES_FOR_COMPOSITION,
    MIN_VOTES_FOR_CONSENSUS,
    MIN_VOTES_FOR_RECENCY,
    MIN_VOTES_FOR_RESPONSE,
    MIN_VOTES_FOR_STEADINESS,
    MIN_VOTES_FOR_TERMINAL,
    MIN_VOTES_PER_SERIES_ENTRY,
    RESPONSE_PRIOR,
    TERMINAL_MATURITY_DAYS,
    TERMINAL_SILENCE_DAYS,
)
from .registry import BOARDS, COMMERCIAL_ONLY, MIN_VOTES_PER_CATALOGUE_TITLE
from .serialize import (
    CatalogueEntry,
    CatalogueResponse,
    LeaderboardResponse,
    LeaderboardRow,
    format_value,
)
from .spec import (
    CATALOGUE_CACHE_KEY,
    HISTORY_METRICS,
    READER_SCAN_METRICS,
    TITLE_AVERAGE_METRICS,
    LANGUAGE_ALL,
    LANGUAGE_JAPANESE,
    ROLLED_UP_SUBJECTS,
    VOTE_METRICS,
    BoardSpec,
    Facet,
    Metric,
    Subject,
    Window,
    board_cache_key,
    slug_cache_key,
)

#: Redis prefix for the population sketches the user stats page compares against.
PERCENTILE_KEY_PREFIX = "pct:v1:"

#: Votes a reader needs before their average rating is placed against the population. Below
#: this the mean swings by whole points on one more vote and says nothing about the reader.
MIN_VOTES_FOR_AVERAGE_PERCENTILE = 10

#: Where the global dashboard reads community voting activity from.
VOTE_ACTIVITY_CACHE_KEY = "global:vote-activity:v1"

#: Where the trends page reads how the community's reading has shifted.
READING_TRENDS_CACHE_KEY = "global:reading-trends:v1"

#: Votes before this are too few to make a stable yearly share.
TRENDS_FIRST_YEAR = 2012

#: Where the trends page reads its year-by-year explorer.
YEAR_EXPLORER_CACHE_KEY = "global:year-explorer:v1"

#: Earliest year the explorer covers. Before this the database holds too few titles per year
#: for a top ten to mean anything, and too few dated votes to say what was being read.
EXPLORER_FIRST_YEAR = 1990

#: Titles shown per year on each side of the explorer.
EXPLORER_DEPTH = 10

#: Votes a title needs before it can represent its release year. Lower than the boards use:
#: the early years hold few titles, and a floor tuned for 2015 empties 1992 entirely.
MIN_VOTES_FOR_EXPLORER = 20

#: Where the trends page reads the rest of its feed.
TREND_FEED_CACHE_KEY = "global:trend-feed:v1"

#: The windows reception movement is offered over, as (key, days, minimum recent votes). The
#: floor falls with the window because it is a floor on votes inside it: a week holds a
#: fraction of a month's votes, and the same floor would empty the shorter window.
SHIFT_WINDOWS = (("week", 7, 15), ("month", 30, 30), ("quarter", 90, 50))

#: A title needs a settled lifetime average to be shifting away from.
MIN_LIFETIME_VOTES_FOR_SHIFT = 200

#: Votes a title needs before its all-time reputation movement is ranked. Higher than the
#: windowed floors: that figure splits a title's whole history in half, so both halves need
#: to be worth comparing.
MIN_VOTES_FOR_ALL_TIME_SHIFT = 400

#: How long a title counts as new, and the window its early reception is measured over.
NEW_RELEASE_DAYS = 180
NEW_RELEASE_VOTE_DAYS = 30

#: The window for reading completions, which are dated on the list entry rather than the vote.
FINISHED_WINDOW_DAYS = 60

#: How far ahead the upcoming list looks. Beyond this, dates are placeholders more often than
#: plans.
UPCOMING_DAYS = 500

#: Weeks of community activity carried, which is a season and a half: long enough to see a
#: direction, short enough that it is about now rather than about history.
PULSE_WEEKS = 26

#: Rows per feed section.
FEED_DEPTH = 6

#: Restricts a vote-keyed query to titles originally written in Japanese. The site is about
#: reading Japanese, so this is the default view everywhere a list of titles is shown; the
#: unfiltered view stays available because the vote data itself is not language-specific.
def japanese_clause(japanese_only: bool, alias: str = "gv") -> tuple[str, str]:
    """The join and predicate that narrow a query to Japanese-original titles."""
    if not japanese_only:
        return "", ""
    return (
        f"JOIN visual_novels lang_vn ON lang_vn.id = {alias}.vn_id",
        "AND lang_vn.olang = 'ja'",
    )


def trends_key(base: str, language: str) -> str:
    """Cache key for one language view of a trends payload.

    The unfiltered view keeps the bare key so anything already reading it keeps working, and
    the Japanese view is suffixed, matching how the boards are keyed.
    """
    return base if language == LANGUAGE_ALL else f"{base}:{language}"


#: Where the trends page reads what is happening now.
HOT_NOW_CACHE_KEY = "global:hot-now:v1"

#: The periods the hot list covers, as (key, days, mover floor). Each is compared against the
#: period immediately before it, which is what turns a count into a direction.
#:
#: The mover floor rises with the period because it is a floor on the current count: a title
#: needs enough votes in the window for a jump against its own previous window to mean
#: something, and seven days of votes is a much smaller number than thirty.
HOT_PERIODS = (("week", 7, 10), ("month", 30, 30), ("year", 365, 150))

#: Titles listed per lens per period.
HOT_DEPTH = 8

#: Damping for the period-over-period ratio, in votes. Keeps a title going from one vote to
#: four out of the movers list.
HOT_PRIOR = 5.0

#: Where the trends page reads one month of history. Kept one key per month rather than one
#: payload for all of them: the page shows a single month at a time, and the whole history is
#: half a megabyte that nobody scrubbing through it needs at once.
MONTH_EXPLORER_KEY_PREFIX = "global:month-explorer:v1:"

#: The list of months that have a payload, so the page can build its scrubber.
MONTH_EXPLORER_INDEX_KEY = "global:month-explorer:v1:index"

#: Earliest month covered. Before this a month holds too few votes for a top eight to be
#: anything but noise, since the audience that would have cast them was still forming.
EXPLORER_FIRST_MONTH_YEAR = 2010

#: Titles per lens per month.
MONTH_EXPLORER_DEPTH = 8

#: Votes a title needs in a month before it can be called a jump. Without it the measure is
#: topped by titles going from no votes to two, which is a rounding error rather than a
#: month where something happened.
MIN_VOTES_FOR_JUMP = 15

#: Damping for the jump ratio, in votes. Pulls a thin month toward the title's normal rate.
JUMP_PRIOR = 3.0

#: Prefix for the per-board rank index that answers "where do I place".
RANK_INDEX_KEY_PREFIX = "lb:v1:ranks:"

#: How deep the rank index goes on each reader board.
#:
#: The stored rows stop at ROWS_PER_BOARD, which is far too shallow to tell most people
#: anything. This depth covers the readers who place anywhere worth mentioning, at a few tens
#: of kilobytes per board, and anyone past it is told plainly that they fall outside the
#: indexed depth rather than given a fabricated number.
RANK_INDEX_DEPTH = 2_000

logger = logging.getLogger(__name__)

#: Longer than two daily cycles plus the import that precedes them, so a single failed run
#: leaves yesterday's board up rather than emptying every ranking hours before the next
#: attempt. The payload carries its own build date, so a stale board still says so.
BOARD_TTL_SECONDS = 60 * 60 * 60

#: Rows kept per board. Beyond this nobody scrolls, and the whole catalogue stays small
#: enough that Redis eviction never has a reason to touch it.
ROWS_PER_BOARD = 100

#: The label ids VNDB assigns. Custom user labels start at 10 and are ignored.
LABEL_PLAYING = 1
LABEL_FINISHED = 2
LABEL_STALLED = 3
LABEL_DROPPED = 4
LABEL_WISHLIST = 5

#: The aggregate below groups far more keys than the default work_mem can hold, and
#: spilling it to disk is both slow and pointless on a box where disk is the scarce thing.
AGGREGATION_WORK_MEM = "128MB"


# ---------------------------------------------------------------- loading


async def load_vn_facts(db) -> dict[str, VNFacts]:
    """Every VN's facet-relevant columns, keyed by id."""
    result = await db.execute(
        select(
            VisualNovel.id,
            VisualNovel.olang,
            VisualNovel.languages,
            VisualNovel.platforms,
            VisualNovel.released,
            VisualNovel.length,
            VisualNovel.minage,
            VisualNovel.votecount,
            VisualNovel.has_free_release,
            VisualNovel.jp_freeware,
            VNDifficulty.difficulty_raw,
        )
        # Outer, because difficulty covers only the titles jiten has analysed and an inner
        # join would quietly drop every other title from every board.
        .outerjoin(VNDifficulty, VNDifficulty.vn_id == VisualNovel.id)
    )

    facts: dict[str, VNFacts] = {}
    for row in result:
        facts[row.id] = VNFacts(
            vn_id=row.id,
            olang=row.olang,
            languages=frozenset(row.languages or ()),
            platforms=frozenset(row.platforms or ()),
            year=row.released.year if row.released else None,
            length=row.length,
            minage=row.minage,
            votecount=row.votecount or 0,
            has_free_release=bool(row.has_free_release),
            jp_freeware=bool(row.jp_freeware),
            released_ordinal=row.released.toordinal() if row.released else None,
            difficulty=row.difficulty_raw,
        )
    return facts


async def latest_vote_date(db) -> date:
    """The most recent vote in the dump, which is what every rolling window ends at.

    Using the dump's own high-water mark rather than the wall clock keeps a board's window
    aligned with the data it was built from, so a late import does not silently produce an
    emptier "this week" than it should.
    """
    result = await db.execute(select(func.max(GlobalVote.date)))
    return result.scalar() or datetime.now(timezone.utc).date()


async def walk_votes(
    db,
    vn_facts,
    plan,
    activity: VoteActivity | None = None,
    chunk_size: int = 50_000,
) -> int:
    """Stream the votes table through the accumulator in chunks.

    Streamed rather than fetched whole: ~1.9M rows materialised at once would cost far more
    memory than the counters they feed. The aggregator stays synchronous and database-free,
    so this is the only place the two concerns meet.

    `activity` rides along on the same pass. Each partition is already a materialised list,
    so walking it twice is free compared with issuing a second query over the whole table.
    """
    statement = select(
        GlobalVote.user_hash, GlobalVote.vn_id, GlobalVote.vote, GlobalVote.date
    ).execution_options(yield_per=chunk_size)

    processed = 0
    result = await db.stream(statement)
    async for partition in result.partitions(chunk_size):
        if activity is not None:
            for row in partition:
                if row.date is not None:
                    activity.record(row.date)

        processed += accumulate_chunk(
            ((r.user_hash, r.vn_id, r.vote, r.date) for r in partition),
            vn_facts,
            plan,
        )
    return processed


async def load_label_counts(db) -> tuple[dict[str, LabelCounts], dict[str, LabelCounts]]:
    """Per-VN and per-user tallies of the standard list labels.

    One grouped scan of ulist_labels producing both tallies. Every index on that table leads
    with uid, so a per-VN aggregate is a full scan whatever else happens; asking for both
    groupings together means paying for that scan once rather than twice.

    Users VNDB excludes from public vote aggregates are excluded from both halves. Their
    votes are already absent from the vote dump, so counting their list entries on one axis
    and not the other would make a title's finished count irreconcilable with the sum of the
    per-user ones.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    by_vn: dict[str, LabelCounts] = {}
    by_user: dict[str, LabelCounts] = {}

    # Anti-joins against the few thousand flagged accounts, so the cost is a small hash
    # probe on top of the scan the group-by already requires.
    eligible = """
        WHERE ul.label BETWEEN 1 AND 5
          AND NOT EXISTS (
              SELECT 1 FROM vndb_users vu
              WHERE vu.uid = ul.uid AND vu.ign_votes
          )
    """

    rows = await db.execute(text(f"""
        SELECT ul.vid, ul.uid, ul.label, count(*) AS n
        FROM ulist_labels ul
        {eligible}
        GROUP BY GROUPING SETS ((ul.vid, ul.label), (ul.uid, ul.label))
    """))

    # Each row belongs to one grouping set, and the column the other set grouped on is null
    # there. A title id is never null in its own set, so that is what tells them apart.
    for vid, uid, label, count in rows:
        target, subject = (by_vn, vid) if vid is not None else (by_user, uid)
        _add_label_count(target, subject, label, count)

    return by_vn, by_user


#: The list states each VNDB label id maps onto. Custom labels start at 10 and are ignored.
_LABEL_ATTRIBUTE = {
    LABEL_PLAYING: "playing",
    LABEL_FINISHED: "finished",
    LABEL_STALLED: "stalled",
    LABEL_DROPPED: "dropped",
    LABEL_WISHLIST: "wishlist",
}


def _add_label_count(target: dict[str, LabelCounts], subject: str, label: int, n: int) -> None:
    """Fold one (subject, label, count) row into the running tally for that subject."""
    name = _LABEL_ATTRIBUTE.get(label)
    if name is None:
        return
    counts = target.get(subject)
    if counts is None:
        counts = target[subject] = LabelCounts()
    setattr(counts, name, getattr(counts, name) + n)


async def load_producer_vns(
    db, producer_types: tuple[str, ...] = ()
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Map each producer to the VNs it developed and the VNs it published.

    `producer_types` restricts to VNDB's own classification: `co` for companies, `ng` for
    amateur groups, `in` for individuals. It matters on the reception boards, where a fan
    translation group credited on a release of a masterpiece would otherwise be ranked as
    one of the best publishers in the database.
    """
    query = (
        select(
            ReleaseProducer.producer_id,
            ReleaseVN.vn_id,
            ReleaseProducer.developer,
            ReleaseProducer.publisher,
        )
        .select_from(ReleaseProducer)
        .join(Release, Release.id == ReleaseProducer.release_id)
        .join(ReleaseVN, ReleaseVN.release_id == Release.id)
        .distinct()
    )
    if producer_types:
        query = query.join(
            Producer, Producer.id == ReleaseProducer.producer_id
        ).where(Producer.type.in_(producer_types))

    result = await db.execute(query)

    developed: dict[str, set] = {}
    published: dict[str, set] = {}
    for producer_id, vn_id, is_developer, is_publisher in result:
        if is_developer:
            developed.setdefault(producer_id, set()).add(vn_id)
        if is_publisher:
            published.setdefault(producer_id, set()).add(vn_id)

    return (
        {p: sorted(v) for p, v in developed.items()},
        {p: sorted(v) for p, v in published.items()},
    )


async def load_credited_vns(
    db, table, entity_column, roles: tuple[str, ...] = ()
) -> dict[str, list[str]]:
    """Map each credited entity to the visual novels it appears on.

    Serves staff and seiyuu, which share the shape: a junction table of VN against entity.
    Distinct because a person credited in several roles on one title should count once.

    `roles` restricts which credits count. It matters more than it looks: the credit table
    treats a scenario writer, a QA tester and a translator alike, so a board about how a
    person's work was received has to say which kinds of work it means. Without it, the
    people who tested a beloved title outrank everyone who wrote one.
    """
    query = select(entity_column, table.vn_id).distinct()
    if roles:
        query = query.where(table.role.in_(roles))
    result = await db.execute(query)

    credited: dict[str, set] = {}
    for entity_id, vn_id in result:
        if entity_id:
            credited.setdefault(entity_id, set()).add(vn_id)

    return {entity: sorted(vns) for entity, vns in credited.items()}


async def load_seiyuu_vns(db, character_roles: tuple[str, ...] = ()) -> dict[str, list[str]]:
    """Map each voice actor to the titles they are credited on.

    `character_roles` restricts to the parts that carry a work: a credit table entry does
    not distinguish a lead from a single line, and counting them alike makes a career of
    cameos read like a career of leads.
    """
    query = select(VNSeiyuu.staff_id, VNSeiyuu.vn_id).distinct()
    if character_roles:
        query = query.join(
            CharacterVN,
            (CharacterVN.character_id == VNSeiyuu.character_id)
            & (CharacterVN.vn_id == VNSeiyuu.vn_id),
        ).where(CharacterVN.role.in_(character_roles))

    credited: dict[str, set] = {}
    for staff_id, vn_id in await db.execute(query):
        if staff_id:
            credited.setdefault(staff_id, set()).add(vn_id)
    return {staff: sorted(vns) for staff, vns in credited.items()}


async def load_studio_activity(db, producer_types: tuple[str, ...] = ()) -> dict[str, tuple]:
    """First and most recent release year per developer, and how many titles they made."""
    query = (
        select(
            ReleaseProducer.producer_id,
            func.min(Release.released),
            func.max(Release.released),
            func.count(func.distinct(ReleaseVN.vn_id)),
        )
        .select_from(ReleaseProducer)
        .join(Release, Release.id == ReleaseProducer.release_id)
        .join(ReleaseVN, ReleaseVN.release_id == Release.id)
        .where(ReleaseProducer.developer.is_(True))
        .where(Release.released.isnot(None))
        .group_by(ReleaseProducer.producer_id)
    )
    if producer_types:
        query = query.join(
            Producer, Producer.id == ReleaseProducer.producer_id
        ).where(Producer.type.in_(producer_types))

    return {
        row[0]: (row[1], row[2], row[3])
        for row in await db.execute(query)
        if row[0]
    }


#: A studio without a release inside this many years has stopped, whatever its span.
ACTIVE_WITHIN_YEARS = 3

#: Titles with fewer votes than this have too unstable a mean to judge a reader against.
MIN_VOTES_FOR_COMPARISON = 30


async def load_reader_scan(db) -> dict[str, ReaderScan]:
    """Measure every reader against the community on the titles they actually voted on.

    A grouped scan rather than part of the streaming accumulation, because every title's
    community mean has to exist before any reader can be compared with it, and the stream
    cannot supply that while it is still running. Two passes over 1.9M rows in Postgres cost
    about a second; doing it in Python would cost a second walk of the whole vote table.

    Deliberately holds no ordered-set aggregate. Adding one forces the whole grouped scan
    from a hash aggregate onto a sort that spills to disk, which is the scarce resource here.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    rows = await db.execute(text(f"""
        WITH per_vn AS (
            SELECT vn_id, avg(vote) AS mean, count(*) AS voters
            FROM global_votes
            GROUP BY vn_id
        )
        SELECT gv.user_hash AS reader,
               count(*) AS votes,
               avg(gv.vote - per_vn.mean) / 10 AS bias,
               stddev_pop(gv.vote - per_vn.mean) / 10 AS divergence
        FROM global_votes gv
        JOIN per_vn ON per_vn.vn_id = gv.vn_id
        WHERE per_vn.voters >= {MIN_VOTES_FOR_COMPARISON}
        GROUP BY gv.user_hash
    """))

    return {
        row.reader: ReaderScan(
            votes=row.votes,
            bias=float(row.bias or 0.0),
            divergence=float(row.divergence or 0.0),
        )
        for row in rows
    }


async def load_reader_obscurity(db, japanese_only: bool = True) -> dict[str, ReaderScan]:
    """How far off the beaten track each reader's picks are.

    Separate from the scan above because it deliberately keeps the thinly-voted titles that
    one excludes: a title with two voters is noise when judging how someone scores, and is
    exactly the point when judging how obscure their reading is.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    restriction = "AND v.olang = :olang" if japanese_only else ""
    rows = await db.execute(
        text(f"""
            WITH per_vn AS (
                SELECT vn_id, count(*) AS voters FROM global_votes GROUP BY vn_id
            )
            SELECT gv.user_hash AS reader,
                   count(*) AS votes,
                   -- Less the reader themself, since the board publishes this as the
                   -- number of other people who voted on the same titles.
                   percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY per_vn.voters - 1
                   ) AS median_voters,
                   percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY extract(year FROM v.released)
                   ) AS median_year,
                   -- The band holding the middle 80% of their reading. Taken here rather
                   -- than in a scan of its own: the rows are already grouped and ordered
                   -- by release year for the median above.
                   percentile_cont(0.1) WITHIN GROUP (
                       ORDER BY extract(year FROM v.released)
                   ) AS year_p10,
                   percentile_cont(0.9) WITHIN GROUP (
                       ORDER BY extract(year FROM v.released)
                   ) AS year_p90
            FROM global_votes gv
            JOIN per_vn ON per_vn.vn_id = gv.vn_id
            JOIN visual_novels v ON v.id = gv.vn_id
            WHERE TRUE {restriction}
            GROUP BY gv.user_hash
        """),
        {"olang": LANGUAGE_JAPANESE},
    )

    return {
        row.reader: ReaderScan(
            votes=row.votes,
            median_voters=float(row.median_voters or 0.0),
            median_year=float(row.median_year or 0.0),
            era_window=float((row.year_p90 or 0.0) - (row.year_p10 or 0.0)),
            era_from=int(row.year_p10 or 0),
            era_to=int(row.year_p90 or 0),
        )
        for row in rows
    }



#: VNDB tag ids the composition scan reads. Named rather than inlined so the query and the
#: disclosures cannot drift apart.
#: VNDB's platform code for the PC-98, whose corner of the database the share board covers.
PC98_PLATFORM = "p98"

TAG_NVL = 43
TAG_BRANCHING = 606
TAG_LINEAR = 145

#: Tags marking a reading convenience a title does not have. Their absence is a property of
#: how a title was built, so a reader whose library is full of them is reading work that
#: predates those conveniences or was made without them.
TAGS_MISSING_COMFORT = (805, 901, 1164, 1258, 1782, 2342, 2651, 2652)

#: Each share board, as (numerator, denominator) columns of the composition scan.
#:
#: Two shapes of denominator. Most are measured against everything a reader has voted on,
#: which is the honest base for "how much of your reading is this". The route-structure pair
#: is measured only against the titles where route structure is recorded, because the tag is
#: applied to a minority and treating untagged titles as "not branching" would report tag
#: coverage rather than reading.
COMPOSITIONS: dict[str, tuple[str, str]] = {
    "nvl": ("nvl", "votes"),
    "branching": ("branching", "route_known"),
    "linear": ("linear", "route_known"),
    "bare_bones": ("bare", "votes"),
    "pc98": ("pc98", "votes"),
    "pre_2000": ("pre_2000", "votes"),
    "top_studio": ("studio_top", "studio_credited"),
    "top_writer": ("writer_top", "writer_credited"),
    "series_return": ("franchises_followed", "franchises_entered"),
}

#: Shares already averaged before they arrive, stored per ten thousand. They cannot be a pair
#: of counts because each is a mean of per-franchise shares rather than one ratio.
PRECOMPUTED_SHARES: dict[str, tuple[str, str]] = {
    "franchise_depth": ("franchise_depth", "deep_franchises"),
}



async def load_reader_composition(db) -> dict[str, dict[str, int]]:
    """What every reader's library is made of, in one pass.

    Each share board is a pair of counts over the same set of votes, so they all come from a
    single grouped scan rather than one apiece. Adding another is a column here, not another
    walk of the vote table.

    Readers below the pre-floor are dropped in the database rather than in Python: they cannot
    qualify for any board built on this, and they are the great majority of accounts.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    interesting = (TAG_NVL, TAG_BRANCHING, TAG_LINEAR, *TAGS_MISSING_COMFORT)
    rows = await db.execute(
        text(f"""
            WITH flags AS (
                SELECT tv.vn_id,
                       bool_or(tv.tag_id = {TAG_NVL}) AS nvl,
                       bool_or(tv.tag_id = {TAG_BRANCHING}) AS branching,
                       bool_or(tv.tag_id = {TAG_LINEAR}) AS linear,
                       bool_or(tv.tag_id IN {TAGS_MISSING_COMFORT}) AS bare
                FROM vn_tags tv
                WHERE tv.score > 0
                  AND tv.spoiler_level = 0
                  AND tv.lie IS NOT TRUE
                  AND tv.tag_id IN {interesting}
                GROUP BY tv.vn_id
            )
            SELECT gv.user_hash AS reader,
                   count(*) AS votes,
                   count(*) FILTER (WHERE f.nvl) AS nvl,
                   count(*) FILTER (WHERE f.branching OR f.linear) AS route_known,
                   count(*) FILTER (WHERE f.branching) AS branching,
                   count(*) FILTER (WHERE f.linear) AS linear,
                   count(*) FILTER (WHERE f.bare) AS bare,
                   count(*) FILTER (WHERE '{PC98_PLATFORM}' = ANY(v.platforms)) AS pc98,
                   count(*) FILTER (WHERE v.released < DATE '2000-01-01') AS pre_2000
            FROM global_votes gv
            JOIN visual_novels v ON v.id = gv.vn_id
            LEFT JOIN flags f ON f.vn_id = gv.vn_id
            GROUP BY gv.user_hash
            HAVING count(*) >= {MIN_VOTES_FOR_COMPOSITION}
        """)
    )

    return {
        row.reader: {
            "votes": row.votes,
            "nvl": row.nvl,
            "route_known": row.route_known,
            "branching": row.branching,
            "linear": row.linear,
            "bare": row.bare,
            "pc98": row.pc98,
            "pre_2000": row.pre_2000,
        }
        for row in rows
    }


#: Credited titles a reader needs before the share coming from one name is published.
MIN_CREDITED_FOR_DEVOTION = 50


async def load_reader_devotion(db, compositions: dict[str, dict[str, int]]) -> None:
    """How much of each reader's library comes from a single studio, and a single writer.

    Folded into the composition figures rather than returned separately: both are a share of
    a library like the others, and ranking them goes through the same path.

    Counted without DISTINCT on purpose. A vote is unique per reader and title, and the credit
    mappings are already unique per title and name, so the rows cannot double up; asking for
    distinct anyway costs several times the runtime for the same answer.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    sources = {
        "studio": """
            SELECT DISTINCT rv.vn_id, rp.producer_id AS credit
            FROM release_producers rp
            JOIN release_vn rv ON rv.release_id = rp.release_id
            WHERE rp.developer
        """,
        "writer": """
            SELECT DISTINCT vs.vn_id, vs.staff_id AS credit
            FROM vn_staff vs
            WHERE vs.role = 'scenario'
        """,
    }

    for name, credit_sql in sources.items():
        rows = await db.execute(
            text(f"""
                WITH credited AS ({credit_sql}),
                per_name AS (
                    SELECT gv.user_hash, c.credit, count(*) AS n
                    FROM global_votes gv
                    JOIN credited c ON c.vn_id = gv.vn_id
                    GROUP BY gv.user_hash, c.credit
                ),
                strongest AS (
                    SELECT user_hash, max(n) AS top_n FROM per_name GROUP BY user_hash
                ),
                library AS (
                    SELECT gv.user_hash, count(*) AS total
                    FROM global_votes gv
                    WHERE EXISTS (SELECT 1 FROM credited c WHERE c.vn_id = gv.vn_id)
                    GROUP BY gv.user_hash
                )
                SELECT l.user_hash AS reader, s.top_n, l.total
                FROM library l
                JOIN strongest s ON s.user_hash = l.user_hash
                WHERE l.total >= {MIN_CREDITED_FOR_DEVOTION}
            """)
        )
        for row in rows:
            entry = compositions.setdefault(row.reader, {})
            entry[f"{name}_top"] = row.top_n
            entry[f"{name}_credited"] = row.total


#: Franchises a reader must have entered before their franchise habits are ranked.
MIN_FRANCHISES_ENTERED = 20

#: Entries a franchise needs before "how much of it did they read" means anything. A pair is
#: not a series to work through.
MIN_ENTRIES_FOR_DEPTH = 3


async def load_reader_franchise(
    db, series: dict[str, list[str]], compositions: dict[str, dict[str, int]]
) -> None:
    """Two habits, from one pass: whether a reader returns to a series, and how far in.

    Franchises come from the continuation relations rather than the wider set, so a shared
    setting or an alternative edition does not read as another entry to work through.

    The membership is built in Python by following relations, so it is handed to the database
    as a temporary mapping and joined there; pulling every reader's votes back out to do it in
    Python would move far more data than the answer is worth.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))
    await db.execute(text("DROP TABLE IF EXISTS franchise_map"))
    await db.execute(
        text("CREATE TEMP TABLE franchise_map (vn_id varchar(10), franchise varchar(24))")
    )

    rows = [
        {"vn_id": vn_id, "franchise": key}
        for key, members in series.items()
        for vn_id in members
    ]
    if not rows:
        return
    await db.execute(
        text("INSERT INTO franchise_map (vn_id, franchise) VALUES (:vn_id, :franchise)"),
        rows,
    )
    await db.execute(text("CREATE INDEX ON franchise_map (vn_id)"))

    result = await db.execute(
        text(f"""
            WITH sizes AS (
                SELECT franchise, count(*) AS entries FROM franchise_map GROUP BY franchise
            ),
            touched AS (
                SELECT gv.user_hash, f.franchise, count(*) AS read_entries
                FROM global_votes gv
                JOIN franchise_map f ON f.vn_id = gv.vn_id
                GROUP BY gv.user_hash, f.franchise
            )
            SELECT t.user_hash AS reader,
                   count(*) AS entered,
                   count(*) FILTER (WHERE t.read_entries > 1) AS followed,
                   count(*) FILTER (WHERE s.entries >= {MIN_ENTRIES_FOR_DEPTH}) AS deep_entered,
                   coalesce(
                       avg(t.read_entries::numeric / s.entries)
                           FILTER (WHERE s.entries >= {MIN_ENTRIES_FOR_DEPTH}),
                       0
                   ) AS depth
            FROM touched t
            JOIN sizes s ON s.franchise = t.franchise
            GROUP BY t.user_hash
            HAVING count(*) >= {MIN_FRANCHISES_ENTERED}
        """)
    )

    for row in result:
        entry = compositions.setdefault(row.reader, {})
        entry["franchises_entered"] = row.entered
        entry["franchises_followed"] = row.followed
        entry["deep_franchises"] = row.deep_entered
        # Stored per ten thousand so the share travels as an integer like its neighbours.
        entry["franchise_depth"] = int(round(float(row.depth) * 10_000))

    await db.execute(text("DROP TABLE IF EXISTS franchise_map"))


#: Floors for the drift figure: enough dated votes to split into thirds, enough separate days
#: that it is a history rather than one sitting, and enough elapsed time for taste to move.
MIN_VOTES_FOR_DRIFT = 60
MIN_DAYS_FOR_DRIFT = 25
MIN_SPAN_DAYS_FOR_DRIFT = 1095


async def load_reader_drift(db, compositions: dict[str, dict[str, int]]) -> None:
    """How far the release years of a reader's picks have moved across their own history.

    Their votes are split into thirds by when they were cast, and the median release year of
    the last third is compared with the first. Thirds rather than halves because the middle is
    the part that says least, and a median rather than a mean because one 1996 title in an
    otherwise modern library should not read as a decade of travel.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    rows = await db.execute(
        text(f"""
            WITH ordered AS (
                SELECT gv.user_hash, gv.date, v.released,
                       ntile(3) OVER (
                           PARTITION BY gv.user_hash ORDER BY gv.date, gv.vn_id
                       ) AS third
                FROM global_votes gv
                JOIN visual_novels v ON v.id = gv.vn_id
                WHERE gv.date IS NOT NULL AND v.released IS NOT NULL
            )
            SELECT user_hash AS reader,
                   count(*) AS dated,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(year FROM released))
                       FILTER (WHERE third = 3) AS late_year,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(year FROM released))
                       FILTER (WHERE third = 1) AS early_year
            FROM ordered
            GROUP BY user_hash
            HAVING count(*) >= {MIN_VOTES_FOR_DRIFT}
               AND count(DISTINCT date) >= {MIN_DAYS_FOR_DRIFT}
               AND max(date) - min(date) >= {MIN_SPAN_DAYS_FOR_DRIFT}
        """)
    )

    for row in rows:
        if row.late_year is None or row.early_year is None:
            continue
        entry = compositions.setdefault(row.reader, {})
        # Carried as hundredths of a year so it travels as an integer like its neighbours.
        entry["era_drift"] = int(round((float(row.late_year) - float(row.early_year)) * 100))
        entry["drift_sample"] = row.dated


#: Titles a reader needs, each carrying enough content tags to describe it, before the range
#: of what they read is estimated.
MIN_TAGGED_FOR_THEMES = 50

#: The sample size the estimate is expressed at. Fixed so the figure does not simply grow with
#: the library: a reader with three thousand titles and one with fifty are both asked what a
#: draw of this many of their titles would look like.
THEME_SAMPLE_SIZE = 25

#: Tags taken from each title, strongest first. Enough to describe a title, few enough that a
#: heavily-tagged one does not drown a sparsely-tagged one.
TAGS_PER_TITLE = 5


async def load_backlog_gap(db) -> dict[str, BacklogGap]:
    """Mean length of each reader's wishlist against the mean length of what they finished.

    One grouped pass over the two standard list states. The higher numbered labels are
    user-defined and carry no shared meaning between accounts, so only these two are read.

    Titles with no recorded length category are skipped rather than treated as average: a
    missing length is not a middling one, and both means have to be over titles that actually
    have the field or the two sides stop being comparable.
    """
    rows = await db.execute(
        text(f"""
            SELECT ul.uid,
                   count(*) FILTER (WHERE ul.label = {LABEL_FINISHED}) AS finished,
                   count(*) FILTER (WHERE ul.label = {LABEL_WISHLIST}) AS wishlist,
                   avg(v.length::numeric) FILTER (WHERE ul.label = {LABEL_FINISHED})
                       AS finished_length,
                   avg(v.length::numeric) FILTER (WHERE ul.label = {LABEL_WISHLIST})
                       AS wishlist_length
            FROM ulist_labels ul
            JOIN visual_novels v ON v.id = ul.vid
            WHERE ul.label IN ({LABEL_FINISHED}, {LABEL_WISHLIST})
              AND v.length IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM vndb_users vu
                  WHERE vu.uid = ul.uid AND vu.ign_votes
              )
            GROUP BY ul.uid
            HAVING count(*) FILTER (WHERE ul.label = {LABEL_FINISHED}) >= :floor
               AND count(*) FILTER (WHERE ul.label = {LABEL_WISHLIST}) >= :floor
        """),
        {"floor": MIN_PER_SIDE_FOR_BACKLOG},
    )
    return {
        row.uid: BacklogGap(
            finished=int(row.finished),
            wishlist=int(row.wishlist),
            finished_length=float(row.finished_length),
            wishlist_length=float(row.wishlist_length),
        )
        for row in rows
    }


async def load_reader_themes(db, compositions: dict[str, dict[str, int]]) -> None:
    """How many different themes a fixed-size sample of a reader's library would show.

    A rarefaction: for each tag, the chance it appears at all in a draw of a fixed number of
    their titles, summed across tags. Counting the distinct tags someone has touched would
    just rank library size, and dividing by size overcorrects; asking what a sample of the
    same size would look like puts every reader on the same footing.

    The per-tag absence probability is written as a product of a fixed number of terms, one
    per title drawn, rather than one per occurrence of the tag. The two are the same identity,
    and the fixed form does not grow with how often a reader's favourite theme appears.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    absent = " * ".join(
        f"(greatest((tot.n - ut.m - {j})::float8, 0) / (tot.n - {j})::float8)"
        for j in range(THEME_SAMPLE_SIZE)
    )

    rows = await db.execute(
        text(f"""
            WITH strongest AS (
                SELECT vn_id, tag_id FROM (
                    SELECT t.vn_id, t.tag_id,
                           row_number() OVER (
                               PARTITION BY t.vn_id ORDER BY t.score DESC, t.tag_id
                           ) AS rank,
                           count(*) OVER (PARTITION BY t.vn_id) AS tagged
                    FROM vn_tags t
                    JOIN tags g ON g.id = t.tag_id
                    WHERE t.score > 0
                      AND t.spoiler_level = 0
                      AND t.lie IS NOT TRUE
                      AND g.category = 'cont'
                ) ranked
                WHERE rank <= {TAGS_PER_TITLE} AND tagged >= {TAGS_PER_TITLE}
            ),
            base AS (
                SELECT gv.user_hash, gv.vn_id
                FROM global_votes gv
                WHERE EXISTS (SELECT 1 FROM strongest s WHERE s.vn_id = gv.vn_id)
            ),
            tot AS (
                SELECT user_hash, count(*)::int AS n
                FROM base GROUP BY user_hash
                HAVING count(*) >= {MIN_TAGGED_FOR_THEMES}
            ),
            ut AS (
                SELECT b.user_hash, s.tag_id, count(*)::int AS m
                FROM base b
                JOIN tot ON tot.user_hash = b.user_hash
                JOIN strongest s ON s.vn_id = b.vn_id
                GROUP BY b.user_hash, s.tag_id
            )
            SELECT ut.user_hash AS reader,
                   max(tot.n) AS tagged_titles,
                   sum(1.0 - ({absent})) AS themes
            FROM ut
            JOIN tot ON tot.user_hash = ut.user_hash
            GROUP BY ut.user_hash
        """)
    )

    for row in rows:
        entry = compositions.setdefault(row.reader, {})
        # Hundredths, so it travels as an integer like every other figure here.
        entry["theme_range"] = int(round(float(row.themes) * 100))
        entry["theme_sample"] = row.tagged_titles


async def load_reader_response(db) -> dict[str, ReaderScan]:
    """How far each reader's votes move when the community's move.

    Regressing a reader's votes on the community average separates two things a plain
    average cannot: where they sit, and how widely they spread. A reader who scores
    everything two points low has a large bias and a slope of one. A reader whose range runs
    from 20 to 100 where consensus runs 60 to 80 has no bias at all and a slope of three.

    Constant voters are excluded rather than filtered afterwards. With no variance in the
    votes the fit statistic is degenerate and reports a perfect line, which would put every
    account that rated everything the same at the head of the board.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    rows = await db.execute(text(f"""
        WITH crowd AS (
            SELECT vn_id, avg(vote) AS crowd_avg
            FROM global_votes
            GROUP BY vn_id
            HAVING count(*) >= {MIN_VOTES_FOR_CONSENSUS}
        ),
        paired AS (
            SELECT g.user_hash, g.vote, c.crowd_avg
            FROM global_votes g
            JOIN crowd c ON c.vn_id = g.vn_id
        )
        SELECT user_hash AS reader,
               count(*) AS votes,
               regr_slope(vote, crowd_avg) AS slope,
               regr_r2(vote, crowd_avg) AS fit
        FROM paired
        GROUP BY user_hash
        HAVING count(*) >= {MIN_VOTES_FOR_RESPONSE}
           AND stddev_pop(vote) > 0
           AND regr_r2(vote, crowd_avg) >= {MIN_RESPONSE_FIT}
    """))

    scans: dict[str, ReaderScan] = {}
    for row in rows:
        votes = row.votes
        slope = float(row.slope or 0.0)
        # Damped toward tracking consensus exactly, in proportion to how much evidence
        # there is. The undamped slope falls steadily with list size, so ranking on it
        # returns the readers sitting at the floor rather than the most responsive ones.
        damped = (votes * slope + RESPONSE_PRIOR) / (votes + RESPONSE_PRIOR)
        scans[row.reader] = ReaderScan(
            votes=votes, response=damped, response_fit=float(row.fit or 0.0)
        )
    return scans



async def load_reader_steadiness(db) -> dict[str, ReaderScan]:
    """How evenly each reader's votes are spread across the months they were active.

    The entropy of the monthly counts, normalised by the length of the span it covers, so
    the measure asks about rhythm rather than volume. A reader who logged everything in one
    burst scores near zero however much they logged; one who logged a little every month for
    a decade scores near one.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    rows = await db.execute(text(f"""
        WITH monthly AS (
            SELECT user_hash, date_trunc('month', date) AS month, count(*) AS votes
            FROM global_votes
            WHERE date IS NOT NULL
            GROUP BY user_hash, date_trunc('month', date)
        ),
        totals AS (
            SELECT user_hash,
                   sum(votes) AS votes,
                   count(*) AS active_months,
                   max(month) AS last_month,
                   (date_part('year', age(max(month), min(month))) * 12
                  + date_part('month', age(max(month), min(month))))::int + 1 AS span_months
            FROM monthly
            GROUP BY user_hash
        ),
        entropy AS (
            SELECT m.user_hash,
                   -sum((m.votes::numeric / t.votes) * ln(m.votes::numeric / t.votes)) AS raw
            FROM monthly m
            JOIN totals t ON t.user_hash = m.user_hash
            GROUP BY m.user_hash
        )
        SELECT t.user_hash AS reader,
               t.votes,
               t.active_months,
               t.span_months,
               to_char(t.last_month, 'YYYY-MM') AS last_active,
               e.raw / ln(t.span_months) AS steadiness
        FROM totals t
        JOIN entropy e ON e.user_hash = t.user_hash
        WHERE t.votes >= {MIN_VOTES_FOR_STEADINESS}
          AND t.span_months >= {MIN_SPAN_FOR_STEADINESS}
    """))

    return {
        row.reader: ReaderScan(
            # A summed count arrives as a decimal; the boards compare it against integers.
            votes=int(row.votes),
            steadiness=float(row.steadiness or 0.0),
            active_months=row.active_months,
            span_months=row.span_months,
            last_active=row.last_active or "",
        )
        for row in rows
    }



async def prepare_vote_cells(db) -> int:
    """Collapse the vote table to one row per title per month, once.

    Four things read this: the month explorer and the year explorer, each in two language
    views. Every one of them was scanning the whole vote table for its own aggregate, which
    is the same aggregate four times over. Materialising it once and reading it four ways
    costs a single scan and leaves the callers otherwise unchanged.

    The language a title was originally written in rides along, because it is a property of
    the title rather than of the vote and so survives the collapse.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))
    await db.execute(text("DROP TABLE IF EXISTS vote_cells"))
    await db.execute(text(f"""
        CREATE TEMP TABLE vote_cells AS
        SELECT date_trunc('month', gv.date) AS month,
               gv.vn_id,
               (v.olang = '{LANGUAGE_JAPANESE}') AS is_ja,
               count(*)::numeric AS votes
        FROM global_votes gv
        JOIN visual_novels v ON v.id = gv.vn_id
        WHERE gv.date IS NOT NULL
        GROUP BY 1, 2, 3
    """))
    total = (await db.execute(text("SELECT count(*) FROM vote_cells"))).scalar_one()
    return int(total)


async def load_votes_by_year(
    db, first_year: int, depth: int, japanese_only: bool = True
) -> dict[int, list[tuple]]:
    """The titles that collected the most votes in each calendar year.

    Keyed on when the vote was cast rather than when the title came out, which is what makes
    it a different question from the release-year side of the explorer: it says what people
    were reading that year, including titles that were already old.

    Ranked inside the query so only the top few rows per year cross the wire; the ungrouped
    pairing of every title with every year it was voted in is far larger than the answer.
    """
    lang_where = "WHERE is_ja" if japanese_only else ""
    rows = await db.execute(
        text(f"""
            WITH per_year AS (
                SELECT extract(year FROM month)::int AS year, vn_id, sum(votes)::bigint AS votes
                FROM vote_cells
                {lang_where}
                GROUP BY 1, 2
            ),
            ranked AS (
                SELECT year, vn_id, votes,
                       row_number() OVER (
                           PARTITION BY year ORDER BY votes DESC, vn_id
                       ) AS place
                FROM per_year
                WHERE year >= :first_year
            )
            SELECT year, vn_id, votes FROM ranked WHERE place <= :depth ORDER BY year, place
        """),
        {"first_year": first_year, "depth": depth},
    )

    by_year: dict[int, list[tuple]] = {}
    for row in rows:
        by_year.setdefault(row.year, []).append((row.vn_id, row.votes))
    return by_year


async def load_reception_shift(db, depth: int, japanese_only: bool = True) -> dict:
    """Titles whose reception is moving, over each of several windows.

    The windowed figures compare a title's votes inside the window against its own settled
    lifetime average, so they answer themselves again every night: a title being reappraised
    now appears while the reappraisal is happening.

    The all-time figure is a different comparison and says so wherever it is shown. It splits
    a title's whole history in half and compares the halves, which is a fact about how the
    title aged rather than about what is happening at the moment. It is offered alongside the
    windows because "has this always been drifting, or only lately" is the obvious next
    question, and the two together answer it.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    lang_join, lang_where = japanese_clause(japanese_only)
    periods: dict[str, dict] = {}

    for key, days, min_recent in SHIFT_WINDOWS:
        rows = await db.execute(
            text(f"""
                WITH bounds AS (SELECT max(date) AS latest FROM global_votes),
                lifetime AS (
                    SELECT gv.vn_id, avg(gv.vote) AS mean, count(*) AS votes
                    FROM global_votes gv
                    {lang_join}
                    WHERE TRUE {lang_where}
                    GROUP BY gv.vn_id
                    HAVING count(*) >= :min_lifetime
                ),
                recent AS (
                    SELECT gv.vn_id, avg(gv.vote) AS mean, count(*) AS votes
                    FROM global_votes gv
                    CROSS JOIN bounds b
                    {lang_join}
                    WHERE gv.date > b.latest - CAST(:days AS integer)
                    {lang_where}
                    GROUP BY gv.vn_id
                    HAVING count(*) >= :min_recent
                ),
                joined AS (
                    SELECT r.vn_id,
                           l.mean / 10 AS baseline,
                           r.mean / 10 AS current_score,
                           (r.mean - l.mean) / 10 AS shift,
                           r.votes AS window_votes
                    FROM recent r
                    JOIN lifetime l ON l.vn_id = r.vn_id
                )
                -- Each direction ranked on its own. Ordering by the size of the move
                -- regardless of sign starves whichever direction is less common, and titles
                -- drifting down outnumber titles drifting up.
                SELECT vn_id, baseline, current_score, shift, window_votes
                FROM (
                    SELECT *,
                           row_number() OVER (ORDER BY shift DESC, vn_id) AS up_place,
                           row_number() OVER (ORDER BY shift ASC, vn_id) AS down_place
                    FROM joined
                ) ranked
                WHERE up_place <= :limit OR down_place <= :limit
            """),
            {
                "days": days,
                "min_lifetime": MIN_LIFETIME_VOTES_FOR_SHIFT,
                "min_recent": min_recent,
                "limit": depth,
            },
        )
        entries = [
            {
                "vn_id": row.vn_id,
                "baseline": float(row.baseline),
                "current_score": float(row.current_score),
                "shift": float(row.shift),
                "window_votes": row.window_votes,
            }
            for row in rows
        ]
        periods[key] = {
            "days": days,
            "rising": sorted(
                (e for e in entries if e["shift"] > 0), key=lambda e: -e["shift"]
            )[:depth],
            "falling": sorted(
                (e for e in entries if e["shift"] < 0), key=lambda e: e["shift"]
            )[:depth],
        }

    # All time, from the column the nightly job already writes.
    rows = await db.execute(
        text(f"""
            SELECT vn_id, shift, window_votes FROM (
                SELECT id AS vn_id, reputation_shift AS shift, public_votes AS window_votes,
                       row_number() OVER (ORDER BY reputation_shift DESC, id) AS up_place,
                       row_number() OVER (ORDER BY reputation_shift ASC, id) AS down_place
                FROM visual_novels
                WHERE reputation_shift IS NOT NULL
                  AND public_votes >= :min_votes
                  {"AND olang = 'ja'" if japanese_only else ""}
            ) ranked
            WHERE up_place <= :limit OR down_place <= :limit
        """),
        {"min_votes": MIN_VOTES_FOR_ALL_TIME_SHIFT, "limit": depth},
    )
    all_time = [
        {
            "vn_id": row.vn_id,
            "shift": float(row.shift),
            "window_votes": row.window_votes,
        }
        for row in rows
    ]
    periods["all"] = {
        "days": None,
        "rising": sorted((e for e in all_time if e["shift"] > 0), key=lambda e: -e["shift"])[
            :depth
        ],
        "falling": sorted((e for e in all_time if e["shift"] < 0), key=lambda e: e["shift"])[
            :depth
        ],
    }

    return periods


async def load_new_releases(db, depth: int, japanese_only: bool = True) -> list[dict]:
    """Titles out in the last few months, by how much attention they have drawn since.

    Fluid by construction: a title leaves this list by ageing out of it, so the whole list
    turns over on its own without anything about the titles changing.
    """
    rows = await db.execute(
        text(f"""
            WITH bounds AS (SELECT max(date) AS latest FROM global_votes)
            SELECT v.id AS vn_id,
                   v.released,
                   count(*) AS votes,
                   avg(gv.vote) / 10 AS score
            FROM global_votes gv
            CROSS JOIN bounds b
            JOIN visual_novels v ON v.id = gv.vn_id
            WHERE gv.date > b.latest - CAST(:vote_days AS integer)
              AND v.released > b.latest - CAST(:release_days AS integer)
              AND v.released <= b.latest
              {"AND v.olang = 'ja'" if japanese_only else ""}
            GROUP BY v.id, v.released
            ORDER BY count(*) DESC
            LIMIT :limit
        """),
        {
            "vote_days": NEW_RELEASE_VOTE_DAYS,
            "release_days": NEW_RELEASE_DAYS,
            "limit": depth,
        },
    )
    return [
        {
            "vn_id": row.vn_id,
            "released": row.released.isoformat() if row.released else None,
            "votes": row.votes,
            "score": float(row.score),
        }
        for row in rows
    ]


async def load_being_finished(db, depth: int, japanese_only: bool = True) -> list[dict]:
    """What readers have been finishing lately.

    Dated on the list entry rather than on a vote, which makes it a different signal from
    everything else here: a vote can be cast at any time, while finishing is an event with a
    date attached. Self-reported, so it describes the readers who fill that field in.
    """
    rows = await db.execute(
        text(f"""
            WITH bounds AS (SELECT max(date) AS latest FROM global_votes)
            SELECT u.vid AS vn_id, count(*) AS finishes
            FROM ulist_vns u
            CROSS JOIN bounds b
            {"JOIN visual_novels lang_vn ON lang_vn.id = u.vid" if japanese_only else ""}
            WHERE u.finished > b.latest - CAST(:days AS integer)
              AND u.finished <= b.latest
              {"AND lang_vn.olang = 'ja'" if japanese_only else ""}
            GROUP BY u.vid
            ORDER BY count(*) DESC
            LIMIT :limit
        """),
        {"days": FINISHED_WINDOW_DAYS, "limit": depth},
    )
    return [{"vn_id": row.vn_id, "finishes": row.finishes} for row in rows]


async def load_anticipated(db, depth: int) -> list[dict]:
    """Japanese titles not out in any form yet, by how many readers are waiting.

    A future release date is not enough on its own to make a title unreleased: ports,
    remasters and new editions all carry one, and a long-finished title picking up a console
    version would otherwise head this list on the strength of the wishlists its original
    earned. The title has to have nothing non-trial released against it at all, which is what
    makes this work that does not exist yet rather than a schedule of editions of work that
    does. A demo does not disqualify one, since a title with only a trial out is still ahead.

    Ordered by wishlist count, so it reports what readers are waiting for rather than
    everything carrying a date.
    """
    rows = await db.execute(
        text("""
            WITH bounds AS (SELECT max(date) AS latest FROM global_votes),
            upcoming AS (
                SELECT rv.vn_id, min(r.released) AS out_on
                FROM releases r
                CROSS JOIN bounds b
                JOIN release_vn rv ON rv.release_id = r.id
                WHERE r.released > b.latest
                  AND r.released < b.latest + CAST(:days AS integer)
                  AND rv.rtype = 'complete'
                  AND r.patch IS NOT TRUE
                  AND r.olang = 'ja'
                GROUP BY rv.vn_id
            )
            SELECT u.vn_id, u.out_on, v.list_wishlist AS waiting
            FROM upcoming u
            CROSS JOIN bounds b
            JOIN visual_novels v ON v.id = u.vn_id
            WHERE v.olang = 'ja' AND v.list_wishlist > 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM release_vn rv2
                  JOIN releases r2 ON r2.id = rv2.release_id
                  WHERE rv2.vn_id = u.vn_id
                    AND r2.released <= b.latest
                    AND rv2.rtype IS DISTINCT FROM 'trial'
                    AND r2.patch IS NOT TRUE
              )
            ORDER BY v.list_wishlist DESC
            LIMIT :limit
        """),
        {"days": UPCOMING_DAYS, "limit": depth},
    )
    return [
        {
            "vn_id": row.vn_id,
            "out_on": row.out_on.isoformat() if row.out_on else None,
            "waiting": row.waiting or 0,
        }
        for row in rows
    ]


async def load_community_pulse(db, weeks: int, japanese_only: bool = True) -> list[dict]:
    """Votes, active readers and first-time readers, week by week.

    The only figure here about the community rather than about titles, and the one that says
    whether the rest of the page is measuring a growing room or a shrinking one. First-time
    readers are counted by comparing each vote's week against the week of that reader's
    earliest vote, so the series needs the whole table to place anyone.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    lang_join, lang_where = japanese_clause(japanese_only)
    rows = await db.execute(
        text(f"""
            WITH bounds AS (SELECT max(date) AS latest FROM global_votes),
            firsts AS (
                SELECT user_hash, min(date) AS first_vote
                FROM global_votes
                WHERE date IS NOT NULL
                GROUP BY user_hash
            )
            SELECT date_trunc('week', gv.date)::date AS week,
                   count(*) AS votes,
                   count(DISTINCT gv.user_hash) AS readers,
                   count(DISTINCT gv.user_hash) FILTER (
                       WHERE date_trunc('week', f.first_vote) = date_trunc('week', gv.date)
                   ) AS new_readers
            FROM global_votes gv
            CROSS JOIN bounds b
            JOIN firsts f ON f.user_hash = gv.user_hash
            {lang_join}
            WHERE gv.date > b.latest - CAST(:days AS integer)
              AND gv.date <= b.latest
              {lang_where}
            GROUP BY date_trunc('week', gv.date)
            ORDER BY week
        """),
        {"days": (weeks + 2) * 7},
    )

    pulse = [
        {
            "week": row.week.isoformat(),
            "votes": row.votes,
            "readers": row.readers,
            "new_readers": row.new_readers,
        }
        for row in rows
    ]
    # Neither end of the window lands on a week boundary: the dump arrives mid-week, and
    # the far end is a fixed number of days back from it. Both outer buckets therefore hold
    # part of a week and would read as a collapse against the full weeks between them, which
    # is also what the period's own growth figure would be measured from. The window is
    # widened by a week at each end so that dropping them still leaves the number asked for.
    return pulse[1:-1][-weeks:]


async def load_hot_now(
    db, days: int, mover_floor: int, depth: int, japanese_only: bool = True
) -> dict:
    """What the community is reading right now, against what it was reading before.

    Two lenses over the same window. The first is the plain count, which answers what is
    being read; on its own it barely moves, because the same handful of titles hold the top
    every week. The second is each title's window against its own previous one, which is
    where a release, a translation or a burst of attention actually shows up.

    Rank in both windows is carried rather than just the counts. A title going from 166th to
    33rd is the readable form of the same fact, and it is the form a reader checking back
    weekly is looking for.

    Reads only twice the window rather than the whole vote table, so this is cheap enough to
    run per period.
    """
    lang_join, lang_where = japanese_clause(japanese_only)
    rows = await db.execute(
        text(f"""
            WITH bounds AS (SELECT max(date) AS latest FROM global_votes),
            windows AS (
                SELECT gv.vn_id,
                       count(*) FILTER (
                           WHERE gv.date > b.latest - CAST(:days AS integer)
                       ) AS current_votes,
                       count(*) FILTER (
                           WHERE gv.date > b.latest - CAST(:double AS integer)
                             AND gv.date <= b.latest - CAST(:days AS integer)
                       ) AS previous_votes
                FROM global_votes gv
                CROSS JOIN bounds b
                {lang_join}
                WHERE gv.date > b.latest - CAST(:double AS integer)
                {lang_where}
                GROUP BY gv.vn_id
            ),
            placed AS (
                SELECT vn_id, current_votes, previous_votes,
                       CASE WHEN current_votes > 0 THEN row_number() OVER (
                           ORDER BY current_votes DESC, vn_id
                       ) END AS current_place,
                       CASE WHEN previous_votes > 0 THEN row_number() OVER (
                           ORDER BY previous_votes DESC, vn_id
                       ) END AS previous_place,
                       -- Cast before the division. Postgres infers a bound parameter's type
                       -- from its context, so added to a count it becomes an integer and the
                       -- ratio silently truncates to whole numbers.
                       (current_votes::numeric + :prior)
                           / (previous_votes::numeric + :prior) AS lift
                FROM windows
            )
            SELECT vn_id, current_votes, previous_votes, current_place, previous_place, lift,
                   row_number() OVER (
                       ORDER BY CASE
                           WHEN current_votes >= :floor THEN lift ELSE -1
                       END DESC, vn_id
                   ) AS mover_place
            FROM placed
            WHERE current_place <= :depth
               OR (current_votes >= :floor AND lift > 1)
            ORDER BY current_place NULLS LAST
        """),
        {
            "days": days,
            "double": days * 2,
            "prior": HOT_PRIOR,
            "floor": mover_floor,
            "depth": depth,
        },
    )

    top: list[dict] = []
    movers: list[dict] = []
    for row in rows:
        entry = {
            "vn_id": row.vn_id,
            "current": row.current_votes,
            "previous": row.previous_votes,
            "place": row.current_place,
            "previous_place": row.previous_place,
            "lift": float(row.lift),
        }
        if row.current_place is not None and row.current_place <= depth:
            top.append(entry)
        if row.mover_place is not None and row.mover_place <= depth:
            movers.append(entry)

    top.sort(key=lambda e: e["place"])
    movers.sort(key=lambda e: -e["lift"])
    return {"top": top, "movers": movers[:depth]}


async def load_period_totals(db, days: int, japanese_only: bool = True) -> tuple[int, int]:
    """Votes cast in the window and in the window before it."""
    lang_join, lang_where = japanese_clause(japanese_only)
    row = (
        await db.execute(
            text(f"""
                WITH bounds AS (SELECT max(date) AS latest FROM global_votes)
                SELECT count(*) FILTER (WHERE gv.date > b.latest - CAST(:days AS integer)) AS current_votes,
                       count(*) FILTER (
                           WHERE gv.date > b.latest - CAST(:double AS integer)
                             AND gv.date <= b.latest - CAST(:days AS integer)
                       ) AS previous_votes
                FROM global_votes gv
                CROSS JOIN bounds b
                {lang_join}
                WHERE gv.date > b.latest - CAST(:double AS integer)
                {lang_where}
            """),
            {"days": days, "double": days * 2},
        )
    ).one()
    return row.current_votes, row.previous_votes


async def load_month_explorer(
    db, first_year: int, depth: int, japanese_only: bool = True
) -> dict[str, tuple]:
    """Month by month: what was read most, and what was read far more than usual.

    Two lenses because the raw count alone is close to a constant. The same handful of
    perennial titles head almost every month, which is true and worth showing once, but it
    buries the thing a reader is actually looking for: the month a title suddenly mattered.

    The second lens measures each title against its own normal rate rather than against other
    titles. A month's expected share of a title's votes is its lifetime total scaled by how
    much of all voting happened that month, so a title that collects votes steadily sits at
    one however popular it is, and only an actual spike rises.

    Grouped in the database rather than from the vote histories already in memory, which is
    the opposite of the choice the yearly figures make. The cell counts here are per month
    rather than per year, so building them in Python would hold an order of magnitude more
    intermediate state at the job's peak; the query trades that for a transient sort in
    Postgres and returns only the few rows per month that are kept.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    lang_filter = "AND is_ja" if japanese_only else ""
    rows = await db.execute(
        text(f"""
            WITH cell AS (
                SELECT month, vn_id, votes
                FROM vote_cells
                WHERE extract(year FROM month) >= :first_year
                  {lang_filter}
            ),
            grand AS (SELECT sum(votes) AS votes FROM cell),
            per_month AS (SELECT month, sum(votes) AS votes FROM cell GROUP BY month),
            per_title AS (SELECT vn_id, sum(votes) AS votes FROM cell GROUP BY vn_id),
            scored AS (
                SELECT c.month,
                       c.vn_id,
                       c.votes,
                       pt.votes * (pm.votes / (SELECT votes FROM grand)) AS expected
                FROM cell c
                JOIN per_month pm ON pm.month = c.month
                JOIN per_title pt ON pt.vn_id = c.vn_id
            ),
            ranked AS (
                SELECT month, vn_id, votes, expected,
                       (votes + :prior) / (expected + :prior) AS jump,
                       row_number() OVER (
                           PARTITION BY month ORDER BY votes DESC, vn_id
                       ) AS read_place,
                       row_number() OVER (
                           PARTITION BY month
                           ORDER BY CASE
                               WHEN votes >= :min_votes
                               THEN (votes + :prior) / (expected + :prior)
                               ELSE -1
                           END DESC, vn_id
                       ) AS jump_place
                FROM scored
            )
            SELECT to_char(month, 'YYYY-MM') AS month, vn_id, votes, jump,
                   read_place, jump_place
            FROM ranked
            WHERE (read_place <= :depth OR jump_place <= :depth)
              AND votes >= 1
            ORDER BY month
        """),
        {
            "first_year": first_year,
            "depth": depth,
            "prior": JUMP_PRIOR,
            "min_votes": MIN_VOTES_FOR_JUMP,
        },
    )

    months: dict[str, tuple] = {}
    for row in rows:
        read, jumped = months.setdefault(row.month, ([], []))
        if row.read_place <= depth:
            read.append((row.read_place, row.vn_id, int(row.votes)))
        # The floor is applied by the ordering above, so a month with nothing above it still
        # fills its places; those rows are dropped here rather than shown as a non-jump.
        if row.jump_place <= depth and int(row.votes) >= MIN_VOTES_FOR_JUMP:
            jumped.append((row.jump_place, row.vn_id, float(row.jump)))

    for read, jumped in months.values():
        read.sort()
        jumped.sort()
    return months


def best_by_release_year(
    bucket: Bucket,
    vn_facts: dict,
    first_year: int,
    depth: int,
    min_votes: int,
    japanese_only: bool = True,
) -> dict[int, list[tuple]]:
    """The best-rated titles first released in each year.

    Damped the same way the rating boards are, so a title with thirty votes and a perfect
    average does not head a year ahead of one with three thousand.
    """
    prior = global_mean_vote(bucket)
    scored: dict[int, list[tuple]] = {}

    for vn_id, facts in vn_facts.items():
        if facts.year is None or facts.year < first_year:
            continue
        if japanese_only and facts.olang != LANGUAGE_JAPANESE:
            continue
        counters = bucket.vns.get(vn_id)
        if counters is None or counters.matched < min_votes:
            continue
        score = bayesian_average(counters.matched_total, counters.matched, prior)
        scored.setdefault(facts.year, []).append((vn_id, score, counters.matched))

    return {
        year: sorted(titles, key=lambda row: (-row[1], row[0]))[:depth]
        for year, titles in scored.items()
    }


async def load_terminal_votes(db) -> dict[str, tuple]:
    """For each title, how often it was the last thing a reader logged before going quiet.

    Two guards carry this measurement. A reader counts as gone only after a year of silence,
    since the record simply stops at the dump and everyone's most recent vote would otherwise
    look like their last. Expected counts come from the quarter each vote was cast in,
    because the chance of a vote turning out to be someone's last rises steadily across the
    record, and comparing a 2012 vote with a 2024 one without that correction ranks nothing
    but recency.

    Days holding more than one vote are skipped: when someone logs six titles and stops,
    there is no last thing they read, only a last thing they typed.
    """
    await db.execute(text(f"SET LOCAL work_mem = '{AGGREGATION_WORK_MEM}'"))

    rows = await db.execute(text(f"""
        WITH bounds AS (SELECT max(date) AS last_day FROM global_votes),
        quiet AS (
            SELECT user_hash, max(date) AS final_day
            FROM global_votes
            WHERE date IS NOT NULL
            GROUP BY user_hash
            HAVING count(*) >= {MIN_VOTES_FOR_TERMINAL}
               AND max(date) <= (SELECT last_day FROM bounds)
                                 - INTERVAL '{TERMINAL_SILENCE_DAYS} days'
        ),
        terminal AS (
            SELECT gv.vn_id, gv.user_hash, gv.date
            FROM global_votes gv
            JOIN quiet q ON q.user_hash = gv.user_hash AND q.final_day = gv.date
            WHERE NOT EXISTS (
                SELECT 1 FROM global_votes other
                WHERE other.user_hash = gv.user_hash
                  AND other.date = gv.date
                  AND other.vn_id <> gv.vn_id
            )
        ),
        per_quarter AS (
            SELECT date_trunc('quarter', gv.date) AS quarter,
                   count(*)::numeric AS votes,
                   count(*) FILTER (WHERE t.vn_id IS NOT NULL)::numeric AS stops
            FROM global_votes gv
            JOIN quiet q ON q.user_hash = gv.user_hash
            LEFT JOIN terminal t
                   ON t.user_hash = gv.user_hash AND t.vn_id = gv.vn_id
            GROUP BY date_trunc('quarter', gv.date)
        ),
        rate AS (
            SELECT quarter, stops / votes AS chance FROM per_quarter WHERE votes > 0
        ),
        exposure AS (
            SELECT gv.vn_id, count(*) AS raters, sum(r.chance) AS expected
            FROM global_votes gv
            JOIN quiet q ON q.user_hash = gv.user_hash
            JOIN rate r ON r.quarter = date_trunc('quarter', gv.date)
            GROUP BY gv.vn_id
        ),
        observed AS (SELECT vn_id, count(*) AS stops FROM terminal GROUP BY vn_id)
        SELECT e.vn_id, e.raters, o.stops, e.expected
        FROM exposure e
        JOIN observed o ON o.vn_id = e.vn_id
        JOIN visual_novels v ON v.id = e.vn_id
        WHERE e.raters >= {MIN_RATERS_FOR_TERMINAL}
          AND o.stops >= {MIN_TERMINAL_OBSERVED}
          AND v.released <= (SELECT last_day FROM bounds)
                             - INTERVAL '{TERMINAL_MATURITY_DAYS} days'
    """))

    return {
        row.vn_id: (row.raters, row.stops, float(row.expected or 0.0)) for row in rows
    }


#: Relation types that make two titles part of the same franchise.
#:
#: `char` and `set` are excluded deliberately. They mean "shares characters" and "same
#: setting", which are far looser: including them merges otherwise unrelated works through
#: long chains, producing components several times the size of anything a reader would call
#: a franchise.
FRANCHISE_RELATIONS = ("seq", "preq", "ser", "side", "par", "fan", "orig", "alt")

#: The subset meaning "this continues that", used where the question is how long a franchise
#: has been running. The looser types above connect works without implying succession, and
#: one such edge is enough to hand a franchise a first entry from decades before it started.
CONTINUATION_RELATIONS = ("seq", "preq", "ser")

#: Namespaces component ids built on the narrower relation set, so they cannot be mistaken
#: for the wider grouping's.
STRICT_SERIES_PREFIX = "c:"

#: A single title is not a series.
MIN_SERIES_SIZE = 2


async def load_series(
    db,
    vn_facts: dict,
    relations: tuple[str, ...] = FRANCHISE_RELATIONS,
    key_prefix: str = "",
) -> tuple[dict[str, list[str]], dict[str, tuple]]:
    """Group visual novels into franchises by connected components over their relations.

    VNDB has no series table, so a franchise has to be inferred from the relation graph.
    Titles are unioned across the franchise relation types and each connected component
    becomes one series.

    Returns the component membership plus a display lookup of (representative id, size). The
    component is keyed by its lexicographically smallest member id so the key is stable
    between runs, while the representative is its most-voted member, which is the name people
    would recognise the franchise by.
    """
    result = await db.execute(
        select(VNRelation.vn_id, VNRelation.related_vn_id)
        .where(VNRelation.official.is_(True))
        .where(VNRelation.relation.in_(relations))
    )

    parent: dict[str, str] = {}

    def find(node: str) -> str:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]  # path halving keeps this near-flat
            node = parent[node]
        return node

    def union(a: str, b: str) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_a] = root_b

    for vn_id, related_id in result:
        union(vn_id, related_id)

    components: dict[str, list[str]] = {}
    for node in list(parent):
        components.setdefault(find(node), []).append(node)

    series: dict[str, list[str]] = {}
    labels: dict[str, tuple] = {}

    for members in components.values():
        if len(members) < MIN_SERIES_SIZE:
            continue

        members = sorted(members)
        # Keyed by lowest id for stability; named after the entry that started it. The prefix
        # keeps two groupings of the same titles apart: a component built on the narrower
        # relation set is a subset of the wider one and usually shares its lowest id, so
        # without it the two would collide and one label would silently describe the other.
        key = f"{key_prefix}{members[0]}"

        def started_first(vn_id: str) -> tuple:
            # Undated entries sort behind every dated one rather than winning by default,
            # and the id breaks ties so the same run always picks the same name.
            facts = vn_facts.get(vn_id)
            ordinal = facts.released_ordinal if facts is not None else None
            return (ordinal is None, ordinal or 0, vn_id)

        # The first release rather than the most voted one. A franchise is named after where
        # it began: the best-known entry is usually a later peak, so naming a line after it
        # reads as though the sequel were the series.
        representative = min(members, key=started_first)
        series[key] = members
        labels[key] = (representative, len(members))

    return series, labels



def series_spans(series: dict[str, list[str]], vn_facts: dict) -> dict[str, tuple]:
    """Years between each franchise's first and most recent entry.

    Measured from release dates rather than entry counts, so a line that shipped twice
    across thirty years outranks one that shipped ten times in three.
    """
    spans: dict[str, tuple] = {}

    for key, members in series.items():
        dated = [
            facts
            for facts in (vn_facts.get(vn_id) for vn_id in members)
            if facts is not None
            and facts.released_ordinal is not None
            and facts.votecount >= MIN_VOTES_PER_SERIES_ENTRY
        ]
        if len(dated) < 2:
            continue

        first = min(dated, key=lambda f: f.released_ordinal)
        latest = max(dated, key=lambda f: f.released_ordinal)
        span = (latest.released_ordinal - first.released_ordinal) / 365.25
        spans[key] = (
            len(dated),
            first.year,
            latest.year,
            span,
            sum(f.votecount for f in dated),
        )

    return spans


async def load_tag_titles(db, exclude_categories: tuple[str, ...] = ()) -> dict[str, list[str]]:
    """Every tag, with the titles it is directly applied to.

    Directly applied, not expanded down the tag tree. The tree expansion used elsewhere
    resolves one named tag to everything beneath it, which is right when a reader asks for
    "fantasy" and wrong here: a board ranking tags against each other would count the same
    title once under a narrow tag and again under every parent above it, and the broad tags
    would then be scored on a population that is mostly other tags.

    The quality filters match the tag pages: a positive score, no spoiler, and not flagged
    as inaccurate. A tag someone applied and the community voted down is not a tag the title
    carries.
    """
    statement = (
        select(VNTag.tag_id, VNTag.vn_id)
        .where(VNTag.score > 0)
        .where(VNTag.spoiler_level == 0)
        .where(VNTag.lie.is_(False))
        .execution_options(yield_per=50_000)
    )

    if exclude_categories:
        statement = statement.where(
            VNTag.tag_id.notin_(
                select(Tag.id).where(Tag.category.in_(exclude_categories))
            )
        )

    # Appended straight to lists rather than collected into sets: vn_tags is unique on
    # (vn_id, tag_id), so there is nothing to deduplicate, and a set per tag across nearly a
    # million pairs costs several hundred megabytes on a box that has none to spare.
    # Interning the ids lets all of them share one string object per title.
    tagged: dict[str, list] = {}
    result = await db.stream(statement)
    async for partition in result.partitions(50_000):
        for tag_id, vn_id in partition:
            tagged.setdefault(str(tag_id), []).append(intern(vn_id))
    return tagged


async def load_tag_categories(db) -> dict[str, str]:
    """Each tag's VNDB category, keyed to match the tag-to-title mapping.

    A few thousand rows, which is what lets a board that excludes a category be derived from
    the full mapping rather than paying for its own scan of the tag table.
    """
    rows = await db.execute(select(Tag.id, Tag.category))
    return {str(tag_id): category for tag_id, category in rows}


async def load_tag_memberships(db, tag_ids: list[int]) -> dict[int, frozenset]:
    """Resolve each faceted tag to the set of visual novels carrying it.

    Tags form a tree, and a title tagged "High Fantasy" is a fantasy title. The tag pages
    already walk that tree, so a board that matched only directly-applied tags would report
    a fraction of what the tag page shows for the same tag: roughly a fifth, in the case of
    the broader genres. The same recursive expansion is applied here.

    Only the tags some board actually facets on are loaded. Reading all of vn_tags would be
    941K rows for information no board asks for. The score, spoiler and accuracy filters
    mirror the tag pages for the same reason.
    """
    if not tag_ids:
        return {}

    descendants: dict[int, set[int]] = {}
    for tag_id in tag_ids:
        rows = await db.execute(
            text("""
                WITH RECURSIVE tag_tree AS (
                    SELECT id FROM tags WHERE id = :tag_id
                    UNION ALL
                    SELECT tp.tag_id AS id
                    FROM tag_parents tp
                    JOIN tag_tree tt ON tp.parent_id = tt.id
                )
                SELECT DISTINCT id FROM tag_tree
            """),
            {"tag_id": tag_id},
        )
        descendants[tag_id] = {row.id for row in rows}

    every_descendant = sorted({t for group in descendants.values() for t in group})
    result = await db.execute(
        select(VNTag.tag_id, VNTag.vn_id)
        .where(VNTag.tag_id.in_(every_descendant))
        .where(VNTag.score > 0)
        .where(VNTag.spoiler_level == 0)
        .where(VNTag.lie.is_(False))
    )

    by_descendant: dict[int, set] = {}
    for tag_id, vn_id in result:
        by_descendant.setdefault(tag_id, set()).add(vn_id)

    members: dict[int, set] = {}
    for tag_id, group in descendants.items():
        covered: set = set()
        for descendant in group:
            covered |= by_descendant.get(descendant, set())
        if covered:
            members[tag_id] = covered

    # A tag id that resolves to nothing means the registry points at a tag VNDB has since
    # merged or removed. The board would still build, and would rank nothing, looking
    # merely unpopular rather than broken.
    for tag_id in tag_ids:
        if tag_id not in members:
            logger.warning(
                f"Featured tag g{tag_id} matched no visual novels; its board will be empty"
            )

    return {tag_id: frozenset(vns) for tag_id, vns in members.items()}


# ---------------------------------------------------------------- hydration


class VNDisplay(NamedTuple):
    """Everything a row needs to render a visual novel."""

    title: str
    title_romaji: str | None
    title_jp: str | None
    image_url: str | None
    image_sexual: float | None


class NameDisplay(NamedTuple):
    """A person or company's name in both forms.

    VNDB stores the Japanese form as `name` and the Latin form as `original`, which reads
    backwards but is what the columns hold.
    """

    name: str
    original: str | None


class Hydrator:
    """Turns subject keys into display rows.

    Lookups are loaded in bulk once per run rather than per board, since the same handful
    of popular titles and prolific studios appear across many boards.
    """

    def __init__(
        self,
        usernames: dict,
        vns: dict,
        producers: dict,
        staff: dict,
        series: dict | None = None,
        tags: dict | None = None,
    ):
        self.usernames = usernames
        self.vns = vns
        self.producers = producers
        self.staff = staff
        self.series = series or {}
        self.tags = tags or {}

    def row(self, spec: BoardSpec, rank: int, entry: RankedEntry) -> LeaderboardRow | None:
        if spec.subject is Subject.USER:
            return self._user_row(spec, rank, entry)
        if spec.subject is Subject.VN:
            return self._vn_row(spec, rank, entry)
        if spec.subject in (Subject.STAFF, Subject.SEIYUU):
            return self._staff_row(spec, rank, entry)
        if spec.subject is Subject.SERIES:
            return self._series_row(spec, rank, entry)
        if spec.subject is Subject.TAG:
            return self._tag_row(spec, rank, entry)
        return self._producer_row(spec, rank, entry)

    def _tag_row(self, spec, rank, entry):
        name = self.tags.get(entry.key)
        if name is None:
            return None
        return LeaderboardRow(
            rank=rank,
            id=entry.key,
            label=name,
            href=f"/stats/tag/{entry.key}",
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary=entry.secondary,
        )

    def _series_row(self, spec, rank, entry):
        label = self.series.get(entry.key)
        if label is None:
            return None
        representative, size = label
        vn = self.vns.get(representative)
        if vn is None:
            return None
        return LeaderboardRow(
            rank=rank,
            id=entry.key,
            label=vn.title,
            title_romaji=vn.title_romaji,
            title_jp=vn.title_jp,
            # A franchise has no page of its own, so it is identified by the entry it began
            # with, and the count makes clear the score covers more than that one title.
            sublabel=f"{size} titles",
            href=f"/vn/{representative.lstrip('v')}",
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
            image_vn_id=representative,
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary={**entry.secondary, "titles": size},
        )

    def _staff_row(self, spec, rank, entry):
        person = self.staff.get(entry.key)
        if person is None:
            return None
        # Seiyuu have their own pages; other credited staff use the staff pages.
        section = "seiyuu" if spec.subject is Subject.SEIYUU else "staff"
        return LeaderboardRow(
            rank=rank,
            id=entry.key,
            label=person.name,
            name_original=person.original,
            href=f"/stats/{section}/{entry.key}",
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary=entry.secondary,
        )

    def _user_row(self, spec, rank, entry):
        # Vote-derived boards key on the bare numeric id; list-derived boards key on the
        # prefixed uid. Normalise here so both render the same links.
        uid = entry.key if entry.key.startswith("u") else f"u{entry.key}"
        username = self.usernames.get(uid)
        if username is None:
            # A voter with no row in the users dump cannot be linked or named, and a board
            # row reading "unknown" helps nobody.
            return None
        return LeaderboardRow(
            rank=rank,
            id=uid,
            label=username,
            href=f"/stats/{uid}",
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary=entry.secondary,
        )

    def _vn_row(self, spec, rank, entry):
        vn = self.vns.get(entry.key)
        if vn is None:
            return None
        return LeaderboardRow(
            rank=rank,
            id=entry.key,
            label=vn.title,
            title_romaji=vn.title_romaji,
            title_jp=vn.title_jp,
            href=f"/vn/{entry.key.lstrip('v')}",
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
            image_vn_id=entry.key,
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary=entry.secondary,
        )

    def _producer_row(self, spec, rank, entry):
        producer = self.producers.get(entry.key)
        if producer is None:
            return None
        return LeaderboardRow(
            rank=rank,
            id=entry.key,
            label=producer.name,
            name_original=producer.original,
            href=f"/stats/producer/{entry.key}",
            value=round(entry.value, 4),
            value_label=format_value(spec.metric, entry.value, entry.count, entry.secondary),
            secondary=entry.secondary,
        )


async def load_lookups(db, series_labels: dict | None = None) -> Hydrator:
    usernames = dict(
        (row.uid, row.username)
        for row in await db.execute(select(VndbUser.uid, VndbUser.username))
    )

    vns = {}
    for row in await db.execute(
        select(
            VisualNovel.id,
            VisualNovel.title,
            VisualNovel.title_romaji,
            VisualNovel.title_jp,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
        )
    ):
        vns[row.id] = VNDisplay(
            row.title, row.title_romaji, row.title_jp, row.image_url, row.image_sexual
        )

    producers = {}
    for row in await db.execute(select(Producer.id, Producer.name, Producer.original)):
        producers[row.id] = NameDisplay(row.name, row.original)

    staff = {}
    for row in await db.execute(select(Staff.id, Staff.name, Staff.original)):
        staff[row.id] = NameDisplay(row.name, row.original)

    tags = {}
    for row in await db.execute(select(Tag.id, Tag.name)):
        tags[str(row.id)] = row.name

    return Hydrator(usernames, vns, producers, staff, series_labels, tags)


# ---------------------------------------------------------------- orchestration


def supports_language_variants(spec: BoardSpec) -> bool:
    """Whether a Japanese-only view of this board is meaningful.

    Only boards ranking visual novels, and only where the facet does not already pin an
    original language: offering a Japanese toggle on a board that is Japanese by definition
    would imply a choice that does not exist.
    """
    return spec.subject is Subject.VN and spec.facet.olang is None


def filter_entries_to_language(
    entries: list[RankedEntry],
    japanese_vn_ids: set,
) -> list[RankedEntry]:
    """Keep only the Japanese-original titles, preserving order.

    Filtering after ranking rather than faceting before it is deliberate, and gives the same
    per-title scores: each visual novel's counters are independent of which others are in
    the bucket. The one thing it does change is the Bayesian prior, which stays the mean
    across every title rather than the Japanese subset, so a score does not move when the
    toggle does.
    """
    return [entry for entry in entries if entry.key in japanese_vn_ids]


def build_response(
    spec: BoardSpec,
    entries: list[RankedEntry],
    hydrator: Hydrator,
    generated_at: datetime,
    dump_date: date,
    language: str = LANGUAGE_ALL,
) -> LeaderboardResponse:
    rows: list[LeaderboardRow] = []
    rank = 0
    for entry in entries:
        if len(rows) >= ROWS_PER_BOARD:
            break
        rank += 1
        row = hydrator.row(spec, rank, entry)
        if row is None:
            rank -= 1  # keep ranks contiguous when a subject cannot be rendered
            continue
        rows.append(row)

    return LeaderboardResponse(
        slug=spec.slug,
        title=spec.title,
        blurb=spec.blurb,
        subject=spec.subject.value,
        metric=spec.metric.value,
        window=spec.window.value,
        home=spec.home.value,
        # Explicit identity checks, not truthiness: `0 == False` in Python, so a numeric
        # bound of zero would be dropped by a `not in (None, False)` test.
        facet={
            field.name: getattr(spec.facet, field.name)
            for field in dataclass_fields(spec.facet)
            if getattr(spec.facet, field.name) is not None
            and getattr(spec.facet, field.name) is not False
        },
        facet_description=describe(spec.facet),
        language=language,
        has_language_variants=supports_language_variants(spec),
        generated_at=generated_at,
        dump_date=dump_date,
        total_ranked=len(entries),
        rows=rows,
        disclosure=(
            {
                "population": spec.disclosure.population,
                "floor": spec.disclosure.floor,
                "score": spec.disclosure.score,
                "excluded": spec.disclosure.excluded,
            }
            if spec.disclosure
            else None
        ),
        attribution=(
            {"label": spec.attribution[0], "href": spec.attribution[1]}
            if spec.attribution
            else None
        ),
        notes=list(spec.notes),
    )


async def refresh_leaderboards(dry_run: bool = False) -> dict:
    """Rebuild every catalogue board. Entry point for the daily worker."""
    # Imported here rather than at module scope so the pure helpers above stay importable
    # without a Redis client present.
    from app.core.cache import get_cache

    started = time.time()
    generated_at = datetime.now(timezone.utc)
    stats = {"boards": 0, "votes_processed": 0, "skipped": [], "unwritten": []}

    async with async_session() as db:
        timings = {}

        mark = time.time()
        vn_facts = await load_vn_facts(db)
        dump_date = await latest_vote_date(db)
        timings["load_vns"] = time.time() - mark
        logger.info(f"Loaded {len(vn_facts):,} VNs; latest vote {dump_date}")

        mark = time.time()
        buckets = build_buckets(BOARDS)
        faceted_tags = sorted(
            {b.facet.tag for b in BOARDS if b.facet.tag is not None}
        )
        tag_members = await load_tag_memberships(db, faceted_tags)
        plan = prepare_plan(buckets, vn_facts, dump_date, tag_members)
        activity = VoteActivity()
        stats["votes_processed"] = await walk_votes(db, vn_facts, plan, activity)
        timings["votes"] = time.time() - mark
        logger.info(
            f"Walked {stats['votes_processed']:,} votes into {len(buckets)} buckets "
            f"in {timings['votes']:.1f}s"
        )

        mark = time.time()
        labels_by_vn, labels_by_user = await load_label_counts(db)
        timings["labels"] = time.time() - mark
        logger.info(
            f"Loaded list labels for {len(labels_by_vn):,} VNs and "
            f"{len(labels_by_user):,} users in {timings['labels']:.1f}s"
        )

        mark = time.time()
        developed, published = await load_producer_vns(db)
        series, series_labels = await load_series(db, vn_facts)
        # Built only if a board asks for it, and once however many do.
        strict_series: dict[str, list[str]] | None = None
        tag_titles: dict[str, list[str]] | None = None
        tag_categories: dict[str, str] = {}

        # Keyed by credit key rather than by subject: two staff boards over different roles
        # need different mappings, and one blended mapping is what let testers outrank
        # writers on the board this replaced.
        credits = {}
        for spec in BOARDS:
            if spec.credit_key in credits:
                continue
            if spec.subject in (Subject.DEVELOPER, Subject.PUBLISHER):
                if spec.producer_types:
                    made, sold = await load_producer_vns(db, spec.producer_types)
                else:
                    made, sold = developed, published
                credits[spec.credit_key] = (
                    made if spec.subject is Subject.DEVELOPER else sold
                )
            elif spec.subject is Subject.SERIES:
                if spec.strict_series:
                    if strict_series is None:
                        strict_series, strict_labels = await load_series(
                            db, vn_facts, CONTINUATION_RELATIONS, STRICT_SERIES_PREFIX
                        )
                        series_labels.update(strict_labels)
                    credits[spec.credit_key] = strict_series
                else:
                    credits[spec.credit_key] = series
            elif spec.subject is Subject.STAFF:
                credits[spec.credit_key] = await load_credited_vns(
                    db, VNStaff, VNStaff.staff_id, spec.credit_roles
                )
            elif spec.subject is Subject.SEIYUU:
                credits[spec.credit_key] = await load_seiyuu_vns(db, spec.character_roles)
            elif spec.subject is Subject.TAG:
                # Loaded once and narrowed in memory. Every tag board wants the same
                # title mapping; the ones excluding a category differ only by which keys
                # they keep, which is not worth a second pass over a million tag rows.
                if tag_titles is None:
                    tag_titles = await load_tag_titles(db)
                    tag_categories = await load_tag_categories(db)
                if spec.excluded_tag_categories:
                    excluded = set(spec.excluded_tag_categories)
                    credits[spec.credit_key] = {
                        tag_id: vn_ids
                        for tag_id, vn_ids in tag_titles.items()
                        if tag_categories.get(tag_id) not in excluded
                    }
                else:
                    credits[spec.credit_key] = tag_titles
        hydrator = await load_lookups(db, series_labels)
        timings["lookups"] = time.time() - mark
        logger.info(f"Grouped {len(series):,} series from the relation graph")

        studio_activity = await load_studio_activity(db, COMMERCIAL_ONLY)

        # Two grouped scans rather than part of the streaming accumulation: both need every
        # title's community figures before any reader can be placed against them.
        mark = time.time()
        bias_scan = await load_reader_scan(db)
        obscurity_scan = await load_reader_obscurity(db)
        response_scan = await load_reader_response(db)
        steadiness_scan = await load_reader_steadiness(db)
        reader_scans = {
            Metric.VOTE_BIAS: bias_scan,
            Metric.VOTE_DIVERGENCE: bias_scan,
            Metric.OBSCURITY: obscurity_scan,
            Metric.ERA: obscurity_scan,
            Metric.ERA_WINDOW: obscurity_scan,
            # No board reads this one. It exists so the figure on a reader's own page, which
            # counts every language, has a distribution of the same shape to sit in.
            _OBSCURITY_ALL_LANGUAGES: await load_reader_obscurity(db, japanese_only=False),
            Metric.VOTE_RESPONSE: response_scan,
            Metric.STEADINESS: steadiness_scan,
        }
        terminal_votes = await load_terminal_votes(db)
        compositions = await load_reader_composition(db)
        await load_reader_devotion(db, compositions)
        # Built here if no board has already asked for it, rather than falling back to the
        # wider grouping: these two boards are about working through a series, and the wider
        # set joins titles that merely share a setting.
        if strict_series is None:
            strict_series, strict_labels = await load_series(
                db, vn_facts, CONTINUATION_RELATIONS, STRICT_SERIES_PREFIX
            )
            series_labels.update(strict_labels)
        await load_reader_franchise(db, strict_series, compositions)
        await load_reader_drift(db, compositions)
        await load_reader_themes(db, compositions)
        backlogs = await load_backlog_gap(db)
        logger.info(f"Backlog gap computed for {len(backlogs):,} readers")
        # Both explorers, in both language views, read from this one aggregate.
        cells = await prepare_vote_cells(db)
        logger.info(f"Collapsed the vote table to {cells:,} title-months")
        anticipated = await load_anticipated(db, FEED_DEPTH)

        trend_views: dict[str, dict] = {}
        for language in (LANGUAGE_JAPANESE, LANGUAGE_ALL):
            japanese_only = language == LANGUAGE_JAPANESE
            feed = {
                "shifting": await load_reception_shift(db, FEED_DEPTH, japanese_only),
                "new_releases": await load_new_releases(db, FEED_DEPTH, japanese_only),
                "finishing": await load_being_finished(db, FEED_DEPTH, japanese_only),
                # Already restricted to Japanese titles with a Japanese release ahead, so
                # there is no wider view of it to offer, and one build serves both.
                "anticipated": anticipated,
                "pulse": await load_community_pulse(db, PULSE_WEEKS, japanese_only),
            }
            periods = []
            for key, days, floor in HOT_PERIODS:
                lists = await load_hot_now(db, days, floor, HOT_DEPTH, japanese_only)
                votes, previous_votes = await load_period_totals(db, days, japanese_only)
                periods.append({
                    "key": key,
                    "days": days,
                    "votes": votes,
                    "previous_votes": previous_votes,
                    **lists,
                })
            trend_views[language] = {
                "feed": feed,
                "hot": periods,
                "by_year": await load_votes_by_year(
                    db, EXPLORER_FIRST_YEAR, EXPLORER_DEPTH, japanese_only
                ),
                "by_month": await load_month_explorer(
                    db, EXPLORER_FIRST_MONTH_YEAR, MONTH_EXPLORER_DEPTH, japanese_only
                ),
                "japanese_only": japanese_only,
            }
        timings["reader_scan"] = time.time() - mark
        logger.info(
            f"Scanned {len(reader_scans[Metric.VOTE_BIAS]):,} readers against the community "
            f"in {timings['reader_scan']:.1f}s"
        )

    # A session of its own: the block above holds one transaction for the whole of its work
    # with a raised work_mem, and committing inside it would reset that for the reads that
    # follow. These writes are also the one part of this job that must not be rolled back by
    # a later failure, since browse reads the columns directly.
    if not dry_run:
        mark = time.time()
        records = collect_vn_aggregates(vn_facts.keys(), buckets, labels_by_vn)
        async with async_session() as db:
            stats["vn_aggregates"] = await persist_vn_aggregates(db, records)
            # The rate every label board damped toward, recorded so a browse sort on the
            # same metric can damp toward it too instead of deriving its own.
            await persist_rate_prior(db, global_rates(labels_by_vn))
        timings["persist"] = time.time() - mark
        logger.info(
            f"Persisted aggregates for {stats['vn_aggregates']:,} titles "
            f"in {timings['persist']:.1f}s"
        )

        # Browse sorts on the columns just written and caches its results for an hour. The
        # import flushes that cache before this job starts, so anything cached while the job
        # was running would otherwise serve the previous day's ordering well past the point
        # where the matching board had moved on.
        stats["browse_cache_flushed"] = await get_cache().flush_pattern("browse:*")

    japanese_vn_ids = {
        vn_id for vn_id, facts in vn_facts.items() if facts.olang == LANGUAGE_JAPANESE
    }
    logger.info(f"{len(japanese_vn_ids):,} VNs are Japanese-original")

    context = {
        "vn_facts": vn_facts,
        "studio_activity": studio_activity,
        "dump_year": dump_date.year,
        "terminal_votes": terminal_votes,
        "labels_by_vn": labels_by_vn,
        "buckets": buckets,
        "compositions": compositions,
        "backlogs": backlogs,
    }

    cache = get_cache()
    catalogue: list[CatalogueEntry] = []

    for spec in BOARDS:
        try:
            entries = _rank(
                spec, buckets, labels_by_vn, labels_by_user, credits,
                reader_scans, context,
            )
        except Exception as exc:
            # One malformed board must not cost every other board its nightly refresh.
            logger.exception(f"Leaderboard {spec.slug} failed: {exc}")
            stats["skipped"].append(spec.slug)
            continue

        response = build_response(spec, entries, hydrator, generated_at, dump_date)

        catalogue.append(
            CatalogueEntry(
                slug=spec.slug,
                title=spec.title,
                blurb=spec.blurb,
                subject=spec.subject.value,
                metric=spec.metric.value,
                window=spec.window.value,
                home=spec.home.value,
                composition=spec.composition,
                facet_description=describe(spec.facet),
                facet_kind=describe_kind(spec.facet),
                total_ranked=response.total_ranked,
                generated_at=generated_at,
            )
        )

        if dry_run:
            logger.info(f"  {spec.slug:32} {response.total_ranked:>8,} ranked")
            continue

        # Reader boards get a deeper index than the rows they display, so a reader outside
        # the visible rows can still be told where they placed.
        if spec.subject is Subject.USER:
            await cache.set(
                f"{RANK_INDEX_KEY_PREFIX}{spec.slug}",
                build_rank_index(entries),
                ttl=BOARD_TTL_SECONDS,
            )

        payload = response.model_dump(mode="json")
        # Counted on the write rather than on the computation. A board that was scored but
        # never stored is not a board anybody can read, and the cache reports a failed write
        # by returning False rather than by raising.
        if await cache.set(slug_cache_key(spec.slug), payload, ttl=BOARD_TTL_SECONDS):
            stats["boards"] += 1
        else:
            stats["unwritten"].append(spec.slug)
        await cache.set(
            board_cache_key(spec.subject, spec.metric, spec.facet, spec.window),
            payload,
            ttl=BOARD_TTL_SECONDS,
        )

        # Visual novel boards are also stored Japanese-only, which is what the site asks
        # for by default. Computed as a second ranking rather than filtered in the browser
        # because only the top hundred rows are stored: filtering those client-side would
        # leave a short list with gaps in its numbering.
        if supports_language_variants(spec):
            japanese = build_response(
                spec,
                filter_entries_to_language(entries, japanese_vn_ids),
                hydrator,
                generated_at,
                dump_date,
                language=LANGUAGE_JAPANESE,
            )
            await cache.set(
                slug_cache_key(spec.slug, LANGUAGE_JAPANESE),
                japanese.model_dump(mode="json"),
                ttl=BOARD_TTL_SECONDS,
            )

    sketches = build_percentile_sketches(buckets, labels_by_user, reader_scans)
    stats["sketches"] = {name: len(values) for name, values in sketches.items()}

    if not dry_run:
        for name, values in sketches.items():
            await cache.set(
                f"{PERCENTILE_KEY_PREFIX}{name}", values, ttl=BOARD_TTL_SECONDS
            )

        # Served by the global dashboard rather than as a board, but computed here because
        # this is the one place the whole vote table is already being read.
        await cache.set(
            VOTE_ACTIVITY_CACHE_KEY, activity.as_payload(), ttl=BOARD_TTL_SECONDS
        )

        # Same reasoning: the vote histories are already in memory with their dates.
        base_bucket = buckets[(Facet().canonical(), Window.ALL.value, False)]
        await cache.set(
            READING_TRENDS_CACHE_KEY,
            reading_trends(base_bucket.history, vn_facts, TRENDS_FIRST_YEAR),
            ttl=BOARD_TTL_SECONDS,
        )

        for language, view in trend_views.items():
            await cache.set(
                trends_key(TREND_FEED_CACHE_KEY, language),
                build_trend_feed(view["feed"], hydrator, dump_date),
                ttl=BOARD_TTL_SECONDS,
            )

            await cache.set(
                trends_key(HOT_NOW_CACHE_KEY, language),
                build_hot_now(view["hot"], hydrator, dump_date),
                ttl=BOARD_TTL_SECONDS,
            )

            await cache.set(
                trends_key(YEAR_EXPLORER_CACHE_KEY, language),
                build_year_explorer(
                    best_by_release_year(
                        base_bucket,
                        vn_facts,
                        EXPLORER_FIRST_YEAR,
                        EXPLORER_DEPTH,
                        MIN_VOTES_FOR_EXPLORER,
                        view["japanese_only"],
                    ),
                    view["by_year"],
                    hydrator,
                    dump_date.year,
                ),
                ttl=BOARD_TTL_SECONDS,
            )

            # One key per month, plus an index so the page can build its scrubber without
            # reading every payload.
            month_payloads = build_month_explorer(
                view["by_month"], hydrator, dump_date.strftime("%Y-%m")
            )
            prefix = trends_key(MONTH_EXPLORER_KEY_PREFIX.rstrip(":"), language) + ":"
            for month, payload in month_payloads.items():
                await cache.set(f"{prefix}{month}", payload, ttl=BOARD_TTL_SECONDS)
            await cache.set(
                trends_key(MONTH_EXPLORER_INDEX_KEY, language),
                {"months": sorted(month_payloads)},
                ttl=BOARD_TTL_SECONDS,
            )

        await cache.set(
            CATALOGUE_CACHE_KEY,
            CatalogueResponse(
                boards=catalogue, generated_at=generated_at, dump_date=dump_date
            ).model_dump(mode="json"),
            ttl=BOARD_TTL_SECONDS,
        )

    stats["elapsed_seconds"] = round(time.time() - started, 1)
    stats["timings"] = {k: round(v, 1) for k, v in timings.items()}
    # A board that was scored but never stored is not a board anybody can read, and the run
    # should say so loudly rather than reporting the number it computed.
    if stats["unwritten"]:
        logger.error(
            f"{len(stats['unwritten'])} boards were computed but not stored: "
            f"{', '.join(stats['unwritten'][:5])}"
        )
    logger.info(
        f"Leaderboards refreshed: {stats['boards']} boards stored in "
        f"{stats['elapsed_seconds']}s"
    )
    return stats


#: The columns written below. Both halves of the statement are generated from this, so the
#: assignment list and the change guard cannot fall out of step with each other.
AGGREGATE_COLUMNS = (
    "public_votes",
    "public_mean",
    "vote_stddev",
    "votes_30d",
    "votes_365d",
    "reputation_shift",
    "list_playing",
    "list_finished",
    "list_stalled",
    "list_dropped",
    "list_wishlist",
)


def collect_vn_aggregates(
    vn_ids,
    buckets: dict[tuple, Bucket],
    labels_by_vn: dict[str, LabelCounts],
) -> list[dict]:
    """Gather the per-title statistics to be written onto visual_novels.

    Read from the same counters the boards were built from, rather than recomputed. That is
    the whole point: a second implementation of divisiveness would eventually disagree with
    the first, and a reader sorting browse would then see a different number from the one on
    the matching board.

    A record is produced for every title passed in, not only those with votes. A title with
    no votes has zero of them, and recording that as unknown would push it into the same
    bucket as a title the job has never looked at.

    Counts are therefore never null. The two derived statistics are, because they are
    undefined below their sample floors, and a sort on them should leave such a title out of
    the ranking rather than place it at one end of it.
    """
    base = buckets[(Facet().canonical(), Window.ALL.value, False)]

    def windowed(window: Window) -> dict:
        bucket = buckets.get((Facet().canonical(), window.value, False))
        return bucket.vns if bucket else {}

    month = windowed(Window.MONTH)
    year = windowed(Window.YEAR)
    no_labels = LabelCounts()

    records = []
    for vn_id in vn_ids:
        counters = base.vns.get(vn_id)
        shift = reputation_shift(base.history.get(vn_id, ()))
        tally = labels_by_vn.get(vn_id, no_labels)
        in_month = month.get(vn_id)
        in_year = year.get(vn_id)

        records.append({
            "vn_id": vn_id,
            "public_votes": counters.matched if counters else 0,
            # The mean of the same votes the count above is over. Persisted because a
            # request-time ranking has to reach the number the boards used rather than a
            # second one derived from a column the importer maintains on its own schedule.
            "public_mean": (
                counters.matched_total / counters.matched / 10
                if counters and counters.matched
                else None
            ),
            # Stored at full precision rather than rounded for tidiness. Rounding collapses
            # values that differ in the sixth decimal into ties, and the tie-break then puts
            # browse in a different order from the board computing the same number.
            "vote_stddev": counters.stddev if counters and counters.matched >= 2 else None,
            "votes_30d": in_month.matched if in_month else 0,
            "votes_365d": in_year.matched if in_year else 0,
            "reputation_shift": shift[0] if shift else None,
            "list_playing": tally.playing,
            "list_finished": tally.finished,
            "list_stalled": tally.stalled,
            "list_dropped": tally.dropped,
            "list_wishlist": tally.wishlist,
        })

    return records


_PERSIST_STATEMENT = text(
    "UPDATE visual_novels SET "
    + ", ".join(f"{c} = :{c}" for c in AGGREGATE_COLUMNS)
    + " WHERE id = :vn_id AND ("
    + " OR ".join(f"{c} IS DISTINCT FROM :{c}" for c in AGGREGATE_COLUMNS)
    + ")"
)


async def persist_vn_aggregates(db, records: list[dict], batch_size: int = 5000) -> int:
    """Write the per-title statistics onto visual_novels.

    Batched UPDATE keyed on id, matching how the importer writes its other derived columns.
    These columns are absent from `_upsert_vns`'s set_ clause, so the nightly VN upsert
    leaves them alone.

    The change guard matters more here than it looks: two of these columns are indexed, and
    on most nights the great majority of titles have moved by nothing at all.

    Returns the number of records submitted, which is not the number of rows the guard let
    through: an executemany reports no usable row count, so the rows actually rewritten are
    not observable from here without a second query.
    """
    for start in range(0, len(records), batch_size):
        await db.execute(_PERSIST_STATEMENT, records[start : start + batch_size])
        await db.commit()

    return len(records)


async def persist_rate_prior(db, rates: GlobalRates) -> None:
    """Record the population rates the rate boards were damped toward.

    Written in the same session as the per-title columns, since a sort reading one and not
    the other would damp this run's counts toward the previous run's population.
    """
    await db.execute(
        text("""
            INSERT INTO system_metadata (key, value, updated_at)
            VALUES (:key, :value, now())
            ON CONFLICT (key) DO UPDATE
                SET value = excluded.value, updated_at = excluded.updated_at
        """),
        {
            "key": RATE_PRIOR_KEY,
            "value": json.dumps(
                {"finished": rates.finished, "dropped": rates.dropped}
            ),
        },
    )
    await db.commit()


def build_rank_index(entries: list[RankedEntry]) -> dict:
    """Map subject id to rank for the top of a board.

    Keys are normalised to the prefixed uid so a lookup works whether the board was scored
    from the votes table, which stores bare numeric ids, or from list labels, which store
    prefixed ones.
    """
    index: dict[str, int] = {}
    for position, entry in enumerate(entries[:RANK_INDEX_DEPTH], start=1):
        uid = entry.key if entry.key.startswith("u") else f"u{entry.key}"
        index[uid] = position
    return {"depth": RANK_INDEX_DEPTH, "total": len(entries), "ranks": index}


#: Key for the all-language obscurity scan inside the scan map. Not a Metric: no board ranks
#: on it, and it exists so a reader's own page can be placed against the population its own
#: figure was drawn from.
_OBSCURITY_ALL_LANGUAGES = "obscurity_all"


def build_percentile_sketches(
    buckets: dict[tuple, Bucket],
    labels_by_user: dict[str, LabelCounts],
    reader_scans: dict | None = None,
) -> dict[str, list[float]]:
    """Sketch the distributions the user stats page compares a reader against.

    Derived from work already done: the vote counts come from the base bucket the boards
    were built from, the label counts from the same two grouped scans, and the bias and
    obscurity figures from the scans the reader boards already needed. No extra query.
    """
    base_key = (Facet().canonical(), Window.ALL.value, False)
    base = buckets.get(base_key)

    sketches: dict[str, list[float]] = {}

    if base is not None:
        sketches["votes"] = percentile_sketch(
            [float(c.matched) for c in base.users.values()]
        )
        # A mean over one or two votes is not a rating habit, so the distribution this
        # reader is placed against is drawn only from readers who have rated enough for
        # their average to describe them.
        sketches["average"] = percentile_sketch(
            [
                c.average
                for c in base.users.values()
                if c.matched >= MIN_VOTES_FOR_AVERAGE_PERCENTILE and c.average
            ]
        )

    # Zero is a position on these distributions, not an absence from them. Most readers have
    # given nothing up, so dropping them leaves a reader with a handful of drops measured
    # against only the readers who drop things, which reads far lower than the truth. The
    # card above these figures says it compares against every reader with a public list.
    sketches["finished"] = percentile_sketch(
        [float(c.finished) for c in labels_by_user.values()]
    )
    sketches["dropped"] = percentile_sketch(
        [float(c.dropped) for c in labels_by_user.values()]
    )
    sketches["wishlist"] = percentile_sketch(
        [float(c.wishlist) for c in labels_by_user.values()]
    )

    scans = reader_scans or {}

    # Both of these are reported on a reader's own page, where a bare number says little:
    # "a median of twelve other voters" only means something next to how most people read.
    bias_scan = scans.get(Metric.VOTE_BIAS) or {}
    sketches["bias"] = percentile_sketch(
        [
            scan.bias
            for scan in bias_scan.values()
            if scan.votes >= MIN_VOTES_FOR_CONSENSUS
        ]
    )

    # The board scores this over Japanese-original titles; a reader's own page states it over
    # everything they have read. Two populations, so two sketches: placing one figure against
    # the other's distribution moved readers by tens of percentile points.
    obscurity_scan = scans.get(Metric.OBSCURITY) or {}
    sketches["obscurity"] = percentile_sketch(
        [
            scan.median_voters
            for scan in obscurity_scan.values()
            if scan.median_voters
        ]
    )

    everything_scan = scans.get(_OBSCURITY_ALL_LANGUAGES) or {}
    sketches["obscurity_all"] = percentile_sketch(
        [
            scan.median_voters
            for scan in everything_scan.values()
            if scan.median_voters
        ]
    )

    return {name: values for name, values in sketches.items() if values}


def rank_difficulty(spec, bucket, vn_facts: dict) -> list[RankedEntry]:
    """Rank titles by the difficulty of their Japanese.

    Only titles jiten has analysed carry a difficulty, so the board is a ranking of that
    subset and says so. The vote floor is separate: a script can be measured without enough
    readers for the title to be worth recommending either way.
    """
    entries = []
    for vn_id, counters in bucket.vns.items():
        facts = vn_facts.get(vn_id)
        if facts is None or facts.difficulty is None:
            continue
        if counters.matched < max(spec.min_count, 1):
            continue
        entries.append(
            RankedEntry(
                key=vn_id,
                value=float(facts.difficulty),
                count=counters.matched,
                secondary={"average": round(counters.average, 2)},
            )
        )
    return _order(entries, spec)


def rank_active_span(spec, activity: dict, dump_year: int) -> list[RankedEntry]:
    """Rank studios by how long they have been releasing, requiring recent activity.

    A studio that stopped twenty years ago has the same span as one still going, so the
    recency requirement is what makes this "still shipping" rather than "was around a while".
    """
    entries = []
    for producer_id, (first, latest, titles) in activity.items():
        if titles < max(spec.min_works, 1):
            continue
        if dump_year - latest.year > ACTIVE_WITHIN_YEARS:
            continue
        span = latest.year - first.year
        if span <= 0:
            continue
        entries.append(
            RankedEntry(
                key=producer_id,
                value=float(span),
                count=titles,
                secondary={"works": titles, "first": first.year, "latest": latest.year},
            )
        )
    return _order(entries, spec)



def build_year_explorer(
    released: dict[int, list[tuple]],
    read: dict[int, list[tuple]],
    hydrator: Hydrator,
    dump_year: int,
) -> dict:
    """The payload behind the year scrubber.

    Two answers per year, because they are genuinely different and the difference is the
    point: what came out then, and what people were actually reading then. A year early in
    the record has a full release side and an almost empty reading side, since the audience
    that would have voted did not exist yet.

    The year in progress is kept and flagged rather than dropped. A trends page that stops at
    the last completed year is always describing the past, and the current year against the
    ones before it is the comparison a reader came for. Its counts cover only the year so far,
    which the flag is there to say.
    """

    def title_row(vn_id: str, label: str) -> dict | None:
        vn = hydrator.vns.get(vn_id)
        if vn is None:
            return None
        return {
            "id": vn_id,
            "title": vn.title,
            "title_romaji": vn.title_romaji,
            "title_jp": vn.title_jp,
            "href": f"/vn/{vn_id.lstrip('v')}",
            "image_url": vn.image_url,
            "image_sexual": vn.image_sexual,
            "value_label": label,
        }

    years = []
    for year in sorted(set(released) | set(read)):
        best = [
            row
            for row in (
                title_row(vn_id, f"{score:.2f} from {votes:,} votes")
                for vn_id, score, votes in released.get(year, ())
            )
            if row is not None
        ]
        popular = [
            row
            for row in (
                title_row(vn_id, f"{votes:,} votes that year")
                for vn_id, votes in read.get(year, ())
            )
            if row is not None
        ]
        if not best and not popular:
            continue
        years.append(
            {
                "year": year,
                "released": best,
                "read": popular,
                "in_progress": year >= dump_year,
            }
        )

    return {"years": years}


def build_trend_feed(feed: dict, hydrator: Hydrator, reference: date) -> dict:
    """The feed sections, with their titles resolved.

    Each section keeps the one figure it is ordered by rather than a shared shape. They are
    measuring genuinely different things, and flattening a completion count and a rating shift
    into the same field would only mean the page had to guess which it had.
    """

    def with_title(entry: dict) -> dict | None:
        vn = hydrator.vns.get(entry["vn_id"])
        if vn is None:
            return None
        return {
            "id": entry["vn_id"],
            "title": vn.title,
            "title_romaji": vn.title_romaji,
            "title_jp": vn.title_jp,
            "href": f"/vn/{entry['vn_id'].lstrip('v')}",
            "image_url": vn.image_url,
            "image_sexual": vn.image_sexual,
            **{k: v for k, v in entry.items() if k != "vn_id"},
        }

    def section(entries) -> list[dict]:
        return [row for row in (with_title(e) for e in entries) if row is not None]

    return {
        "reference": reference.isoformat(),
        "shifting": {
            key: {
                "days": period["days"],
                "rising": section(period["rising"]),
                "falling": section(period["falling"]),
            }
            for key, period in feed["shifting"].items()
        },
        "new_releases": section(feed["new_releases"]),
        "finishing": section(feed["finishing"]),
        "anticipated": section(feed["anticipated"]),
        "pulse": feed["pulse"],
    }


def build_hot_now(periods: list[dict], hydrator: Hydrator, reference: date) -> dict:
    """The hot list as the page renders it.

    Each entry carries where it sits now, where it sat in the previous window, and both
    counts, so the page can show a direction rather than a number. `previous_place` is null
    for a title that drew no votes at all last window, which is a different statement from
    having placed badly and is rendered differently.
    """

    def entry_row(entry: dict) -> dict | None:
        vn = hydrator.vns.get(entry["vn_id"])
        if vn is None:
            return None
        return {
            "id": entry["vn_id"],
            "title": vn.title,
            "title_romaji": vn.title_romaji,
            "title_jp": vn.title_jp,
            "href": f"/vn/{entry['vn_id'].lstrip('v')}",
            "image_url": vn.image_url,
            "image_sexual": vn.image_sexual,
            "current": entry["current"],
            "previous": entry["previous"],
            "place": entry["place"],
            "previous_place": entry["previous_place"],
            "lift": round(entry["lift"], 2),
        }

    def rows(entries: list[dict]) -> list[dict]:
        return [row for row in (entry_row(e) for e in entries) if row is not None]

    return {
        "reference": reference.isoformat(),
        "periods": [
            {
                "key": period["key"],
                "days": period["days"],
                "votes": period["votes"],
                "previous_votes": period["previous_votes"],
                "top": rows(period["top"]),
                "movers": rows(period["movers"]),
            }
            for period in periods
        ],
    }


def build_month_explorer(
    months: dict[str, tuple], hydrator: Hydrator, latest_month: str
) -> dict[str, dict]:
    """One payload per month, keyed by "YYYY-MM".

    The month in progress is kept and flagged. It holds only the days elapsed, so its counts
    are not comparable with a full month and its jump ratios run high against a whole month's
    expectation; the flag is what lets the page say so rather than quietly overstating them.
    Dropping it would mean a page about what is happening now never showed the current month.
    """
    payloads: dict[str, dict] = {}

    def title_row(vn_id: str, label: str) -> dict | None:
        vn = hydrator.vns.get(vn_id)
        if vn is None:
            return None
        return {
            "id": vn_id,
            "title": vn.title,
            "title_romaji": vn.title_romaji,
            "title_jp": vn.title_jp,
            "href": f"/vn/{vn_id.lstrip('v')}",
            "image_url": vn.image_url,
            "image_sexual": vn.image_sexual,
            "value_label": label,
        }

    for month, (read, jumped) in months.items():
        most_read = [
            row
            for row in (
                title_row(vn_id, f"{votes:,} votes") for _place, vn_id, votes in read
            )
            if row is not None
        ]
        biggest_jump = [
            row
            for row in (
                title_row(vn_id, f"{jump:.1f}x its usual month")
                for _place, vn_id, jump in jumped
            )
            if row is not None
        ]
        if not most_read:
            continue
        payloads[month] = {
            "month": month,
            "read": most_read,
            "jumped": biggest_jump,
            "in_progress": month >= latest_month,
        }

    return payloads


def _title_value_source(spec, context):
    """The per-title figure a title-average board reads, and what to compare it against.

    Returns a function from VN id to the figure, or None where the title has no measurement
    to contribute. Each board decides its own floor, since the counts differ in kind: list
    entries for a drop rate, votes for a recency share.
    """
    vn_facts = context["vn_facts"]

    if spec.metric is Metric.TITLE_DIFFICULTY:
        def difficulty(vn_id):
            facts = vn_facts.get(vn_id)
            if facts is None or facts.difficulty is None:
                return None
            # The facet decides the corpus here rather than only the baseline, so the
            # titles counted are the ones the board says it counts.
            return facts.difficulty if matches(facts, spec.facet) else None

        # Averaged over the same corpus the board ranks, so the gap a row shows is against
        # the titles it is actually competing with rather than the database as a whole.
        measured = [
            facts.difficulty
            for facts in vn_facts.values()
            if facts.difficulty is not None and matches(facts, spec.facet)
        ]
        baseline = sum(measured) / len(measured) if measured else None
        return difficulty, baseline

    if spec.metric is Metric.TITLE_DROP_RATE:
        labels_by_vn = context["labels_by_vn"]

        def drop_rate(vn_id):
            counts = labels_by_vn.get(vn_id)
            if counts is None:
                return None
            attempts = counts.finished + counts.dropped
            if attempts < MIN_LIST_ENTRIES_FOR_RATE:
                return None
            return counts.dropped / attempts

        return drop_rate, None

    if spec.metric is Metric.TITLE_RECENCY:
        buckets = context["buckets"]
        lifetime = buckets[(Facet().canonical(), Window.ALL.value, False)]
        recent = buckets[(Facet().canonical(), Window.YEAR.value, False)]

        def recency(vn_id):
            total = lifetime.vns.get(vn_id)
            if total is None or total.matched < MIN_VOTES_FOR_RECENCY:
                return None
            arrived = recent.vns.get(vn_id)
            return (arrived.matched if arrived is not None else 0) / total.matched

        return recency, None

    raise ValueError(f"{spec.slug}: {spec.metric} has no per-title figure to average")


def _rank(spec, buckets, labels_by_vn, labels_by_user, credits, reader_scans, context):
    """Dispatch a board to the aggregator that knows how to score it.

    `credits` maps each board's credit key to its entity-to-VN mapping; two staff boards
    over different roles need different mappings. `reader_scans` holds the two grouped
    scans that measure readers against the community.
    """
    if spec.metric in TITLE_AVERAGE_METRICS:
        # Dispatched first: what is being averaged is not always vote-derived, so this must
        # not fall through to the label path below.
        value_of, baseline = _title_value_source(spec, context)
        return rank_title_average(spec, credits[spec.credit_key], value_of, baseline)

    if spec.metric is Metric.TERMINAL_RATE:
        return rank_terminal(spec, context["terminal_votes"])

    if spec.metric is Metric.SERIES_SPAN:
        return rank_series_span(spec, series_spans(credits[spec.credit_key], context["vn_facts"]))

    if spec.metric is Metric.BACKLOG_GAP:
        return rank_backlog_gap(spec, context["backlogs"])

    if spec.metric not in VOTE_METRICS:
        counts = labels_by_user if spec.subject is Subject.USER else labels_by_vn
        return rank_label_board(spec, counts)

    if spec.metric is Metric.THEME_RANGE:
        return rank_reader_value(
            spec, context["compositions"], "theme_range", "theme_sample", scale=100
        )

    if spec.metric is Metric.READING_DRIFT:
        return rank_reader_value(
            spec, context["compositions"], "era_drift", "drift_sample", scale=100
        )

    if spec.metric is Metric.LIBRARY_SHARE:
        if spec.composition in PRECOMPUTED_SHARES:
            field, sample = PRECOMPUTED_SHARES[spec.composition]
            return rank_reader_value(spec, context["compositions"], field, sample)
        numerator, denominator = COMPOSITIONS[spec.composition]
        return rank_reader_share(
            spec, context["compositions"], numerator, denominator
        )

    if spec.metric in READER_SCAN_METRICS:
        return rank_reader_scan(spec, reader_scans[spec.metric])

    if spec.metric is Metric.ACTIVE_SPAN:
        return rank_active_span(spec, context["studio_activity"], context["dump_year"])

    bucket = buckets[spec.bucket_key]

    if spec.metric is Metric.DIFFICULTY:
        return rank_difficulty(spec, bucket, context["vn_facts"])

    if spec.metric is Metric.DISCOVERY_LAG:
        # Vote histories live only on the base bucket, whatever facet the board carries.
        base = buckets[(Facet().canonical(), Window.ALL.value, False)]
        return rank_discovery_lag(spec, base, context["vn_facts"])

    if spec.metric in (Metric.TITLE_MEAN, Metric.TITLE_SPREAD):
        return rank_title_aggregate(
            spec,
            bucket,
            credits[spec.credit_key],
            global_mean_vote(bucket),
            MIN_VOTES_PER_CATALOGUE_TITLE,
        )

    if spec.metric is Metric.CATALOGUE_FLOOR:
        # Reads per-title scores rather than pooled counters, so it takes the mapping
        # directly instead of going through the roll-up.
        return rank_catalogue_floor(
            spec,
            bucket,
            credits[spec.credit_key],
            global_mean_vote(bucket),
            MIN_VOTES_PER_CATALOGUE_TITLE,
        )

    if spec.metric is Metric.VELOCITY:
        # A ratio between a period and all time, so it needs the lifetime bucket too.
        lifetime = buckets[(spec.facet.canonical(), Window.ALL.value, False)]
        return rank_velocity_board(spec, bucket, lifetime)

    if spec.metric in HISTORY_METRICS:
        # Vote histories are kept only on the base bucket, so these boards read from there
        # regardless of their own facet.
        base = buckets[(Facet().canonical(), Window.ALL.value, False)]
        if spec.metric is Metric.REPUTATION_SHIFT:
            return rank_reputation_board(spec, base)
        return rank_rating_as_of(spec, base)

    # Taken before the roll-up, which discards the per-title counters the mean is computed
    # from. Passed rather than recomputed so the entity boards damp toward the same
    # population their disclosures name.
    prior = global_mean_vote(bucket)

    if spec.subject in ROLLED_UP_SUBJECTS:
        bucket = roll_up_by_entity(bucket, credits[spec.credit_key])

    return rank_vote_board(spec, bucket, prior)


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Rebuild the leaderboard catalogue")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="compute and report row counts without writing to Redis",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(asyncio.run(refresh_leaderboards(dry_run=args.dry_run)))
