"""The named lists the recommendations endpoint serves, and the reason a card carries.

The engine blends nine signals into one order. A reader who disagrees with that order has
nowhere to look: the blend is the only view, and a signal that ranks a title first is
invisible once eight others have averaged it away. This publishes each signal's own list
under a name, so a reader can ask what one kind of evidence says on its own.

A list is a request scored under a vector giving one signal all the weight. That is not a
special path through the engine: the vector already decides how the candidate budget is
split between the retrieval sources, so naming one signal sends its own source looking and
leaves the rest unspent. What comes back is that source's answer, ranked by that signal's
scorer, which is what the list claims to be.

Names are the reader's, not the engine's, except where the same page already shows the
engine's word on a control. `tags` and `staff` are spelled as the filters beside them are
spelled, since two words for one thing on one screen teaches a reader the page is
approximate. The rest are plain words for what the evidence is.

`quality` has no list. It is the crowd's average rating, identical for every reader, and a
list ordered by it is a chart rather than a recommendation. It has no retrieval source
either, so a list asking for it would draw its candidates from the exploration slice and
rank a random sample of the catalogue by popularity.

Ordering, and why it is not the score alone: four of the nine scorers return the same
value for most of what their own source reaches, so ordering on the score leaves those
lists in whatever order the pool arrived in. The source ranked those candidates on the
reader's affinity for the entities behind them, and that ordering is published on the
recommender. Sorting on the score first and the source position second uses whichever of
the two discriminates, with no threshold and no per-signal case: where the score separates
candidates it decides, and where it is flat the affinity does.
"""

from dataclasses import dataclass
from typing import Optional

from app.services.hybrid_recommender import (
    RETRIEVAL_ARM_SIGNALS,
    SIGNAL_WEIGHTS,
    RecommendationResult,
)

# The combined view, and the default when no list is named.
COMBINED = "combined"

# Entities named on a card. Three is what fits on one line beside a cover, and the count
# beside them says how much was left out.
REASON_NAMES = 3

# Depth each detail list is cut to before it reaches the reason. A count at the depth is
# a floor rather than a total, and the reason says so rather than leaving copy to guess.
DETAIL_DEPTH = {
    "matched_tags": 10,
    "matched_seiyuu": 5,
    "matched_traits": 5,
    "similar_games_details": 5,
    "users_also_read_details": 5,
    "description_matches": 3,
}

# Sorts a candidate the list's own retrieval source never reached below every candidate it
# did. Larger than any source's answer, which is bounded by the collection budget.
UNRANKED_POSITION = 1 << 30


class UnknownList(ValueError):
    """A `list` parameter naming something this endpoint does not serve."""


@dataclass(frozen=True)
class SignalList:
    """One named list, and where its ranking and its reason come from."""

    # The token in the URL and in `reason.list`.
    name: str
    # The engine signal it ranks on, which is also the key it appears under in `scores`,
    # `signal_weights` and `ranked_in`.
    signal: str
    # Field on a result holding the entities that put the title on this list. Populated
    # only when the run computed details.
    source: str
    # Keys within those entries carrying the name to show and the id to link to. Producers
    # are held by name in the profile, so that list has no id to offer.
    label_key: str
    id_key: Optional[str]

    @property
    def arm(self) -> Optional[str]:
        """The retrieval source serving this signal, where one does."""
        return _ARM_OF_SIGNAL.get(self.signal)


_ARM_OF_SIGNAL = {signal: arm for arm, signal in RETRIEVAL_ARM_SIGNALS.items()}


# Order the lists are published in, which is the order a client should offer them.
SIGNAL_LISTS: tuple[SignalList, ...] = (
    SignalList("tags", "tag", "matched_tags", "name", "id"),
    SignalList("premise", "description", "description_matches", "source_title", "source_vn_id"),
    SignalList("similar", "similar_games", "similar_games_details", "source_title", "source_vn_id"),
    SignalList("studios", "developer", "matched_developers", "name", None),
    SignalList("staff", "staff", "matched_staff", "name", "id"),
    SignalList("voices", "seiyuu", "matched_seiyuu", "name", "id"),
    SignalList("characters", "trait", "matched_traits", "name", "id"),
    SignalList("also-read", "users_also_read", "users_also_read_details", "source_title", "source_vn_id"),
)

LISTS_BY_NAME: dict[str, SignalList] = {entry.name: entry for entry in SIGNAL_LISTS}
LISTS_BY_SIGNAL: dict[str, SignalList] = {entry.signal: entry for entry in SIGNAL_LISTS}

# Every token the parameter accepts, in the order they are offered.
LIST_NAMES: tuple[str, ...] = (COMBINED,) + tuple(entry.name for entry in SIGNAL_LISTS)


def parse_list(raw: Optional[str]) -> Optional[SignalList]:
    """Read the `list` parameter. None is the combined view.

    An unknown name is refused rather than falling back to the combined view: a client
    that misspells a list would otherwise be served a different list under its name and
    have no way to notice.
    """
    if raw is None:
        return None
    name = raw.strip().lower()
    if not name or name == COMBINED:
        return None
    entry = LISTS_BY_NAME.get(name)
    if entry is None:
        raise UnknownList(
            f"list names {raw!r}, which is not served; the lists are "
            + ", ".join(LIST_NAMES)
        )
    return entry


def single_signal_weights(signal: str) -> dict[str, float]:
    """The vector that scores one signal and nothing else.

    The named signal keeps its usual weight rather than a weight of one. The split of the
    retrieval budget is measured against the default weight for a signal, so a source asked
    for at its usual weight spends its usual share; the rest sit at zero, which their
    sources read as not running at all.

    The weight also divides the match percentage, so under a vector of one signal the
    percentage is that signal's own score on the 0-100 scale rather than a share of a total
    no candidate could reach.
    """
    return {
        name: (SIGNAL_WEIGHTS[name] if name == signal else 0.0) for name in SIGNAL_WEIGHTS
    }


def reason_from(result: RecommendationResult, entry: SignalList) -> Optional[dict]:
    """What put this title on this list: how many entities matched, and the strongest few.

    `count` is how many the run reported. Several of the detail lists are cut to a fixed
    depth before they reach here, so on a title matching more than that depth the count is
    a floor rather than a total. `count_is_floor` marks a count that sits at the cut, so
    copy built on it reads as at least rather than exactly.

    None where the run did not compute details, and where the signal ranked the title on
    something with no entities behind it to name.
    """
    matches = getattr(result, entry.source, None) or []
    if not matches:
        return None
    top = []
    for match in matches[:REASON_NAMES]:
        label = match.get(entry.label_key)
        if not label:
            continue
        named = {"name": label}
        if entry.id_key:
            named["id"] = match.get(entry.id_key)
        # The other script travels with the name, because which one is shown is the
        # reader's setting. A person carries a romanisation; a title carries its variants.
        if match.get("name_original"):
            named["original"] = match["name_original"]
        if entry.label_key == "source_title":
            for key in ("source_title_jp", "source_title_romaji"):
                if match.get(key):
                    named[key.removeprefix("source_")] = match[key]
        top.append(named)
    if not top:
        return None
    depth = DETAIL_DEPTH.get(entry.source)
    return {
        "list": entry.name,
        "signal": entry.signal,
        "count": len(matches),
        "count_is_floor": depth is not None and len(matches) >= depth,
        "top": top,
    }


def strongest_reason(
    result: RecommendationResult,
    weights: Optional[dict[str, float]] = None,
) -> Optional[dict]:
    """The reason from whichever signal contributed most to this title's score.

    A combined card has up to eight reasons available and room for one. Contribution is
    the signal's score against the weight it carried for this reader, so the reason shown
    is the one the order was actually made of rather than whichever list happens to be
    first.

    `weights` is the vector the result was scored under. A caller that did not keep it
    falls back to the global vector, which is what a run that names no weights of its own
    is scored under.
    """
    weights = weights if weights is not None else SIGNAL_WEIGHTS
    best: Optional[dict] = None
    best_contribution = -1.0
    for entry in SIGNAL_LISTS:
        contribution = getattr(result, f"{entry.signal}_score", 0.0) * weights.get(
            entry.signal, 0.0
        )
        if contribution <= best_contribution:
            continue
        reason = reason_from(result, entry)
        if reason is None:
            continue
        best = reason
        best_contribution = contribution
    return best


def order_by_signal(
    results: list[RecommendationResult],
    entry: SignalList,
    arm_ranking: list[tuple[str, float]],
) -> list[RecommendationResult]:
    """Put a single-signal page in that signal's own order.

    The engine returns its page in the order the diversity pass settled, which is the
    right order for a blend and the wrong one for a list claiming to be one signal's
    ranking. Sorting here rather than asking the engine for another order keeps the
    diversity pass doing what it does, which is deciding which titles reach the page.

    See the module docstring for why the retrieval position is the second key.
    """
    positions = {vn_id: index for index, (vn_id, _) in enumerate(arm_ranking)}
    return sorted(
        results,
        key=lambda result: (
            -getattr(result, f"{entry.signal}_score", 0.0),
            positions.get(result.vn_id, UNRANKED_POSITION),
            result.vn_id,
        ),
    )


def list_catalogue() -> list[dict]:
    """The lists on offer, for a client building the same set of tabs this serves."""
    return [{"name": COMBINED, "signal": None}] + [
        {"name": entry.name, "signal": entry.signal} for entry in SIGNAL_LISTS
    ]
