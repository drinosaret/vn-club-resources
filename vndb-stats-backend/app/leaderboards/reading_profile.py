"""What one reader's votes look like against everyone else's, answered when asked.

Three questions the rest of the stats page cannot ask, because each needs the whole vote
record rather than one person's list: how much of what they read nobody else has rated, how
far their ratings sit from the community on the titles they share, and how far off the
beaten track they read.

All three come from one grouped pass over a single reader's votes joined to the per-title
columns the nightly job already writes, so this is a few tens of milliseconds rather than
anything that needs materialising. Nothing here is precomputed per reader: there are tens of
thousands of them and only the ones who visit their own page need an answer.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from .compute import LABEL_FINISHED
from .thresholds import MIN_VOTES_FOR_CONSENSUS


@dataclass(frozen=True)
class ReadingProfile:
    """One reader's standing against the vote record."""

    rated: int
    #: Titles they have rated that nobody else has.
    sole_voter: int
    #: Typical number of *other* people who rated the titles they read, matching the wording
    #: the obscurity board already uses.
    median_other_voters: int | None
    #: Mean gap between their rating and the community's, in rating points. Signed.
    bias: float | None
    #: Spread of that gap around its own mean. A reader who marks everything two points low
    #: is predictable once the offset is known; one who disagrees title by title is not.
    divergence: float | None
    #: Titles behind the two figures above, which need a settled community rating to compare against.
    comparable: int
    #: The release years holding the middle 80% of what they read, and the midpoint. An
    #: average year would be dragged around by a handful of outliers at either end; a band
    #: says what period someone actually reads in.
    era_from: int | None
    era_to: int | None
    era_median: int | None

    @property
    def has_comparison(self) -> bool:
        return self.bias is not None and self.comparable > 0


async def load_reading_profile(db, uid: str) -> ReadingProfile | None:
    """Everything above, in one query. Returns None for a reader with no public votes.

    `uid` arrives in VNDB's prefixed form; `global_votes` keys on the bare number.
    """
    user_hash = uid[1:] if uid.startswith("u") else uid
    if not user_hash.isdigit():
        return None

    row = (
        await db.execute(
            text(f"""
                WITH mine AS (
                    SELECT g.vote / 10.0 AS mine,
                           v.public_votes,
                           v.average_rating,
                           extract(year FROM v.released)::int AS released_year
                    FROM global_votes g
                    JOIN visual_novels v ON v.id = g.vn_id
                    WHERE g.user_hash = :user_hash
                )
                SELECT
                    count(*) AS rated,
                    count(*) FILTER (WHERE public_votes = 1) AS sole_voter,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY public_votes) AS median_voters,
                    avg(mine - average_rating)
                        FILTER (WHERE public_votes >= :floor) AS bias,
                    stddev_samp(mine - average_rating)
                        FILTER (WHERE public_votes >= :floor) AS divergence,
                    count(*) FILTER (WHERE public_votes >= :floor) AS comparable,
                    percentile_cont(0.1) WITHIN GROUP (ORDER BY released_year) AS era_from,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY released_year) AS era_median,
                    percentile_cont(0.9) WITHIN GROUP (ORDER BY released_year) AS era_to
                FROM mine
            """),
            {"user_hash": user_hash, "floor": MIN_VOTES_FOR_CONSENSUS},
        )
    ).first()

    if row is None or not row.rated:
        return None

    # The median counts every rater including this one, and the figure is published as the
    # other voters, so one is taken off before it is reported.
    median_others = (
        max(int(row.median_voters) - 1, 0) if row.median_voters is not None else None
    )

    def year(value) -> int | None:
        return int(value) if value is not None else None

    return ReadingProfile(
        rated=int(row.rated),
        sole_voter=int(row.sole_voter or 0),
        median_other_voters=median_others,
        bias=round(float(row.bias), 3) if row.bias is not None else None,
        divergence=round(float(row.divergence), 3) if row.divergence is not None else None,
        comparable=int(row.comparable or 0),
        era_from=year(row.era_from),
        era_to=year(row.era_to),
        era_median=year(row.era_median),
    )


@dataclass(frozen=True)
class ReadingYear:
    """One year of a reader's rating history."""

    year: int
    rated: int
    average: float | None
    best_id: str | None
    best_title: str | None
    best_title_jp: str | None
    best_title_romaji: str | None
    best_score: float | None


async def load_reading_years(db, uid: str) -> list[ReadingYear]:
    """A reader's rating history, one row per year, newest first.

    Keyed on when the vote was cast rather than when the title came out, so this describes
    what somebody was doing that year rather than what was being published. Votes with no
    date are left out: VNDB has carried the field long enough that the gap is small, and
    guessing a year would put activity in a year that did not have it.
    """
    user_hash = uid[1:] if uid.startswith("u") else uid
    if not user_hash.isdigit():
        return []

    rows = await db.execute(
        text("""
            WITH per_year AS (
                SELECT extract(year FROM g.date)::int AS yr,
                       count(*) AS rated,
                       avg(g.vote) / 10.0 AS average
                FROM global_votes g
                WHERE g.user_hash = :user_hash AND g.date IS NOT NULL
                GROUP BY 1
            ),
            best AS (
                SELECT DISTINCT ON (extract(year FROM g.date)::int)
                       extract(year FROM g.date)::int AS yr,
                       v.id, v.title, v.title_jp, v.title_romaji,
                       g.vote / 10.0 AS score
                FROM global_votes g
                JOIN visual_novels v ON v.id = g.vn_id
                WHERE g.user_hash = :user_hash AND g.date IS NOT NULL
                ORDER BY 1, g.vote DESC, v.id
            )
            SELECT p.yr, p.rated, p.average,
                   b.id AS best_id,
                   b.title AS best_title,
                   b.title_jp AS best_title_jp,
                   b.title_romaji AS best_title_romaji,
                   b.score AS best_score
            FROM per_year p
            LEFT JOIN best b ON b.yr = p.yr
            ORDER BY p.yr DESC
        """),
        {"user_hash": user_hash},
    )

    return [
        ReadingYear(
            year=int(row.yr),
            rated=int(row.rated),
            average=round(float(row.average), 2) if row.average is not None else None,
            best_id=row.best_id,
            best_title=row.best_title,
            best_title_jp=row.best_title_jp,
            best_title_romaji=row.best_title_romaji,
            best_score=round(float(row.best_score), 1) if row.best_score is not None else None,
        )
        for row in rows
    ]


@dataclass(frozen=True)
class JapaneseRead:
    """How much Japanese a reader has actually been through.

    The unit an immersion learner cares about is characters, not titles, and jiten measures
    them per title. Coverage is partial and varies enormously between readers: it tracks how
    mainstream someone's reading is, so a reader of obscure titles can sit far below the
    median even with a large list. Every figure therefore carries the number of titles behind
    it, and the total is a floor rather than an estimate of the whole list.
    """

    finished: int
    measured: int
    characters: int
    difficulty: float | None

    @property
    def coverage(self) -> float:
        return (self.measured / self.finished * 100) if self.finished else 0.0


async def load_japanese_read(db, uid: str) -> JapaneseRead | None:
    """Characters of Japanese across the finished titles jiten has measured.

    Finished rather than everything on the list: a title someone is part-way through has not
    put its whole script in front of them, and counting it would inflate the one number here
    that people will quote.
    """
    if not uid.startswith("u"):
        uid = f"u{uid}"

    row = (
        await db.execute(
            text("""
                SELECT count(*) AS finished,
                       count(*) FILTER (WHERE d.vn_id IS NOT NULL) AS measured,
                       coalesce(sum(d.character_count), 0) AS characters,
                       avg(d.difficulty) AS difficulty
                FROM ulist_labels u
                LEFT JOIN vn_difficulty d ON d.vn_id = u.vid
                WHERE u.uid = :uid AND u.label = :finished_label
            """),
            {"uid": uid, "finished_label": LABEL_FINISHED},
        )
    ).first()

    if row is None or not row.measured:
        return None

    return JapaneseRead(
        finished=int(row.finished),
        measured=int(row.measured),
        characters=int(row.characters or 0),
        difficulty=round(float(row.difficulty), 2) if row.difficulty is not None else None,
    )


@dataclass(frozen=True)
class MeasuredTitle:
    """One finished title jiten has a character count for."""

    vn_id: str
    title: str
    title_jp: str | None
    title_romaji: str | None
    characters: int
    difficulty: float | None
    deck_id: int


async def load_japanese_titles(db, uid: str) -> list[MeasuredTitle]:
    """The finished titles behind the character total, heaviest first.

    The total is a sum over a partial mirror, which is a hard thing to take on trust. Listing
    what went into it turns the figure into something a reader can check against the source
    one title at a time.
    """
    if not uid.startswith("u"):
        uid = f"u{uid}"

    rows = await db.execute(
        text("""
            SELECT u.vid, v.title, v.title_jp, v.title_romaji,
                   d.character_count, d.difficulty, d.jiten_deck_id
            FROM ulist_labels u
            JOIN vn_difficulty d ON d.vn_id = u.vid
            JOIN visual_novels v ON v.id = u.vid
            WHERE u.uid = :uid AND u.label = :finished_label
              AND d.character_count IS NOT NULL
            ORDER BY d.character_count DESC, u.vid
        """),
        {"uid": uid, "finished_label": LABEL_FINISHED},
    )

    return [
        MeasuredTitle(
            vn_id=row.vid,
            title=row.title,
            title_jp=row.title_jp,
            title_romaji=row.title_romaji,
            characters=int(row.character_count),
            difficulty=round(float(row.difficulty), 2) if row.difficulty is not None else None,
            deck_id=int(row.jiten_deck_id),
        )
        for row in rows
    ]


@dataclass(frozen=True)
class ReadingMilestone:
    """One dated point in a reader's history."""

    date: str
    vn_id: str
    title: str
    title_jp: str | None
    title_romaji: str | None
    score: float


@dataclass(frozen=True)
class ReadingMilestones:
    """The ends of a reader's history, and the longest quiet stretch inside it."""

    first: ReadingMilestone | None
    latest: ReadingMilestone | None
    #: Days between the two most widely separated consecutive votes.
    longest_gap_days: int | None
    #: Days on which they rated anything, which is not the same as days elapsed.
    active_days: int


async def load_reading_milestones(db, uid: str) -> ReadingMilestones | None:
    """Where a reader's history starts, where it stands, and the longest pause in it.

    Dates come from the votes rather than from list entries, so this describes rating
    activity. Many readers enter a backlog in one sitting, which is why the gap is reported
    as a plain fact about the record rather than dressed up as time spent away from reading.
    """
    user_hash = uid[1:] if uid.startswith("u") else uid
    if not user_hash.isdigit():
        return None

    row = (
        await db.execute(
            text("""
                WITH mine AS (
                    SELECT g.date, g.vote / 10.0 AS score, v.id,
                           v.title, v.title_jp, v.title_romaji,
                           lag(g.date) OVER (ORDER BY g.date, v.id) AS prev
                    FROM global_votes g
                    JOIN visual_novels v ON v.id = g.vn_id
                    WHERE g.user_hash = :user_hash AND g.date IS NOT NULL
                ),
                ends AS (
                    SELECT
                        (SELECT to_jsonb(f) FROM (
                            SELECT date, id, title, title_jp, title_romaji, score
                            FROM mine ORDER BY date, id LIMIT 1
                        ) f) AS first_vote,
                        (SELECT to_jsonb(l) FROM (
                            SELECT date, id, title, title_jp, title_romaji, score
                            FROM mine ORDER BY date DESC, id LIMIT 1
                        ) l) AS last_vote
                )
                SELECT ends.first_vote, ends.last_vote,
                       (SELECT max(date - prev) FROM mine) AS longest_gap,
                       (SELECT count(DISTINCT date) FROM mine) AS active_days
                FROM ends
            """),
            {"user_hash": user_hash},
        )
    ).first()

    if row is None or not row.first_vote:
        return None

    def milestone(payload) -> ReadingMilestone | None:
        if not payload:
            return None
        return ReadingMilestone(
            date=str(payload["date"]),
            vn_id=payload["id"],
            title=payload["title"],
            title_jp=payload.get("title_jp"),
            title_romaji=payload.get("title_romaji"),
            score=round(float(payload["score"]), 1),
        )

    return ReadingMilestones(
        first=milestone(row.first_vote),
        latest=milestone(row.last_vote),
        longest_gap_days=int(row.longest_gap) if row.longest_gap is not None else None,
        active_days=int(row.active_days or 0),
    )


@dataclass(frozen=True)
class DriftHalf:
    """One half of a reader's rating history, on the axes their page already shows."""

    titles: int
    average: float | None
    near_release: float | None
    long_titles: float | None
    adult: float | None


@dataclass(frozen=True)
class ReadingDrift:
    """How a reader's own measures moved between their earlier and later halves.

    Deliberately expressed on the axes the page already displays rather than on tags. The
    tag-level version of this measure works, but its strongest signal turns out to be the
    kind of inference nobody should publish about a named person, and these pages are public.
    Movement in figures a reader can already see beside it adds insight without adding
    exposure.

    Split at the median vote rather than by calendar date, so both halves hold the same
    number of titles and the comparison is not dominated by one busy year.
    """

    early: DriftHalf
    late: DriftHalf


#: Votes a reader needs before their history is split in two. Below this each half is small
#: enough that the difference between them is mostly noise.
MIN_VOTES_FOR_DRIFT = 40

#: Days that must separate the two halves before they describe different periods. A list
#: imported in one sitting carries a single date and has no then and now to report.
MIN_DAYS_BETWEEN_HALVES = 180

#: How soon after a release a rating still counts as reading it while it was current.
DRIFT_RELEASE_WINDOW = 2


async def load_reading_drift(db, uid: str) -> ReadingDrift | None:
    """The two halves of a reader's history, as shares rather than counts.

    Each share is taken over the titles that carry the field it needs, so a missing length
    or age rating leaves that axis alone instead of quietly counting as a no.

    Release age is measured against the date of the rating rather than against today, because
    the calendar alone would push every early half towards zero and read as a change in taste.
    """
    user_hash = uid[1:] if uid.startswith("u") else uid
    if not user_hash.isdigit():
        return None

    rows = list(
        await db.execute(
            text("""
                WITH mine AS (
                    SELECT g.vote, g.date, v.length, v.minage,
                           extract(year FROM v.released)::int AS yr,
                           extract(year FROM g.date)::int AS voted_year,
                           ntile(2) OVER (ORDER BY g.date, v.id) AS half
                    FROM global_votes g
                    JOIN visual_novels v ON v.id = g.vn_id
                    WHERE g.user_hash = :user_hash AND g.date IS NOT NULL
                )
                SELECT half,
                       count(*) AS titles,
                       percentile_disc(0.5) WITHIN GROUP (ORDER BY date) AS mid_date,
                       avg(vote) / 10.0 AS average,
                       count(*) FILTER (WHERE yr >= voted_year - :window) AS near_release,
                       count(*) FILTER (WHERE yr IS NOT NULL) AS dated,
                       count(*) FILTER (WHERE length >= 4) AS long_titles,
                       count(*) FILTER (WHERE length IS NOT NULL) AS with_length,
                       count(*) FILTER (WHERE minage >= 18) AS adult,
                       count(*) FILTER (WHERE minage IS NOT NULL) AS with_age
                FROM mine
                GROUP BY half
                ORDER BY half
            """),
            {"user_hash": user_hash, "window": DRIFT_RELEASE_WINDOW},
        )
    )

    if len(rows) < 2 or sum(int(r.titles) for r in rows) < MIN_VOTES_FOR_DRIFT:
        return None
    if (rows[1].mid_date - rows[0].mid_date).days < MIN_DAYS_BETWEEN_HALVES:
        return None

    def share(matching, total) -> float | None:
        return round(matching / total * 100, 1) if total else None

    def half(row) -> DriftHalf:
        return DriftHalf(
            titles=int(row.titles),
            average=round(float(row.average), 2) if row.average is not None else None,
            near_release=share(int(row.near_release), int(row.dated)),
            long_titles=share(int(row.long_titles), int(row.with_length)),
            adult=share(int(row.adult), int(row.with_age)),
        )

    return ReadingDrift(early=half(rows[0]), late=half(rows[1]))
