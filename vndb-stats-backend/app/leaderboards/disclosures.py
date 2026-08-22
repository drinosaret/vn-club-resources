"""How each board says what it counts.

Every board in the catalogue has to answer four questions: what was eligible, what the
minimum sample was, how the score is computed, and who was left out. This module builds
those answers from the same numbers the board is configured with, so a floor cannot be
changed in the registry while the page still quotes the old one.

The answers are deliberately not uniform. A voice-actor board and a reader board are
measuring different things, and a shared template would end up either vague enough to fit
both or wrong for one of them. What is shared is the shape of the questions, not the text.
"""

from __future__ import annotations

from .aggregate import BAYESIAN_PRIOR_VOTES
from .spec import Disclosure

#: Every board reading the vote dump inherits these two exclusions, so they are stated once.
VOTE_EXCLUSIONS = (
    "Votes on private lists, which VNDB does not publish, and accounts VNDB excludes from "
    "its own public vote aggregates."
)

LIST_EXCLUSIONS = (
    "List entries belonging to accounts VNDB excludes from public vote aggregates, so the "
    "per-title and per-reader counts stay reconcilable with each other."
)

#: How `_order` settles equal scores. Stated because on the ratio boards ties are common.
TIE_BREAK = "Ties go to the larger sample first, then to the lower id, so the order is stable between runs."

#: The prior in the damped title rating, read from the value the scorer applies.
BAYESIAN_NOTE = (
    f"damped toward the population mean by the weight of about {BAYESIAN_PRIOR_VOTES} votes, "
    "so a thinly-voted title cannot reach the top on a handful of tens"
)


def _population(scope: str) -> str:
    return f"Every {scope} in the VNDB dump, as of the daily import."


def title_votes(window_text: str = "all time") -> Disclosure:
    """Boards counting how many people voted on a title."""
    return Disclosure(
        population=_population("visual novel with at least one public vote"),
        floor="None. A single vote is enough to appear, because the board is a count and not an average.",
        score=f"The number of distinct readers who voted on it over {window_text}. {TIE_BREAK}",
        excluded=VOTE_EXCLUSIONS,
    )


def title_rating(scope: str, min_votes: int) -> Disclosure:
    """Boards ranking titles by damped average score."""
    return Disclosure(
        population=_population(f"visual novel {scope}"),
        floor=f"{min_votes} public votes. Below that a mean says more about who happened to vote than about the title.",
        score=f"Mean of the public votes, {BAYESIAN_NOTE}. {TIE_BREAK}",
        excluded=VOTE_EXCLUSIONS,
    )


def title_spread(min_votes: int) -> Disclosure:
    """Divisiveness: the spread of opinion rather than its centre."""
    return Disclosure(
        population=_population("visual novel with public votes"),
        floor=f"{min_votes} public votes, since a spread needs a sample before it means anything.",
        score=(
            "Standard deviation of the votes, not the average. A title everyone rates 5 "
            f"scores zero; one split between 2 and 9 scores highly. {TIE_BREAK}"
        ),
        excluded=VOTE_EXCLUSIONS,
    )


def title_rate(action: str, min_started: int) -> Disclosure:
    """Completion and drop rates, as a share of readers who began the title."""
    return Disclosure(
        population="Every visual novel that appears on public reading lists.",
        floor=(
            f"{min_started} readers who actually started it: entries marked playing, "
            "finished, stalled or dropped. Wishlist entries do not count, because wanting "
            "to read something says nothing about finishing it."
        ),
        score=(
            f"The share of those readers who {action}, damped toward the rate across the "
            "whole database so a title measured on ninety readers cannot tie one measured "
            f"on four thousand. {TIE_BREAK}"
        ),
        excluded=LIST_EXCLUSIONS,
    )


def reader_votes(scope: str, pure: bool = False) -> Disclosure:
    """Reader boards counting votes over some slice of the database."""
    if pure:
        floor = (
            "None, but qualifying is strict: a single vote outside the slice removes the "
            "reader from the board entirely rather than reducing their score."
        )
    else:
        floor = "None. Every reader with at least one qualifying vote is ranked."
    return Disclosure(
        population=f"Every reader with public votes on {scope}.",
        floor=floor,
        score=f"The number of qualifying titles they have voted on. {TIE_BREAK}",
        excluded=VOTE_EXCLUSIONS,
    )


def reader_list_count(label: str) -> Disclosure:
    """Reader boards counting list entries in one state."""
    return Disclosure(
        population="Every reader with a public list.",
        floor="None. The board is a count, so any reader with one such entry is ranked.",
        score=f"The number of titles they have marked {label}. {TIE_BREAK}",
        excluded=LIST_EXCLUSIONS,
    )


def entity_rating(entity: str, credited: str, min_works: int, min_votes: int) -> Disclosure:
    """Boards scoring a person or company by the reception of the titles behind them."""
    return Disclosure(
        population=f"Every {entity} {credited}.",
        floor=(
            f"{min_works} separate titles, and {min_votes} public votes across them. The "
            "title count is the floor that matters: one credit on a famous work brings "
            "tens of thousands of votes with it and would otherwise clear a vote floor on "
            "its own, which says nothing about the work of the person credited."
        ),
        score=(
            f"Every vote on every qualifying title, pooled and then {BAYESIAN_NOTE}. "
            "Pooled rather than averaging each title's average, so a landmark work is not "
            f"cancelled out by an obscure one. {TIE_BREAK}"
        ),
        excluded=VOTE_EXCLUSIONS,
    )


def entity_votes(entity: str, credited: str) -> Disclosure:
    """Boards counting how much attention an entity's titles have collected."""
    return Disclosure(
        population=f"Every {entity} {credited}.",
        floor="None. This is a count of attention, so there is nothing to stabilise.",
        score=(
            "Every public vote on every title behind them, added together. A person "
            f"credited twice on one title is counted once. {TIE_BREAK}"
        ),
        excluded=VOTE_EXCLUSIONS,
    )
