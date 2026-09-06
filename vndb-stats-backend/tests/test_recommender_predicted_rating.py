"""A signal that ranks a candidate should be able to say what the reader would mark it.

The engine's own quantity is a match percentage against a weighted total, which is a
position in a list wearing the clothes of a measurement. A predicted rating is on the scale
a reader actually marks on, so it can be checked against what they went on to give.

Two things are pinned here. The first is the construction: the profile holds each entity as
a damped mean of the marks this reader gave the titles carrying it, already on the 1-10
scale, so the prediction is an average of those and never a rescaled closeness. The second
is abstention. A signal with no basis for a mark has to be absent from the result rather
than present at the reader's mean, because a caller taking a mean and a spread over these
cannot otherwise tell how many signals spoke.

Measured against held-out ratings, co-occurrence does not beat the reader's own mean even
with its sources widened, so it abstains everywhere.
"""

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    clamp_rating,
    predict_from_entities,
    predict_from_neighbours,
)


@pytest.fixture(autouse=True)
def predictions_on(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTED_RATING", True)
    monkeypatch.setattr(engine, "PREDICTION_MIN_SUPPORT", 0)


def _profile(**overrides):
    profile = {
        "user_overall_avg": 7.2,
        "crowd_rating_shift": 0.0,
        "tag_means": {},
        "tag_counts": {},
        "tag_idf": {},
        "dev_means": {},
        "dev_counts": {},
        "staff_means": {},
        "staff_counts": {},
        "seiyuu_means": {},
        "seiyuu_counts": {},
        "trait_means": {},
        "trait_counts": {},
    }
    profile.update(overrides)
    return profile


def _predict(profile, **candidate):
    return HybridRecommender(db=None)._predicted_ratings(profile, **candidate)


# ---------------------------------------------------------------------------
# The construction
# ---------------------------------------------------------------------------


def test_a_studio_the_reader_marks_above_their_own_average_predicts_above_it():
    profile = _profile(dev_means={"Studio": 8.0}, dev_counts={"Studio": 6})

    predicted = _predict(profile, vn_developers=["Studio"])

    assert predicted["developer"] == pytest.approx(8.0)


def test_several_matches_are_averaged_by_how_much_of_the_readers_list_they_stand_on():
    profile = _profile(
        dev_means={"Deep": 9.0, "Passing": 6.0},
        dev_counts={"Deep": 9, "Passing": 1},
    )

    predicted = _predict(profile, vn_developers=["Deep", "Passing"])

    assert predicted["developer"] == pytest.approx((9 * 9 + 6 * 1) / 10)


def test_a_mark_outside_the_scale_is_held_inside_it():
    profile = _profile(dev_means={"Studio": 42.0}, dev_counts={"Studio": 3})

    assert _predict(profile, vn_developers=["Studio"])["developer"] == 10.0
    assert clamp_rating(-4.0) == 1.0


def test_a_tag_is_weighted_by_how_strongly_it_applies_and_how_few_titles_carry_it():
    """A title's ordinary tags are shared with most of the catalogue and say least about it."""
    profile = _profile(
        tag_means={1: 9.0, 2: 6.0},
        tag_counts={1: 10, 2: 10},
        tag_idf={1: 3.0, 2: 0.5},
    )

    predicted = _predict(profile, vn_tags={1: 3.0, 2: 3.0})

    # The rare tag carries six times the common one's weight, so the mark sits near its own.
    assert predicted["tag"] > 8.5


def test_a_trait_carried_by_several_of_a_cast_counts_for_more_than_one_carried_once():
    profile = _profile(
        trait_means={1: 9.0, 2: 6.0}, trait_counts={1: 5, 2: 5}
    )

    single = _predict(profile, vn_traits={1: 1, 2: 1})["trait"]
    repeated = _predict(profile, vn_traits={1: 3, 2: 1})["trait"]

    assert repeated > single


def test_a_thinly_held_entity_is_pulled_toward_the_readers_own_mean(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTION_MIN_SUPPORT", 4)
    profile = _profile(dev_means={"Studio": 10.0}, dev_counts={"Studio": 1})

    predicted = _predict(profile, vn_developers=["Studio"])

    assert 7.2 < predicted["developer"] < 10.0


def test_the_crowds_mark_is_shifted_by_where_the_reader_sits_against_the_crowd():
    generous = _profile(crowd_rating_shift=0.9)
    harsh = _profile(crowd_rating_shift=-1.1)

    assert _predict(generous, average_rating=7.0)["quality"] == pytest.approx(7.9)
    assert _predict(harsh, average_rating=7.0)["quality"] == pytest.approx(5.9)


# ---------------------------------------------------------------------------
# Reading a mark off the reader's own titles
# ---------------------------------------------------------------------------


def test_a_closeness_chooses_which_marks_to_average_and_is_never_itself_a_mark():
    predicted = predict_from_neighbours([(0.9, 9.0), (0.3, 5.0)])

    assert predicted == pytest.approx((0.9 * 9.0 + 0.3 * 5.0) / 1.2)


def test_a_neighbour_too_far_away_to_say_anything_is_not_averaged_in(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTION_NEIGHBOUR_FLOOR", 0.5)

    assert predict_from_neighbours([(0.9, 9.0), (0.1, 2.0)]) == pytest.approx(9.0)


def test_nothing_close_enough_is_silence_rather_than_a_mark(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTION_NEIGHBOUR_FLOOR", 0.5)

    assert predict_from_neighbours([(0.1, 2.0)]) is None


def test_only_the_nearest_are_read_off():
    far = [(0.2, 1.0)] * 20

    assert predict_from_neighbours([(0.9, 9.0)] + far, 1) == pytest.approx(9.0)


# ---------------------------------------------------------------------------
# Abstention
# ---------------------------------------------------------------------------


def test_a_signal_with_nothing_to_match_is_absent_rather_than_at_the_readers_mean():
    profile = _profile(dev_means={"Studio": 8.0}, dev_counts={"Studio": 4})

    predicted = _predict(profile, vn_developers=["Stranger"], vn_staff=["s1"])

    assert "developer" not in predicted
    assert "staff" not in predicted


def test_nothing_matched_at_all_yields_no_marks():
    assert _predict(_profile()) == {}


def test_co_occurrence_never_predicts():
    """Widening its sources does not make it beat the reader's own mean, so there is no
    construction to offer."""
    profile = _profile(dev_means={"Studio": 8.0}, dev_counts={"Studio": 4})

    predicted = _predict(
        profile, vn_developers=["Studio"], similarity_neighbours=[(0.8, 9.0)]
    )

    assert "users_also_read" not in predicted
    assert set(predicted) == {"developer", "similar_games"}


def test_an_empty_entity_average_is_none_rather_than_zero():
    assert predict_from_entities([], 7.0) is None
    assert predict_from_entities([(9.0, 0, 0)], 7.0) is None


# ---------------------------------------------------------------------------
# The switch
# ---------------------------------------------------------------------------


def test_nothing_is_predicted_while_the_switch_is_off(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTED_RATING", False)
    profile = _profile(dev_means={"Studio": 8.0}, dev_counts={"Studio": 4})

    assert _predict(profile, vn_developers=["Studio"]) == {}


def test_the_switch_is_recorded_with_the_rest():
    settings = engine.switch_settings()

    for name in (
        "REC_PREDICTED_RATING",
        "REC_PREDICTION_MIN_SUPPORT",
        "REC_PREDICTION_NEIGHBOUR_FLOOR",
        "REC_PREDICTION_NEIGHBOURS",
        "REC_PREDICTION_QUALITY",
    ):
        assert name in settings


def test_the_default_is_off(monkeypatch):
    """A run without it is the control every switched run is measured against.

    Read through the binding rather than off the module, which the fixture here turns on.
    """
    monkeypatch.delenv("REC_PREDICTED_RATING", raising=False)

    assert engine._env_flag("REC_PREDICTED_RATING", False) is False
