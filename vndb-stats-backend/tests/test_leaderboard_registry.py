"""Guard the catalogue and the layer that renders it.

Slugs are permanent URLs, so a rename is a broken link and a duplicate is a silently
shadowed board. Neither shows up until someone visits the page.
"""

from datetime import date, datetime, timezone

from app.leaderboards.aggregate import (
    Bucket,
    RankedEntry,
    rank_vote_board,
    roll_up_by_entity,
)
from app.leaderboards.compute import (
    FRANCHISE_RELATIONS,
    NameDisplay,
    VNDisplay,
    MIN_SERIES_SIZE,
    RANK_INDEX_DEPTH,
    Hydrator,
    build_rank_index,
    build_response,
    filter_entries_to_language,
    supports_language_variants,
)
from app.leaderboards.facets import describe_kind, describe, predicate
from app.leaderboards.registry import (
    COMMERCIAL_ONLY,
    CREATIVE_ROLES,
    BOARDS,
    BOARDS_BY_SLUG,
    board_for_slug,
)
from app.leaderboards.serialize import format_value
from app.leaderboards.spec import (
    Home,
    TITLE_AVERAGE_METRICS,
    BoardSpec,
    Disclosure,
    LIST_METRICS,
    ROLLED_UP_SUBJECTS,
    VOTE_METRICS,
    BoardSpec,
    Facet,
    Metric,
    Subject,
    Window,
    slug_cache_key,
)


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



WHEN = datetime(2026, 8, 16, tzinfo=timezone.utc)
DUMP_DATE = date(2026, 8, 16)


# --- catalogue integrity ----------------------------------------------------------

def test_slugs_are_unique():
    assert len(BOARDS_BY_SLUG) == len(BOARDS)


def test_slugs_are_url_safe():
    for board in BOARDS:
        assert board.slug == board.slug.lower()
        assert " " not in board.slug
        assert board.slug.replace("-", "").isalnum(), board.slug


def test_every_board_has_a_title_and_blurb():
    for board in BOARDS:
        assert board.title.strip(), board.slug
        assert board.blurb.strip(), board.slug


def test_every_metric_is_classified_as_vote_or_list_derived():
    # The dispatcher picks an aggregator from this split; an unclassified metric would
    # reach the wrong one and raise at build time rather than here. Title averages form a
    # third family because what they average is not always vote-derived: a drop rate comes
    # from list states, so they are dispatched ahead of the split rather than inside it.
    classified = VOTE_METRICS | LIST_METRICS | TITLE_AVERAGE_METRICS
    for board in BOARDS:
        assert board.metric in classified, board.slug


def test_ratio_boards_carry_a_sample_floor():
    # Without one, a title dropped by its single reader tops the most-dropped chart.
    for board in BOARDS:
        if board.metric in (Metric.DROP_RATE, Metric.COMPLETION_RATE, Metric.AVG_SCORE):
            assert board.min_count > 0, board.slug


def test_windowed_list_boards_must_explain_the_approximation():
    # ulist_labels has no timestamp, so any period over it is inferred. The spec refuses
    # to construct such a board without a note; this pins that guard.
    try:
        make_spec(
            slug="x", title="x", subject=Subject.VN,
            metric=Metric.DROPPED, window=Window.MONTH,
        )
    except ValueError:
        return
    raise AssertionError("a windowed list-state board was allowed with no caveat")


def test_windowed_vote_boards_need_no_such_note():
    board = make_spec(
        slug="x", title="x", subject=Subject.USER,
        metric=Metric.VOTES, window=Window.MONTH,
    )
    assert board.window is Window.MONTH


def test_no_slug_collides_with_a_reserved_route_segment():
    # The leaderboard router serves /{slug} alongside fixed paths. A board slugged
    # "standings" would be shadowed by the standings route and return the wrong thing,
    # which is the sort of collision that only shows up when someone visits the page.
    reserved = {"percentiles", "standings", "query", "rank", "catalogue"}
    for board in BOARDS:
        assert board.slug not in reserved, board.slug


def test_board_lookup_by_slug():
    assert board_for_slug(BOARDS[0].slug) is BOARDS[0]
    assert board_for_slug("does-not-exist") is None


def test_the_users_hand_written_queries_are_all_represented():
    # These six mirror queries written by hand against VNDB's public query browser, and are
    # the reason the facet axes exist. Two remain boards because they ask something the slice
    # route cannot: one excludes a reader outright for a single vote outside the slice, the
    # other counts titles nobody else has voted on. The rest are now slices a reader picks,
    # so what has to survive is the axis, not the board.
    from app.leaderboards.custom import slice_conditions

    for slug in ("users-jp-patricians", "users-sole-voters"):
        assert slug in BOARDS_BY_SLUG, slug

    for facet in (
        Facet(olang="ja", jp_freeware=True),
        Facet(olang="ja", lang_only="ja"),
        Facet(year_max=1999),
        Facet(platform="p98"),
    ):
        assert slice_conditions(facet), f"{facet.canonical()} narrows nothing"


# --- facets -----------------------------------------------------------------------

def test_facet_canonical_form_is_order_independent():
    a = Facet(olang="ja", platform="p98")
    b = Facet(platform="p98", olang="ja")
    assert a.canonical() == b.canonical()
    assert a.hash() == b.hash()


def test_distinct_facets_hash_differently():
    assert Facet(olang="ja").hash() != Facet(olang="en").hash()


def test_empty_facet_is_recognised_as_empty():
    assert Facet().is_empty
    assert not Facet(olang="ja").is_empty


def test_falsey_flags_are_omitted_from_the_canonical_form():
    # freeware=False means "do not filter", not "filter to non-freeware", so it must not
    # produce a distinct cache key from the empty facet.
    assert Facet(freeware=False).canonical() == Facet().canonical()


def test_every_registry_facet_compiles_to_sql():
    for board in BOARDS:
        if board.facet.needs_tags:
            continue
        predicate(board.facet)  # raises if a field has no SQL translation


def test_tag_facets_are_rejected_by_the_sql_builder():
    # They need a join; failing loudly beats returning an unfiltered board.
    try:
        predicate(Facet(tag=42))
    except ValueError:
        return
    raise AssertionError("a tag facet produced a column predicate")


def test_no_board_facets_on_a_tag():
    # Tag filtering belongs to browse, which does it better and for any tag. A board carrying
    # a tag facet would be a second, narrower answer to the same question.
    assert not [b.slug for b in BOARDS if b.facet.tag is not None]


def test_rolled_up_subjects_are_all_credited_entities():
    # Anything in this set needs an entity-to-VN mapping supplied at compute time; a
    # subject added here without one raises a KeyError mid-run.
    assert Subject.USER not in ROLLED_UP_SUBJECTS
    assert Subject.VN not in ROLLED_UP_SUBJECTS
    for board in BOARDS:
        if board.subject in ROLLED_UP_SUBJECTS:
            assert board.metric in VOTE_METRICS | TITLE_AVERAGE_METRICS, board.slug


def test_facet_descriptions_are_human_readable():
    assert describe(Facet()) == "all visual novels"
    assert "p98" in describe(Facet(platform="p98"))
    # An upper bound reads as an exclusive cutoff, which is how people say it.
    assert describe(Facet(year_max=1999)) == "released before 2000"
    assert describe(Facet(year_min=1990, year_max=1999)) == "released 1990 to 1999"


# --- producer roll-up -------------------------------------------------------------

def test_producer_score_pools_votes_across_their_titles():
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    for vn_id, count, total in (("v1", 10, 800), ("v2", 5, 450)):
        counters = bucket.vn(vn_id)
        counters.matched, counters.matched_total = count, total

    rolled = roll_up_by_entity(bucket, {"p1": ["v1", "v2"]})
    assert rolled.users["p1"].matched == 15
    assert rolled.users["p1"].matched_total == 1250


def test_producers_with_no_voted_titles_are_dropped():
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    bucket.vn("v1").matched = 3
    rolled = roll_up_by_entity(bucket, {"p1": ["v1"], "p2": ["v999"]})
    assert set(rolled.users) == {"p1"}


def test_producer_boards_read_the_rolled_up_counters():
    # The roll-up writes producers into the user-keyed side of the
    # bucket. A ranker that reads the VN-keyed side for every non-user subject returns an
    # empty developer board while looking perfectly healthy.
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    counters = bucket.vn("v1")
    counters.matched, counters.matched_total = 30, 2400

    rolled = roll_up_by_entity(bucket, {"p1": ["v1"]})
    spec = make_spec(
        slug="d", title="d", subject=Subject.DEVELOPER, metric=Metric.VOTES, min_count=1
    )
    ranked = rank_vote_board(spec, rolled)
    assert [(e.key, e.value) for e in ranked] == [("p1", 30.0)]


# --- series -----------------------------------------------------------------------

def test_franchise_relations_exclude_the_loose_ones():
    # Shared characters and shared settings chain unrelated works together: including them
    # more than doubles the largest component, merging distinct franchises.
    assert "char" not in FRANCHISE_RELATIONS
    assert "set" not in FRANCHISE_RELATIONS
    assert "seq" in FRANCHISE_RELATIONS and "preq" in FRANCHISE_RELATIONS


def test_a_series_needs_more_than_one_title():
    assert MIN_SERIES_SIZE >= 2


def test_series_boards_explain_how_a_franchise_is_inferred():
    # There is no series list in the dump, so the grouping is a judgement the reader is
    # entitled to see.
    for board in BOARDS:
        if board.subject is Subject.SERIES:
            assert any("relation graph" in note for note in board.notes), board.slug


# --- rank index -------------------------------------------------------------------

def test_rank_index_numbers_from_one_and_stops_at_the_depth():
    entries = [RankedEntry(str(i), 1000 - i, 10) for i in range(1, RANK_INDEX_DEPTH + 500)]
    index = build_rank_index(entries)
    assert index["ranks"]["u1"] == 1
    assert len(index["ranks"]) == RANK_INDEX_DEPTH
    # The full size is reported even though only the top slice is stored, so a reader can
    # be told what they placed out of.
    assert index["total"] == len(entries)


def test_rank_index_normalises_bare_numeric_ids():
    # Vote-derived boards key on the bare id; a lookup by prefixed uid has to still hit.
    index = build_rank_index([RankedEntry("12345", 10, 10)])
    assert index["ranks"] == {"u12345": 1}


def test_rank_index_does_not_double_prefix():
    index = build_rank_index([RankedEntry("u12345", 10, 10)])
    assert index["ranks"] == {"u12345": 1}


def test_rank_index_of_an_empty_board_is_empty():
    index = build_rank_index([])
    assert index["ranks"] == {}
    assert index["total"] == 0


# --- language variants ------------------------------------------------------------

def test_visual_novel_boards_offer_a_japanese_view():
    spec = make_spec(slug="s", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    assert supports_language_variants(spec) is True


def test_boards_already_pinned_to_a_language_offer_no_toggle():
    # Offering a Japanese filter on a board that is Japanese by definition implies a choice
    # that does not exist.
    spec = make_spec(
        slug="s", title="t", subject=Subject.VN, metric=Metric.BAYESIAN,
        facet=Facet(olang="ja"),
    )
    assert supports_language_variants(spec) is False


def test_non_visual_novel_subjects_offer_no_toggle():
    # A reader's vote count is not a property of any one title's language.
    for subject in (Subject.USER, Subject.DEVELOPER, Subject.STAFF, Subject.SERIES):
        spec = make_spec(slug="s", title="t", subject=subject, metric=Metric.VOTES)
        assert supports_language_variants(spec) is False, subject


def test_every_registry_board_pinned_to_japanese_hides_the_toggle():
    for board in BOARDS:
        if board.facet.olang is not None:
            assert supports_language_variants(board) is False, board.slug


def test_language_filter_preserves_rank_order():
    entries = [RankedEntry(f"v{i}", 100 - i, 10) for i in range(1, 6)]
    japanese = {"v1", "v3", "v5"}
    filtered = filter_entries_to_language(entries, japanese)
    assert [e.key for e in filtered] == ["v1", "v3", "v5"]
    # Values are untouched: filtering selects rows, it does not rescore them.
    assert [e.value for e in filtered] == [99, 97, 95]


def test_language_filter_renumbers_contiguously_in_the_response():
    # The stored slice is only a hundred rows, so a client-side filter would leave gaps in
    # the numbering. Filtering server-side and renumbering is the point of the variant.
    spec = make_spec(slug="s", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    entries = [RankedEntry("v1", 50, 10), RankedEntry("v2", 40, 10)]
    response = build_response(
        spec, filter_entries_to_language(entries, {"v2"}), _hydrator(), WHEN, DUMP_DATE,
        language="ja",
    )
    assert response.language == "ja"
    assert response.total_ranked == 1


def test_a_board_with_no_japanese_titles_is_empty_rather_than_unfiltered():
    # Failing open would silently show non-Japanese titles under a Japanese heading.
    entries = [RankedEntry("v1", 50, 10)]
    assert filter_entries_to_language(entries, set()) == []


def test_the_cache_key_separates_the_two_views():
    assert slug_cache_key("x") != slug_cache_key("x", "ja")
    # An unrecognised value falls back to the unfiltered key rather than inventing one.
    assert slug_cache_key("x", "all") == slug_cache_key("x")


# --- rendering --------------------------------------------------------------------

def _hydrator():
    return Hydrator(
        usernames={"u1": "reader-one", "u2": "reader-two"},
        vns={
            "v1": VNDisplay(
                title="ある題名",
                title_romaji="Aru Daimei",
                title_jp="ある題名",
                image_url="https://example.invalid/cover.jpg",
                image_sexual=0.0,
            )
        },
        # VNDB holds the Japanese form in `name` and the Latin form in `original`.
        producers={"p1": NameDisplay("スタジオ", "A Studio")},
        staff={"s1": NameDisplay("作家", "A Writer")},
        series={"v1": ("v1", 4)},
    )


def test_rows_are_numbered_from_one():
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    entries = [RankedEntry("u1", 10, 10), RankedEntry("u2", 5, 5)]
    response = build_response(spec, entries, _hydrator(), WHEN, DUMP_DATE)
    assert [r.rank for r in response.rows] == [1, 2]


def test_ranks_stay_contiguous_when_a_subject_cannot_be_rendered():
    # A voter absent from the users dump has no name to show. Skipping it must not leave
    # a hole in the numbering.
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    entries = [
        RankedEntry("u1", 10, 10),
        RankedEntry("u404", 8, 8),  # unknown
        RankedEntry("u2", 5, 5),
    ]
    response = build_response(spec, entries, _hydrator(), WHEN, DUMP_DATE)
    assert [r.rank for r in response.rows] == [1, 2]
    assert [r.id for r in response.rows] == ["u1", "u2"]


def test_total_ranked_reports_the_full_ranking_not_the_stored_slice():
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    entries = [RankedEntry(f"u{i}", 1000 - i, 10) for i in range(500)]
    response = build_response(spec, entries, _hydrator(), WHEN, DUMP_DATE)
    assert response.total_ranked == 500
    assert len(response.rows) <= 100


def test_bare_numeric_voter_ids_are_normalised_to_a_uid():
    # global_votes stores the id without its prefix; links and list boards use the
    # prefixed form. Both must render the same person.
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    response = build_response(spec, [RankedEntry("1", 10, 10)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].id == "u1"
    assert response.rows[0].href == "/stats/u1"


def test_vn_rows_link_without_the_id_prefix():
    spec = make_spec(slug="s", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    response = build_response(spec, [RankedEntry("v1", 10, 10)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].href == "/vn/1"


def test_a_series_cover_is_keyed_to_the_title_it_belongs_to():
    # The row is identified by the franchise but illustrated by one entry. Keying the
    # click-to-reveal state on the franchise would mean a reveal here does not carry to that
    # title's own page, and vice versa.
    spec = make_spec(slug="s", title="t", subject=Subject.SERIES, metric=Metric.VOTES)
    response = build_response(spec, [RankedEntry("v1", 40, 40)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].id == "v1"
    assert response.rows[0].image_vn_id == "v1"


def test_vn_rows_key_their_cover_to_themselves():
    spec = make_spec(slug="s", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    response = build_response(spec, [RankedEntry("v1", 10, 10)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].image_vn_id == "v1"


def test_rows_without_a_cover_carry_no_image_key():
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    response = build_response(spec, [RankedEntry("u1", 10, 10)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].image_vn_id is None


def test_series_rows_name_the_franchise_and_disclose_its_size():
    # The score covers every title in the franchise, so a row showing only one title's
    # name would understate what is being ranked.
    spec = make_spec(slug="s", title="t", subject=Subject.SERIES, metric=Metric.VOTES)
    response = build_response(spec, [RankedEntry("v1", 40, 40)], _hydrator(), WHEN, DUMP_DATE)
    assert response.rows[0].label == "ある題名"
    assert response.rows[0].sublabel == "4 titles"
    assert response.rows[0].href == "/vn/1"


def test_responses_state_they_are_not_live():
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    response = build_response(spec, [], _hydrator(), WHEN, DUMP_DATE)
    assert response.is_live is False
    assert response.dump_date == DUMP_DATE


def test_board_notes_survive_onto_the_response():
    spec = make_spec(
        slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES,
        notes=("a caveat",),
    )


    response = build_response(spec, [], _hydrator(), WHEN, DUMP_DATE)
    assert response.notes == ["a caveat"]


def test_ratio_labels_include_their_denominator():
    # "38%" alone cannot be told apart from a rate over four readers.
    assert "of 120" in format_value(Metric.DROP_RATE, 0.384, 120)


# --- title preference ---------------------------------------------------------------

def test_vn_rows_carry_every_title_form():
    # The client picks which to show, so the row has to offer the choice. Sending only the
    # database's own title silently pins Japanese works to their Japanese title.
    spec = make_spec(slug="s", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    row = build_response(
        spec, [RankedEntry("v1", 10, 10)], _hydrator(), WHEN, DUMP_DATE
    ).rows[0]
    assert row.label == "ある題名"
    assert row.title_romaji == "Aru Daimei"
    assert row.title_jp == "ある題名"


def test_series_rows_carry_the_representative_title_forms():
    spec = make_spec(slug="s", title="t", subject=Subject.SERIES, metric=Metric.VOTES)
    row = build_response(
        spec, [RankedEntry("v1", 10, 10)], _hydrator(), WHEN, DUMP_DATE
    ).rows[0]
    assert row.title_romaji == "Aru Daimei"


def test_people_and_studios_carry_their_romanised_name():
    for subject, key in ((Subject.STAFF, "s1"), (Subject.DEVELOPER, "p1")):
        spec = make_spec(slug="s", title="t", subject=subject, metric=Metric.VOTES)
        row = build_response(
            spec, [RankedEntry(key, 10, 10)], _hydrator(), WHEN, DUMP_DATE
        ).rows[0]
        assert row.name_original, subject
        # The romanised form must be the one that is not already the label.
        assert row.name_original != row.label, subject


def test_reader_rows_have_no_title_variants():
    # A username has one form; offering variants would imply a choice that does not exist.
    spec = make_spec(slug="s", title="t", subject=Subject.USER, metric=Metric.VOTES)
    row = build_response(
        spec, [RankedEntry("u1", 10, 10)], _hydrator(), WHEN, DUMP_DATE
    ).rows[0]
    assert row.title_jp is None
    assert row.title_romaji is None
    assert row.name_original is None


# --- catalogue grouping ------------------------------------------------------------

def test_facet_kind_separates_attention_from_the_work_itself():
    # The catalogue groups the "best of" boards by this. An era slice and an obscurity
    # threshold are different questions and must not land in the same group.
    assert describe_kind(Facet()) == "none"
    assert describe_kind(Facet(votecount_max=100)) == "attention"
    assert describe_kind(Facet(year_min=1990, year_max=1999)) == "era"
    assert describe_kind(Facet(platform="p98")) == "kind"


def test_every_board_reports_a_known_facet_kind():
    # An unrecognised value would fall through the catalogue's clusters into "More".
    known = {"none", "era", "attention", "kind", "difficulty"}
    for board in BOARDS:
        assert describe_kind(board.facet) in known, board.slug


def test_no_board_ranks_a_slice_the_reader_can_choose():
    # A board narrowing by era, platform, length, age rating or difficulty is one guess at a
    # slice somebody wanted, and the slice route answers all of them from a picker. Keeping
    # such a board would put a fixed answer next to a chooseable one that disagrees about
    # nothing except which slices exist.
    # Reader boards are exempt: a facet there names the corner of the database a reader
    # specialises in, and the ranking is of people rather than of the slice.
    for board in (b for b in BOARDS if b.subject is Subject.VN):
        assert describe_kind(board.facet) not in ("era", "difficulty"), board.slug
        assert board.facet.platform is None, board.slug
        assert board.facet.length is None, board.slug
        assert board.facet.minage_max is None, board.slug


# --- disclosure and floors ---------------------------------------------------------

def test_every_board_answers_all_four_disclosure_questions():
    # The point of the requirement is that it cannot be half-satisfied: a board with an
    # empty "left out" reads as though nothing was excluded.
    for board in BOARDS:
        d = board.disclosure
        assert d is not None, board.slug
        for field in ("population", "floor", "score", "excluded"):
            value = getattr(d, field)
            assert value and value.strip(), f"{board.slug}: {field} is empty"
            assert value.rstrip().endswith("."), f"{board.slug}: {field} is not a sentence"


def test_disclosures_reach_the_rendered_notes():
    board = BOARDS_BY_SLUG["staff-best-writers"]
    rendered = board.all_notes
    assert len(rendered) == 4 + len(board.notes)
    assert rendered[0].startswith("Ranked from:")
    assert any(n.startswith("Minimum to qualify:") for n in rendered)


def test_a_board_cannot_be_defined_without_disclosing():
    import pytest

    with pytest.raises(ValueError, match="disclose"):
        BoardSpec(slug="x", title="x", subject=Subject.VN, metric=Metric.VOTERS)


def test_every_rolled_up_reception_board_floors_on_works():
    # The defect this repairs: pooling a famous title's votes into one credit clears any
    # vote floor by itself, so the board ends up ranking single credits.
    for board in BOARDS:
        if board.subject in ROLLED_UP_SUBJECTS and board.metric is Metric.BAYESIAN:
            assert board.min_works >= 2, board.slug


def test_craft_boards_count_only_roles_that_shaped_the_work():
    craft = [b for b in BOARDS if b.subject is Subject.STAFF and b.min_works]
    assert craft, "the craft boards went missing"
    for board in craft:
        assert board.credit_roles, board.slug
        for role in board.credit_roles:
            assert role in CREATIVE_ROLES, f"{board.slug} counts {role}"


def test_no_board_scores_a_person_on_a_role_they_only_translated_or_tested():
    for board in BOARDS:
        if board.subject is Subject.STAFF and board.metric is Metric.BAYESIAN:
            assert not ({"translator", "qa", "editor", "staff"} & set(board.credit_roles)), (
                board.slug
            )


def test_producer_reception_boards_exclude_fan_groups():
    # A translation group credited on a release of a masterpiece is not a publisher in the
    # sense the board means, and inherits reception it did not shape.
    for board in BOARDS:
        if board.subject in (Subject.DEVELOPER, Subject.PUBLISHER) and board.metric in (
            Metric.BAYESIAN,
            Metric.CATALOGUE_FLOOR,
        ):
            assert board.producer_types == COMMERCIAL_ONLY, board.slug


def test_the_reader_drop_board_requires_finishing_something():
    board = BOARDS_BY_SLUG["users-most-dropped"]
    assert board.metric is Metric.DROP_RATE, "a raw count rewards bulk labelling"
    assert board.min_finished > 0


def test_reader_standing_boards_are_measured_against_the_community():
    # The average-score boards they replaced tied hundreds of readers at exactly ten.
    for slug in ("users-harshest", "users-most-generous"):
        assert BOARDS_BY_SLUG[slug].metric is Metric.VOTE_BIAS
        assert BOARDS_BY_SLUG[slug].min_count >= 100


def test_boards_claiming_to_drop_adult_scene_tags_actually_drop_them():
    # A disclosure describing an exclusion the board does not apply is worse than no
    # disclosure: the reader checks, is reassured, and is wrong. This pins the one case
    # where the claim and the mechanism live in different files.
    for board in BOARDS:
        claims = "adult-scene" in board.disclosure.excluded.lower()
        assert claims == bool(board.excluded_tag_categories), board.slug


def test_difficulty_boards_credit_where_the_figure_came_from():
    # Reading difficulty is the one number on the site sourced from outside.
    for board in BOARDS:
        if board.metric in (Metric.DIFFICULTY, Metric.TITLE_DIFFICULTY):
            assert board.attribution is not None, board.slug


def test_only_the_span_board_narrows_the_relation_set():
    # The wider grouping is right for pooling a franchise's votes and wrong for measuring
    # how long it ran; mixing them up is silent, since both produce plausible components.
    strict = {board.slug for board in BOARDS if board.strict_series}
    span = {board.slug for board in BOARDS if board.metric is Metric.SERIES_SPAN}
    assert strict == span


def test_windowed_boards_all_live_on_the_trends_page():
    # A board covering a rolling week or month is answering "what is happening now", which
    # is the trends page's question. Leaving one in the rankings is how the two pages start
    # blurring back into each other.
    for board in BOARDS:
        if board.window is not Window.ALL:
            assert board.home is Home.TRENDS, board.slug


def test_trends_boards_are_all_about_time_or_popularity():
    # The converse guard. Every board homed to trends has to be there for a reason that is
    # legible from its own definition, rather than because someone moved it once.
    moving = {
        Metric.VOTES, Metric.VOTERS, Metric.VELOCITY,
        Metric.RATING_AS_OF, Metric.REPUTATION_SHIFT, Metric.BAYESIAN,
    }
    for board in BOARDS:
        if board.home is Home.TRENDS:
            windowed = board.window is not Window.ALL
            dated = board.metric in moving and (windowed or board.facet.year_min is not None
                                                or board.as_of_year is not None
                                                or board.metric is Metric.REPUTATION_SHIFT)
            assert dated, board.slug


#: Metrics scored from a per-reader scan rather than from the faceted buckets. Their language
#: restriction lives in the scan's own query, so an empty facet on one of these is not the
#: same defect as an empty facet on a board that reads the buckets.
SCAN_SCORED = {
    Metric.VOTE_BIAS,
    Metric.VOTE_DIVERGENCE,
    Metric.OBSCURITY,
    Metric.ERA,
    Metric.ERA_WINDOW,
    Metric.VOTE_RESPONSE,
    Metric.STEADINESS,
}


def test_a_board_claiming_japanese_originals_selects_them():
    """A disclosure that names a population is a claim about the query, not a description.

    Two entity boards said "Japanese-original" while carrying no language facet at all, so
    they ranked studios with no Japanese titles among them.
    """
    for board in (b for b in BOARDS if b.metric not in SCAN_SCORED):
        text = " ".join(
            part
            for part in (
                board.disclosure.population,
                board.disclosure.floor,
                board.disclosure.score,
            )
            if part
        )
        if "Japanese-original" in text or "originally in Japanese" in text:
            assert board.facet.olang == "ja", board.slug
