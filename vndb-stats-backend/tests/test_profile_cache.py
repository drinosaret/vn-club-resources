"""The reader profile round-trips through JSON without changing what the engine reads.

Several maps are keyed by tag or trait id, which JSON turns into strings, and two fields
are sets, which JSON has no shape for; the codec restores both. The key is a digest of the
votes and of every switch, so a changed list or a changed switch is a different entry.
"""

import pytest

from app.services import profile_cache


def _profile():
    return {
        "tag_weights": {1: 0.5, 22: 1.5},
        "tag_dislikes": {},
        "tag_absolute_scores": {1: 7.0},
        "tag_weighted_scores": {1: 6.0},
        "tag_counts": {1: 3},
        "tag_idf": {1: 1.2, 22: 0.4},
        "excluded_tag_ids": {9, 10},
        "seed_tag_profiles": [({1: 0.5, 22: 1.0}, 1.118, 0.9)],
        "max_tag_weighted": 6.0,
        "elite_tag_ids": {1},
        "high_rated_vns": ["v1"],
        "vn_scores": {"v1": 9.0},
        "preferred_staff": {"s1": 0.3},
        "preferred_traits": {7: 0.1},
        "trait_weighted_scores": {7: 5.0},
        "trait_counts": {7: 2},
        "trait_means": {7: 7.5},
        "tag_means": {1: 7.2},
        "user_overall_avg": 7.0,
    }


def test_round_trip_restores_int_keys_sets_and_tuples():
    original = _profile()
    restored = profile_cache.decode_profile(profile_cache.encode_profile(original))
    assert restored["tag_weights"] == {1: 0.5, 22: 1.5}
    assert restored["excluded_tag_ids"] == {9, 10}
    assert restored["elite_tag_ids"] == {1}
    assert restored["preferred_traits"] == {7: 0.1}
    assert restored["trait_means"] == {7: 7.5}
    assert restored["seed_tag_profiles"] == [({1: 0.5, 22: 1.0}, 1.118, 0.9)]
    assert restored["vn_scores"] == {"v1": 9.0}
    assert restored["preferred_staff"] == {"s1": 0.3}


def test_encoded_form_is_plain_json():
    import json
    json.dumps(profile_cache.encode_profile(_profile()))


def test_key_changes_with_votes_spoiler_and_switches():
    votes = [{"vn_id": "v1", "score": 90}, {"vn_id": "v2", "score": 70}]
    base = profile_cache.profile_key(votes, 0, {"REC_TAG_CENTERING": 0.0})
    assert base == profile_cache.profile_key(list(reversed(votes)), 0, {"REC_TAG_CENTERING": 0.0})
    assert base != profile_cache.profile_key(votes, 1, {"REC_TAG_CENTERING": 0.0})
    assert base != profile_cache.profile_key(votes, 0, {"REC_TAG_CENTERING": 1.0})
    assert base != profile_cache.profile_key(votes[:1], 0, {"REC_TAG_CENTERING": 0.0})
    assert base.startswith("rec:profile:")


def test_a_malformed_entry_reads_as_a_miss(monkeypatch):
    import asyncio

    class _Cache:
        async def get(self, key):
            return {"tag_weights": "garbage"}

    monkeypatch.setattr(profile_cache, "get_cache", lambda: _Cache())
    assert asyncio.run(profile_cache.read_profile("rec:profile:x")) is None
