"""Reader-supplied signal weights: the wire format, the limits, and the no-op case.

The parameter travels in a shareable link and reaches the scoring paths untouched, so
three things have to hold. A request that names nothing, or names the defaults, must be
the request that was always served. Anything unreadable must be refused rather than
half-applied. And the match percentage must divide by the weight the candidate could have
earned, or the number beside a tuned list stops describing it.

The feature is off by default, so most of what follows is asserted with it switched on.
The switched-off behaviour has a section of its own at the end.
"""

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    MAX_WEIGHTED_SCORE,
    SIGNAL_WEIGHTS,
    normalize_score,
    weight_total,
    weighted_total,
)
from app.services import recommendation_weights as weights_module
from app.services.recommendation_weights import (
    MAX_SIGNAL_WEIGHT,
    MAX_TOTAL_WEIGHT,
    MAX_WEIGHTS_PARAM_CHARS,
    MIN_TOTAL_WEIGHT,
    PRESETS,
    SIGNAL_NAMES,
    InvalidSignalWeights,
    build_selection,
    format_signal_weights,
    matching_preset,
    parse_signal_weights,
    preset_catalogue,
)


@pytest.fixture(autouse=True)
def reader_weights_on(monkeypatch):
    """Every case below describes the feature in use, so the switch is on for all of them."""
    monkeypatch.setattr(weights_module, "READER_WEIGHTS", True)


# ---------------------------------------------------------------------------
# The divisor
# ---------------------------------------------------------------------------


def test_weight_total_of_the_global_vector_is_the_published_constant():
    """The default path must reach the same divisor by the new route as by the old one."""
    assert weight_total(SIGNAL_WEIGHTS) == MAX_WEIGHTED_SCORE


def test_normalize_score_defaults_to_the_global_total():
    for raw in (0.0, 1.0, 4.4, MAX_WEIGHTED_SCORE, MAX_WEIGHTED_SCORE * 3):
        assert normalize_score(raw) == min(100, round((raw / MAX_WEIGHTED_SCORE) * 100))


def test_a_full_score_reads_as_a_hundred_under_any_vector():
    """A title maxing every signal is a perfect match whatever the balance was."""
    for preset in PRESETS.values():
        weights = preset["weights"]
        perfect = weighted_total({name: 1.0 for name in SIGNAL_WEIGHTS}, weights)
        assert normalize_score(perfect, weight_total(weights)) == 100


def test_a_vector_with_no_weight_anywhere_cannot_divide():
    assert normalize_score(0.0, 0.0) == 0


def test_dropping_a_signal_reweights_the_rest_rather_than_shrinking_the_score():
    """With quality dropped, a title strong everywhere else scores higher, not lower.

    Dividing by the untouched constant would report the opposite, which is the reason the
    divisor follows the weights.
    """
    scores = {name: (0.0 if name == "quality" else 0.9) for name in SIGNAL_WEIGHTS}
    default = normalize_score(
        weighted_total(scores, SIGNAL_WEIGHTS), weight_total(SIGNAL_WEIGHTS)
    )
    without_quality = PRESETS["ignore-consensus"]["weights"]
    tuned = normalize_score(
        weighted_total(scores, without_quality), weight_total(without_quality)
    )
    assert tuned > default


# ---------------------------------------------------------------------------
# Reading the parameter
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("raw", [None, "", "   ", ",", " , "])
def test_a_request_naming_no_weights_selects_nothing(raw):
    assert parse_signal_weights(raw) is None


def test_naming_the_defaults_is_not_a_custom_request():
    """However it is spelled, asking for the published balance is the ordinary request."""
    selection = parse_signal_weights(
        ",".join(f"{name}:{SIGNAL_WEIGHTS[name]:g}" for name in ("tag", "quality"))
    )
    assert selection is not None
    assert selection.is_custom is False
    assert selection.weights == dict(SIGNAL_WEIGHTS)
    assert selection.preset == "balanced"


def test_unnamed_signals_keep_their_default():
    selection = parse_signal_weights("tag:4")
    assert selection.weights["tag"] == 4.0
    for name in SIGNAL_NAMES:
        if name != "tag":
            assert selection.weights[name] == SIGNAL_WEIGHTS[name]


def test_whitespace_around_a_pair_is_ignored():
    assert parse_signal_weights(" tag : 4 , staff:1 ").weights["tag"] == 4.0


@pytest.mark.parametrize(
    "raw",
    [
        "popularity:3",          # not a signal
        "tag",                   # no value
        "tag:banana",            # not a number
        "tag:nan",
        "tag:inf",
        "tag:-inf",
        "tag:3,tag:4",           # said twice
    ],
)
def test_a_vector_that_cannot_be_read_is_refused(raw):
    with pytest.raises(InvalidSignalWeights):
        parse_signal_weights(raw)


def test_an_over_long_parameter_is_refused():
    with pytest.raises(InvalidSignalWeights):
        parse_signal_weights("tag:1" + "," * MAX_WEIGHTS_PARAM_CHARS)


def test_an_unknown_signal_is_named_in_the_message():
    with pytest.raises(InvalidSignalWeights) as raised:
        parse_signal_weights("popularity:3")
    assert "popularity" in str(raised.value)


# ---------------------------------------------------------------------------
# The limits
# ---------------------------------------------------------------------------


def test_a_signal_above_the_ceiling_is_clamped_and_reported():
    selection = parse_signal_weights(f"tag:{MAX_SIGNAL_WEIGHT * 5}")
    assert selection.weights["tag"] == MAX_SIGNAL_WEIGHT
    adjusted = [entry for entry in selection.adjustments if entry["signal"] == "tag"]
    assert adjusted and adjusted[0]["applied"] == MAX_SIGNAL_WEIGHT


def test_a_negative_signal_is_clamped_to_zero():
    selection = parse_signal_weights("quality:-5")
    assert selection.weights["quality"] == 0.0
    assert any(entry["signal"] == "quality" for entry in selection.adjustments)


def test_a_vector_over_the_total_is_scaled_rather_than_refused():
    selection = parse_signal_weights(
        ",".join(f"{name}:{MAX_SIGNAL_WEIGHT}" for name in SIGNAL_NAMES)
    )
    assert selection.total == pytest.approx(MAX_TOTAL_WEIGHT)
    # Every signal was asked for equally, so every signal still carries an equal share.
    assert len(set(round(value, 6) for value in selection.weights.values())) == 1
    assert any(entry["signal"] is None for entry in selection.adjustments)


def test_scaling_the_whole_vector_moves_neither_order_nor_percentage():
    """The ceiling on the total is a scale bound, not a change of answer."""
    scores = {name: 0.4 for name in SIGNAL_WEIGHTS}
    scores["tag"] = 0.9
    # Scaled to just clear the ceiling, so every weight is scaled by one factor rather
    # than some of them meeting the per-signal ceiling first, which is a different
    # adjustment and not the one this is about.
    factor = (MAX_TOTAL_WEIGHT + 1) / MAX_WEIGHTED_SCORE
    asked = {name: SIGNAL_WEIGHTS[name] * factor for name in SIGNAL_NAMES}
    selection = build_selection(asked)
    assert normalize_score(
        weighted_total(scores, asked), weight_total(asked)
    ) == normalize_score(
        weighted_total(scores, selection.weights), selection.total
    )


def test_a_vector_adding_up_to_nothing_is_refused():
    with pytest.raises(InvalidSignalWeights):
        parse_signal_weights(",".join(f"{name}:0" for name in SIGNAL_NAMES))


def test_the_floor_leaves_a_thin_but_usable_vector_standing():
    thin = ",".join(f"{name}:{0 if name != 'tag' else MIN_TOTAL_WEIGHT}" for name in SIGNAL_NAMES)
    selection = parse_signal_weights(thin)
    assert selection.total == pytest.approx(MIN_TOTAL_WEIGHT)


# ---------------------------------------------------------------------------
# Presets and the round trip
# ---------------------------------------------------------------------------


def test_every_preset_names_every_signal_and_passes_its_own_validation():
    for name, preset in PRESETS.items():
        assert set(preset["weights"]) == set(SIGNAL_NAMES), name
        selection = build_selection(dict(preset["weights"]))
        assert selection.adjustments == [], name
        assert selection.weights == {
            signal: float(preset["weights"][signal]) for signal in SIGNAL_NAMES
        }, name


def test_the_default_preset_is_the_published_vector():
    assert PRESETS["balanced"]["weights"] == dict(SIGNAL_WEIGHTS)


def test_ignore_consensus_drops_every_signal_that_needs_an_audience():
    """The preset is named for what it removes: everything only a read title can carry.

    Tags are crowd-contributed, both item-item terms are built from vote patterns and the
    quality term is a vote average, so all four are absent or thin for a title nobody has
    read. What is left is what its publisher said about it.
    """
    weights = PRESETS["ignore-consensus"]["weights"]
    for name in engine.CONSENSUS_SIGNALS:
        assert weights[name] == 0.0, name
    for name in engine.CATALOGUE_SIGNALS:
        assert weights[name] == SIGNAL_WEIGHTS[name], name


def test_a_preset_round_trips_through_the_wire_format():
    for name, preset in PRESETS.items():
        param = format_signal_weights(preset["weights"])
        selection = parse_signal_weights(param) if param else None
        if selection is None:
            # The default vector differs from the default in nothing, so it writes empty.
            assert name == "balanced"
            continue
        assert selection.preset == name
        assert selection.weights == {
            signal: float(preset["weights"][signal]) for signal in SIGNAL_NAMES
        }


def test_the_wire_format_names_only_what_differs():
    weights = dict(SIGNAL_WEIGHTS)
    weights["tag"] = 4.0
    assert format_signal_weights(weights) == "tag:4"


def test_a_vector_matching_no_preset_reports_none():
    weights = dict(SIGNAL_WEIGHTS)
    weights["tag"] = 3.7
    assert matching_preset(weights) is None


def test_the_catalogue_describes_every_signal_and_preset():
    catalogue = preset_catalogue()
    assert [entry["name"] for entry in catalogue["signals"]] == list(SIGNAL_NAMES)
    assert {entry["name"] for entry in catalogue["presets"]} == set(PRESETS)
    assert catalogue["default_total"] == pytest.approx(MAX_WEIGHTED_SCORE)
    assert catalogue["limits"]["max_total"] == MAX_TOTAL_WEIGHT


# ---------------------------------------------------------------------------
# What the response says
# ---------------------------------------------------------------------------


def test_the_response_block_reports_what_was_asked_and_what_was_applied():
    described = parse_signal_weights(f"tag:{MAX_SIGNAL_WEIGHT + 5},quality:0").describe()
    assert described["custom"] is True
    assert described["requested"]["tag"] == MAX_SIGNAL_WEIGHT + 5
    assert described["effective"]["tag"] == MAX_SIGNAL_WEIGHT
    assert described["effective"]["quality"] == 0.0
    assert list(described["effective"]) == list(SIGNAL_NAMES)
    assert described["adjustments"]
    assert described["param"] == format_signal_weights(
        parse_signal_weights(f"tag:{MAX_SIGNAL_WEIGHT + 5},quality:0").weights
    )


def test_the_response_block_reports_an_untouched_vector_as_unadjusted():
    described = parse_signal_weights("tag:3").describe()
    assert described["adjustments"] == []
    assert described["total"]["scaled"] is False
    assert described["total"]["applied"] == pytest.approx(
        MAX_WEIGHTED_SCORE - SIGNAL_WEIGHTS["tag"] + 3
    )


# ---------------------------------------------------------------------------
# The switch at its default
# ---------------------------------------------------------------------------


def test_the_parameter_is_not_read_while_the_switch_is_off(monkeypatch):
    """Off, a request carrying weights is the request it would have been without them.

    Links outlive any one setting of the switch, so a tuned one turns back into an
    ordinary page rather than into an error.
    """
    monkeypatch.setattr(weights_module, "READER_WEIGHTS", False)
    assert parse_signal_weights("tag:5,quality:0") is None
    assert parse_signal_weights("popularity:9") is None
    assert parse_signal_weights("this is not a vector at all") is None


def test_the_catalogue_says_whether_the_controls_are_available(monkeypatch):
    monkeypatch.setattr(weights_module, "READER_WEIGHTS", False)
    assert preset_catalogue()["enabled"] is False
    monkeypatch.setattr(weights_module, "READER_WEIGHTS", True)
    assert preset_catalogue()["enabled"] is True


def test_the_switch_ships_on_and_can_be_turned_off(monkeypatch):
    """The published default, read the way the engine reads its own switches.

    Tuning is on by default; the guard worth keeping is that turning it off is still what
    makes the endpoint ignore a weights parameter rather than reject it.
    """
    import importlib

    reloaded = importlib.reload(weights_module)
    try:
        assert reloaded.READER_WEIGHTS is True
        monkeypatch.setattr(reloaded, "READER_WEIGHTS", False)
        assert reloaded.parse_signal_weights("tag:4.0") is None
    finally:
        importlib.reload(weights_module)
