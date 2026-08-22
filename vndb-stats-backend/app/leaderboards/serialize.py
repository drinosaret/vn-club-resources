"""Response models for the leaderboard API.

One row shape serves every subject. That is deliberate: it lets a single table component
render a board of users, of visual novels, or of studios without knowing which it has, and
it means adding a subject does not touch the frontend.

Rows are hydrated when a board is built, not when it is read, so serving a board is a cache
read and nothing else.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from .spec import Metric


def format_value(
    metric: Metric, value: float, count: int, secondary: dict | None = None
) -> str:
    """Render a metric for display beside its row.

    Ratio metrics carry their denominator, because "38%" alone cannot be told apart from a
    rate over four readers and a rate over four thousand. `secondary` supplies the few
    figures a bare number cannot stand without: only this label reaches the page, so a
    caveat telling the reader to check something it does not show would be unactionable.
    """
    detail = secondary or {}
    if metric is Metric.VOTES:
        return f"{int(value):,} votes"
    if metric is Metric.VOTERS:
        return f"{int(value):,} voters"
    if metric is Metric.SOLE_VOTER:
        return f"{int(value):,} titles"
    if metric in (Metric.AVG_SCORE, Metric.BAYESIAN):
        return f"{value:.2f}"
    if metric is Metric.DIVISIVENESS:
        return f"±{value:.2f}"
    if metric is Metric.VELOCITY:
        return f"{value * 100:.0f}% of {count:,} recent"
    if metric is Metric.REPUTATION_SHIFT:
        # Signed, because the direction is the entire point.
        return f"{value:+.2f} over {count:,} votes"
    if metric is Metric.RATING_AS_OF:
        return f"{value:.2f} from {count:,} votes then"
    if metric is Metric.FINISHED:
        return f"{int(value):,} finished"
    if metric is Metric.DROPPED:
        return f"{int(value):,} dropped"
    if metric is Metric.WISHLIST:
        return f"{int(value):,} wishlisted"
    if metric is Metric.CHARACTERS:
        # At the scale a person would say it out loud, with the measured count attached: the
        # figure is a floor over part of a library and reads as a total without it.
        if value >= 1_000_000:
            return f"{value / 1_000_000:,.1f}M characters over {count:,} titles"
        return f"{int(value):,} characters over {count:,} titles"
    if metric in (Metric.DROP_RATE, Metric.COMPLETION_RATE):
        return f"{value * 100:.0f}% of {count:,}"
    if metric is Metric.VOTE_BIAS:
        # Signed and in rating points: the direction is what the board is about.
        return f"{value:+.2f} vs the room"
    if metric is Metric.OBSCURITY:
        # The median can round to one, and the top of the board is exactly where it does.
        noun = "other voter" if round(value) == 1 else "other voters"
        return f"{value:,.0f} {noun}, typically"
    if metric is Metric.CATALOGUE_FLOOR:
        return f"worst rated {value:.2f}"
    if metric is Metric.VOTE_DIVERGENCE:
        return f"±{value:.2f} swing"
    if metric is Metric.ERA:
        return f"median {int(value)}"
    if metric is Metric.WORKS:
        return f"{int(value):,} leading roles"
    if metric is Metric.DIFFICULTY:
        return f"difficulty {value:.2f}"
    if metric is Metric.TITLE_DIFFICULTY:
        return f"{value:.2f} across {count:,} titles"
    if metric is Metric.TITLE_DROP_RATE:
        return f"{value * 100:.0f}% given up, {count:,} titles"
    if metric is Metric.TITLE_RECENCY:
        return f"{value * 100:.0f}% this year, {count:,} titles"
    if metric is Metric.VOTE_RESPONSE:
        # A multiplier on the community's own movement, so the unit is "times".
        return f"{value:.2f}x the swing"
    if metric is Metric.STEADINESS:
        return f"{value * 100:.0f}% even over {count:,} votes"
    if metric is Metric.ERA_WINDOW:
        band = f"{detail['from']}-{detail['to']}" if 'from' in detail else f"{value:.0f} years"
        return f"{band}, {count:,} votes"
    if metric is Metric.TERMINAL_RATE:
        return f"{value:.1f}x expected, {count:,} times"
    if metric is Metric.THEME_RANGE:
        return f"{value:.0f} themes of {count:,} titles"
    if metric is Metric.READING_DRIFT:
        # Signed and in years: the direction is the whole claim.
        return f"{value:+.1f} yrs, {count:,} votes"
    if metric is Metric.BACKLOG_GAP:
        # Signed, and both means shown: "+1.8" alone cannot be told apart from a reader who
        # finishes nothing short from one whose backlog is merely a little longer.
        want = detail.get("wishlist_length")
        done = detail.get("finished_length")
        if want is None or done is None:
            return f"{value:+.2f} length categories"
        return f"{value:+.2f}: {want:.1f} to {done:.1f} of 5"
    if metric is Metric.LIBRARY_SHARE:
        return f"{value * 100:.1f}% of {count:,}"
    if metric is Metric.SERIES_SPAN:
        run = f"{detail['first']}-{detail['latest']}" if 'first' in detail else ''
        return f"{value:.1f} yrs{f', {run}' if run else ''}"
    if metric is Metric.DISCOVERY_LAG:
        # Signed against its release-year peers, which is the whole comparison.
        return f"{value:+.1f} yrs vs its year"
    if metric is Metric.TITLE_MEAN:
        return f"{value:.2f} across {count:,} titles"
    if metric is Metric.TITLE_SPREAD:
        return f"±{value:.2f} across {count:,} titles"
    if metric is Metric.ACTIVE_SPAN:
        return f"{int(value)} years running"
    return f"{value:g}"


class LeaderboardRow(BaseModel):
    """One ranked entry, whatever the subject.

    Titles and names are sent in every form the database holds rather than pre-resolved,
    because which one to show is a per-reader setting the server does not know. The client
    picks using the same helpers the rest of the site uses.
    """

    rank: int
    id: str
    #: The database's own title or name. For a Japanese work this is the Japanese form, so
    #: it is not safe to display without consulting the reader's preference.
    label: str
    sublabel: str | None = None

    #: Visual novel title variants, for `getDisplayTitle`.
    title_jp: str | None = None
    title_romaji: str | None = None
    #: Romanised name of a person or company, for `getEntityDisplayName`. Named for the
    #: column it comes from, where `name` holds the Japanese form and `original` the Latin.
    name_original: str | None = None
    href: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    #: The visual novel the cover belongs to, which is not always the row's own id: a series
    #: row is identified by the franchise but illustrated by one of its entries. Used as the
    #: key for the click-to-reveal state, so revealing here carries to that title's page.
    image_vn_id: str | None = None
    value: float
    value_label: str
    secondary: dict = Field(default_factory=dict)


class LeaderboardResponse(BaseModel):
    """A board, as served."""

    slug: str | None = None
    title: str
    blurb: str = ""
    subject: str
    metric: str
    window: str
    #: Which page lists this board: "rankings" or "trends". The board page renders both, so
    #: this is what its back link and breadcrumb follow; without it a board that moved would
    #: send readers to a page it no longer appears on.
    home: str = "rankings"
    facet: dict = Field(default_factory=dict)
    facet_description: str = ""

    #: Which language view this payload is: "ja" for Japanese-original titles only, "all"
    #: for everything.
    language: str = "all"
    #: Whether a Japanese-only view of this board exists. False for boards that are not
    #: about visual novels, and for boards already pinned to one original language.
    has_language_variants: bool = False

    #: When the nightly job built this, and which dump it was built from. The UI shows the
    #: dump date rather than the build time: readers care which data they are looking at.
    generated_at: datetime | None = None
    dump_date: date | None = None
    #: Always false. The dump lands once a day, so nothing here is live, and a board that
    #: implied otherwise would be lying about how fresh its numbers are.
    is_live: bool = False

    total_ranked: int = 0
    rows: list[LeaderboardRow] = Field(default_factory=list)
    #: The four standing answers, sent structurally so the page can label them rather than
    #: parsing a prefix back out of a sentence.
    disclosure: dict[str, str] | None = None
    #: (label, href) crediting a source outside this site, where one was used.
    attribution: dict[str, str] | None = None
    #: Board-specific caveats, beyond the four above.
    notes: list[str] = Field(default_factory=list)


class CatalogueEntry(BaseModel):
    """One board as it appears in the catalogue listing."""

    slug: str
    title: str
    blurb: str
    subject: str
    metric: str
    window: str
    #: Which page lists this board: "rankings" or "trends".
    home: str = "rankings"
    #: For share boards, which composition of a library is ranked. Empty for everything else.
    composition: str = ""
    facet_description: str
    #: What the facet narrows by: none, era, attention or kind. Groups the catalogue.
    facet_kind: str = "none"
    total_ranked: int = 0
    generated_at: datetime | None = None


class CatalogueResponse(BaseModel):
    boards: list[CatalogueEntry] = Field(default_factory=list)
    generated_at: datetime | None = None
    dump_date: date | None = None


class Standing(BaseModel):
    """One board a reader places on."""

    slug: str
    title: str
    rank: int
    total_ranked: int
    percentile: float | None = None


class StandingsResponse(BaseModel):
    """Every reader board a person places on, best placement first."""

    uid: str
    standings: list[Standing] = Field(default_factory=list)


class RankResponse(BaseModel):
    """Where one subject sits on a board."""

    slug: str
    id: str
    rank: int | None = None
    total_ranked: int = 0
    percentile: float | None = None
    value: float | None = None
