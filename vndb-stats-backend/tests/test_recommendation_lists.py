"""The named lists, the ordering inside one, and the reason a card carries."""

from dataclasses import dataclass, field

import pytest

from app.services.hybrid_recommender import (
    RETRIEVAL_ARM_SIGNALS,
    SIGNAL_WEIGHTS,
)
from app.services.recommendation_lists import (
    COMBINED,
    LIST_NAMES,
    LISTS_BY_NAME,
    LISTS_BY_SIGNAL,
    REASON_NAMES,
    SIGNAL_LISTS,
    UnknownList,
    list_catalogue,
    order_by_signal,
    parse_list,
    reason_from,
    single_signal_weights,
    strongest_reason,
)


@dataclass
class _Result:
    """Stands in for RecommendationResult, carrying only what a list reads."""

    vn_id: str = "v1"
    tag_score: float = 0.0
    similar_games_score: float = 0.0
    users_also_read_score: float = 0.0
    developer_score: float = 0.0
    staff_score: float = 0.0
    seiyuu_score: float = 0.0
    trait_score: float = 0.0
    quality_score: float = 0.0
    description_score: float = 0.0
    matched_tags: list = field(default_factory=list)
    matched_staff: list = field(default_factory=list)
    matched_developers: list = field(default_factory=list)
    matched_seiyuu: list = field(default_factory=list)
    matched_traits: list = field(default_factory=list)
    similar_games_details: list = field(default_factory=list)
    users_also_read_details: list = field(default_factory=list)
    description_matches: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------


def test_every_list_ranks_on_a_signal_the_engine_scores():
    # A list naming a signal the engine does not score would rank on a field that is
    # always zero, and would look like a working list serving an arbitrary order.
    for entry in SIGNAL_LISTS:
        assert entry.signal in SIGNAL_WEIGHTS


def test_no_list_ranks_on_quality():
    # It is the same number for every reader and has no retrieval source, so a list of it
    # would rank a random draw of the catalogue by how widely it has been read.
    assert "quality" not in LISTS_BY_SIGNAL


def test_a_signal_is_served_by_at_most_one_list():
    assert len(LISTS_BY_SIGNAL) == len(SIGNAL_LISTS)
    assert len(LISTS_BY_NAME) == len(SIGNAL_LISTS)


def test_every_list_but_one_names_a_retrieval_source():
    # The source is what makes a list its own page rather than a re-sort of the blend's
    # pool, and it is also the second sort key.
    for entry in SIGNAL_LISTS:
        assert entry.arm in RETRIEVAL_ARM_SIGNALS, entry.name


def test_published_names_are_the_names_the_parameter_takes():
    published = {entry["name"] for entry in list_catalogue()}
    assert published == set(LIST_NAMES)
    assert LIST_NAMES[0] == COMBINED


def test_parse_reads_the_combined_view_as_no_list():
    for raw in (None, "", "   ", COMBINED, "COMBINED", " combined "):
        assert parse_list(raw) is None


def test_parse_returns_the_entry_for_every_published_name():
    for name in LIST_NAMES[1:]:
        entry = parse_list(name)
        assert entry is not None and entry.name == name


def test_parse_refuses_a_name_it_does_not_serve():
    # Falling back to the combined view would serve a different list under the asked-for
    # name, which a client has no way to notice.
    with pytest.raises(UnknownList):
        parse_list("developers")


def test_the_refusal_names_what_is_on_offer():
    with pytest.raises(UnknownList) as caught:
        parse_list("nope")
    for name in LIST_NAMES:
        assert name in str(caught.value)


# ---------------------------------------------------------------------------
# The weight vector behind a list
# ---------------------------------------------------------------------------


def test_a_single_signal_vector_names_every_signal():
    # A vector naming fewer signals than the engine scores is read as describing something
    # other than this budget, and the retrieval split falls back to the fixed one.
    weights = single_signal_weights("tag")
    assert set(weights) == set(SIGNAL_WEIGHTS)


def test_only_the_named_signal_carries_weight():
    weights = single_signal_weights("developer")
    assert weights["developer"] == SIGNAL_WEIGHTS["developer"]
    assert all(value == 0.0 for name, value in weights.items() if name != "developer")


def test_the_named_signal_keeps_its_usual_weight():
    # The retrieval split measures a source's share against the default weight for its
    # signal, so a signal asked for at its usual weight spends its usual share.
    for entry in SIGNAL_LISTS:
        weights = single_signal_weights(entry.signal)
        assert weights[entry.signal] == SIGNAL_WEIGHTS[entry.signal]


def test_a_single_signal_vector_has_something_to_divide_by():
    # The match percentage divides by the total actually used. At zero every candidate
    # scores alike and the page has no order.
    for entry in SIGNAL_LISTS:
        assert sum(single_signal_weights(entry.signal).values()) > 0


# ---------------------------------------------------------------------------
# The reason on a card
# ---------------------------------------------------------------------------


def _tags(count: int) -> list[dict]:
    return [{"id": index, "name": f"tag {index}"} for index in range(count)]


def test_a_reason_names_the_list_and_counts_what_matched():
    entry = LISTS_BY_NAME["tags"]
    reason = reason_from(_Result(matched_tags=_tags(7)), entry)
    assert reason["list"] == "tags"
    assert reason["signal"] == "tag"
    assert reason["count"] == 7


def test_a_reason_names_only_the_strongest_few():
    entry = LISTS_BY_NAME["tags"]
    reason = reason_from(_Result(matched_tags=_tags(20)), entry)
    assert len(reason["top"]) == REASON_NAMES
    assert [named["name"] for named in reason["top"]] == ["tag 0", "tag 1", "tag 2"]


def test_a_reason_carries_an_id_where_the_entity_has_one():
    reason = reason_from(_Result(matched_tags=_tags(2)), LISTS_BY_NAME["tags"])
    assert reason["top"][0]["id"] == 0


def test_a_reason_omits_an_id_where_the_entity_has_none():
    # Producers are held by name in the profile, so there is no id to link to.
    reason = reason_from(
        _Result(matched_developers=[{"name": "a studio"}]), LISTS_BY_NAME["studios"]
    )
    assert reason["top"] == [{"name": "a studio"}]


def test_a_signal_with_nothing_matched_has_no_reason():
    assert reason_from(_Result(), LISTS_BY_NAME["tags"]) is None


def test_entities_with_no_name_are_not_named():
    # A blank name reaches the card as an empty line rather than as a reason.
    result = _Result(matched_staff=[{"id": 1, "name": ""}])
    assert reason_from(result, LISTS_BY_NAME["staff"]) is None


def test_every_list_reads_a_field_a_result_carries():
    # A source field that does not exist would leave that list permanently without reasons.
    result = _Result()
    for entry in SIGNAL_LISTS:
        assert hasattr(result, entry.source), entry.name


# ---------------------------------------------------------------------------
# Which reason a combined card carries
# ---------------------------------------------------------------------------


def test_the_combined_reason_is_the_signal_that_carried_the_score():
    result = _Result(
        tag_score=0.1,
        developer_score=1.0,
        matched_tags=_tags(5),
        matched_developers=[{"name": "a studio"}],
    )
    weights = {name: 1.0 for name in SIGNAL_WEIGHTS}
    assert strongest_reason(result, weights)["list"] == "studios"


def test_weight_decides_as_well_as_score():
    # Contribution is score against weight, since that is what the order was made of.
    result = _Result(
        tag_score=0.4,
        developer_score=0.5,
        matched_tags=_tags(5),
        matched_developers=[{"name": "a studio"}],
    )
    weights = {name: 1.0 for name in SIGNAL_WEIGHTS}
    weights["tag"] = 4.0
    assert strongest_reason(result, weights)["list"] == "tags"


def test_a_stronger_signal_with_nothing_to_name_is_passed_over():
    result = _Result(tag_score=1.0, developer_score=0.1, matched_developers=[{"name": "s"}])
    weights = {name: 1.0 for name in SIGNAL_WEIGHTS}
    assert strongest_reason(result, weights)["list"] == "studios"


def test_a_card_with_nothing_matched_has_no_reason():
    weights = {name: 1.0 for name in SIGNAL_WEIGHTS}
    assert strongest_reason(_Result(tag_score=1.0), weights) is None


def test_a_caller_without_a_vector_falls_back_to_the_global_one():
    result = _Result(tag_score=0.5, matched_tags=_tags(2))
    assert strongest_reason(result)["list"] == "tags"


# ---------------------------------------------------------------------------
# The order inside one list
# ---------------------------------------------------------------------------


def test_the_signal_score_decides_where_it_separates_candidates():
    entry = LISTS_BY_NAME["tags"]
    page = [
        _Result(vn_id="v1", tag_score=0.2),
        _Result(vn_id="v2", tag_score=0.9),
        _Result(vn_id="v3", tag_score=0.5),
    ]
    ordered = order_by_signal(page, entry, [])
    assert [r.vn_id for r in ordered] == ["v2", "v3", "v1"]


def test_retrieval_affinity_decides_where_the_score_does_not():
    # Four of the scorers return one value over most of what their own source reaches, so
    # a list ordered on the score alone would be in whatever order the pool arrived in.
    entry = LISTS_BY_NAME["staff"]
    page = [
        _Result(vn_id="v1", staff_score=1.0),
        _Result(vn_id="v2", staff_score=1.0),
        _Result(vn_id="v3", staff_score=1.0),
    ]
    arm = [("v3", 9.0), ("v1", 4.0), ("v2", 1.0)]
    assert [r.vn_id for r in order_by_signal(page, entry, arm)] == ["v3", "v1", "v2"]


def test_the_score_outranks_the_retrieval_position():
    entry = LISTS_BY_NAME["tags"]
    page = [_Result(vn_id="v1", tag_score=0.1), _Result(vn_id="v2", tag_score=0.9)]
    arm = [("v1", 9.0), ("v2", 1.0)]
    assert [r.vn_id for r in order_by_signal(page, entry, arm)] == ["v2", "v1"]


def test_a_title_the_source_never_named_sorts_last_among_equals():
    # It reached the page through the exploration draw rather than through this evidence.
    entry = LISTS_BY_NAME["voices"]
    page = [
        _Result(vn_id="v1", seiyuu_score=1.0),
        _Result(vn_id="v2", seiyuu_score=1.0),
    ]
    arm = [("v2", 3.0)]
    assert [r.vn_id for r in order_by_signal(page, entry, arm)] == ["v2", "v1"]


def test_the_order_is_settled_rather_than_left_to_the_input():
    # Two runs of one request have to agree, so nothing may fall through to input order.
    entry = LISTS_BY_NAME["characters"]
    forwards = [_Result(vn_id="v1", trait_score=1.0), _Result(vn_id="v2", trait_score=1.0)]
    backwards = list(reversed(forwards))
    assert [r.vn_id for r in order_by_signal(forwards, entry, [])] == [
        r.vn_id for r in order_by_signal(backwards, entry, [])
    ]


def test_ordering_keeps_every_title_and_adds_none():
    entry = LISTS_BY_NAME["premise"]
    page = [_Result(vn_id=f"v{index}", description_score=index / 10) for index in range(8)]
    ordered = order_by_signal(page, entry, [("v3", 1.0)])
    assert sorted(r.vn_id for r in ordered) == sorted(r.vn_id for r in page)


# ---------------------------------------------------------------------------
# What the endpoint does with the parameter
# ---------------------------------------------------------------------------


@dataclass
class _PageResult(_Result):
    """A result carrying everything the v2 response builder reads off one."""

    title: str = "a title"
    title_jp: str = None
    title_romaji: str = None
    score: float = 1.0
    normalized_score: int = 55
    match_reasons: list = field(default_factory=list)
    image_url: str = None
    image_sexual: float = 0.0
    rating: float = 7.0
    confidence: int = 30
    signals_ranked: int = 2
    predicted_rating: float = None
    predicted_rating_low: float = None
    predicted_rating_high: float = None
    predicted_ratings: dict = field(default_factory=dict)
    contributing_vns: list = field(default_factory=list)


def _run_v2(monkeypatch, page=None, rankings=None, arms=None, **overrides):
    """Drive the v2 endpoint with the cache and the engine stood in for.

    Returns the response and the cache traffic, so a test can say both what the page
    carried and whether the shared cache was touched to build it.
    """
    import asyncio
    import inspect

    from fastapi import params

    import app.api.v1.recommendations as api

    traffic = {"reads": [], "writes": []}

    async def _read(**kwargs):
        traffic["reads"].append(kwargs)
        return [], False

    def _write(user_id, results, reasons=None):
        traffic["writes"].append((user_id, list(results), reasons))

        async def _settled():
            return None

        return _settled()

    class _UserService:
        def __init__(self, db):
            pass

        async def get_user_list(self, vndb_uid):
            return {"labels": {"2": ["v1"]}, "votes": [{"vn_id": "v1", "score": 80}]}

    class _Recommender:
        def __init__(self, db):
            self.last_pool = {}
            self.last_signal_weights = dict(SIGNAL_WEIGHTS)
            self.last_signal_rankings = rankings or {}
            self.last_ranked_arms = arms or {}
            self.scored_under = None

        async def recommend(self, **kwargs):
            self.scored_under = kwargs.get("signal_weights")
            _Recommender.last_instance = self
            return list(page if page is not None else [_PageResult(vn_id="v50")])

    # The facts join, the import stamp and the list cache all need a session or a
    # Redis this test does not hold; each is stood in for so only the page shape
    # and the shared-cache traffic are under test.
    async def _no_facts(db, vn_ids):
        return {}

    async def _no_last_import(db):
        return None

    class _NoListCache:
        async def get(self, key):
            return None

        async def set(self, key, value, ttl=None):
            traffic.setdefault("list_cache_writes", []).append((key, value))

    monkeypatch.setattr(api, "get_cached_recommendations", _read)
    monkeypatch.setattr(api, "cache_recommendations_async", _write)
    monkeypatch.setattr(api, "UserService", _UserService)
    monkeypatch.setattr(api, "HybridRecommender", _Recommender)
    monkeypatch.setattr(api, "title_facts", _no_facts)
    monkeypatch.setattr(api, "last_import_time", _no_last_import)
    # Relation exclusion and the continuations shelf are on by default and both read
    # the relation table; a test that has not stood them in for itself gets empty ones.
    async def _no_related(db, vn_ids):
        return set()

    async def _no_continuations(db, **kwargs):
        return []

    if api.related_to.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "related_to", _no_related)
    if api.continuations.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "continuations", _no_continuations)
    monkeypatch.setattr(api, "get_cache", lambda: _NoListCache())

    raw = inspect.unwrap(api.get_recommendations_v2)
    arguments = {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }
    arguments["limit"] = api.CACHED_PAGE_LIMIT
    arguments.update(overrides)
    response = asyncio.run(raw(request=None, vndb_uid="u1", db=None, **arguments))
    return response, traffic, _Recommender.last_instance


def test_the_combined_page_is_still_read_from_and_written_to_the_cache(monkeypatch):
    response, traffic, _ = _run_v2(monkeypatch)
    assert response["list"] == {"name": COMBINED, "signal": None}
    assert len(traffic["reads"]) == 1
    assert len(traffic["writes"]) == 1


def test_a_single_signal_page_is_neither_read_from_nor_written_to_the_cache(monkeypatch):
    # The cache holds one page per reader under the default balance, and a list is scored
    # under a balance of its own.
    _, traffic, _ = _run_v2(monkeypatch, list_name="studios")
    assert traffic["reads"] == []
    assert traffic["writes"] == []


def test_a_single_signal_page_is_scored_under_that_signal_alone(monkeypatch):
    _, _, recommender = _run_v2(monkeypatch, list_name="voices")
    assert recommender.scored_under == single_signal_weights("seiyuu")


def test_the_response_says_which_list_it_is_and_how_well_it_ranked(monkeypatch):
    page = [
        _PageResult(vn_id="v1", staff_score=1.0),
        _PageResult(vn_id="v2", staff_score=1.0),
    ]
    response, _, _ = _run_v2(
        monkeypatch, page=page, arms={"staff": [("v2", 3.0)]}, list_name="staff"
    )
    block = response["list"]
    assert block["name"] == "staff" and block["signal"] == "staff"
    # One value across the page is a signal that ranked nothing, which a client has to be
    # able to tell from a ranking.
    assert block["distinct_scores"] == 1
    assert block["from_retrieval"] == 1
    assert [r["vn_id"] for r in response["recommendations"]] == ["v2", "v1"]


def test_a_card_carries_its_reason_and_where_each_signal_placed_it(monkeypatch):
    page = [_PageResult(vn_id="v1", tag_score=0.9, matched_tags=_tags(4))]
    response, _, _ = _run_v2(
        monkeypatch, page=page, rankings={"tag": {"v1": 1.0}, "quality": {"v1": 12.5}}
    )
    card = response["recommendations"][0]
    assert card["reason"]["list"] == "tags"
    assert card["reason"]["count"] == 4
    # Quality has no tab of its own, so it is not one of the lists a title places in and
    # is left out of the figure the card counts.
    assert card["ranked_in"] == {"tag": 1.0}


def test_the_reasons_written_to_the_cache_are_the_ones_the_page_showed(monkeypatch):
    page = [_PageResult(vn_id="v1", tag_score=0.9, matched_tags=_tags(4))]
    response, traffic, _ = _run_v2(monkeypatch, page=page)
    _, _, reasons = traffic["writes"][0]
    assert reasons["v1"] == response["recommendations"][0]["reason"]


def test_an_unknown_list_is_refused(monkeypatch):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        _run_v2(monkeypatch, list_name="developers")
    assert caught.value.status_code == 400


def test_naming_a_list_and_a_vector_lets_the_list_decide(monkeypatch):
    # A tuned vector reaches the endpoint from a link that outlives the tab it was made
    # on, so the two cannot both set the balance and the reader's last ask wins.
    response, _, recommender = _run_v2(
        monkeypatch, list_name="tags", weights="developer:5"
    )
    assert response["list"]["weights_ignored"] is True
    assert recommender.scored_under == single_signal_weights("tag")
    assert response["weights"]["requested"] == {"developer": 5.0}


def test_reason_count_is_marked_as_a_floor_at_the_cut():
    from app.services.hybrid_recommender import RecommendationResult
    from app.services.recommendation_lists import LISTS_BY_NAME, reason_from

    result = RecommendationResult(vn_id="v1", title="t", score=1.0, match_reasons=[])
    result.matched_seiyuu = [{"id": i, "name": f"s{i}"} for i in range(5)]
    reason = reason_from(result, LISTS_BY_NAME["voices"])
    assert reason["count"] == 5
    assert reason["count_is_floor"] is True

    result.matched_seiyuu = result.matched_seiyuu[:2]
    reason = reason_from(result, LISTS_BY_NAME["voices"])
    assert reason["count"] == 2
    assert reason["count_is_floor"] is False

    # A source the engine never cuts reports a total, however long it runs.
    result.matched_developers = [{"name": f"d{i}"} for i in range(6)]
    reason = reason_from(result, LISTS_BY_NAME["studios"])
    assert reason["count"] == 6
    assert reason["count_is_floor"] is False


def test_a_reason_carries_the_other_script_for_people_and_titles():
    # The card shows one script, chosen by the reader, so both have to travel.
    staff_entry = next(e for e in SIGNAL_LISTS if e.name == "staff")
    reason = reason_from(
        _Result(matched_staff=[{"id": "s1", "name": "名", "name_original": "Na"}]),
        staff_entry,
    )
    assert reason["top"][0] == {"name": "名", "id": "s1", "original": "Na"}

    similar_entry = next(e for e in SIGNAL_LISTS if e.name == "similar")
    reason = reason_from(
        _Result(similar_games_details=[{"source_vn_id": "v1", "source_title": "t", "source_title_jp": "題", "source_title_romaji": "Dai"}]),
        similar_entry,
    )
    assert reason["top"][0] == {"name": "t", "id": "v1", "title_jp": "題", "title_romaji": "Dai"}
