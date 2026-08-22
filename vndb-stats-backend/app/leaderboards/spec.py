"""Types describing a leaderboard.

A board is addressed by four axes: what is ranked (subject), how it is ranked (metric),
which slice of the database counts (facet), and over what period (window). Everything else
in this package is either a way of computing one of these, or a way of rendering it.

Keeping the axes separate is what lets the catalogue grow by adding registry entries rather
than code. It also means an arbitrary combination can be requested directly, which is why
`Facet.canonical` has to be stable: it is the cache key.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, fields
from enum import Enum


class Subject(str, Enum):
    """What a row of the board represents."""

    USER = "user"
    VN = "vn"
    DEVELOPER = "developer"
    PUBLISHER = "publisher"
    STAFF = "staff"
    SEIYUU = "seiyuu"
    SERIES = "series"
    TAG = "tag"


#: Subjects scored by pooling the counters of the visual novels they are credited on,
#: rather than being counted directly. All of them are keyed into the user side of a
#: bucket by the roll-up, which is why only VN boards read the VN side.
ROLLED_UP_SUBJECTS = frozenset({
    Subject.DEVELOPER,
    Subject.PUBLISHER,
    Subject.STAFF,
    Subject.SEIYUU,
    Subject.SERIES,
    # A tag is scored from the titles carrying it, the same shape as a studio's catalogue,
    # though it aggregates their ratings rather than pooling their votes.
    Subject.TAG,
})


class Metric(str, Enum):
    """How rows are ordered."""

    # Vote-derived, from global_votes.
    VOTES = "votes"
    AVG_SCORE = "avg_score"
    BAYESIAN = "bayesian"
    VOTERS = "voters"
    DIVISIVENESS = "divisiveness"
    SOLE_VOTER = "sole_voter"
    #: Share of a title's lifetime votes that arrived inside the window. A newly released
    #: title legitimately scores near 1.0, which is the point; the sample floor is what
    #: keeps a title with three votes off the chart.
    VELOCITY = "velocity"
    #: Change in a title's average between its earlier and later votes, in rating points.
    #: Positive means its reputation grew; negative means it did not last.
    REPUTATION_SHIFT = "reputation_shift"
    #: Bayesian average using only the votes cast up to a given year, so a board can show
    #: what the community thought at the time rather than what it thinks now.
    RATING_AS_OF = "rating_as_of"

    #: Titles behind an entity, rather than the votes those titles collected. Answers "how
    #: much has this person actually led" instead of "how popular were the works".
    WORKS = "works"
    #: Japanese reading difficulty, mirrored from jiten.moe.
    DIFFICULTY = "difficulty"
    #: How much later than its contemporaries a title collected its votes. Normalised
    #: against other titles released the same year, or it would only rank old ones.
    DISCOVERY_LAG = "discovery_lag"
    #: Mean and spread of the ratings of every title in a set, unweighted by how many votes
    #: each title drew. Used for tags, where pooling votes would let one famous title speak
    #: for the whole tag.
    TITLE_MEAN = "title_mean"
    TITLE_SPREAD = "title_spread"
    #: Years between a studio's first and most recent release.
    ACTIVE_SPAN = "active_span"
    #: Median release year of what a reader has voted on.
    ERA = "era"
    #: How far a reader's votes sit from the community's, on the same titles. Measures the
    #: reader rather than what they chose to read, which a plain average cannot separate.
    VOTE_BIAS = "vote_bias"
    #: The same gap taken as a distance, ignoring direction. A uniformly harsh reader scores
    #: low here; one who loves what others dislike scores high.
    VOTE_DIVERGENCE = "vote_divergence"
    #: Typical number of other voters on the titles a reader has voted on. Low means they
    #: read where almost nobody else has.
    OBSCURITY = "obscurity"
    #: The weakest title in an entity's catalogue, which is what "can I read this studio
    #: blind" actually asks. Ranking on the average hides a single bad entry.
    CATALOGUE_FLOOR = "catalogue_floor"

    #: Averages of a per-title figure over every title an entity covers, each title counting
    #: once. For a tag this is the only honest shape: pooling would let one hugely-voted
    #: title answer for the hundreds of others carrying the same tag.
    TITLE_DIFFICULTY = "title_difficulty"
    TITLE_DROP_RATE = "title_drop_rate"
    TITLE_RECENCY = "title_recency"

    #: How far a reader's votes move when the community's move, as the slope of their votes
    #: regressed on the community average for the same titles. One means they track
    #: consensus; three means they treat the same range as three times as wide.
    VOTE_RESPONSE = "vote_response"
    #: How evenly a reader's votes are spread across the months they were active, as the
    #: entropy of their monthly counts normalised by career length. Measures rhythm, not
    #: volume: the largest voter in the population does not place.
    STEADINESS = "steadiness"
    #: The width of the release-year band holding the middle 80% of what a reader has voted
    #: on. Small means their reading sits inside one period of the medium's history.
    ERA_WINDOW = "era_window"
    #: How much more often than expected a title was the last thing a reader logged before
    #: going quiet. Normalised against the period the votes were cast in, since the chance
    #: of any vote being someone's last rises steadily over the record.
    TERMINAL_RATE = "terminal_rate"
    #: Years between a franchise's first and most recent entry.
    SERIES_SPAN = "series_span"
    #: The share of a reader's library made up of titles of one kind. Asks what someone's
    #: reading is composed of rather than how much of it there is, which is what separates it
    #: from counting their votes inside a facet: a count of PC-98 titles mostly re-ranks
    #: whoever votes most, while a share names the people who actually read PC-98.
    LIBRARY_SHARE = "library_share"
    #: How far the release years of a reader's picks have travelled across their own history,
    #: in years. Negative means their reading has moved into the past, which is the direction
    #: worth a board: drifting forward is what happens by default as new titles come out.
    READING_DRIFT = "reading_drift"
    #: Mean length of what a reader wants to read minus the mean length of what they
    #: finish, in VNDB length categories. Signed: the direction is the whole point.
    BACKLOG_GAP = "backlog_gap"
    #: How many different themes a reader's library would show in a fixed-size sample of it.
    #: A count rather than a share, and independent of library size by construction, which is
    #: what separates it from simply counting the tags someone has touched.
    THEME_RANGE = "theme_range"

    # List-state derived, from ulist_labels.
    FINISHED = "finished"
    DROPPED = "dropped"
    DROP_RATE = "drop_rate"
    COMPLETION_RATE = "completion_rate"
    WISHLIST = "wishlist"
    #: Characters of Japanese in the titles a reader has been through, over the part of
    #: their library the difficulty mirror has measured. A floor, never a total.
    CHARACTERS = "characters"


class Home(str, Enum):
    """Which page lists a board.

    A board's home is about the question it answers, not the data behind it. Anything about
    what is popular now, what was popular then, or how that changed belongs with the other
    moving figures; the rankings are for the standing questions VNDB's own search cannot
    express. Both kinds render through the same board page, so this decides discovery only.
    """

    RANKINGS = "rankings"
    TRENDS = "trends"


class Window(str, Enum):
    """The period a board covers.

    All periods are rolling and end at the dump's most recent vote, not at a calendar
    boundary. A calendar month would leave every monthly board nearly empty on the 1st.
    """

    ALL = "all"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


#: Length of each rolling window in days. ALL is absent: it has no lower bound.
WINDOW_DAYS: dict[Window, int] = {
    Window.WEEK: 7,
    Window.MONTH: 30,
    Window.YEAR: 365,
}


#: Metrics that read global_votes. Everything else reads ulist_labels, which has no
#: timestamp of its own and therefore cannot be windowed honestly.
VOTE_METRICS = frozenset({
    Metric.VOTES,
    Metric.LIBRARY_SHARE,
    Metric.READING_DRIFT,
    Metric.THEME_RANGE,
    Metric.WORKS,
    Metric.DIFFICULTY,
    Metric.DISCOVERY_LAG,
    Metric.TITLE_MEAN,
    Metric.TITLE_SPREAD,
    Metric.ACTIVE_SPAN,
    Metric.ERA,
    Metric.VOTE_BIAS,
    Metric.VOTE_DIVERGENCE,
    Metric.OBSCURITY,
    Metric.CATALOGUE_FLOOR,
    Metric.ERA_WINDOW,
    Metric.VOTE_RESPONSE,
    Metric.STEADINESS,
    Metric.TERMINAL_RATE,
    Metric.SERIES_SPAN,
    Metric.AVG_SCORE,
    Metric.BAYESIAN,
    Metric.VOTERS,
    Metric.DIVISIVENESS,
    Metric.SOLE_VOTER,
    Metric.VELOCITY,
    Metric.REPUTATION_SHIFT,
    Metric.RATING_AS_OF,
})

#: Metrics derived from their own grouped scan of the vote table rather than from bucket
#: counters. Each needs every title's community mean before a single reader can be scored,
#: which the streaming accumulation cannot provide while it is still running.
READER_SCAN_METRICS = frozenset({
    Metric.VOTE_BIAS,
    Metric.VOTE_DIVERGENCE,
    Metric.OBSCURITY,
    Metric.ERA,
    Metric.ERA_WINDOW,
    Metric.VOTE_RESPONSE,
    Metric.STEADINESS,
})

#: Metrics averaging a per-title figure over the titles an entity covers, each title
#: counting once whatever its vote count. Dispatched ahead of everything else because the
#: figure being averaged is not always vote-derived: a drop rate comes from list states.
TITLE_AVERAGE_METRICS = frozenset(
    {Metric.TITLE_DIFFICULTY, Metric.TITLE_DROP_RATE, Metric.TITLE_RECENCY}
)

#: Metrics aggregating the scores of a set of titles without weighting by vote count.
TITLE_SET_METRICS = frozenset(
    {Metric.CATALOGUE_FLOOR, Metric.TITLE_MEAN, Metric.TITLE_SPREAD}
)

#: Metrics computed from stored per-title vote histories rather than from bucket counters.
#: Both need the base bucket, whatever facet the board itself carries.
HISTORY_METRICS = frozenset({Metric.REPUTATION_SHIFT, Metric.RATING_AS_OF})

#: Share-of-population metrics, which are damped toward the population rate so a thin
#: sample cannot tie a large one at the top of a board.
RATE_METRICS = frozenset({Metric.DROP_RATE, Metric.COMPLETION_RATE})

#: Metrics read from list states rather than from votes. The backlog gap belongs here because
#: both of its sides are list states, even though it is a difference of means rather than a
#: count and so is dispatched before the count-shaped ones.
LIST_METRICS = frozenset({
    Metric.FINISHED,
    Metric.DROPPED,
    Metric.DROP_RATE,
    Metric.COMPLETION_RATE,
    Metric.WISHLIST,
    Metric.BACKLOG_GAP,
})


#: VNDB's category for tags describing an individual adult scene. Two rules rest on it.
#: A board asking what a title is like to read excludes them, because a scene is not a
#: property of the writing. A ranking of named readers may not be narrowed to one at all:
#: how much of a person's reading carries such a tag is an inference about that person,
#: and these pages are public.
ADULT_SCENE_TAG_CATEGORIES: tuple[str, ...] = ("ero",)


@dataclass(frozen=True)
class Facet:
    """Which visual novels count toward a board.

    Every field resolves against a column on visual_novels, with one exception: `tag`
    needs vn_tags and is therefore preset-only. Adding a field here means adding it to
    `facets.predicate` and to the matcher in `compute`, or it will be silently ignored.
    """

    olang: str | None = None  # original language, e.g. "ja"
    lang_only: str | None = None  # released in this language and no other
    year_min: int | None = None
    year_max: int | None = None
    platform: str | None = None  # VNDB platform code, e.g. "p98"
    length: int | None = None  # 1-5 length category
    freeware: bool = False  # has a free, non-trial release
    jp_freeware: bool = False  # every Japanese release is free
    minage_max: int | None = None
    votecount_min: int | None = None
    votecount_max: int | None = None  # the obscurity ceiling behind "hidden gems"
    difficulty_min: float | None = None  # jiten reading difficulty, mirrored locally
    difficulty_max: float | None = None
    tag: int | None = None

    def canonical(self) -> str:
        """Stable textual form. Two equal facets must produce the same string."""
        parts = []
        for f in fields(self):
            value = getattr(self, f.name)
            if value is None or value is False:
                continue
            parts.append(f"{f.name}={value}")
        return ";".join(sorted(parts))

    def hash(self) -> str:
        return hashlib.sha1(self.canonical().encode()).hexdigest()[:12]

    @property
    def is_empty(self) -> bool:
        return self.canonical() == ""

    @property
    def needs_tags(self) -> bool:
        """True when evaluating this facet requires the vn_tags table."""
        return self.tag is not None


EMPTY_FACET = Facet()


@dataclass(frozen=True)
class Disclosure:
    """How one board arrives at its numbers, in the reader's terms.

    Every board answers the same four questions and answers them for itself, because the
    right population for a voice-actor board is not the right one for a reader board and
    pretending otherwise is how a board ends up ranking QA testers by reception.

    These are shown under "How this is counted" rather than kept in documentation. A ranking
    whose method is not on the page is asking to be taken on trust, and several of these
    boards rest on choices a reader would reasonably want to check.
    """

    #: What was eligible to be ranked at all, before any threshold.
    population: str
    #: The minimum sample, stated in the unit that actually decides it: works for a creator,
    #: finished titles for a reader, votes for a title.
    floor: str
    #: The formula in one plain sentence, including damping and the tie-break.
    score: str
    #: Who was deliberately left out, and why.
    excluded: str

    def as_lines(self) -> tuple[str, ...]:
        """Rendered form, labelled so each answer is attributable to its question."""
        return (
            f"Ranked from: {self.population}",
            f"Minimum to qualify: {self.floor}",
            f"Score: {self.score}",
            f"Left out: {self.excluded}",
        )


@dataclass(frozen=True)
class BoardSpec:
    """One entry in the leaderboard catalogue."""

    slug: str
    title: str
    subject: Subject
    metric: Metric
    blurb: str = ""
    #: Which page lists this board. Defaults to the rankings, so a new board has to opt in
    #: to the trends page rather than landing there by accident.
    home: Home = Home.RANKINGS
    window: Window = Window.ALL
    facet: Facet = EMPTY_FACET
    #: When set, a subject qualifies only if *every* one of its contributions matches the
    #: facet, rather than being ranked on the matching subset. This is what separates
    #: "users who only ever vote on Japanese-original games" from "users with the most
    #: votes on Japanese-original games".
    require_pure: bool = False
    #: Floor on the underlying sample, to keep a single vote from topping a ratio board.
    min_count: int = 0
    #: Rank upward instead of downward. Needed for boards where low is the interesting end,
    #: such as the harshest voters.
    ascending: bool = False
    #: Floor on the number of credited works, for subjects scored by pooling other people's
    #: titles. Distinct from `min_count`, which counts votes: one credit on a famous title
    #: brings tens of thousands of votes and clears any vote floor while saying nothing.
    min_works: int = 0
    #: Floor on titles a reader has actually finished. Without it a "gives up most often"
    #: board is topped by accounts that finished nothing and labelled in bulk.
    min_finished: int = 0
    #: For producer boards: which kinds of company count. VNDB classes producers as
    #: companies, amateur groups or individuals, and a fan translation group publishing a
    #: release of a masterpiece is not a publisher in the sense a reader means.
    producer_types: tuple[str, ...] = field(default_factory=tuple)
    #: For voice-actor boards: which character roles count. A credit table entry does not
    #: distinguish a lead from one line, and counting them alike makes a career of cameos
    #: look like a career of leads.
    character_roles: tuple[str, ...] = field(default_factory=tuple)
    #: For staff boards: which credited roles count. Empty means every role, which is only
    #: right for boards about how much someone worked rather than how it was received.
    credit_roles: tuple[str, ...] = field(default_factory=tuple)
    #: For share boards: which composition of a reader's library is ranked. Names an entry in
    #: the composition registry, which owns what counts toward the figure and what it is
    #: measured against.
    composition: str = ""
    #: For tag boards: tag categories to leave out. VNDB files tags as content, technical
    #: or adult-scene, and the last describes a scene rather than the work, which makes it
    #: the wrong unit for a board about what a title is like to read.
    excluded_tag_categories: tuple[str, ...] = field(default_factory=tuple)
    #: For series boards: group franchises on continuation relations only, dropping the
    #: looser links that merely connect two works. The loose set is right when pooling a
    #: franchise's votes, and wrong when measuring how long one has been running: a single
    #: spin-off named in homage to an older work is enough to backdate a franchise by
    #: decades, and that one edge becomes the headline number.
    strict_series: bool = False
    #: For RATING_AS_OF: only votes cast up to the end of this year are counted.
    as_of_year: int | None = None
    #: How this board is counted. Required: a board that cannot say where its numbers come
    #: from should not be published.
    disclosure: Disclosure | None = None
    #: Credit for data this site did not produce, shown with the board rather than only in
    #: its methodology panel. Reading difficulty is the one figure on the site that comes
    #: from somewhere else.
    attribution: tuple[str, str] | None = None
    #: Further caveats, beyond the four standing disclosures.
    notes: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self):
        if self.metric is Metric.RATING_AS_OF and self.as_of_year is None:
            raise ValueError(f"{self.slug}: a rating-as-of board needs an as_of_year")

        if self.disclosure is None:
            raise ValueError(f"{self.slug}: every board must disclose how it is counted")

        if self.min_works and self.subject not in ROLLED_UP_SUBJECTS:
            raise ValueError(
                f"{self.slug}: min_works only means something for a rolled-up subject"
            )

        if self.character_roles and self.subject is not Subject.SEIYUU:
            raise ValueError(f"{self.slug}: character_roles only applies to voice-actor boards")

        if self.credit_roles and self.subject is not Subject.STAFF:
            raise ValueError(f"{self.slug}: credit_roles only applies to staff boards")

        if self.producer_types and self.subject not in (Subject.DEVELOPER, Subject.PUBLISHER):
            raise ValueError(f"{self.slug}: producer_types only applies to producer boards")

        if bool(self.composition) != (self.metric is Metric.LIBRARY_SHARE):
            raise ValueError(
                f"{self.slug}: a share board names one composition, and only a share board "
                "may name one"
            )

        if self.strict_series and self.subject is not Subject.SERIES:
            raise ValueError(f"{self.slug}: strict_series only applies to series boards")

        if self.excluded_tag_categories and self.subject is not Subject.TAG:
            raise ValueError(
                f"{self.slug}: excluded_tag_categories only applies to tag boards"
            )

        if self.window is not Window.ALL and self.metric in LIST_METRICS:
            # ulist_labels carries no timestamp, so a windowed list-state board is always
            # an approximation. It is allowed, but it has to say so.
            if not self.notes:
                raise ValueError(
                    f"{self.slug}: windowed list-state boards must carry a note explaining "
                    "that the period is approximated from list modification time"
                )

    @property
    def all_notes(self) -> tuple[str, ...]:
        """What is shown under "How this is counted": the four answers, then any caveats."""
        lines = self.disclosure.as_lines() if self.disclosure else ()
        return (*lines, *self.notes)

    @property
    def credit_key(self) -> tuple[str, ...]:
        """Identifies the credit mapping this board needs, since two staff boards over
        different roles cannot share one."""
        return (
            self.subject.value,
            *sorted(self.credit_roles),
            *sorted(self.character_roles),
            *sorted(self.producer_types),
            *sorted(self.excluded_tag_categories),
            *((self.composition,) if self.composition else ()),
            *(("strict",) if self.strict_series else ()),
        )

    @property
    def bucket_key(self) -> tuple[str, str, bool]:
        """Boards sharing this key can be computed from one accumulation pass."""
        return (self.facet.canonical(), self.window.value, self.require_pure)


def board_cache_key(
    subject: Subject,
    metric: Metric,
    facet: Facet,
    window: Window,
) -> str:
    """Redis key for a board, preset or ad-hoc."""
    return f"lb:v1:{subject.value}:{metric.value}:{facet.hash()}:{window.value}"


#: The Japanese-original view of a board. The site is about reading Japanese, so this is
#: what the frontend asks for by default; "all" remains the API default so a third-party
#: consumer is never silently handed a filtered ranking.
LANGUAGE_JAPANESE = "ja"
LANGUAGE_ALL = "all"


def slug_cache_key(slug: str, language: str = LANGUAGE_ALL) -> str:
    if language == LANGUAGE_JAPANESE:
        return f"lb:v1:slug:{slug}:ja"
    return f"lb:v1:slug:{slug}"


CATALOGUE_CACHE_KEY = "lb:v1:catalogue"
