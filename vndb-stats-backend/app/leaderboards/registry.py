"""The curated leaderboard catalogue.

Every entry here is materialised nightly and served from cache, so adding one costs a
little compute in the daily job and nothing at request time. Entries are grouped by subject
purely for readability; the API groups them the same way.

Slugs are permanent. They appear in URLs and in the sitemap, so rename a title freely but
never a slug.

Several of these reproduce queries that VNDB users write by hand against the public query
browser. Where that is the case the wording of the original is preserved in the blurb, so
someone comparing the two can see they mean the same thing.
"""

from __future__ import annotations

from .disclosures import (
    LIST_EXCLUSIONS,
    BAYESIAN_NOTE,
    TIE_BREAK,
    VOTE_EXCLUSIONS,
    entity_rating,
    entity_votes,
    reader_list_count,
    reader_votes,
    title_rate,
    title_rating,
    title_spread,
    title_votes,
)
from .thresholds import (
    MIN_LIBRARY_FOR_SHARE,
    MIN_PER_SIDE_FOR_BACKLOG,
    MIN_LIST_ENTRIES_FOR_RATE,
    MIN_RATERS_FOR_TERMINAL,
    MIN_RESPONSE_FIT,
    MIN_SPAN_FOR_STEADINESS,
    MIN_TERMINAL_OBSERVED,
    MIN_VOTES_FOR_CONSENSUS,
    MIN_VOTES_FOR_RECENCY,
    MIN_VOTES_FOR_RESPONSE,
    MIN_VOTES_FOR_STEADINESS,
    MIN_VOTES_FOR_TERMINAL,
    MIN_VOTES_PER_SERIES_ENTRY,
    TERMINAL_MATURITY_DAYS,
    TERMINAL_SILENCE_DAYS,
)
from .spec import (
    ADULT_SCENE_TAG_CATEGORIES,
    BoardSpec,
    Disclosure,
    Facet,
    Home,
    Metric,
    Subject,
    Window,
)

# Ratio and average boards need a floor, or a user with two votes tops the rating charts.
_MIN_VOTES_FOR_AVERAGE = 20

#: Comparable votes before a reader's standing against the community settles down. Far above
#: the floor used for a plain average, which is low enough that many readers tie at exactly
#: ten out of ten and the order between them is arbitrary.
_MIN_VOTES_FOR_BIAS = 100

#: The route-structure pair is measured only against titles where route structure is recorded,
#: which is a minority of the database, so its floor counts those rather than all votes.
_MIN_ROUTE_TAGGED = 100

#: Credited titles a reader needs before the share from a single name is published.
_MIN_CREDITED_FOR_DEVOTION = 50

#: Series a reader must have entered before their series habits are ranked.
_MIN_FRANCHISES_ENTERED = 20

#: Dated votes a reader needs before their reading is said to have drifted.
_MIN_VOTES_FOR_DRIFT = 60

#: Sufficiently tagged titles a reader needs before the range of their reading is estimated.
_MIN_TAGGED_FOR_THEMES = 50

_SHARE_EXCLUSIONS = (
    "Accounts VNDB excludes from public vote aggregates, which are absent from the vote data "
    "entirely. Titles a reader has on a list but has not voted on: this reads votes, so it "
    "describes what someone has finished with rather than what they own."
)

#: Japanese-original titles before obscurity describes a habit rather than a few finds.
_MIN_VOTES_FOR_OBSCURITY = 150
_MIN_VOTES_FOR_VN_RATING = 50
_MIN_VOTES_FOR_DIVISIVENESS = 20
_MIN_LIST_ENTRIES_FOR_RATE = 50

#: Separate titles a person or company must be credited on before an average of their
#: reception means anything. Votes are the wrong unit here: one credit on a landmark title
#: carries tens of thousands of them.
_MIN_WORKS_FOR_PERSON = 5
MIN_WORKS_FOR_COMPANY = 4

#: VNDB classes a producer as a company, an amateur group or an individual. The reception
#: boards keep only companies: a fan translation group is credited on releases of titles it
#: did not make, and inherits their reception without having shaped it.
COMMERCIAL_ONLY = ("co",)

#: Roles that constitute making the work. A translator, tester or image editor contributed
#: to a release, not to how the work was received, and scoring them on its reception ranks
#: the people who tested a beloved title above everyone who wrote one.
CREATIVE_ROLES = ("scenario", "art", "music", "chardesign", "director")

#: Readers must have finished something before "gives up most often" means anything. Without
#: this the board is topped by accounts that labelled thousands of titles dropped and
#: finished none, which is bulk labelling rather than reluctance.
_MIN_FINISHED_FOR_READER = 20

#: Ceiling for a VN to count as obscure. Chosen to sit well below the point where a title
#: shows up in general discussion, while still leaving enough votes for a rating to mean
#: something alongside the min_count floor.
_HIDDEN_GEM_VOTE_CEILING = 100

_APPROXIMATE_WINDOW_NOTE = (
    "List entries carry no timestamp, so this period is approximated from when the list "
    "entry was last modified rather than when the status was set."
)

_PRIVATE_VOTES_NOTE = (
    "Votes on private lists are not published in the VNDB dump and are not counted here."
)

_IGNORED_VOTERS_NOTE = (
    "Accounts VNDB excludes from public vote aggregates are already absent from the vote "
    "dump, so they are excluded here too."
)


_FREEWARE_NOTE = (
    "A title qualifies only when it has no paid release anywhere, in any language. The "
    "weaker test, having some free release, lets through commercial titles that once had a "
    "promotional free edition, which is how well-known paid games ended up on this board."
)

_FREEWARE_COST_NOTE = (
    "Titles released free and sold commercially later are excluded, since there is now a "
    "price on them. That is the intended answer to what can be read for nothing today, but "
    "it does leave out a few that were free at the time."
)

USER_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="users-most-votes-month",
        home=Home.TRENDS,
        disclosure=reader_votes("any visual novel, in the last 30 days"),
        title="Most votes this month",
        subject=Subject.USER,
        metric=Metric.VOTES,
        window=Window.MONTH,
        blurb="Who has been rating the most in the last month.",
        notes=(_PRIVATE_VOTES_NOTE,),
    ),
    BoardSpec(
        slug="users-most-votes-week",
        home=Home.TRENDS,
        disclosure=reader_votes("any visual novel, in the last 7 days"),
        title="Most votes this week",
        subject=Subject.USER,
        metric=Metric.VOTES,
        window=Window.WEEK,
        blurb="Who has been rating the most in the last week.",
        notes=(_PRIVATE_VOTES_NOTE,),
    ),
    BoardSpec(
        slug="users-jp-patricians",
        disclosure=reader_votes("titles originally written in Japanese", pure=True),
        title="Japanese-only patricians",
        subject=Subject.USER,
        metric=Metric.VOTES,
        facet=Facet(olang="ja"),
        require_pure=True,
        blurb=(
            "Users whose votes are all on original-language-Japanese games, ranked by "
            "total number of votes. Anyone with a single vote on a non-Japanese-original "
            "title is excluded outright."
        ),
        notes=(_IGNORED_VOTERS_NOTE,),
    ),
    BoardSpec(
        slug="users-sole-voters",
        disclosure=Disclosure(
            population="Every reader with public votes.",
            floor="None. Being the only voter on one title is already the thing being counted.",
            score=(
                "The number of titles where they are the only voter in the public dump. "
                f"{TIE_BREAK}"
            ),
            excluded=(
                "Private votes. Because they are unpublished, a title counted here may have "
                "other voters who simply cannot be seen, so this measures visible solitude "
                "rather than certain solitude."
            ),
        ),
        title="Sole voters",
        subject=Subject.USER,
        metric=Metric.SOLE_VOTER,
        blurb=(
            "Ranked by number of games they are the only visible voter on. The deepest "
            "corners of the database, by definition."
        ),
        notes=(_IGNORED_VOTERS_NOTE,),
    ),
    BoardSpec(
        slug="users-harshest",
        title="Harshest voters",
        subject=Subject.USER,
        metric=Metric.VOTE_BIAS,
        min_count=_MIN_VOTES_FOR_BIAS,
        ascending=True,
        blurb=(
            "Readers who rate consistently below everyone else on the very same titles. "
            "Measured against the community rather than against ten out of ten."
        ),
        disclosure=Disclosure(
            population=(
                "Every reader with public votes on titles that have enough votes of their "
                "own to have a stable community average."
            ),
            floor=(
                f"{_MIN_VOTES_FOR_BIAS} comparable votes. Each of those titles needs "
                f"{MIN_VOTES_FOR_CONSENSUS} votes of its own before its average is "
                "steady enough to judge anyone against."
            ),
            score=(
                "The average gap between the reader's vote and the community's average for "
                "the same title, in rating points. Comparing per title is the point: a "
                "plain average score measures what someone chose to read as much as how "
                f"they score it. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        notes=(
            "A reader who only reads titles they expect to like will have a high average "
            "score without being generous. This board is unaffected by that, because every "
            "vote is compared only against other votes on the same title.",
        ),
    ),
    BoardSpec(
        slug="users-most-generous",
        title="Most generous voters",
        subject=Subject.USER,
        metric=Metric.VOTE_BIAS,
        min_count=_MIN_VOTES_FOR_BIAS,
        blurb=(
            "Readers who rate consistently above everyone else on the very same titles."
        ),
        disclosure=Disclosure(
            population=(
                "Every reader with public votes on titles that have enough votes of their "
                "own to have a stable community average."
            ),
            floor=(
                f"{_MIN_VOTES_FOR_BIAS} comparable votes, each on a title with at "
                f"least {MIN_VOTES_FOR_CONSENSUS} votes."
            ),
            score=(
                "The average gap between the reader's vote and the community's average for "
                f"the same title, in rating points. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
    ),
    BoardSpec(
        slug="users-most-contrarian",
        title="Most contrarian",
        subject=Subject.USER,
        metric=Metric.VOTE_DIVERGENCE,
        min_count=_MIN_VOTES_FOR_BIAS,
        blurb=(
            "Readers who agree with the room on average and disagree with it constantly. "
            "Loving what everyone dislikes, and the reverse, in the same list."
        ),
        disclosure=Disclosure(
            population=(
                "Every reader with public votes on titles that have enough votes of their "
                "own to have a stable community average."
            ),
            floor=(
                f"{_MIN_VOTES_FOR_BIAS} comparable votes, each on a title with at "
                f"least {MIN_VOTES_FOR_CONSENSUS} votes."
            ),
            score=(
                "How much the gap between their vote and the community's varies from title "
                "to title, measured as its spread around their own average. Deliberately not "
                "the size of that gap: a reader who marks everything two points low is "
                "entirely predictable once you know the offset, and belongs on the harshest "
                f"board rather than this one. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
    ),
    BoardSpec(
        slug="users-retro",
        title="Retro readers",
        subject=Subject.USER,
        metric=Metric.ERA,
        min_count=_MIN_VOTES_FOR_OBSCURITY,
        ascending=True,
        blurb="Readers whose Japanese reading sits furthest back in time.",
        disclosure=Disclosure(
            population="Every reader with public votes on titles originally written in Japanese.",
            floor=f"{_MIN_VOTES_FOR_OBSCURITY} Japanese-original titles voted on, with a known release date.",
            score=(
                "The median release year of the titles they voted on, earliest first. The "
                "median rather than the mean, so a handful of modern titles does not undo a "
                f"catalogue of old ones. {TIE_BREAK}"
            ),
            excluded=(
                "Titles with no recorded release date, and the standing vote exclusions."
            ),
        ),
    ),
    BoardSpec(
        slug="users-completionists",
        title="Completionists",
        subject=Subject.USER,
        metric=Metric.COMPLETION_RATE,
        min_count=_MIN_LIST_ENTRIES_FOR_RATE,
        min_finished=_MIN_FINISHED_FOR_READER,
        blurb="Readers who finish nearly everything they start.",
        disclosure=Disclosure(
            population="Every reader with a public list.",
            floor=(
                f"{_MIN_LIST_ENTRIES_FOR_RATE} titles started and "
                f"{_MIN_FINISHED_FOR_READER} finished."
            ),
            score=(
                "Finished titles as a share of everything started, damped toward the rate "
                f"across all readers so a short list cannot top the board. {TIE_BREAK}"
            ),
            excluded=LIST_EXCLUSIONS,
        ),
        notes=(
            "Wishlist entries are not counted as started, so a large backlog neither helps "
            "nor hurts.",
        ),
    ),
    BoardSpec(
        slug="users-deepest-cuts",
        title="Deepest cuts",
        subject=Subject.USER,
        metric=Metric.OBSCURITY,
        min_count=_MIN_VOTES_FOR_OBSCURITY,
        ascending=True,
        blurb=(
            "Readers whose Japanese-original reading is the least travelled. Not the most "
            "obscure single find, but the most obscure habit."
        ),
        disclosure=Disclosure(
            population="Every reader with public votes on titles originally written in Japanese.",
            floor=(
                f"{_MIN_VOTES_FOR_OBSCURITY} Japanese-original titles voted on, so the "
                "measure describes a reading habit rather than a handful of finds."
            ),
            score=(
                "The median number of other readers who voted on the titles they voted on, "
                "lowest first. The median rather than the mean, so one famous title in an "
                f"otherwise obscure list does not undo the picture. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        notes=(
            "Thinly-voted titles are kept here rather than filtered out. On the boards "
            "that judge how someone scores they are noise; here they are the subject.",
        ),
    ),
    BoardSpec(
        slug="users-most-finished",
        disclosure=reader_list_count("finished"),
        title="Most titles finished",
        subject=Subject.USER,
        metric=Metric.FINISHED,
        blurb="Readers with the most titles marked finished.",
    ),
    BoardSpec(
        slug="users-most-dropped",
        title="Most likely to give up",
        subject=Subject.USER,
        metric=Metric.DROP_RATE,
        min_count=_MIN_LIST_ENTRIES_FOR_RATE,
        min_finished=_MIN_FINISHED_FOR_READER,
        blurb=(
            "Readers who abandon the highest share of what they start, among readers who "
            "do finish things."
        ),
        disclosure=Disclosure(
            population="Every reader with a public list.",
            floor=(
                f"{_MIN_LIST_ENTRIES_FOR_RATE} titles started, and at least "
                f"{_MIN_FINISHED_FOR_READER} finished. The second half matters: an account "
                "that marked thousands dropped and finished none has a perfect drop rate "
                "and nothing to say, because that is bulk labelling rather than reluctance."
            ),
            score=(
                "Dropped titles as a share of everything started, damped toward the rate "
                f"across all readers so a thin list cannot top the board. {TIE_BREAK}"
            ),
            excluded=LIST_EXCLUSIONS,
        ),
    ),
    BoardSpec(
        slug="users-biggest-backlog",
        disclosure=reader_list_count("wishlisted"),
        title="Biggest backlog",
        subject=Subject.USER,
        metric=Metric.WISHLIST,
        blurb="Readers with the most titles still on the wishlist.",
    ),
]


VN_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="vns-trending-month",
        home=Home.TRENDS,
        disclosure=title_votes("the last 30 days"),
        title="Trending this month",
        subject=Subject.VN,
        metric=Metric.VOTERS,
        window=Window.MONTH,
        blurb="The titles picking up the most new votes right now.",
    ),
    BoardSpec(
        slug="vns-trending-week",
        home=Home.TRENDS,
        disclosure=title_votes("the last 7 days"),
        title="Trending this week",
        subject=Subject.VN,
        metric=Metric.VOTERS,
        window=Window.WEEK,
        blurb="The titles picking up the most new votes in the last week.",
    ),
]

PRODUCER_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="developers-most-voted",
        disclosure=entity_votes("studio", "credited as the developer of at least one title"),
        title="Most voted-on developers",
        subject=Subject.DEVELOPER,
        metric=Metric.VOTES,
        blurb="Studios whose games have collected the most votes between them.",
    ),
    BoardSpec(
        slug="developers-highest-rated",
        # The disclosure names a Japanese-original population, so the query has to select one.
        facet=Facet(olang="ja"),
        producer_types=COMMERCIAL_ONLY,
        min_works=MIN_WORKS_FOR_COMPANY,
        disclosure=entity_rating("studio", f"credited as the developer of at least {MIN_WORKS_FOR_COMPANY} Japanese-original titles", MIN_WORKS_FOR_COMPANY, _MIN_VOTES_FOR_VN_RATING),
        title="Highest rated developers",
        subject=Subject.DEVELOPER,
        metric=Metric.BAYESIAN,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="Studios with the best average reception across everything they have made.",
    ),
    BoardSpec(
        slug="publishers-most-voted",
        disclosure=entity_votes("company", "credited as the publisher of at least one title"),
        title="Most voted-on publishers",
        subject=Subject.PUBLISHER,
        metric=Metric.VOTES,
        blurb="Publishers whose catalogue has collected the most votes.",
    ),
    BoardSpec(
        slug="publishers-highest-rated",
        # The disclosure names a Japanese-original population, so the query has to select one.
        facet=Facet(olang="ja"),
        producer_types=COMMERCIAL_ONLY,
        min_works=MIN_WORKS_FOR_COMPANY,
        disclosure=entity_rating("company", f"credited as the publisher of at least {MIN_WORKS_FOR_COMPANY} Japanese-original titles", MIN_WORKS_FOR_COMPANY, _MIN_VOTES_FOR_VN_RATING),
        title="Highest rated publishers",
        subject=Subject.PUBLISHER,
        metric=Metric.BAYESIAN,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="Publishers with the best average reception across their catalogue.",
    ),
]


#: The crafts given a board of their own, as (role, slug fragment, label, plural noun).
#: Split rather than blended because "creators" is not one job: the credit table treats a
#: composer, a scenario writer and a QA tester identically, and a single blended board
#: ranked the testers of one beloved title above every writer in the database.
_CRAFTS = (
    ("scenario", "writers", "scenario writers", "written"),
    ("art", "artists", "artists", "drawn"),
    ("music", "composers", "composers", "scored"),
)

CREDIT_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="staff-most-voted",
        title="Most voted-on creators",
        subject=Subject.STAFF,
        metric=Metric.VOTES,
        blurb="Writers, artists and composers whose credits have collected the most votes.",
        disclosure=entity_votes("person", "credited on at least one title, in any role"),
        notes=(
            "Every role counts here, including translation and testing, because this board "
            "measures how much work someone has been part of rather than how it was "
            "received. The craft boards below are the ones that judge reception.",
        ),
    ),
]

CREDIT_BOARDS += [
    BoardSpec(
        slug=f"staff-best-{fragment}",
        title=f"Best {label}",
        subject=Subject.STAFF,
        metric=Metric.BAYESIAN,
        facet=Facet(olang="ja"),
        credit_roles=(role,),
        min_works=_MIN_WORKS_FOR_PERSON,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb=(
            f"The {label} whose body of work is best received, across everything they have "
            f"{verb}."
        ),
        disclosure=entity_rating(
            "person",
            f"credited in the {role} role on at least "
            f"{_MIN_WORKS_FOR_PERSON} Japanese-original titles",
            _MIN_WORKS_FOR_PERSON,
            _MIN_VOTES_FOR_VN_RATING,
        ),
        notes=(
            f"Only {role} credits count. Translation, testing, editing and uncategorised "
            "credits are ignored, so nobody is scored on the reception of a title they "
            "worked on in a role that did not shape it.",
            "Restricted to titles originally written in Japanese, which is the subject of "
            "this site; a fan translation of a famous title would otherwise dominate.",
        ),
    )
    for role, fragment, label, verb in _CRAFTS
]

CREDIT_BOARDS += [
    BoardSpec(
        slug="seiyuu-most-voted",
        title="Most voted-on voice actors",
        subject=Subject.SEIYUU,
        metric=Metric.VOTES,
        blurb="The voices behind the most-rated titles.",
        disclosure=entity_votes("voice actor", "credited on at least one title"),
    ),
    BoardSpec(
        slug="seiyuu-highest-rated",
        title="Highest rated voice actors",
        subject=Subject.SEIYUU,
        metric=Metric.BAYESIAN,
        facet=Facet(olang="ja"),
        min_works=_MIN_WORKS_FOR_PERSON,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="Whose roles land in the best received titles.",
        disclosure=entity_rating(
            "voice actor",
            f"credited on at least {_MIN_WORKS_FOR_PERSON} Japanese-original titles",
            _MIN_WORKS_FOR_PERSON,
            _MIN_VOTES_FOR_VN_RATING,
        ),
        notes=(
            "Every voiced role counts the same, from a lead to a single line, because the "
            "dump does not weight them.",
        ),
    ),
]


_SERIES_NOTE = (
    "VNDB has no series list, so a franchise is inferred from the relation graph: titles "
    "linked as sequels, prequels, side stories, fandiscs or alternative versions form one "
    "series. Shared characters and shared settings are not enough, or unrelated works "
    "would merge into each other."
)

SERIES_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="series-most-voted",
        disclosure=entity_votes("franchise", "with more than one entry in the relation graph"),
        title="Most voted-on series",
        subject=Subject.SERIES,
        metric=Metric.VOTES,
        blurb="Franchises ranked by the votes their entries have collected between them.",
        notes=(_SERIES_NOTE,),
    ),
    BoardSpec(
        slug="series-highest-rated",
        facet=Facet(olang="ja"),
        min_works=2,
        disclosure=entity_rating("franchise", f"with at least {2} entries in the relation graph", 2, _MIN_VOTES_FOR_VN_RATING),
        title="Highest rated series",
        subject=Subject.SERIES,
        metric=Metric.BAYESIAN,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb=(
            "Which franchises hold up across everything in them, rather than resting on "
            "one strong entry."
        ),
        notes=(_SERIES_NOTE,),
    ),
    BoardSpec(
        slug="series-most-divisive",
        disclosure=Disclosure(
            population="Every franchise of at least two Japanese-original entries.",
            floor="2 entries, and 50 public votes pooled across them.",
            score=(
                "Standard deviation of every vote in the franchise pooled together, so a "
                "run that swings between beloved and disliked entries scores as highly as "
                f"a single contentious title. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        facet=Facet(olang="ja"),
        min_works=2,
        title="Most divisive series",
        subject=Subject.SERIES,
        metric=Metric.DIVISIVENESS,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="Franchises readers cannot agree on, whether across entries or within them.",
        notes=(
            _SERIES_NOTE,
            "Measured across every vote in the series pooled together, so an uneven run "
            "scores as highly as a single contentious title.",
        ),
    ),
]


_REPUTATION_NOTE = (
    "A title's votes are split in half by the order they were cast, and the later half's "
    "average is compared against the earlier half's. Splitting by order rather than by date "
    "keeps the comparison fair for titles whose votes arrived in a burst."
)


RISING_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="vns-rising-month",
        home=Home.TRENDS,
        disclosure=Disclosure(
            population="Every visual novel with public votes in the last 30 days.",
            floor=(
                f"{_MIN_VOTES_FOR_VN_RATING} votes over its lifetime, so a title with three "
                "votes cast this month cannot claim to be rising."
            ),
            score=(
                "The share of the title's all-time votes that arrived in the period, not a "
                "raw count. A newly released title legitimately scores near the top; that "
                f"is what rising means. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        title="Rising this month",
        subject=Subject.VN,
        metric=Metric.VELOCITY,
        window=Window.MONTH,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb=(
            "Titles collecting a large share of their lifetime votes right now. A recent "
            "release scores highly here by design; that is what rising means."
        ),
        notes=(
            "Measured as the share of a title's all-time votes cast in the period, not as "
            "a raw count, so perennially popular titles do not simply top it every month.",
        ),
    ),
    BoardSpec(
        slug="vns-rising-year",
        home=Home.TRENDS,
        disclosure=Disclosure(
            population="Every visual novel with public votes in the last year.",
            floor=f"{_MIN_VOTES_FOR_VN_RATING} votes over its lifetime.",
            score=(
                "The share of the title's all-time votes cast in the last year, which "
                f"favours a sustained revival over a single spike. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        title="Rising this year",
        subject=Subject.VN,
        metric=Metric.VELOCITY,
        window=Window.YEAR,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="The same measure over a longer run, which favours a sustained revival over a spike.",
    ),
]


#: Titles below this have too few votes for their score to weigh on a studio's floor.
MIN_VOTES_PER_CATALOGUE_TITLE = 50

CATALOGUE_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="developers-no-weak-entry",
        producer_types=COMMERCIAL_ONLY,
        title="No weak entry",
        subject=Subject.DEVELOPER,
        metric=Metric.CATALOGUE_FLOOR,
        facet=Facet(olang="ja"),
        min_works=6,
        blurb=(
            "Studios whose worst title is still good. The question an average cannot "
            "answer: can this back catalogue be read blind?"
        ),
        disclosure=Disclosure(
            population=(
                "Every studio credited as developer on at least six Japanese-original "
                f"titles carrying {MIN_VOTES_PER_CATALOGUE_TITLE} votes or more."
            ),
            floor=(
                f"6 qualifying titles. Titles under {MIN_VOTES_PER_CATALOGUE_TITLE} votes "
                "are skipped rather than counted against the studio, since a score nobody "
                "has voted on is not evidence of a weak entry."
            ),
            score=(
                "The rating of the studio's *weakest* qualifying title, highest first. "
                "Ranking on consistency instead would be a mistake: a studio averaging "
                "well below the database would score just as well for being reliably "
                f"mediocre. {TIE_BREAK}"
            ),
            excluded=VOTE_EXCLUSIONS,
        ),
        notes=(
            "A studio with one bad release sits low here however good the rest are. That "
            "is the intent, not a defect.",
        ),
    ),
]


#: Difficulty band a beginner can realistically finish. Bands are whole numbers upstream,
#: so this is "band 2 or easier", not an arbitrary cut through the middle of one.
BEGINNER_DIFFICULTY_CEILING = 2.0

#: Votes before a title is worth putting in front of someone as a recommendation.
_MIN_VOTES_FOR_DIFFICULTY = 30

#: Titles carrying a tag before the tag's average says anything about the tag.
_MIN_TITLES_FOR_TAG = 40

#: Votes a reader needs before the shape of their reading is described.
_MIN_VOTES_FOR_ERA_WINDOW = 150

#: Entries a franchise needs before its span is treated as a run rather than a pair.
_MIN_ENTRIES_FOR_SPAN = 5

#: Difficulty is jiten.moe's measurement, and every board resting on it credits the source.
JITEN_ATTRIBUTION = ("jiten.moe", "https://jiten.moe/decks/media?mediaType=7")

_DIFFICULTY_SOURCE_NOTE = (
    "Difficulty comes from jiten.moe's analysis of the script and covers only the titles it "
    "has analysed, which is a small fraction of the database. A title absent from this board "
    "has not been measured; it is not an easy one."
)


_DISCOVERY_NOTE = (
    "Compared against other titles released the same year rather than measured outright. "
    "The raw figure is mostly a statement about age, since a title from before VNDB existed "
    "could only ever be voted on long after release."
)

DISCOVERY_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="vns-found-late",
        title="Found its audience late",
        subject=Subject.VN,
        metric=Metric.DISCOVERY_LAG,
        min_count=150,
        blurb=(
            "Titles the community reached years after everything else from their year. "
            "Usually a translation that arrived a decade after the original."
        ),
        disclosure=Disclosure(
            population="Every title with a known release date and enough dated votes to measure.",
            floor="150 votes cast after release, and a release year with at least 10 such titles to compare against.",
            score=(
                "The median gap between release and vote, minus the average of those medians "
                "across the other titles released that year that clear the same vote floor. "
                f"Positive means slower than its peers. {TIE_BREAK}"
            ),
            excluded=(
                "Votes cast before the recorded release date, titles with no release date, "
                "and release years too sparse to form a comparison."
            ),
        ),
        notes=(_DISCOVERY_NOTE,),
    ),
    BoardSpec(
        slug="vns-found-immediately",
        title="Straight out of the gate",
        subject=Subject.VN,
        metric=Metric.DISCOVERY_LAG,
        min_count=150,
        ascending=True,
        blurb="Titles that found their whole audience at once, while their peers took years.",
        disclosure=Disclosure(
            population="Every title with a known release date and enough dated votes to measure.",
            floor="150 votes cast after release, in a release year with at least 10 comparable titles.",
            score=f"The same comparison as the board above, ordered the other way. {TIE_BREAK}",
            excluded="Votes cast before release, and years too sparse to compare within.",
        ),
        notes=(_DISCOVERY_NOTE,),
    ),
]


#: Character roles that carry a work. A voice credit does not distinguish a lead from one
#: line, so counting every appearance makes a career of cameos read like a career of leads.
LEADING_ROLES = ("primary", "main")

LEADING_ROLE_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="seiyuu-most-leads",
        title="Most leading roles",
        subject=Subject.SEIYUU,
        metric=Metric.WORKS,
        facet=Facet(olang="ja"),
        character_roles=LEADING_ROLES,
        blurb="The voices carrying the most Japanese titles, counting leads rather than every appearance.",
        disclosure=Disclosure(
            population=(
                "Every voice actor credited on a leading character in a Japanese-original "
                "title that has public votes."
            ),
            floor="None. This is a count of leading roles, so one is enough to appear.",
            score=(
                "The number of separate titles where they voiced a leading character. A "
                f"single-line part does not count. {TIE_BREAK}"
            ),
            excluded=(
                "Side and background roles, and titles with no public votes. The existing "
                "most-voted-on board counts every appearance if that is what you want."
            ),
        ),
    ),
    BoardSpec(
        slug="seiyuu-best-leads",
        title="Best leading roles",
        subject=Subject.SEIYUU,
        metric=Metric.BAYESIAN,
        facet=Facet(olang="ja"),
        character_roles=LEADING_ROLES,
        min_works=_MIN_WORKS_FOR_PERSON,
        min_count=_MIN_VOTES_FOR_VN_RATING,
        blurb="Whose leading roles land in the best received titles, cameos excluded.",
        disclosure=entity_rating(
            "voice actor",
            f"credited on a leading character in at least {_MIN_WORKS_FOR_PERSON} "
            "Japanese-original titles",
            _MIN_WORKS_FOR_PERSON,
            _MIN_VOTES_FOR_VN_RATING,
        ),
        notes=(
            "Only leading and main character roles count, so a career of small parts in "
            "great titles does not outrank a career of leads.",
        ),
    ),
]


STUDIO_LONGEVITY_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="developers-still-shipping",
        title="Still shipping",
        subject=Subject.DEVELOPER,
        metric=Metric.ACTIVE_SPAN,
        producer_types=COMMERCIAL_ONLY,
        min_works=5,
        blurb="Studios with the longest run still going, from their first release to a recent one.",
        disclosure=Disclosure(
            population="Every company credited as developer on at least 5 titles with known release dates.",
            floor="5 titles, and a release within the last 3 years. Without the second, a studio that stopped decades ago would rank as highly as one still working.",
            score=f"Years between their first and most recent release. {TIE_BREAK}",
            excluded=(
                "Amateur groups and individuals, studios with no release in the last 3 "
                "years, and releases with no recorded date."
            ),
        ),
        notes=(
            "A studio renamed or restructured appears as two entries, because the dump "
            "records them as two producers.",
        ),
    ),
]


TAG_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="tags-best-rated",
        title="Tags on the best-rated titles",
        subject=Subject.TAG,
        metric=Metric.TITLE_MEAN,
        facet=Facet(olang="ja"),
        min_works=_MIN_TITLES_FOR_TAG,
        blurb=(
            "Which tags appear on titles the community rates highly. Mostly production "
            "values rather than genres, which is itself the finding."
        ),
        disclosure=Disclosure(
            population=(
                "Every tag applied to at least "
                f"{_MIN_TITLES_FOR_TAG} Japanese-original titles carrying "
                f"{MIN_VOTES_PER_CATALOGUE_TITLE} votes or more."
            ),
            floor=f"{_MIN_TITLES_FOR_TAG} qualifying titles, so one acclaimed title cannot carry a tag.",
            score=(
                "The unweighted mean of those titles' ratings. Unweighted deliberately: "
                "pooling every vote would let one hugely-voted title speak for a tag applied "
                f"to hundreds of others. {TIE_BREAK}"
            ),
            excluded=(
                "Tags applied with a score of zero or below, behind a spoiler warning, or flagged as "
                "inaccurate, matching the tag pages. Titles below the vote floor are skipped "
                "rather than counted."
            ),
        ),
        notes=(
            "Tags are counted where they are directly applied, not rolled up the tag tree. "
            "Rolling up would count one title under a narrow tag and again under every "
            "parent above it.",
            "This is a correlation, not a cause. Much of it tracks production budget: the "
            "tags that mark a well-funded title mark a well-rated one.",
        ),
    ),
    BoardSpec(
        slug="tags-most-divisive",
        title="Tags readers disagree about",
        subject=Subject.TAG,
        metric=Metric.TITLE_SPREAD,
        facet=Facet(olang="ja"),
        min_works=_MIN_TITLES_FOR_TAG,
        blurb="Subject matter whose titles land all over the scale rather than clustering.",
        disclosure=Disclosure(
            population=(
                f"Every tag applied to at least {_MIN_TITLES_FOR_TAG} Japanese-original "
                f"titles carrying {MIN_VOTES_PER_CATALOGUE_TITLE} votes or more."
            ),
            floor=f"{_MIN_TITLES_FOR_TAG} qualifying titles.",
            score=(
                "Standard deviation of those titles' ratings. High means the tag covers both "
                f"well and poorly rated work, not that the work is disliked. {TIE_BREAK}"
            ),
            excluded="The same tag-quality filters as the board above.",
        ),
        notes=(
            "Measured across titles, not within them. A tag whose titles are each "
            "uncontroversial but collectively uneven scores highly here.",
        ),
    ),
]


#: Titles a tag needs before a per-title average is allowed to describe it. Higher than the
#: floor on the rating boards: narrow tags come in clusters of near-synonyms, and a low
#: floor fills the head of a board with a dozen ways of saying the same thing.
_MIN_TITLES_FOR_TAG_AVERAGE = 60


#: Votes a title needs before it joins the difficulty corpus, matching the tag rating boards
#: in kind: an unread title should not decide what a tag reads like.
_MIN_VOTES_FOR_DIFFICULTY_CORPUS = 20

_TAG_QUALITY_FILTER = (
    "Tags applied with a score of zero or below, behind a spoiler warning, or flagged as "
    "inaccurate, matching the tag pages."
)

_DIFFICULTY_COVERAGE = (
    "Difficulty is measured for a small fraction of the database, and the titles measured "
    "are the ones learners have wanted to read, so the corpus leans toward what gets "
    "texthooked rather than a fair sample of Japanese titles."
)

TAG_TEXTURE_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="tags-hardest-japanese",
        title="Tags that mark hard Japanese",
        subject=Subject.TAG,
        metric=Metric.TITLE_DIFFICULTY,
        facet=Facet(olang="ja", votecount_min=_MIN_VOTES_FOR_DIFFICULTY_CORPUS),
        min_works=_MIN_TITLES_FOR_TAG_AVERAGE,
        excluded_tag_categories=ADULT_SCENE_TAG_CATEGORIES,
        attribution=JITEN_ATTRIBUTION,
        blurb=(
            "What a title is about predicts its reading difficulty less than how it is "
            "written. Narration style and prose form sit near the top alongside the "
            "action tags."
        ),
        disclosure=Disclosure(
            population=(
                "Japanese-original titles jiten has measured, carrying at least "
                f"{_MIN_VOTES_FOR_DIFFICULTY_CORPUS} votes, grouped by the tags applied to "
                "them."
            ),
            floor=(
                f"{_MIN_TITLES_FOR_TAG_AVERAGE} measured titles per tag. Set high on "
                "purpose: below it the board fills with narrow tags that all describe the "
                "same kind of story."
            ),
            score=(
                "The mean difficulty of the tag's measured titles, each counting once "
                "however many votes it has, shown against the average across the whole "
                f"corpus. {TIE_BREAK}"
            ),
            excluded=(
                f"{_TAG_QUALITY_FILTER} Adult-scene tags are left out: they describe "
                "individual scenes rather than how a title is written, and as a group they "
                "sit well below the average. Titles jiten has not measured are skipped "
                "rather than treated as easy."
            ),
        ),
        notes=(
            _DIFFICULTY_COVERAGE,
            "Tags overlap heavily, so neighbouring rows often describe one kind of title "
            "from several angles rather than several independent findings.",
            "A tag being hard on average says nothing about any single title carrying it.",
        ),
    ),
    BoardSpec(
        slug="tags-easiest-japanese",
        title="Tags that mark easy Japanese",
        subject=Subject.TAG,
        metric=Metric.TITLE_DIFFICULTY,
        facet=Facet(olang="ja", votecount_min=_MIN_VOTES_FOR_DIFFICULTY_CORPUS),
        min_works=_MIN_TITLES_FOR_TAG_AVERAGE,
        excluded_tag_categories=ADULT_SCENE_TAG_CATEGORIES,
        ascending=True,
        attribution=JITEN_ATTRIBUTION,
        blurb=(
            "The other end of the same measurement, and the more useful one if you are "
            "picking a first title: everyday settings and small casts."
        ),
        disclosure=Disclosure(
            population=(
                "Japanese-original titles jiten has measured, carrying at least "
                f"{_MIN_VOTES_FOR_DIFFICULTY_CORPUS} votes, grouped by the tags applied to "
                "them."
            ),
            floor=f"{_MIN_TITLES_FOR_TAG_AVERAGE} measured titles per tag.",
            score=(
                "The same mean, ranked from the bottom. Lowest average difficulty first. "
                f"{TIE_BREAK}"
            ),
            excluded=f"{_TAG_QUALITY_FILTER} Adult-scene tags are left out, as above.",
        ),
        notes=(
            _DIFFICULTY_COVERAGE,
            "Easy on average is not a recommendation. It describes the prose, not whether "
            "a title is worth reading or suitable for a beginner in any other respect.",
        ),
    ),
    BoardSpec(
        slug="tags-most-abandoned",
        title="Tags readers give up on",
        subject=Subject.TAG,
        metric=Metric.TITLE_DROP_RATE,
        min_works=_MIN_TITLES_FOR_TAG_AVERAGE,
        blurb=(
            "Where reading attempts stop. How a title is presented separates these more "
            "than what it is about."
        ),
        disclosure=Disclosure(
            population=(
                "Every tag applied to enough titles that carry at least "
                f"{MIN_LIST_ENTRIES_FOR_RATE} finished or dropped list entries."
            ),
            floor=(
                f"{_MIN_TITLES_FOR_TAG_AVERAGE} qualifying titles per tag, and "
                f"{MIN_LIST_ENTRIES_FOR_RATE} attempts before a title counts at all."
            ),
            score=(
                "The mean of each title's dropped share of its finished-plus-dropped "
                f"entries, each title counting once. {TIE_BREAK}"
            ),
            excluded=(
                f"{_TAG_QUALITY_FILTER} Titles still being read, on hold or only "
                "wishlisted are not counted either way, since neither outcome has happened "
                "yet."
            ),
        ),
        notes=(
            "Length does not drive this the way it might seem it should: the tags at the "
            "top mark slightly shorter titles than average rather than longer ones.",
            "List labels are self-reported and many readers never set them, so this "
            "describes the readers who label rather than everyone.",
        ),
    ),
    BoardSpec(
        slug="tags-rising",
        title="Tags being picked up now",
        subject=Subject.TAG,
        metric=Metric.TITLE_RECENCY,
        min_works=_MIN_TITLES_FOR_TAG_AVERAGE,
        blurb=(
            "Which kinds of title are collecting votes now rather than over their lifetime. "
            "The short indie end of the medium is where the movement is."
        ),
        disclosure=Disclosure(
            population=(
                "Every tag applied to enough titles carrying at least "
                f"{MIN_VOTES_FOR_RECENCY} votes."
            ),
            floor=(
                f"{_MIN_TITLES_FOR_TAG_AVERAGE} qualifying titles per tag, and "
                f"{MIN_VOTES_FOR_RECENCY} lifetime votes before a title counts."
            ),
            score=(
                "For each title, the share of its lifetime votes cast in the last 365 days; "
                f"the board shows the mean of those shares. {TIE_BREAK}"
            ),
            excluded=f"{_TAG_QUALITY_FILTER}",
        ),
        notes=(
            "A share rather than a count, so a tag on a few briskly-voted titles can beat "
            "one on many long-established titles. That is the question being asked.",
            "Recently released titles have most of their votes inside the window by "
            "definition, so tags marking what came out this year sit high for that reason "
            "alone.",
        ),
    ),
]

READER_CHARACTER_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="users-amplifiers",
        title="Readers who use the whole scale",
        subject=Subject.USER,
        metric=Metric.VOTE_RESPONSE,
        min_count=MIN_VOTES_FOR_RESPONSE,
        blurb=(
            "Readers who agree with everyone about which titles are better, and disagree "
            "about by how much. When consensus moves a point, their vote moves two or more."
        ),
        disclosure=Disclosure(
            population=(
                "Readers with at least "
                f"{MIN_VOTES_FOR_RESPONSE} votes on titles carrying "
                f"{MIN_VOTES_FOR_CONSENSUS} votes or more, which is what makes a community "
                "average to compare against."
            ),
            floor=(
                f"{MIN_VOTES_FOR_RESPONSE} comparable votes, and the community average has "
                "to account for at least "
                f"{int(MIN_RESPONSE_FIT * 100)}% of the variation in theirs."
            ),
            score=(
                "Their votes regressed on the community average for the same titles. One "
                "means they move with consensus point for point; two means they treat the "
                "same range as twice as wide. Damped toward one in proportion to how few "
                f"votes the estimate rests on. {TIE_BREAK}"
            ),
            excluded=(
                "Readers who gave every title the same score, whose fit statistic is "
                "meaningless rather than perfect. Readers whose votes bear no relation to "
                "consensus are also left out: the slope would describe scatter, not them."
            ),
        ),
        notes=(
            "Not the same as being harsh or generous. This measures the width of the range "
            "someone uses, not where it sits, so a reader can appear here at any average.",
            "The undamped figure falls steadily as a reader's list grows, so the damping is "
            "what keeps a long list comparable with a short one rather than a tidying step.",
        ),
    ),
    BoardSpec(
        slug="users-steadiest",
        title="The steadiest readers",
        subject=Subject.USER,
        metric=Metric.STEADINESS,
        min_count=MIN_VOTES_FOR_STEADINESS,
        blurb=(
            "Not who logged the most, but who logged at the most even pace. The top of this "
            "board has gone years without missing a month."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {MIN_VOTES_FOR_STEADINESS} dated votes spanning "
                f"{MIN_SPAN_FOR_STEADINESS} months or more."
            ),
            floor=(
                f"{MIN_VOTES_FOR_STEADINESS} votes and a {MIN_SPAN_FOR_STEADINESS}-month "
                "span. Below either, a sparse history looks even for want of anything to be "
                "uneven about."
            ),
            score=(
                "The evenness of their monthly vote counts, measured as entropy and taken "
                "as a share of the most even a span that long could be, so a long career is "
                f"not penalised. One is the same number of votes every month. {TIE_BREAK}"
            ),
            excluded=(
                "Votes with no date, which cannot be placed in a month. Readers below "
                "either floor are not ranked rather than ranked low."
            ),
        ),
        notes=(
            "Steadiness rises with volume across the population, so this is not a fair "
            "comparison between a reader logging fifteen a month and one logging two. The "
            "leaders are not the largest voters, but the measure does favour them.",
            "The board says when someone was last active. A reader who kept perfect rhythm "
            "and then stopped still places.",
        ),
    ),
    BoardSpec(
        slug="users-time-capsule",
        title="Readers stuck in one era",
        subject=Subject.USER,
        metric=Metric.ERA_WINDOW,
        min_count=_MIN_VOTES_FOR_ERA_WINDOW,
        ascending=True,
        blurb=(
            "Readers whose libraries sit almost entirely inside a handful of release years, "
            "against a typical reader whose reading spans more than a decade."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {_MIN_VOTES_FOR_ERA_WINDOW} votes on "
                "Japanese-original titles with a known release date."
            ),
            floor=f"{_MIN_VOTES_FOR_ERA_WINDOW} qualifying votes.",
            score=(
                "The width in years of the release-year band holding the middle 80% of "
                "their votes, narrowest first. The band's own years are shown beside it. "
                f"{TIE_BREAK}"
            ),
            excluded=(
                "Titles with no release date, and everything not Japanese-original, so a "
                "reader is measured against one publishing history rather than several."
            ),
        ),
        notes=(
            "The years are when a title came out, not when it was read. A narrow band means "
            "someone reads within one period of the medium's history, not that they read "
            "everything at once.",
            "A reader who joined recently and has only rated current releases is narrow for "
            "an uninteresting reason. The bands well behind the present are the ones that "
            "say something.",
        ),
    ),
]

CHURN_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="vns-last-logged",
        title="The last thing they logged",
        subject=Subject.VN,
        metric=Metric.TERMINAL_RATE,
        blurb=(
            "Titles that turn up far more often than chance as the final entry in a reading "
            "list before it goes quiet. They are mostly long-awaited finales, not "
            "disappointments."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {MIN_VOTES_FOR_TERMINAL} dated votes who then went "
                f"at least {TERMINAL_SILENCE_DAYS // 365} year silent before the dump ends, "
                "counted against every title they voted on."
            ),
            floor=(
                f"{MIN_RATERS_FOR_TERMINAL} such readers per title and "
                f"{MIN_TERMINAL_OBSERVED} observed stopping points, and the title must have "
                f"been out at least {TERMINAL_MATURITY_DAYS // 365} years."
            ),
            score=(
                "Observed stopping points divided by expected, where expected comes from "
                "the calendar quarter each vote was cast in. Damped toward one so a title "
                f"whose ratio rests on a handful of readers cannot lead. {TIE_BREAK}"
            ),
            excluded=(
                "Readers still active in the last year, whose most recent vote is not their "
                "last. Days holding more than one vote, where there is no single last "
                "title. Titles too new to have a settled readership."
            ),
        ),
        notes=(
            "This measures where reading lists end, not what ended them. A reader who "
            "finished a series they had followed for years and a reader who lost interest "
            "leave the same trace, and the board cannot tell them apart.",
            "Longer titles are somewhat over-represented, at about one and a half times the "
            "rate of the shortest ones, because they take longer to reach and to finish.",
            "Going quiet on this site's copy of the record is not the same as leaving. A "
            "reader who kept reading and stopped logging looks identical.",
        ),
    ),
]

FRANCHISE_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="series-longest-running",
        title="The longest-running franchises",
        subject=Subject.SERIES,
        metric=Metric.SERIES_SPAN,
        strict_series=True,
        min_works=_MIN_ENTRIES_FOR_SPAN,
        blurb=(
            "VNDB has no concept of a series, so these are assembled from the relations "
            "between titles. The longest line has been shipping since 1989."
        ),
        disclosure=Disclosure(
            population=(
                "Groups of titles connected by sequel, prequel and same-series relations, "
                "built by following those links until they run out."
            ),
            floor=(
                f"{_MIN_ENTRIES_FOR_SPAN} entries carrying at least "
                f"{MIN_VOTES_PER_SERIES_ENTRY} votes each. An unvoted catalogue fragment at "
                "either end would move the span by years while representing nothing anyone "
                "read."
            ),
            score=(
                "Years between the earliest and latest release among the counted entries. "
                f"{TIE_BREAK}"
            ),
            excluded=(
                "Looser relations that connect two works without one continuing the other, "
                "such as shared settings, alternative versions and fan works. One such link "
                "is enough to backdate a franchise by decades."
            ),
        ),
        notes=(
            "The span is between first and most recent entry, which is not the same as "
            "still running. Several of these finished years ago.",
            "Older franchises have more room to score, so this cannot be read as a ranking "
            "of which lines are most enduring in any forward-looking sense.",
            "Entries means database entries, so remakes, ports and spin-offs count "
            "alongside numbered sequels. The relation graph is also incomplete, so a "
            "franchise recorded in pieces can appear more than once or not at all.",
        ),
    ),
]


READER_COMPOSITION_BOARDS: list[BoardSpec] = [
    BoardSpec(
        slug="users-branching-readers",
        title="Readers of branching stories",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="branching",
        min_count=_MIN_ROUTE_TAGGED,
        blurb="Whose reading forks: routes, choices and endings rather than one way through.",
        disclosure=Disclosure(
            population=(
                "Readers with at least "
                f"{_MIN_ROUTE_TAGGED} voted titles where someone has recorded whether the "
                "plot branches."
            ),
            floor=f"{_MIN_ROUTE_TAGGED} titles with route structure recorded.",
            score=(
                "Of those titles, the share tagged as branching rather than linear. Measured "
                "against the titles where the structure is known rather than the whole "
                "library, since an untagged title is unrecorded rather than linear. "
                f"{TIE_BREAK}"
            ),
            excluded=_SHARE_EXCLUSIONS,
        ),
        notes=(
            "Branching is the majority, so this end of the scale is compressed: the visible "
            "board sits inside a few percentage points and the order within it turns on one "
            "or two titles. The linear board is the sharper of the pair.",
            "Route structure is recorded for a minority of titles, so a reader whose library "
            "is largely untagged does not appear here at all.",
        ),
    ),
    BoardSpec(
        slug="users-linear-readers",
        title="Readers of one way through",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="linear",
        min_count=_MIN_ROUTE_TAGGED,
        blurb=(
            "The other end of the same measurement, and the sharper one: readers who pick "
            "stories that go one way, in a medium whose default is to fork."
        ),
        disclosure=Disclosure(
            population=(
                "Readers with at least "
                f"{_MIN_ROUTE_TAGGED} voted titles where someone has recorded whether the "
                "plot branches."
            ),
            floor=f"{_MIN_ROUTE_TAGGED} titles with route structure recorded.",
            score=(
                "Of those titles, the share tagged as linear rather than branching. "
                f"{TIE_BREAK}"
            ),
            excluded=_SHARE_EXCLUSIONS,
        ),
        notes=(
            "The minority end of the same figure the branching board ranks, which is what "
            "gives it room: the population sits near a third, so the top is a long way above "
            "typical rather than a fraction above it.",
            "Route structure is recorded for a minority of titles, so a reader whose library "
            "is largely untagged does not appear here at all.",
        ),
    ),
    BoardSpec(
        slug="users-bare-bones",
        title="Readers who go without",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="bare_bones",
        min_count=MIN_LIBRARY_FOR_SHARE,
        blurb=(
            "Whose libraries are full of titles missing the conveniences readers now take for "
            "granted: no backlog, no skip, no quick save, a single save slot."
        ),
        disclosure=Disclosure(
            population=(
                f"Every reader with at least {MIN_LIBRARY_FOR_SHARE} public votes, ranked on "
                "all of them."
            ),
            floor=f"{MIN_LIBRARY_FOR_SHARE} voted titles.",
            score=(
                "The share of their voted titles tagged as lacking at least one of: a "
                "backlog, a skip function, skipping read text, quick save and load, saving at "
                "all, an auto-advance function, more than one save slot, or anything beyond "
                f"an autosave. {TIE_BREAK}"
            ),
            excluded=_SHARE_EXCLUSIONS,
        ),
        notes=(
            "This measures the titles, not the reader's patience. What it mostly finds is "
            "people reading older or smaller work, where these features had not become "
            "standard.",
            "Absence has to have been tagged to count. A title nobody has annotated counts "
            "toward the total and not toward the share, so the figure is a floor on how "
            "spartan someone's reading really is.",
        ),
    ),
    BoardSpec(
        slug="users-one-studio",
        title="Readers of one studio",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="top_studio",
        min_count=_MIN_CREDITED_FOR_DEVOTION,
        blurb=(
            "How much of a reader's library comes from a single developer. At the top, almost "
            "all of it."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {_MIN_CREDITED_FOR_DEVOTION} voted titles that have a "
                "credited developer."
            ),
            floor=f"{_MIN_CREDITED_FOR_DEVOTION} credited titles.",
            score=(
                "The share of those titles made by whichever single developer they have read "
                f"most. Their own most-read studio, not a fixed one. {TIE_BREAK}"
            ),
            excluded=_SHARE_EXCLUSIONS,
        ),
        notes=(
            "A title with several credited developers counts toward each of them, so a reader "
            "of co-productions can score a little higher than their reading warrants.",
            "Studios vary enormously in catalogue size, so a high share partly reflects having "
            "picked a prolific one. It says the reader stayed, not that they had nowhere to go.",
        ),
    ),
    BoardSpec(
        slug="users-one-writer",
        title="Readers who follow a writer",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="top_writer",
        min_count=_MIN_CREDITED_FOR_DEVOTION,
        blurb=(
            "The same question about people rather than companies: how much of a library is "
            "the work of one scenario writer."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {_MIN_CREDITED_FOR_DEVOTION} voted titles carrying a "
                "scenario credit."
            ),
            floor=f"{_MIN_CREDITED_FOR_DEVOTION} titles with a scenario credit.",
            score=(
                "The share of those titles written by whichever single writer they have read "
                f"most. {TIE_BREAK}"
            ),
            excluded=_SHARE_EXCLUSIONS,
        ),
        notes=(
            "Only the scenario credit counts. Someone credited for art or music on a title is "
            "not counted as its writer.",
            "Co-written titles count toward each credited writer.",
            "Scenario credits are recorded unevenly, and a reader whose titles carry none does "
            "not appear here at all.",
        ),
    ),
    BoardSpec(
        slug="users-series-returners",
        title="Readers who come back for the next one",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="series_return",
        min_count=_MIN_FRANCHISES_ENTERED,
        blurb=(
            "Of the series a reader has started at all, how often they went on to read another "
            "entry rather than stopping at one."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers who have voted on a title from at least {_MIN_FRANCHISES_ENTERED} "
                "different series."
            ),
            floor=f"{_MIN_FRANCHISES_ENTERED} series entered.",
            score=(
                "The share of those series where they rated more than one entry. "
                f"{TIE_BREAK}"
            ),
            excluded=(
                "Series are built from sequel, prequel and same-series relations only. A "
                "shared setting or an alternative edition is not another entry to go on to."
            ),
        ),
        notes=(
            "A series here is a group of titles VNDB links as continuations of each other, "
            "which it has no entity for; it is assembled from those links.",
            "Entering a two-part series and reading both counts the same as working through a "
            "long one, so this measures the habit of returning rather than how far.",
        ),
    ),
    BoardSpec(
        slug="users-completionists-series",
        title="Readers who finish the whole series",
        subject=Subject.USER,
        metric=Metric.LIBRARY_SHARE,
        composition="franchise_depth",
        min_count=_MIN_FRANCHISES_ENTERED,
        blurb=(
            "Not whether they came back, but how far in they got: across every series they "
            "touched, the average share of its entries they actually read."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers who have entered at least {_MIN_FRANCHISES_ENTERED} series, scored "
                "over those with three or more entries."
            ),
            floor=(
                f"{_MIN_FRANCHISES_ENTERED} series entered, and a series needs three entries "
                "before how much of it someone read means anything."
            ),
            score=(
                "For each series they entered, the share of its entries they voted on; the "
                f"board shows the average of those shares. {TIE_BREAK}"
            ),
            excluded=(
                "Series of fewer than three entries, where finishing is not a feat. Series "
                "built from anything other than sequel, prequel and same-series relations."
            ),
        ),
        notes=(
            "Entries means database entries, so remakes, ports and side stories count as part "
            "of a series alongside numbered sequels. Reading everything is harder than it "
            "sounds for that reason.",
            "The companion to the returning board: one asks whether they came back at all, "
            "this asks how much they finished once they did.",
        ),
    ),
    BoardSpec(
        slug="users-travelled-backwards",
        title="Readers who went backwards in time",
        subject=Subject.USER,
        metric=Metric.READING_DRIFT,
        min_count=_MIN_VOTES_FOR_DRIFT,
        ascending=True,
        blurb=(
            "Everyone drifts forward as new titles come out. These readers went the other "
            "way, some of them by two decades."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {_MIN_VOTES_FOR_DRIFT} dated votes, cast across at "
                "least 25 separate days and three years."
            ),
            floor=(
                f"{_MIN_VOTES_FOR_DRIFT} dated votes. The day and span requirements matter as "
                "much: a history needs to be spread out before it can be said to have moved."
            ),
            score=(
                "Their votes are ordered by date and split into thirds. The score is the "
                "median release year of the last third minus that of the first, so a negative "
                f"number means their reading travelled into the past. {TIE_BREAK}"
            ),
            excluded=(
                "Votes with no date, which cannot be placed in the order, and titles with no "
                "release date, which have no year to compare."
            ),
        ),
        notes=(
            "Ranked from the most negative. Drifting forward is what happens by default, so "
            "the interesting direction is the one that takes effort.",
            "A median rather than an average, so one very old title in an otherwise modern "
            "third does not read as a decade of travel.",
            "This describes the order someone rated things in, which is not always the order "
            "they read them.",
        ),
    ),
    BoardSpec(
        slug="users-narrowest-taste",
        title="Readers with the narrowest taste",
        subject=Subject.USER,
        metric=Metric.THEME_RANGE,
        min_count=_MIN_TAGGED_FOR_THEMES,
        ascending=True,
        blurb=(
            "How many different themes would show up in twenty-five titles pulled at random "
            "from a reader's library. At the top of this board, remarkably few."
        ),
        disclosure=Disclosure(
            population=(
                f"Readers with at least {_MIN_TAGGED_FOR_THEMES} voted titles carrying five "
                "or more content tags."
            ),
            floor=f"{_MIN_TAGGED_FOR_THEMES} sufficiently tagged titles.",
            score=(
                "Each title contributes its five strongest content tags. The score is the "
                "number of distinct tags a random draw of twenty-five of their titles would "
                "be expected to show, counted from the bottom so the narrowest lead. "
                f"{TIE_BREAK}"
            ),
            excluded=(
                "Titles carrying fewer than five content tags, which would look narrow "
                "because nobody has described them rather than because they are alike."
            ),
        ),
        notes=(
            "Asked at a fixed sample size on purpose. Counting the tags a reader has touched "
            "would rank library size, and dividing by size overcorrects; asking what a draw of "
            "the same size looks like puts a fifty-title library and a three-thousand-title "
            "one on the same footing.",
            "Narrow is not a judgement. A reader working through one genre deliberately scores "
            "the same as one who has not looked around.",
            "Only the wider end of this measurement was left off. A large library reaches a "
            "high count easily enough that the top of it tracked the sample floor rather than "
            "genuine range.",
        ),
    ),
    BoardSpec(
        slug="users-backlog-longer",
        title="Backlogs longer than the reading",
        subject=Subject.USER,
        metric=Metric.BACKLOG_GAP,
        min_count=MIN_PER_SIDE_FOR_BACKLOG,
        blurb=(
            "Readers whose wishlist is made of long titles while the ones they actually finish "
            "are short. Most people lean this way a little; these lean hard."
        ),
        disclosure=Disclosure(
            population=(
                f"Every reader with at least {MIN_PER_SIDE_FOR_BACKLOG} finished and "
                f"{MIN_PER_SIDE_FOR_BACKLOG} wishlisted titles that carry a length category."
            ),
            floor=(
                f"{MIN_PER_SIDE_FOR_BACKLOG} titles on each side. The smaller side is what "
                "limits the comparison, so it is what the floor is applied to."
            ),
            score=(
                "Mean length category of the wishlist minus the mean of what they finished, "
                f"on VNDB's one-to-five scale. {TIE_BREAK}"
            ),
            excluded=(
                "Titles with no recorded length category, on both sides. A missing length is "
                "not a middling one, and including it on one side only would make the two "
                "means measure different things. Accounts the dump marks as not counting are "
                "left out, as everywhere."
            ),
        ),
        notes=(
            "The length category is used rather than an hour count because it is recorded for "
            "roughly twice as many titles, and the comparison only needs both sides measured "
            "the same way.",
            "No correction for sample size is applied because none is needed here. Both sides "
            "come from one reader's own list, so a difference of means is already centred on "
            "zero whatever the list length, and the measured relationship with list size is "
            "close enough to nothing to leave alone.",
            "A wishlist is a statement of intent that costs nothing to make, which is most of "
            "why this gap exists at all. Two thirds of qualifying readers show it in the same "
            "direction.",
        ),
    ),
]

BOARDS: list[BoardSpec] = (
    USER_BOARDS
    + VN_BOARDS
    + PRODUCER_BOARDS
    + CREDIT_BOARDS
    + SERIES_BOARDS
    + RISING_BOARDS
    + CATALOGUE_BOARDS
    + DISCOVERY_BOARDS
    + LEADING_ROLE_BOARDS
    + STUDIO_LONGEVITY_BOARDS
    + TAG_BOARDS
    + TAG_TEXTURE_BOARDS
    + READER_CHARACTER_BOARDS
    + CHURN_BOARDS
    + FRANCHISE_BOARDS
    + READER_COMPOSITION_BOARDS
)

BOARDS_BY_SLUG: dict[str, BoardSpec] = {board.slug: board for board in BOARDS}

if len(BOARDS_BY_SLUG) != len(BOARDS):
    seen: set[str] = set()
    duplicates = sorted({b.slug for b in BOARDS if b.slug in seen or seen.add(b.slug)})
    raise ValueError(f"Duplicate leaderboard slugs: {duplicates}")


def board_for_slug(slug: str) -> BoardSpec | None:
    return BOARDS_BY_SLUG.get(slug)


def boards_by_subject() -> dict[Subject, list[BoardSpec]]:
    grouped: dict[Subject, list[BoardSpec]] = {}
    for board in BOARDS:
        grouped.setdefault(board.subject, []).append(board)
    return grouped
