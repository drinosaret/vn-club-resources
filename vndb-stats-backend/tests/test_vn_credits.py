from app.services.vn_credits import (
    STAFF_ROLE_ORDER,
    group_seiyuu_credits,
    order_staff_credits,
    role_rank,
)


# ── role_rank ──────────────────────────────────────────────

def test_known_roles_rank_in_the_declared_order():
    assert role_rank("scenario") < role_rank("art")
    assert role_rank("art") < role_rank("staff")


def test_an_unknown_role_ranks_after_every_known_one():
    assert role_rank("newrole") == len(STAFF_ROLE_ORDER)
    assert role_rank("newrole") > role_rank("translator")


# ── order_staff_credits ────────────────────────────────────

def test_one_entry_per_person_with_every_role_kept():
    rows = [
        ("s1", "A", None, "art"),
        ("s1", "A", None, "scenario"),
    ]
    assert order_staff_credits(rows) == [
        {"id": "s1", "name": "A", "original": None, "roles": ["scenario", "art"]}
    ]


def test_a_person_is_placed_by_their_most_significant_role():
    rows = [
        ("s1", "A", None, "music"),
        ("s2", "B", None, "staff"),
        ("s2", "B", None, "scenario"),
    ]
    assert [p["id"] for p in order_staff_credits(rows)] == ["s2", "s1"]


def test_ties_within_a_role_keep_the_order_the_rows_arrived_in():
    rows = [
        ("s2", "B", None, "art"),
        ("s1", "A", None, "art"),
    ]
    assert [p["id"] for p in order_staff_credits(rows)] == ["s2", "s1"]


def test_the_cap_keeps_the_most_significant_credits():
    rows = [
        ("s1", "A", None, "staff"),
        ("s2", "B", None, "scenario"),
        ("s3", "C", None, "music"),
    ]
    assert [p["id"] for p in order_staff_credits(rows, limit=2)] == ["s2", "s3"]


def test_an_empty_original_becomes_none():
    rows = [("s1", "A", "", "art")]
    assert order_staff_credits(rows)[0]["original"] is None


def test_a_row_missing_its_person_is_dropped():
    rows = [("s1", "", None, "art"), (None, "A", None, "art")]
    assert order_staff_credits(rows) == []


def test_a_row_with_no_role_is_credited_as_general_staff():
    rows = [("s1", "A", None, None)]
    assert order_staff_credits(rows)[0]["roles"] == ["staff"]


def test_a_duplicated_role_is_not_repeated():
    rows = [("s1", "A", None, "art"), ("s1", "A", None, "art")]
    assert order_staff_credits(rows)[0]["roles"] == ["art"]


# ── group_seiyuu_credits ───────────────────────────────────

def test_a_voice_actor_carries_every_character_they_play():
    rows = [
        ("s1", "A", "あ", "c1", "One", None),
        ("s1", "A", "あ", "c2", "Two", "二"),
    ]
    result = group_seiyuu_credits(rows)
    assert len(result) == 1
    assert result[0]["original"] == "あ"
    assert [c["id"] for c in result[0]["characters"]] == ["c1", "c2"]
    assert result[0]["characters"][1]["original"] == "二"


def test_voice_actors_keep_the_order_the_rows_arrived_in():
    rows = [
        ("s2", "B", None, "c1", "One", None),
        ("s1", "A", None, "c2", "Two", None),
    ]
    assert [p["id"] for p in group_seiyuu_credits(rows)] == ["s2", "s1"]


def test_the_cap_counts_people_not_rows():
    rows = [
        ("s1", "A", None, "c1", "One", None),
        ("s1", "A", None, "c2", "Two", None),
        ("s2", "B", None, "c3", "Three", None),
    ]
    result = group_seiyuu_credits(rows, limit=1)
    assert [p["id"] for p in result] == ["s1"]
    assert len(result[0]["characters"]) == 2


def test_a_repeated_character_appears_once():
    rows = [
        ("s1", "A", None, "c1", "One", None),
        ("s1", "A", None, "c1", "One", None),
    ]
    assert len(group_seiyuu_credits(rows)[0]["characters"]) == 1


def test_a_credit_without_a_resolvable_character_is_dropped():
    rows = [
        ("s1", "A", None, None, None, None),
        ("s2", "B", None, "c1", "One", None),
    ]
    assert [p["id"] for p in group_seiyuu_credits(rows)] == ["s2"]
