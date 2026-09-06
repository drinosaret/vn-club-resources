"""Reader-supplied signal weights for the recommendation endpoints.

The engine blends nine signals under one weight vector, and that vector is the same for
every reader. A reader the balance does not suit has no way to say which signal is wrong
for them, so the vector is accepted per request: the endpoint takes one compact parameter,
validates it here, and hands the result to both scoring paths.

The parameter travels in a link that is meant to be read and shared, so it is one value
rather than eight, it names only the signals that differ from the default, and it spells
them the way the response spells them:

    weights=tag:3.0,quality:0

Nothing is stored. There are no accounts, so a tuned vector lives in the link and nowhere
else, and a request that names no weights is the request that has always been served.

Presets live here rather than in a client so that every client offers the same set and a
link produced by one reproduces under another.
"""

from dataclasses import dataclass
from typing import Optional

from app.services.hybrid_recommender import SIGNAL_WEIGHTS, _env_flag, weight_total

# Whether the endpoints read a reader-supplied vector at all. Off, the parameter is not
# looked at and every request is answered exactly as it was before this existed, which is
# both the safe default and the thing that makes the on state measurable against it.
#
# It is a per-request parameter rather than a scoring variant, so it is not in the engine's
# SWITCH_ENV_VARS: the evaluation harness never sets weights, and a switch it cannot
# exercise recorded against every run is noise. The reason to have it at all is cost. A
# tuned request cannot be answered from the shared per-reader cache, so it computes fresh
# every time, and this is the one place to stand that down without a deploy.
READER_WEIGHTS = _env_flag("REC_READER_WEIGHTS", True)

# The signals a caller may name, in the order every response lists them.
SIGNAL_NAMES: tuple[str, ...] = tuple(SIGNAL_WEIGHTS)

# Ceiling on one signal. Four times the largest default already decides the ranking on its
# own, so a larger number expresses nothing further and only inflates the raw score.
MAX_SIGNAL_WEIGHT = 10.0

# Ceiling and floor on the vector as a whole. The match percentage divides by the total
# actually used, so multiplying every weight by a constant moves neither the order nor the
# percentage; the ceiling exists to keep the raw score on the scale the rest of the system
# reads it at. The floor is the case that has no answer rather than a large one: with no
# weight anywhere there is nothing to divide by and every candidate scores alike, so a
# vector adding up to nothing is refused rather than clamped.
MAX_TOTAL_WEIGHT = 20.0
MIN_TOTAL_WEIGHT = 0.1

# Length bound on the raw parameter. Every name and value fits inside it several times
# over, so anything longer is not a weight vector.
MAX_WEIGHTS_PARAM_CHARS = 240

# How many decimal places a weight is kept to. Enough to place a signal between two
# defaults, few enough that two links describing the same vector are the same link.
WEIGHT_PRECISION = 3


class InvalidSignalWeights(ValueError):
    """A weights parameter that cannot be read as a vector.

    Raised only for what cannot be interpreted at all. A value that is merely out of
    range is clamped and reported, since refusing it would leave a slider able to produce
    a request the endpoint rejects.
    """


# Named vectors, described by what the signals do rather than by the mood of the result.
# `balanced` is the default vector itself, so selecting it is the same request as naming
# no weights at all.
PRESETS: dict[str, dict] = {
    "balanced": {
        "label": "Balanced",
        "description": (
            "The default blend: how a title describes itself and who made it lead, with "
            "tags and co-reading adding on top."
        ),
        "weights": dict(SIGNAL_WEIGHTS),
    },
    "by-theme": {
        "label": "By theme",
        "description": "Leans on tag affinity, so subject matter decides and popularity has little say.",
        "weights": {
            "tag": 5.0,
            "similar_games": 1.5,
            "users_also_read": 0.8,
            "quality": 0.8,
            "developer": 0.4,
            "staff": 0.4,
            "trait": 0.6,
            "seiyuu": 0.2,
            "description": 2.0,
        },
    },
    "by-premise": {
        "label": "By premise",
        "description": (
            "Leans almost entirely on how a title describes itself, which is the one "
            "signal a title carries whether or not anyone has read it."
        ),
        "weights": {
            "tag": 0.8,
            "similar_games": 0.3,
            "users_also_read": 0.0,
            "quality": 0.3,
            "developer": 1.0,
            "staff": 0.6,
            "trait": 0.4,
            "seiyuu": 0.3,
            "description": 6.0,
        },
    },
    "by-creator": {
        "label": "By creator",
        "description": "Leans on the studios, writers and voice actors behind titles already rated highly.",
        "weights": {
            "tag": 1.5,
            "similar_games": 1.0,
            "users_also_read": 0.5,
            "quality": 0.5,
            "developer": 2.5,
            "staff": 2.5,
            "trait": 0.4,
            "seiyuu": 1.5,
            "description": 1.0,
        },
    },
    "by-similar-readers": {
        "label": "By similar readers",
        "description": "Leans on what readers of the same titles went on to read, rather than on the titles themselves.",
        "weights": {
            "tag": 1.0,
            "similar_games": 3.0,
            "users_also_read": 4.0,
            "quality": 0.5,
            "developer": 0.3,
            "staff": 0.3,
            "trait": 0.3,
            "seiyuu": 0.2,
            "description": 0.8,
        },
    },
    "by-characters": {
        "label": "By characters",
        "description": "Leans on character archetypes and voice actors, which the default blend keeps quiet.",
        "weights": {
            "tag": 2.0,
            "similar_games": 1.2,
            "users_also_read": 0.8,
            "quality": 0.5,
            "developer": 0.3,
            "staff": 0.4,
            "trait": 3.0,
            "seiyuu": 1.8,
            "description": 1.2,
        },
    },
    "ignore-consensus": {
        "label": "Ignore consensus",
        "description": (
            "Drops every signal that only exists once a title has been widely read: tags, "
            "both co-reading terms and the quality average. What is left is what a title "
            "says about itself and who made it."
        ),
        "weights": {
            **SIGNAL_WEIGHTS,
            "tag": 0.0,
            "similar_games": 0.0,
            "users_also_read": 0.0,
            "quality": 0.0,
        },
    },
}

DEFAULT_PRESET = "balanced"


def _round(value: float) -> float:
    return round(value, WEIGHT_PRECISION)


@dataclass(frozen=True)
class WeightSelection:
    """The vector a request will score under, and what had to be adjusted to reach it."""

    # Every signal, defaults filled in for the ones the caller left out.
    weights: dict[str, float]
    # Only what the caller named, before clamping, so a client can show both numbers.
    requested: dict[str, float]
    adjustments: list[dict]
    # Total of the clamped vector before the ceiling on the vector as a whole is applied.
    pre_scale_total: float
    preset: Optional[str]

    @property
    def total(self) -> float:
        """The divisor the match percentage is computed against."""
        return weight_total(self.weights)

    @property
    def is_custom(self) -> bool:
        """Whether this differs from the vector every unweighted request is scored under.

        A caller who names the defaults, by hand or by selecting the default preset, is
        asking for the ordinary request and is served it, cache included.
        """
        return self.weights != dict(SIGNAL_WEIGHTS)

    def describe(self) -> dict:
        """The weights block a response carries, for a client explaining what it applied."""
        return {
            "custom": self.is_custom,
            "preset": self.preset,
            "requested": {name: _round(value) for name, value in self.requested.items()},
            "effective": {name: _round(self.weights[name]) for name in SIGNAL_NAMES},
            "total": {
                "before_limits": _round(self.pre_scale_total),
                "applied": _round(self.total),
                "scaled": _round(self.pre_scale_total) != _round(self.total),
            },
            "adjustments": self.adjustments,
            "limits": {
                "max_signal": MAX_SIGNAL_WEIGHT,
                "max_total": MAX_TOTAL_WEIGHT,
                "min_total": MIN_TOTAL_WEIGHT,
            },
            "param": format_signal_weights(self.weights),
        }


def format_signal_weights(weights: dict[str, float]) -> str:
    """The compact parameter describing a vector, naming only what differs from default.

    The one place the wire format is written, so a client that reads a link and a client
    that writes one cannot spell it differently.
    """
    parts = [
        f"{name}:{_round(weights[name]):g}"
        for name in SIGNAL_NAMES
        if _round(weights[name]) != _round(SIGNAL_WEIGHTS[name])
    ]
    return ",".join(parts)


def _parse_pairs(raw: str) -> dict[str, float]:
    """Read `name:value` pairs, rejecting anything that is not one."""
    requested: dict[str, float] = {}
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        name, separator, value = entry.partition(":")
        name = name.strip()
        if not separator:
            raise InvalidSignalWeights(
                f"weights entry {entry!r} is not name:value, for example tag:3.0"
            )
        if name not in SIGNAL_WEIGHTS:
            raise InvalidSignalWeights(
                f"weights names an unknown signal {name!r}; the signals are "
                + ", ".join(SIGNAL_NAMES)
            )
        if name in requested:
            raise InvalidSignalWeights(f"weights names {name!r} more than once")
        try:
            number = float(value.strip())
        except ValueError:
            raise InvalidSignalWeights(
                f"weights gives {name!r} a non-numeric value {value.strip()!r}"
            )
        # Infinities and not-a-number pass float() and would poison every score they
        # touch, so they are turned away with the rest of what cannot be read.
        if number != number or number in (float("inf"), float("-inf")):
            raise InvalidSignalWeights(f"weights gives {name!r} a value that is not finite")
        requested[name] = number
    return requested


def build_selection(requested: dict[str, float]) -> WeightSelection:
    """Clamp a set of named weights into a full vector, recording what moved."""
    adjustments: list[dict] = []
    effective = dict(SIGNAL_WEIGHTS)

    for name in SIGNAL_NAMES:
        if name not in requested:
            continue
        asked = requested[name]
        applied = min(MAX_SIGNAL_WEIGHT, max(0.0, asked))
        reason = f"a signal weight is held between 0 and {MAX_SIGNAL_WEIGHT:g}"
        if SIGNAL_WEIGHTS[name] == 0:
            # A signal the engine is not scoring has no evidence to weight. Left settable,
            # it would divide a request's match percentage by weight no candidate can earn,
            # and only for the callers naming a vector of their own.
            applied = 0.0
            reason = "this signal is not currently scored, so it carries no weight"
        effective[name] = applied
        if _round(applied) != _round(asked):
            adjustments.append({
                "signal": name,
                "requested": _round(asked),
                "applied": _round(applied),
                "reason": reason,
            })

    pre_scale_total = weight_total(effective)
    if pre_scale_total < MIN_TOTAL_WEIGHT:
        raise InvalidSignalWeights(
            "weights leaves every signal at zero, which gives every title the same score; "
            f"the weights must add up to at least {MIN_TOTAL_WEIGHT:g}"
        )
    if pre_scale_total > MAX_TOTAL_WEIGHT:
        # Scaled rather than refused: the shares between signals are what the reader
        # asked for, and they survive the scale untouched.
        scale = MAX_TOTAL_WEIGHT / pre_scale_total
        effective = {name: value * scale for name, value in effective.items()}
        adjustments.append({
            "signal": None,
            "requested": _round(pre_scale_total),
            "applied": _round(weight_total(effective)),
            "reason": (
                f"the weights are held to a total of {MAX_TOTAL_WEIGHT:g}; "
                "each one was scaled down by the same factor, so their shares are unchanged"
            ),
        })

    return WeightSelection(
        weights=effective,
        requested=dict(requested),
        adjustments=adjustments,
        pre_scale_total=pre_scale_total,
        preset=matching_preset(effective),
    )


def matching_preset(weights: dict[str, float]) -> Optional[str]:
    """The preset a vector reproduces, where it reproduces one.

    Lets a link that carries only numbers still be shown under the name it was made with.
    """
    rounded = {name: _round(weights[name]) for name in SIGNAL_NAMES}
    for name, preset in PRESETS.items():
        if rounded == {signal: _round(preset["weights"][signal]) for signal in SIGNAL_NAMES}:
            return name
    return None


def parse_signal_weights(raw: Optional[str]) -> Optional[WeightSelection]:
    """Read the `weights` parameter, or None where the request named no weights.

    Returns None while reader tuning is switched off, whatever the parameter says. A
    request carrying weights then gets the answer it would have got without them rather
    than an error, since the parameter reaches the endpoint from links that outlive any
    one setting of the switch.
    """
    if raw is None or not READER_WEIGHTS:
        return None
    text = raw.strip()
    if not text:
        return None
    if len(text) > MAX_WEIGHTS_PARAM_CHARS:
        raise InvalidSignalWeights(
            f"weights is longer than {MAX_WEIGHTS_PARAM_CHARS} characters"
        )
    requested = _parse_pairs(text)
    if not requested:
        return None
    return build_selection(requested)


def preset_catalogue() -> dict:
    """Everything a client needs to offer the same controls this endpoint accepts."""
    return {
        # A client offers the controls only where this is true. Off, the parameter is
        # ignored rather than refused, so a client that offers them anyway misleads its
        # reader instead of failing visibly.
        "enabled": READER_WEIGHTS,
        "format": "weights=tag:3.0,quality:0 (comma-separated name:value pairs, naming only what differs from the default)",
        "signals": [
            {"name": name, "default": _round(SIGNAL_WEIGHTS[name])} for name in SIGNAL_NAMES
        ],
        "default_total": _round(weight_total(SIGNAL_WEIGHTS)),
        "limits": {
            "max_signal": MAX_SIGNAL_WEIGHT,
            "max_total": MAX_TOTAL_WEIGHT,
            "min_total": MIN_TOTAL_WEIGHT,
        },
        "presets": [
            {
                "name": name,
                "label": preset["label"],
                "description": preset["description"],
                "weights": {
                    signal: _round(preset["weights"][signal]) for signal in SIGNAL_NAMES
                },
                "param": format_signal_weights(preset["weights"]),
            }
            for name, preset in PRESETS.items()
        ],
    }
