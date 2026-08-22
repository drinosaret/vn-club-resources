"""Rankings over any slice of the database, answered when asked rather than materialised.

The curated boards answer a fixed set of questions, and each one costs a slice of the
nightly job, which is why they are hand-picked. A ranking over one slice is a single grouped
scan, so the slice does not have to be picked in advance: a reader states which titles they
mean and which question they are asking, and the answer is computed and cached until the
next dump lands.

That removes a whole class of board. "Best of the 1990s", "best on PC-98" and "best as
judged in 2015" are the same question asked of three different slices, and a permanent URL
for each is a guess about which slices somebody wanted. The guesses were also arbitrary in a
way a reader could not correct: a board for 2010 and 2015 but not 2013 is a statement about
what was easy to hardcode, not about the database.

Membership is defined once, in `facets`, and shared with the nightly job. A slice built here
and a curated board carrying the same facet select the same titles by construction rather
than by two definitions being kept in step by hand.

Two costs bound what can be offered. Everything the nightly job already wrote onto
`visual_novels` is a column read, so most title questions are a filtered sort. The questions
it did not write, which is any reader ranking and any rating as of a past year, are a
grouped scan of the vote table narrowed to the slice. Both are fast enough to answer live;
neither is fast enough to answer without a statement timeout, which is why one is set.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Callable

from sqlalchemy import Float, Integer, and_, cast, func, select, text

from app.db.models import (
    GlobalVote,
    Tag,
    TagParent,
    VisualNovel,
    VNDifficulty,
    VNTag,
    VndbUser,
)

from . import facets
from .aggregate import BAYESIAN_PRIOR_VOTES, RATE_PRIOR_KEY, RATE_PRIOR_READERS
from .disclosures import TIE_BREAK, VOTE_EXCLUSIONS
from .serialize import format_value
from .spec import Disclosure, Facet, Metric
from .thresholds import MIN_LIBRARY_FOR_SHARE

#: Rows kept per live ranking, matching what the materialised boards keep so a reader moving
#: between the two does not find one deeper than the other.
LIVE_ROW_LIMIT = 100

#: Ceiling on one live ranking's database work. The slice comes from the caller and the
#: widest slices cover the whole database, so the cost of a single request is bounded here
#: rather than left to whichever slice is asked for. Comfortably above the slowest
#: legitimate request, which is the point: it is a backstop, not a budget.
STATEMENT_TIMEOUT_MS = 20_000

#: Largest tag id that can exist. The column is a 32-bit integer, so a larger value is not a
#: tag that is missing, it is a value the column cannot hold.
MAX_TAG_ID = 2_147_483_647

#: Votes before a title can be rated at all. Deliberately low, and lower than several of the
#: curated boards used: those picked a floor per board, which a slice chosen by the reader
#: cannot do, and a narrow slice under a high floor ranks almost nothing. The Bayesian pull
#: toward the slice's own mean is what keeps a ten-vote title from topping the ranking, so
#: the floor only has to exclude titles too thin to have a mean at all.
MIN_VOTES_FOR_RATING = 10

#: Reading attempts, which is what a completion or drop rate is a proportion of. Wishlist
#: entries are excluded: wanting to read something says nothing about finishing it.
_STARTED = (
    func.coalesce(VisualNovel.list_playing, 0)
    + func.coalesce(VisualNovel.list_finished, 0)
    + func.coalesce(VisualNovel.list_stalled, 0)
    + func.coalesce(VisualNovel.list_dropped, 0)
)

#: Accounts whose votes the dump marks as not counting.
_ELIGIBLE_VOTER = ~select(VndbUser.uid).where(
    and_(VndbUser.uid == "u" + GlobalVote.user_hash, VndbUser.ign_votes.is_(True))
).exists()


async def bound_statement_cost(db) -> None:
    """Cap how long any one statement in this transaction may run."""
    await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))


# --------------------------------------------------------------------------- slice


def tag_tree_ids(tag_id: int):
    """Every tag at or below one tag, as a subquery.

    A title tagged a child genre counts toward the parent, which is what the tag pages do
    and what a reader picking a broad genre means by it.
    """
    base = select(Tag.id).where(Tag.id == tag_id).cte("tag_tree", recursive=True)
    return select(
        base.union_all(
            select(TagParent.tag_id).join(base, TagParent.parent_id == base.c.id)
        ).c.id
    )


def tagged_vn_ids(tag_id: int):
    """Titles carrying a tag, on the same terms as the tag pages.

    Negative-scored, spoiler-flagged and disputed applications are excluded, which is the
    difference between a tag meaning something and a tag having been typed.
    """
    return select(VNTag.vn_id).where(
        and_(
            VNTag.tag_id.in_(tag_tree_ids(tag_id)),
            VNTag.score > 0,
            VNTag.spoiler_level == 0,
            VNTag.lie.is_(False),
        )
    )


def slice_conditions(facet: Facet) -> list:
    """Every condition narrowing `visual_novels` to the slice.

    The column predicates come from the shared facet definition. Tag membership and measured
    difficulty are the two that cannot: one needs a join to the tag tree, the other a join to
    the difficulty mirror, and both are expressed here as id subqueries so the caller is
    left with a plain list of conditions.
    """
    columns = Facet(
        olang=facet.olang,
        lang_only=facet.lang_only,
        year_min=facet.year_min,
        year_max=facet.year_max,
        platform=facet.platform,
        length=facet.length,
        freeware=facet.freeware,
        jp_freeware=facet.jp_freeware,
        minage_max=facet.minage_max,
        votecount_min=facet.votecount_min,
        votecount_max=facet.votecount_max,
    )
    conditions = []
    column_predicate = facets.predicate(columns)
    if column_predicate is not None:
        conditions.append(column_predicate)

    if facet.tag is not None:
        conditions.append(VisualNovel.id.in_(tagged_vn_ids(facet.tag)))

    if facet.difficulty_min is not None or facet.difficulty_max is not None:
        measured = select(VNDifficulty.vn_id).where(VNDifficulty.difficulty_raw.isnot(None))
        if facet.difficulty_min is not None:
            measured = measured.where(VNDifficulty.difficulty_raw >= facet.difficulty_min)
        if facet.difficulty_max is not None:
            measured = measured.where(VNDifficulty.difficulty_raw <= facet.difficulty_max)
        conditions.append(VisualNovel.id.in_(measured))

    return conditions


# ------------------------------------------------------------------------ questions


@dataclass(frozen=True)
class Question:
    """One question askable of a slice, and how to present its answer."""

    key: str
    label: str
    #: Formats the ranking's own title around the slice description.
    title: str
    blurb: str
    metric: Metric
    #: What a row's number means, for the sentence under the picker.
    high_means: str
    descending: bool = True
    #: Only offered where the slice has been measured by the difficulty mirror.
    needs_difficulty: bool = False
    #: Only offered with a year, which is the whole question.
    needs_year: bool = False


def _rate_prior(field: str):
    """The population rate the nightly job damped toward, read back from what it wrote."""
    from sqlalchemy.dialects.postgresql import JSONB

    from app.db.models import SystemMetadata

    return (
        select(cast(cast(SystemMetadata.value, JSONB)[field].astext, Float))
        .where(SystemMetadata.key == RATE_PRIOR_KEY)
        .scalar_subquery()
    )


def _damped_share(numerator, field: str):
    """A share pulled toward the population rate in proportion to how thin the sample is."""
    prior = _rate_prior(field)
    damped = (cast(numerator, Float) + RATE_PRIOR_READERS * prior) / (
        _STARTED + RATE_PRIOR_READERS
    )
    return func.coalesce(damped, cast(numerator, Float) / func.nullif(_STARTED, 0))


#: How each title question is scored, which titles it can speak for, and what its score is a
#: share of. The floor is part of the question rather than a filter the reader is trusted to
#: remember: a rate over three readers is noise that would otherwise occupy the whole first
#: page. The sample is what the floor counts and what the row reports beside its figure, so a
#: rate over readers must not report a vote count.
TITLE_QUESTIONS: dict[str, tuple[Question, Callable, Callable, int, Callable]] = {}


def _title_question(
    question: Question, expression, floor, min_sample: int, sample=None
) -> None:
    TITLE_QUESTIONS[question.key] = (
        question,
        expression,
        floor,
        min_sample,
        sample or (lambda: VisualNovel.public_votes),
    )


_title_question(
    Question(
        key="rated",
        label="Highest rated",
        title="The best {slice}",
        blurb=(
            "Ranked on the mean of their public votes, pulled toward the average of this "
            "slice in proportion to how few votes a title has. Without that, a title with "
            "thirty votes at nine outranks one with three thousand at eight-and-a-half."
        ),
        metric=Metric.BAYESIAN,
        high_means="rated highest",
    ),
    None,  # filled in per request: the prior depends on the slice
    lambda: VisualNovel.public_votes >= MIN_VOTES_FOR_RATING,
    MIN_VOTES_FOR_RATING,
)

_title_question(
    Question(
        key="voted",
        label="Most voted on",
        title="The most voted on {slice}",
        blurb="Ranked by how many people have rated them, which is reach rather than quality.",
        metric=Metric.VOTERS,
        high_means="drew the most votes",
    ),
    lambda: VisualNovel.public_votes,
    lambda: VisualNovel.public_votes > 0,
    1,
)

_title_question(
    Question(
        key="divisive",
        label="Most divisive",
        title="The most divisive {slice}",
        blurb=(
            "Ranked on how far apart the votes are rather than where they average out. A "
            "title everybody rates a six is not divisive; one split between nines and twos is."
        ),
        metric=Metric.DIVISIVENESS,
        high_means="split opinion most",
    ),
    lambda: VisualNovel.vote_stddev,
    lambda: and_(VisualNovel.public_votes >= 20, VisualNovel.vote_stddev.isnot(None)),
    20,
)

_title_question(
    Question(
        key="dropped",
        label="Most given up on",
        title="The most given up on {slice}",
        blurb=(
            "The share of readers who started a title and marked it dropped, against those "
            "who started it at all. Wishlist entries do not count as starting."
        ),
        metric=Metric.DROP_RATE,
        high_means="most often abandoned",
    ),
    lambda: _damped_share(VisualNovel.list_dropped, "dropped"),
    lambda: _STARTED >= 50,
    50,
    lambda: _STARTED,
)

_title_question(
    Question(
        key="finished",
        label="Most finished",
        title="The most finished {slice}",
        blurb="The other end of the same measure: who starts one of these and sees it through.",
        metric=Metric.COMPLETION_RATE,
        high_means="most often finished",
    ),
    lambda: _damped_share(VisualNovel.list_finished, "finished"),
    lambda: _STARTED >= 50,
    50,
    lambda: _STARTED,
)

_title_question(
    Question(
        key="wishlisted",
        label="Most wishlisted",
        title="The most wishlisted {slice}",
        blurb="What the most people intend to read but have not started.",
        metric=Metric.WISHLIST,
        high_means="most often wanted",
    ),
    lambda: VisualNovel.list_wishlist,
    lambda: VisualNovel.list_wishlist > 0,
    1,
)

_title_question(
    Question(
        key="aged-up",
        label="Aged well",
        title="The best-aged {slice}",
        blurb=(
            "The gap between a title's earlier votes and its later ones, in rating points. "
            "Positive means the community came around to it."
        ),
        metric=Metric.REPUTATION_SHIFT,
        high_means="gained the most",
    ),
    lambda: VisualNovel.reputation_shift,
    lambda: and_(VisualNovel.public_votes >= 50, VisualNovel.reputation_shift.isnot(None)),
    50,
)

_title_question(
    Question(
        key="aged-down",
        label="Did not last",
        title="The {slice} that did not last",
        blurb="The same measure read from the other end: where the later votes are the harsher ones.",
        metric=Metric.REPUTATION_SHIFT,
        high_means="lost the most",
        descending=False,
    ),
    lambda: VisualNovel.reputation_shift,
    lambda: and_(VisualNovel.public_votes >= 50, VisualNovel.reputation_shift.isnot(None)),
    50,
)

_title_question(
    Question(
        key="hardest",
        label="Hardest Japanese",
        title="The densest prose among {slice}",
        blurb=(
            "Ranked on the difficulty jiten.moe measured for the script. Only titles it has "
            "analysed can appear, which is a small part of the database."
        ),
        metric=Metric.DIFFICULTY,
        high_means="densest prose",
        needs_difficulty=True,
    ),
    lambda: VNDifficulty.difficulty_raw,
    lambda: VisualNovel.public_votes >= 30,
    30,
)

_title_question(
    Question(
        key="easiest",
        label="Easiest Japanese",
        title="The plainest prose among {slice}",
        blurb=(
            "The same measurement read from the bottom, and the more useful end if you are "
            "picking something to start on. Easy prose is not a recommendation, and only "
            "titles jiten.moe has analysed can appear."
        ),
        metric=Metric.DIFFICULTY,
        high_means="plainest prose",
        descending=False,
        needs_difficulty=True,
    ),
    lambda: VNDifficulty.difficulty_raw,
    lambda: VisualNovel.public_votes >= 30,
    30,
)

_title_question(
    Question(
        key="as-of",
        label="As judged then",
        title="The best {slice}, as judged by the end of {year}",
        blurb=(
            "Counting only the votes cast up to the end of that year. Not the same as "
            "today's ranking filtered by release date: this is what the community thought "
            "at the time, before later readers arrived."
        ),
        metric=Metric.RATING_AS_OF,
        high_means="rated highest at the time",
        needs_year=True,
    ),
    None,  # answered by its own scan rather than a column
    None,
    25,
)


#: The reader questions. Each is asked of the same slice, so "who has read the most of this"
#: and "whose reading is most made of this" sit next to each other rather than being separate
#: boards that happen to share a facet.
READER_QUESTIONS: dict[str, Question] = {
    q.key: q
    for q in (
        Question(
            key="read-most",
            label="Read the most of it",
            title="The biggest readers of {slice}",
            blurb=(
                "Ranked by how many qualifying titles they have voted on. A count rewards "
                "reading a lot in general as well as reading this in particular, which is "
                "what the share ranking separates out."
            ),
            metric=Metric.VOTES,
            high_means="read the most",
        ),
        Question(
            key="share",
            label="Library made of it",
            title="Libraries built on {slice}",
            blurb=(
                "Ranked by how much of a reader's voted library falls in this slice, rather "
                "than by how much of the slice they have read. A small library concentrated "
                "here outranks a large one that merely includes it."
            ),
            metric=Metric.LIBRARY_SHARE,
            high_means="most concentrated here",
        ),
        Question(
            key="characters",
            label="Japanese read",
            title="The most characters read among {slice}",
            blurb=(
                "Characters of Japanese, summed over the titles in this slice that "
                "jiten.moe has measured. A floor rather than a total: everything it has not "
                "analysed counts as nothing, so every reader here has read more than the "
                "figure says."
            ),
            metric=Metric.CHARACTERS,
            high_means="read the most Japanese",
            needs_difficulty=True,
        ),
        Question(
            key="difficulty",
            label="Hardest Japanese read",
            title="The readers of the densest prose among {slice}",
            blurb=(
                "The mean difficulty of the titles they have voted on, over the part of "
                "this slice jiten.moe has measured. Each title counts once, so one very "
                "hard book does not answer for a library."
            ),
            metric=Metric.TITLE_DIFFICULTY,
            high_means="reads the hardest",
            needs_difficulty=True,
        ),
    )
}

#: Readers must have this many measured titles before a difficulty question will speak for
#: them. Coverage is partial, so a mean over three measured titles describes the mirror
#: rather than the reader.
MIN_MEASURED_FOR_READER = 25


# -------------------------------------------------------------------------- answers


async def slice_population(db, facet: Facet) -> int:
    """How many titles the slice covers, which is what tells a genre from most of the database."""
    query = select(func.count()).select_from(VisualNovel)
    for condition in slice_conditions(facet):
        query = query.where(condition)
    return int((await db.execute(query)).scalar() or 0)


async def slice_prior(db, facet: Facet) -> float:
    """The mean vote across the slice, which thin samples are pulled toward.

    Taken over the slice rather than the whole database, matching how the curated boards
    take theirs over their own facet: the best of a hard year should be measured against
    that year.
    """
    query = select(
        func.sum(VisualNovel.public_votes * VisualNovel.public_mean)
        / func.nullif(func.sum(VisualNovel.public_votes), 0)
    ).where(VisualNovel.public_mean.isnot(None))
    for condition in slice_conditions(facet):
        query = query.where(condition)
    return float((await db.execute(query)).scalar() or 0.0)


async def title_rows(db, facet: Facet, question_key: str, year: int | None, limit: int):
    """One page of titles, ranked. Returns the rows and how many qualified."""
    question, expression, floor, min_sample, _ = TITLE_QUESTIONS[question_key]

    if question.needs_year:
        return await _as_of_rows(db, facet, year, limit)

    if question.key == "rated":
        prior = await slice_prior(db, facet)
        score = (
            VisualNovel.public_votes * VisualNovel.public_mean + BAYESIAN_PRIOR_VOTES * prior
        ) / (VisualNovel.public_votes + BAYESIAN_PRIOR_VOTES)
    else:
        score = expression()

    sample = TITLE_QUESTIONS[question_key][4]()

    query = select(
        VisualNovel.id,
        VisualNovel.title,
        VisualNovel.title_jp,
        VisualNovel.title_romaji,
        VisualNovel.image_url,
        VisualNovel.image_sexual,
        sample.label("sample"),
        score.label("score"),
    )
    if question.needs_difficulty:
        query = query.join(VNDifficulty, VNDifficulty.vn_id == VisualNovel.id)

    for condition in slice_conditions(facet):
        query = query.where(condition)
    if floor is not None:
        query = query.where(floor())
    query = query.where(score.isnot(None))

    ordering = score.desc() if question.descending else score.asc()
    # Ties break toward the better-evidenced title, on the same sample the score is a share
    # of. Breaking on votes would order two equal rates by something neither of them measures.
    ranked = query.order_by(ordering, sample.desc(), VisualNovel.id.asc())

    # The qualifying count rides along on the same scan. Asking for it separately would
    # double the cost of every ranking to report one number.
    ranked = ranked.add_columns(func.count().over().label("qualified"))
    rows = (await db.execute(ranked.limit(limit))).all()
    return rows, int(rows[0].qualified) if rows else 0


async def _as_of_rows(db, facet: Facet, year: int | None, limit: int):
    """Titles ranked on the votes they had collected by the end of a year.

    The only title question needing the vote table rather than a column: the counters on
    `visual_novels` describe today, and the whole point of this one is that it does not.
    """
    if year is None:
        raise ValueError("A year is required")

    cutoff = date(year + 1, 1, 1)
    ids = select(VisualNovel.id)
    for condition in slice_conditions(facet):
        ids = ids.where(condition)

    scored = (
        select(
            GlobalVote.vn_id.label("vn_id"),
            func.count().label("n"),
            (func.avg(GlobalVote.vote) / 10.0).label("mean"),
        )
        .where(
            and_(
                GlobalVote.vn_id.in_(ids),
                GlobalVote.date.isnot(None),
                GlobalVote.date < cutoff,
                _ELIGIBLE_VOTER,
            )
        )
        .group_by(GlobalVote.vn_id)
        .having(func.count() >= 25)
        .subquery()
    )

    prior = float(
        (
            await db.execute(
                select(
                    func.sum(scored.c.n * scored.c.mean) / func.nullif(func.sum(scored.c.n), 0)
                )
            )
        ).scalar()
        or 0.0
    )
    score = (scored.c.n * scored.c.mean + BAYESIAN_PRIOR_VOTES * prior) / (
        scored.c.n + BAYESIAN_PRIOR_VOTES
    )

    ranked = (
        select(
            VisualNovel.id,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            scored.c.n.label("sample"),
            score.label("score"),
        )
        .join(scored, scored.c.vn_id == VisualNovel.id)
        .order_by(score.desc(), scored.c.n.desc(), VisualNovel.id.asc())
    )

    ranked = ranked.add_columns(func.count().over().label("qualified"))
    rows = (await db.execute(ranked.limit(limit))).all()
    return rows, int(rows[0].qualified) if rows else 0


def share_is_degenerate(facet: Facet) -> bool:
    """Whether a share over this slice can only ever be 100%.

    A share divides what a reader read inside the slice by everything they read. Where the
    slice narrows by nothing except the language the denominator is already restricted to,
    the two are the same set and every reader scores exactly one, which ranks nobody and says
    the opposite of what the question claims to separate out.
    """
    return facet == Facet(olang=facet.olang)


async def user_vote_totals(db, olang: str | None) -> dict[str, int]:
    """Every reader's public vote count, which is the denominator a share is taken over.

    Independent of the slice, so one pass serves every share ranking asked for until the
    next dump. Readers below the share floor are dropped here: they can never place.
    """
    query = (
        select(GlobalVote.user_hash, func.count().label("total"))
        .where(_ELIGIBLE_VOTER)
        .group_by(GlobalVote.user_hash)
        .having(func.count() >= MIN_LIBRARY_FOR_SHARE)
    )
    if olang is not None:
        query = query.join(VisualNovel, VisualNovel.id == GlobalVote.vn_id).where(
            VisualNovel.olang == olang
        )
    return {row.user_hash: int(row.total) for row in (await db.execute(query)).all()}


async def reader_rows(
    db, facet: Facet, question_key: str, limit: int, totals: dict[str, int] | None
):
    """One page of readers, ranked over the slice."""
    question = READER_QUESTIONS[question_key]

    ids = select(VisualNovel.id)
    for condition in slice_conditions(facet):
        ids = ids.where(condition)

    if question.key in ("characters", "difficulty"):
        measure = (
            func.sum(VNDifficulty.character_count)
            if question.key == "characters"
            else func.avg(VNDifficulty.difficulty_raw)
        )
        query = (
            select(
                GlobalVote.user_hash.label("uid"),
                func.count().label("sample"),
                measure.label("score"),
            )
            .join(VNDifficulty, VNDifficulty.vn_id == GlobalVote.vn_id)
            .where(and_(GlobalVote.vn_id.in_(ids), _ELIGIBLE_VOTER))
            .group_by(GlobalVote.user_hash)
            .having(func.count() >= MIN_MEASURED_FOR_READER)
        )
        if question.key == "characters":
            query = query.where(VNDifficulty.character_count.isnot(None))
        else:
            query = query.where(VNDifficulty.difficulty_raw.isnot(None))
        ranked = query.order_by(measure.desc(), func.count().desc(), GlobalVote.user_hash)
        ranked = ranked.add_columns(func.count().over().label("qualified"))
        rows = (await db.execute(ranked.limit(limit))).all()
        return (
            [(r.uid, float(r.score), int(r.sample)) for r in rows],
            int(rows[0].qualified) if rows else 0,
        )

    counted = (
        select(GlobalVote.user_hash.label("uid"), func.count().label("n"))
        .where(and_(GlobalVote.vn_id.in_(ids), _ELIGIBLE_VOTER))
        .group_by(GlobalVote.user_hash)
    )

    if question.key == "read-most":
        ranked = counted.order_by(func.count().desc(), GlobalVote.user_hash).add_columns(
            func.count().over().label("qualified")
        )
        rows = (await db.execute(ranked.limit(limit))).all()
        return (
            [(r.uid, float(r.n), int(r.n)) for r in rows],
            int(rows[0].qualified) if rows else 0,
        )

    # A share needs a denominator this query does not know about, so the counts are taken
    # whole and reordered here rather than ranked by the database on the wrong number.
    counts = [(r.uid, int(r.n)) for r in (await db.execute(counted)).all()]
    candidates = []
    for uid, n in counts:
        denominator = (totals or {}).get(uid)
        if denominator:
            candidates.append((uid, n / denominator, denominator, n))
    candidates.sort(key=lambda row: (-row[1], -row[3], row[0]))
    return [(uid, share, denominator) for uid, share, denominator, _ in candidates[:limit]], len(
        candidates
    )


async def usernames_for(db, uids: list[str]) -> dict[str, str]:
    """Display names for one page of readers."""
    if not uids:
        return {}
    rows = await db.execute(
        select(VndbUser.uid, VndbUser.username).where(
            VndbUser.uid.in_([f"u{uid}" for uid in uids])
        )
    )
    return {row.uid: row.username for row in rows}


# ---------------------------------------------------------------------- disclosure


#: Platform names for the phrase a ranking is titled with. Only the display form lives here;
#: the code is the data, and the picker's own list is what a reader chooses from. Anything
#: unlisted falls back to its code, which VNDB spells recognisably in upper case.
_PLATFORM_NAMES = {
    "p98": "the PC-98",
    "p88": "the PC-88",
    "fm7": "the FM-7",
    "fm8": "the FM-8",
    "x1s": "the Sharp X1",
    "x68": "the X68000",
    "msx": "MSX",
    "win": "Windows",
    "mac": "macOS",
    "lin": "Linux",
    "web": "the web",
    "and": "Android",
    "ios": "iOS",
    "swi": "the Switch",
}

#: Length categories as a reader would say them, keyed by VNDB's own 1-5 scale.
_LENGTH_NAMES = {
    1: "very short",
    2: "short",
    3: "medium-length",
    4: "long",
    5: "very long",
}


def _years_phrase(facet: Facet) -> str | None:
    """A release range as words, collapsing a whole decade into its own name."""
    low, high = facet.year_min, facet.year_max
    if low is None and high is None:
        return None
    if low is not None and high is not None:
        if low == high:
            return f"from {low}"
        if low % 10 == 0 and high == low + 9:
            return f"from the {low}s"
        return f"from {low} to {high}"
    if low is not None:
        return f"from {low} onwards"
    return f"released before {high + 1}"


def slice_phrase(facet: Facet, tag_name: str | None) -> str:
    """The slice as a noun phrase, for the ranking's own title.

    Built to read as English rather than as a filter list, since it is the title a reader
    sees and shares. The full machine-readable description travels separately, so nothing
    here has to be exhaustive.
    """
    if facet.is_empty:
        return "visual novels"

    adjectives = []
    # A title written in one language and released in no other is one idea, not two, so the
    # pair collapses rather than reading as "Japanese never translated".
    if facet.lang_only and facet.lang_only == facet.olang:
        adjectives.append("Japanese-only" if facet.olang == "ja" else f"{facet.olang}-only")
    else:
        if facet.olang == "ja":
            adjectives.append("Japanese")
        elif facet.olang:
            adjectives.append(f"{facet.olang}-original")
        if facet.lang_only:
            adjectives.append(f"released only in {facet.lang_only}")
    if facet.freeware or facet.jp_freeware:
        adjectives.append("freeware")
    if facet.minage_max is not None and facet.minage_max < 18:
        adjectives.append("all-ages")
    if facet.length is not None:
        adjectives.append(_LENGTH_NAMES.get(facet.length, ""))
    if facet.difficulty_max is not None and facet.difficulty_min is None:
        adjectives.append("beginner-level")
    if facet.difficulty_min is not None and facet.difficulty_max is None:
        adjectives.append("advanced")

    noun = "visual novels" if tag_name is None else f"{tag_name} titles"
    phrase = " ".join([a for a in adjectives if a] + [noun])

    if facet.platform is not None:
        phrase += f" on {_PLATFORM_NAMES.get(facet.platform, facet.platform.upper())}"
    years = _years_phrase(facet)
    if years:
        phrase += f" {years}"
    if facet.votecount_max is not None:
        phrase += f" with {facet.votecount_max} votes or fewer"

    return phrase


def _slice_sentence(facet: Facet, population: int, tag_name: str | None) -> str:
    """The slice in words, with the tag named rather than numbered."""
    described = facets.describe(facet)
    if tag_name is not None:
        described = described.replace(f"tagged g{facet.tag}", f"tagged {tag_name}")
    if facet.is_empty:
        return f"all {population:,} visual novels"
    return f"the {population:,} visual novels {described}"


def _title_disclosure(question: Question, slice_text: str, min_sample: int, year: int | None):
    floor = {
        "rated": f"{min_sample} public votes.",
        "voted": "None beyond having a public vote.",
        "divisive": f"{min_sample} public votes, since a spread over a handful is not a spread.",
        "dropped": f"{min_sample} readers who started it.",
        "finished": f"{min_sample} readers who started it.",
        "wishlisted": "None beyond appearing on one wishlist.",
        "aged-up": f"{min_sample} public votes split across the two halves of its history.",
        "aged-down": f"{min_sample} public votes split across the two halves of its history.",
        "hardest": f"{min_sample} public votes. A script can be measured without enough readers.",
        "easiest": f"{min_sample} public votes. A script can be measured without enough readers.",
        "as-of": f"{min_sample} votes cast by the end of {year}.",
    }[question.key]

    excluded = VOTE_EXCLUSIONS
    if question.needs_difficulty:
        excluded = (
            "Every title jiten.moe has not analysed, which is most of the database. "
            + VOTE_EXCLUSIONS
        )

    return Disclosure(
        population=f"Ranked over {slice_text}.",
        floor=floor,
        score=f"{question.blurb} {TIE_BREAK}",
        excluded=excluded,
    )


def _reader_disclosure(question: Question, slice_text: str):
    floor = {
        "read-most": "None. Every reader with at least one qualifying vote is ranked.",
        "share": (
            f"{MIN_LIBRARY_FOR_SHARE} public votes. A share over a handful of votes reaches "
            "100% on no evidence, so the denominator carries the floor."
        ),
        "characters": f"{MIN_MEASURED_FOR_READER} measured titles inside the slice.",
        "difficulty": f"{MIN_MEASURED_FOR_READER} measured titles inside the slice.",
    }[question.key]

    excluded = VOTE_EXCLUSIONS
    if question.needs_difficulty:
        excluded = (
            "Every title jiten.moe has not analysed, which is most of the database, so these "
            "figures describe the measured part of a library rather than all of it. "
            + VOTE_EXCLUSIONS
        )

    return Disclosure(
        population=f"Every reader with public votes on {slice_text}.",
        floor=floor,
        score=f"{question.blurb} {TIE_BREAK}",
        excluded=excluded,
    )


# --------------------------------------------------------------------------- entry


async def tag_name(db, tag_id: int) -> str | None:
    row = (await db.execute(select(Tag.name).where(Tag.id == tag_id))).first()
    return row.name if row else None


async def build_custom_ranking(
    db,
    *,
    subject: str,
    question_key: str,
    facet: Facet,
    year: int | None = None,
    limit: int = LIVE_ROW_LIMIT,
    totals: dict[str, int] | None = None,
) -> dict | None:
    """One live ranking over a slice, shaped like any other board.

    Returns None when the slice names a tag that does not exist, which the caller turns into
    a 404. Anything else empty is a real answer: a slice can be narrow enough to hold
    nothing, and that is worth saying rather than hiding.
    """
    await bound_statement_cost(db)

    name = None
    if facet.tag is not None:
        name = await tag_name(db, facet.tag)
        if name is None:
            return None

    population = await slice_population(db, facet)
    slice_text = _slice_sentence(facet, population, name)
    described = facets.describe(facet)
    if name is not None:
        described = described.replace(f"tagged g{facet.tag}", f"tagged {name}")

    if subject == "vns":
        question = TITLE_QUESTIONS[question_key][0]
        min_sample = TITLE_QUESTIONS[question_key][3]
        rows, total_ranked = await title_rows(db, facet, question_key, year, limit)
        disclosure = _title_disclosure(question, slice_text, min_sample, year)
        payload_rows = [
            {
                "rank": index,
                "id": row.id,
                "label": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "href": f"/vn/{row.id}",
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "value": round(float(row.score), 4),
                "value_label": format_value(question.metric, float(row.score), int(row.sample or 0)),
                "secondary": {},
            }
            for index, row in enumerate(rows, start=1)
        ]
    else:
        question = READER_QUESTIONS[question_key]
        if question.key == "share":
            # Over a slice that narrows by nothing, a share is every reader at 100% and the
            # ranking says nothing. The count is the honest answer to the same slice.
            if share_is_degenerate(facet):
                question = READER_QUESTIONS["read-most"]
                question_key = "read-most"
            elif totals is None:
                totals = await user_vote_totals(db, facet.olang)
        scored, total_ranked = await reader_rows(db, facet, question_key, limit, totals)
        disclosure = _reader_disclosure(question, slice_text)
        names = await usernames_for(db, [uid for uid, _, _ in scored])
        payload_rows = []
        for index, (uid, value, sample) in enumerate(scored, start=1):
            prefixed = f"u{uid}"
            username = names.get(prefixed)
            if username is None:
                # A voter absent from the users dump can be neither named nor linked.
                continue
            payload_rows.append(
                {
                    "rank": index,
                    "id": prefixed,
                    "label": username,
                    "href": f"/stats/{prefixed}",
                    "value": round(float(value), 4),
                    "value_label": format_value(question.metric, float(value), int(sample)),
                    "secondary": {},
                }
            )

    title = question.title.format(slice=slice_phrase(facet, name), year=year)

    return {
        "slug": None,
        "title": title,
        "blurb": question.blurb,
        "subject": "user" if subject == "readers" else "vn",
        "metric": question.metric.value,
        "window": "all",
        "home": "rankings",
        "facet": {
            "canonical": facet.canonical(),
            "titles": population,
            "tag": facet.tag,
            "name": name,
            "year": year,
        },
        "facet_description": described or "all visual novels",
        "language": facet.olang or "all",
        "has_language_variants": True,
        "is_live": True,
        "total_ranked": total_ranked,
        "rows": payload_rows,
        "disclosure": {
            "population": disclosure.population,
            "floor": disclosure.floor,
            "score": disclosure.score,
            "excluded": disclosure.excluded,
        },
        "notes": [],
    }
