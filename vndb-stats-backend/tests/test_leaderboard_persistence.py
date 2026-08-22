"""Cover the per-title columns the leaderboard job writes to visual_novels.

These columns are what lets a reader-supplied filter be ranked by a metric the boards
compute, so the thing worth testing is that the column and the board agree. A column that
disagreed with the board next to it would be believed by both surfaces and wrong on one.

No database: the collection step is pure, and the write is one statement built from a
constant that is asserted against directly.
"""

from datetime import date

from app.leaderboards.aggregate import (
    Bucket,
    LabelCounts,
    accumulate_votes,
    build_buckets,
    rank_reputation_board,
)
from app.leaderboards.compute import (
    AGGREGATE_COLUMNS,
    _PERSIST_STATEMENT,
    collect_vn_aggregates,
)
from app.leaderboards.facets import VNFacts
from app.leaderboards.spec import BoardSpec, Disclosure, Facet, Metric, Subject, Window


#: Throwaway boards for the arithmetic tests. The registry requires every real board to say
#: how it is counted; these exist only to exercise a ranker, so they carry a placeholder
#: rather than weakening that requirement for the boards people actually read.
_TEST_DISCLOSURE = Disclosure(
    population="test fixture",
    floor="test fixture",
    score="test fixture",
    excluded="test fixture",
)


def make_spec(**kwargs) -> BoardSpec:
    """A BoardSpec with the disclosure filled in."""
    kwargs.setdefault("disclosure", _TEST_DISCLOSURE)
    return BoardSpec(**kwargs)



REFERENCE = date(2026, 8, 16)


def _facts(vn_id):
    return VNFacts(
        vn_id=vn_id,
        olang="ja",
        languages=frozenset({"ja"}),
        platforms=frozenset(),
        year=2010,
        length=2,
        minage=18,
        votecount=100,
        has_free_release=False,
        jp_freeware=False,
    )


def _world(*vn_ids):
    return {vn_id: _facts(vn_id) for vn_id in vn_ids}


def _plain_board():
    """A catalogue that asks for none of the persisted metrics."""
    return [make_spec(slug="p", title="p", subject=Subject.VN, metric=Metric.VOTERS)]


def _collect(votes, vn_ids, labels=None):
    world = _world(*vn_ids)
    buckets = build_buckets(_plain_board())
    accumulate_votes(votes, world, buckets, REFERENCE)
    records = collect_vn_aggregates(vn_ids, buckets, labels or {})
    return {record["vn_id"]: record for record in records}


def _by_id(record_list):
    return {record["vn_id"]: record for record in record_list}


# --- vote-derived columns ---------------------------------------------------------------

def test_public_votes_counts_the_dump_not_vndbs_own_figure():
    # votecount on the facts is 100 for every title here; the column must report the three
    # votes actually present, since it is the denominator for everything derived from them.
    votes = [(f"u{i}", "v1", 70, REFERENCE) for i in range(3)]
    assert _collect(votes, ["v1"])["v1"]["public_votes"] == 3


def test_spread_is_null_below_two_votes_rather_than_zero():
    # A single vote has no spread. Reporting 0.0 would make the title the least divisive in
    # the database and put it at the top of an ascending sort.
    records = _collect([("u1", "v1", 70, REFERENCE)], ["v1"])
    assert records["v1"]["vote_stddev"] is None


def test_spread_matches_the_counters_the_boards_rank_on():
    votes = [("u1", "v1", 20, REFERENCE), ("u2", "v1", 100, REFERENCE)]
    world = _world("v1")
    buckets = build_buckets(_plain_board())
    accumulate_votes(votes, world, buckets, REFERENCE)

    base = buckets[(Facet().canonical(), Window.ALL.value, False)]
    expected = base.vns["v1"].stddev

    records = _by_id(collect_vn_aggregates(["v1"], buckets, {}))
    assert records["v1"]["vote_stddev"] == round(expected, 4)


def test_windowed_counts_come_from_their_own_buckets():
    # One vote inside the month, one inside the year but not the month, one older than both.
    votes = [
        ("u1", "v1", 70, REFERENCE),
        ("u2", "v1", 70, date(2026, 3, 1)),
        ("u3", "v1", 70, date(2019, 1, 1)),
    ]
    record = _collect(votes, ["v1"])["v1"]
    assert record["public_votes"] == 3
    assert record["votes_30d"] == 1
    assert record["votes_365d"] == 2


def test_reputation_shift_matches_the_board_for_the_same_title():
    # The one that matters: browse sorting by this column and the reputation board must not
    # be able to disagree, because both are read as the same statement about the title.
    rising = [("u%d" % i, "v1", 50, date(2015, 1, 1)) for i in range(10)]
    rising += [("w%d" % i, "v1", 90, date(2024, 1, 1)) for i in range(10)]

    world = _world("v1")
    buckets = build_buckets(_plain_board())
    accumulate_votes(rising, world, buckets, REFERENCE)
    base = buckets[(Facet().canonical(), Window.ALL.value, False)]

    spec = make_spec(
        slug="r", title="r", subject=Subject.VN, metric=Metric.REPUTATION_SHIFT
    )


    board = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    board.history = base.history
    [entry] = rank_reputation_board(spec, board)

    record = _by_id(collect_vn_aggregates(["v1"], buckets, {}))["v1"]
    assert record["reputation_shift"] == round(entry.value, 4)
    assert record["reputation_shift"] > 0


def test_reputation_shift_is_null_when_a_half_is_too_thin():
    votes = [("u%d" % i, "v1", 70, date(2015, 1, 1)) for i in range(4)]
    record = _collect(votes, ["v1"])["v1"]
    assert record["public_votes"] == 4
    assert record["reputation_shift"] is None


# --- list-derived columns --------------------------------------------------------------

def test_label_counts_land_on_their_own_columns():
    labels = {"v1": LabelCounts(playing=3, finished=5, stalled=1, dropped=2, wishlist=9)}
    record = _collect([], ["v1"], labels)["v1"]
    assert record["list_playing"] == 3
    assert record["list_finished"] == 5
    assert record["list_stalled"] == 1
    assert record["list_dropped"] == 2
    assert record["list_wishlist"] == 9


def test_a_title_on_nobodys_list_records_zero_not_null():
    record = _collect([("u1", "v1", 70, REFERENCE)], ["v1"])["v1"]
    assert record["list_finished"] == 0


# --- coverage and shape ----------------------------------------------------------------

def test_every_title_gets_a_record_even_with_no_votes_at_all():
    # Otherwise a title with no votes is indistinguishable from one the job never saw, and
    # both sort into the same null group.
    records = _collect([("u1", "v1", 70, REFERENCE)], ["v1", "v2"])
    assert set(records) == {"v1", "v2"}
    assert records["v2"]["public_votes"] == 0
    assert records["v2"]["votes_30d"] == 0
    assert records["v2"]["vote_stddev"] is None


def test_records_all_carry_the_same_keys():
    # The write is an executemany, so a record missing a key would fail the whole batch.
    labels = {"v1": LabelCounts(finished=1)}
    records = _collect([("u1", "v2", 70, REFERENCE)], ["v1", "v2", "v3"], labels)
    expected = {"vn_id", *AGGREGATE_COLUMNS}
    assert all(set(record) == expected for record in records.values())


def test_the_statement_writes_and_guards_every_column():
    sql = str(_PERSIST_STATEMENT)
    for column in AGGREGATE_COLUMNS:
        assert f"{column} = :{column}" in sql
        assert f"{column} IS DISTINCT FROM :{column}" in sql


def test_the_nightly_vn_upsert_leaves_these_columns_alone():
    # The VN dump carries none of these, so a column added to that statement's update clause
    # would be blanked every night, and the boards would go on ranking as though it had not.
    import asyncio

    from sqlalchemy.dialects import postgresql

    from app.ingestion.importer import _upsert_vns

    captured = []

    class _Recorder:
        async def execute(self, statement):
            captured.append(statement)

    asyncio.run(_upsert_vns(_Recorder(), [{"id": "v1", "title": "t"}]))
    sql = str(captured[0].compile(dialect=postgresql.dialect()))
    _, marker, update_clause = sql.partition("DO UPDATE SET")
    assert marker, "the VN upsert no longer has an update clause to inspect"

    for column in AGGREGATE_COLUMNS:
        assert column not in update_clause, f"{column} would be overwritten nightly"
