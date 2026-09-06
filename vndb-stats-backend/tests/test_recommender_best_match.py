"""A reader with two tastes is not described by the average of them.

The taste profile is one vector averaged over everything a reader liked. Averaged over two
distinct tastes it sits between them and points at neither: a title halfway between two
things a reader enjoys outscores a title squarely inside one of them, which is the opposite
of what the reader asked for. The per-title comparison a title's own page makes does not
have that failing, and it is the comparison readers report as useful.

The tests here pin the per-title terms: the tag signal measured against the single closest
favourite alongside the averaged profile, and the two item-item signals scored on their
strongest match rather than on the mean of the matches they found. Both are reachable off,
so the change stays measurable against what preceded it.
"""

import asyncio

import pytest

# These need SQLAlchemy to compile clauses; the minimal unit venv omits it.
pytest.importorskip("sqlalchemy")

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import HybridRecommender, switch_settings


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, rows_by_table=None):
        self.rows_by_table = dict(rows_by_table or {})
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        text = str(statement)
        for table, rows in self.rows_by_table.items():
            if f"FROM {table}" in text:
                return _Result(rows)
        return _Result([])


def run(coroutine):
    return asyncio.run(coroutine)


def _vector(tag_ids, score=3.0):
    return {tag_id: score for tag_id in tag_ids}


def _profile(seeds):
    """A profile carrying favourites as vectors, shaped the way the builder leaves it."""
    return {
        "tag_weights": {},
        "tag_idf": {},
        "excluded_tag_ids": set(),
        "seed_tag_profiles": [
            (vector, engine.tag_vector_magnitude(vector), weight)
            for vector, weight in seeds
        ],
    }


# ---------------------------------------------------------------------------
# The tag term against individual favourites.
# ---------------------------------------------------------------------------


def test_a_title_inside_one_taste_beats_one_sitting_between_two():
    # Two tastes with nothing in common. The mean of them matches half of each.
    profile = _profile([(_vector([1, 2, 3]), 1.0), (_vector([4, 5, 6]), 1.0)])

    inside = HybridRecommender._blend_tag_best_match(profile, _vector([1, 2, 3]), 0.5)
    between = HybridRecommender._blend_tag_best_match(profile, _vector([1, 4]), 0.5)

    assert inside > between


def test_the_closest_favourite_decides_rather_than_the_rest():
    """A second, unrelated favourite must not pull the term down."""
    one = _profile([(_vector([1, 2, 3]), 1.0)])
    two = _profile([(_vector([1, 2, 3]), 1.0), (_vector([7, 8, 9]), 1.0)])

    assert HybridRecommender._blend_tag_best_match(
        one, _vector([1, 2, 3]), 0.5
    ) == HybridRecommender._blend_tag_best_match(two, _vector([1, 2, 3]), 0.5)


def test_a_favourite_the_reader_rated_higher_counts_for_more():
    loved = _profile([(_vector([1, 2, 3]), 1.0)])
    liked = _profile([(_vector([1, 2, 3]), 0.6)])

    assert HybridRecommender._blend_tag_best_match(
        loved, _vector([1, 2, 3]), 0.0
    ) > HybridRecommender._blend_tag_best_match(liked, _vector([1, 2, 3]), 0.0)


def test_rarity_weighting_applies_to_both_sides_of_the_comparison():
    """The two vectors are scaled alike, so a shared rare tag is not scored as a common one."""
    profile = _profile([(_vector([1, 2]), 1.0)])
    profile["tag_idf"] = {1: 5.0, 2: 5.0, 3: 0.1}

    close = HybridRecommender._blend_tag_best_match(profile, {1: 3.0, 2: 3.0, 3: 3.0}, 0.0)
    far = HybridRecommender._blend_tag_best_match(profile, {3: 3.0}, 0.0)

    assert close > far


def test_a_tag_carrying_no_content_is_dropped_from_both_sides():
    profile = _profile([(_vector([1, 2]), 1.0)])
    profile["excluded_tag_ids"] = {99}

    with_noise = HybridRecommender._blend_tag_best_match(
        profile, {1: 3.0, 2: 3.0, 99: 3.0}, 0.0
    )
    without = HybridRecommender._blend_tag_best_match(profile, {1: 3.0, 2: 3.0}, 0.0)

    assert with_noise == without


def test_the_term_stays_inside_the_range_the_weighted_total_assumes():
    profile = _profile([(_vector([1, 2, 3]), 1.0)])

    for score in (0.0, 0.5, 1.0):
        blended = HybridRecommender._blend_tag_best_match(profile, _vector([1, 2, 3]), score)
        assert 0.0 <= blended <= 1.0


# ---------------------------------------------------------------------------
# Reachable off, and inert where there is nothing to compare against.
# ---------------------------------------------------------------------------


def test_the_share_at_zero_leaves_the_profile_score_alone(monkeypatch):
    monkeypatch.setattr(engine, "TAG_BEST_MATCH", 0.0)
    profile = _profile([(_vector([1, 2, 3]), 1.0)])

    assert HybridRecommender._blend_tag_best_match(profile, _vector([1, 2, 3]), 0.4) == 0.4


def test_a_profile_carrying_no_favourite_vectors_leaves_the_score_alone():
    assert HybridRecommender._blend_tag_best_match({}, _vector([1, 2, 3]), 0.4) == 0.4


def test_a_candidate_with_no_tags_leaves_the_score_alone():
    profile = _profile([(_vector([1, 2, 3]), 1.0)])

    assert HybridRecommender._blend_tag_best_match(profile, {}, 0.4) == 0.4


def test_the_scored_tag_term_reads_the_favourite_vectors():
    """The component reaches the signal rather than sitting beside it unused."""
    # A candidate matching a little of the profile, so neither reading sits on the ceiling.
    profile = {
        "tag_weights": {1: 2.0, 2: 2.0, 3: 10.0, 4: 10.0},
        "elite_tag_ids": {3, 4},
        "tag_idf": {},
        "excluded_tag_ids": set(),
        "seed_tag_profiles": [],
    }
    without = HybridRecommender(_Session())._compute_tag_score_fast(profile, _vector([1, 2]))

    profile["seed_tag_profiles"] = _profile([(_vector([1, 2]), 1.0)])["seed_tag_profiles"]
    with_seeds = HybridRecommender(_Session())._compute_tag_score_fast(
        profile, _vector([1, 2])
    )

    assert with_seeds != without


# ---------------------------------------------------------------------------
# The profile publishes the vectors without a query of its own.
# ---------------------------------------------------------------------------


def test_the_favourite_vectors_come_from_rows_the_profile_already_loads():
    session = _Session(
        {
            "vn_tags": [
                _Row(vn_id="v1", tag_id=1, score=3.0),
                _Row(vn_id="v1", tag_id=2, score=2.0),
            ]
        }
    )
    recommender = HybridRecommender(session)

    profile = run(recommender._build_user_profile([{"vn_id": "v1", "score": 90}]))
    reads = sum(1 for statement in session.statements if "FROM vn_tags" in str(statement))

    assert profile["seed_tag_profiles"]
    vector, magnitude, weight = profile["seed_tag_profiles"][0]
    assert set(vector) == {1, 2}
    assert magnitude > 0
    assert weight == pytest.approx(0.9)
    # One read of the tag table, the one the averaged profile is built from.
    assert reads == 1


def test_a_reader_with_no_votes_still_carries_the_key():
    profile = run(HybridRecommender(_Session())._build_user_profile([]))

    assert profile["seed_tag_profiles"] == []


# ---------------------------------------------------------------------------
# The two item-item signals score on their strongest match.
# ---------------------------------------------------------------------------


def _similar_session():
    return _Session(
        {
            "vn_similarities": [
                _Row(similar_vn_id="c1", source_vn_id="v1", similarity_score=0.9),
                _Row(similar_vn_id="c2", source_vn_id="v1", similarity_score=0.9),
                _Row(similar_vn_id="c2", source_vn_id="v2", similarity_score=0.1),
            ]
        }
    )


def _similar_scores(session):
    return run(
        HybridRecommender(session)._batch_get_similar_games_scores(
            candidate_ids=["c1", "c2"],
            high_rated_vns=["v1", "v2"],
            vn_scores={"v1": 10.0, "v2": 10.0},
        )
    )


def test_a_weak_second_match_does_not_rank_a_candidate_below_its_own_best():
    scores = _similar_scores(_similar_session())

    # Both are equally close to the same favourite; one also resembles a second favourite
    # slightly. That is more evidence for it, never less.
    assert scores["c2"][0] >= scores["c1"][0]


def test_the_mean_of_the_matches_is_reachable(monkeypatch):
    monkeypatch.setattr(engine, "ITEM_ITEM_BEST_MATCH", False)

    scores = _similar_scores(_similar_session())

    assert scores["c2"][0] < scores["c1"][0]


def test_co_reading_scores_on_the_strongest_match_too():
    session = _Session(
        {
            "vn_cooccurrence": [
                _Row(similar_vn_id="c1", source_vn_id="v1", co_rating_score=9.0, user_count=50),
                _Row(similar_vn_id="c2", source_vn_id="v1", co_rating_score=9.0, user_count=50),
                _Row(similar_vn_id="c2", source_vn_id="v2", co_rating_score=0.5, user_count=50),
            ]
        }
    )

    scores = run(
        HybridRecommender(session)._batch_get_users_also_read_scores(
            candidate_ids=["c1", "c2"],
            high_rated_vns=["v1", "v2"],
            vn_scores={"v1": 10.0, "v2": 10.0},
        )
    )

    assert scores["c2"][0] >= scores["c1"][0]


def test_the_item_item_score_stays_inside_its_range():
    scores = _similar_scores(_similar_session())

    assert all(0.0 <= score <= 1.0 for score, _ in scores.values())


def test_the_per_title_terms_are_declared_as_switches():
    settings = switch_settings()

    for name in (
        "REC_TAG_BEST_MATCH",
        "REC_TAG_BEST_MATCH_SEEDS",
        "REC_ITEM_ITEM_BEST_MATCH",
        # The description signal reached this shape first and is what the rest follow.
        "REC_DESC_BEST_MATCH",
    ):
        assert name in settings


def test_the_description_signal_already_scores_per_title():
    """Named rather than assumed: it is the arm the others were made to match."""
    assert engine.DESC_BEST_MATCH is True
