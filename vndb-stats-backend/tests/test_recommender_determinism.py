"""Candidate selection must answer an identical request an identical way.

Every stage of `_get_candidates` truncates with a LIMIT, so an unordered stage lets the
planner choose the survivors and two identical requests diverge. That makes the engine
impossible to measure or tune, so the ordering is asserted here rather than left to
whatever plan the current statistics happen to produce.
"""

import asyncio
import hashlib

from sqlalchemy.dialects import postgresql

from app.services.hybrid_recommender import (
    HybridRecommender,
    exploration_seed,
    stable_shuffle_order,
)
from app.db.models import VisualNovel


class _Row:
    """Attribute-access stand-in for a SQLAlchemy result row."""

    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _QueueSession:
    """Hands back canned results in call order and keeps every statement it saw."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        if not self._results:
            raise AssertionError("more queries executed than the test queued results for")
        return _Result(self._results.pop(0))


def _sql(statement):
    compiled = statement.compile(dialect=postgresql.dialect())
    return str(compiled), dict(compiled.params)


def _similarity_rows():
    # Deliberately tied scores: ties are where an unordered limit shows itself.
    return [
        _Row(similar_vn_id=f"v{100 + i}", similarity_score=0.9 if i < 4 else 0.5)
        for i in range(6)
    ]


def _vn_detail_row(vn_id):
    return _Row(
        id=vn_id,
        title=f"Title {vn_id}",
        title_jp=None,
        title_romaji=None,
        image_url=None,
        image_sexual=0.0,
        rating=7.5,
        average_rating=7.4,
        votecount=120,
        length=2,
    )


def _queued_results():
    return [
        _similarity_rows(),                                    # VNSimilarity
        [_Row(id=f"v{200 + i}") for i in range(3)],            # exploration
        [_Row(vn_id=f"v{300 + i}") for i in range(3)],         # elite tags
        [_Row(similar_vn_id=f"v{400 + i}") for i in range(3)], # co-occurrence
        [_vn_detail_row(f"v{100 + i}") for i in range(4)],     # candidate details
    ]


def _run_candidates(high_rated_vns=("v1", "v2", "v3")):
    session = _QueueSession(_queued_results())
    recommender = HybridRecommender(session)
    candidates = asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids={"v9"},
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=10,
            high_rated_vns=list(high_rated_vns),
            elite_tag_ids={1, 2, 3},
            japanese_only=True,
            spoiler_level=0,
        )
    )
    return candidates, session.statements


def test_every_candidate_source_query_runs():
    # Each source is wrapped in its own try/except, so a stub that fails one of them would
    # leave the rest of this file asserting against a shorter run than the real path takes.
    _, statements = _run_candidates()
    assert len(statements) == 5


def test_every_limited_query_carries_an_order_by():
    _, statements = _run_candidates()
    for statement in statements:
        sql, _ = _sql(statement)
        if "LIMIT" not in sql:
            continue
        assert "ORDER BY" in sql, f"limited query with no ordering: {sql}"
        assert sql.index("ORDER BY") < sql.index("LIMIT")


def test_no_candidate_query_orders_at_random():
    _, statements = _run_candidates()
    for statement in statements:
        sql, _ = _sql(statement)
        assert "random()" not in sql.lower()


def test_identical_inputs_emit_identical_queries():
    _, first = _run_candidates()
    _, second = _run_candidates()
    assert [_sql(s) for s in first] == [_sql(s) for s in second]


def test_identical_inputs_return_identical_candidates():
    first, _ = _run_candidates()
    second, _ = _run_candidates()
    assert first == second
    assert [c["id"] for c in first] == [c["id"] for c in second]


def test_exploration_ordering_differs_between_profiles():
    # Exploration is meant to spread readers over different titles, so two profiles must
    # not receive the same slice.
    _, one = _run_candidates(high_rated_vns=("v1", "v2", "v3"))
    _, two = _run_candidates(high_rated_vns=("v4", "v5", "v6"))
    assert _sql(one[1]) != _sql(two[1])


def test_exploration_seed_ignores_input_ordering():
    assert exploration_seed(["v2", "v1"]) == exploration_seed(["v1", "v2"])


def test_exploration_seed_separates_profiles():
    assert exploration_seed(["v1"]) != exploration_seed(["v2"])
    assert exploration_seed(None) == exploration_seed([])


def test_stable_shuffle_order_is_total():
    # The digest alone leaves ties undecided, so the id has to travel with it.
    clauses = stable_shuffle_order(VisualNovel.id, "seed", "exploration")
    assert len(clauses) == 2
    assert clauses[1] is VisualNovel.id


def _run_tag_candidates():
    session = _QueueSession([
        [_Row(tag_id=i, total_score=5.0) for i in (10, 11, 12)],   # profile tags
        [_Row(tag_id=i, doc_count=100) for i in (10, 11, 12)],     # document counts
        [10000],                                                   # corpus size
        [_Row(vn_id=f"v{500 + i}", weighted_score=4.0) for i in range(3)],
    ])
    recommender = HybridRecommender(session)
    result = asyncio.run(
        recommender._get_tag_based_candidates(
            high_rated_vns=["v1", "v2"],
            exclude_vn_ids={"v9"},
            limit=10,
            spoiler_level=0,
        )
    )
    return result, session.statements


def test_tag_based_queries_are_ordered():
    # The live tag path only runs when the precomputed similarity table is thin, so it
    # needs its own exercise rather than riding on the main run.
    _, statements = _run_tag_candidates()
    assert len(statements) == 4
    for statement in statements:
        sql, _ = _sql(statement)
        if "LIMIT" in sql:
            assert "ORDER BY" in sql, f"limited query with no ordering: {sql}"


def test_tag_based_selection_repeats():
    first, first_statements = _run_tag_candidates()
    second, second_statements = _run_tag_candidates()
    assert first == second
    assert [_sql(s) for s in first_statements] == [_sql(s) for s in second_statements]


def test_fallback_query_is_ordered():
    # With no profile and no exploration rows the fallback is the only source left, and it
    # is truncated the same way.
    session = _QueueSession([[], [_vn_detail_row(f"v{600 + i}") for i in range(2)]])
    recommender = HybridRecommender(session)
    candidates = asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids=set(),
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=10,
            high_rated_vns=None,
            elite_tag_ids=None,
            japanese_only=True,
            spoiler_level=0,
        )
    )
    assert [c["id"] for c in candidates] == ["v600", "v601"]
    fallback_sql, _ = _sql(session.statements[-1])
    assert "ORDER BY" in fallback_sql
    assert "visual_novels.id" in fallback_sql[fallback_sql.index("ORDER BY"):]


def test_shuffle_domains_produce_independent_orderings():
    """Two orderings built from one seed must not agree on who sorts first.

    One of them selects a slice and the other truncates a pool containing it. Sharing a
    digest would place that whole slice ahead of every candidate the other sources found,
    so the pool the scorer sees would stop reflecting the sources that filled it.
    """
    seed = exploration_seed(["v10", "v20"], {1, 2})
    ids = [f"v{n}" for n in range(400)]

    def order(domain: str) -> list[str]:
        expr = stable_shuffle_order(VisualNovel.id, seed, domain)[0]
        rendered = str(expr.compile(dialect=postgresql.dialect(),
                                    compile_kwargs={"literal_binds": True}))
        salt = rendered.split("||")[-1].strip().strip("')")
        return sorted(ids, key=lambda i: hashlib.md5(f"{i}{salt}".encode()).hexdigest())

    exploration = order("exploration")
    candidate_cut = order("candidate_cut")

    assert exploration != candidate_cut
    # The slice the first ordering would take must not sweep the front of the second.
    head = set(exploration[:40])
    survivors = set(candidate_cut[:200])
    assert len(head & survivors) < len(head), (
        "every explored id survived the cut, so the two orderings are still correlated"
    )


def test_exploration_seed_differs_without_high_rated_titles():
    """A reader with no high-rated titles still needs a salt of their own.

    Both halves of the profile can be empty on their own, and a salt derived from one
    empty half is the same salt for everyone in that position.
    """
    assert exploration_seed([], {12, 45}) != exploration_seed([], {3, 91})
    assert exploration_seed(None, {12, 45}) == exploration_seed([], {12, 45})
