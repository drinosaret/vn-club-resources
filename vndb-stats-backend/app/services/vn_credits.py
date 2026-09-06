"""Shaping of a visual novel's staff and voice actor credits.

The dump stores one row per (staff, role) pair and one row per (voice actor, character)
pair, so a person appears several times and in dump order. These helpers collapse the
rows to one entry per person, order them by the significance of the credit, and cap the
result, which is what a credits list on a VN page wants.
"""

from typing import Iterable, Sequence

# Ordered from the credits a reader looks for first. Anything the dump carries that is
# not listed sorts after these, alphabetically by role, so a new role code still appears.
STAFF_ROLE_ORDER: tuple[str, ...] = (
    "scenario",
    "director",
    "chardesign",
    "art",
    "music",
    "songs",
    "editor",
    "qa",
    "staff",
    "translator",
)

DEFAULT_STAFF_LIMIT = 24
DEFAULT_SEIYUU_LIMIT = 20


def role_rank(role: str) -> int:
    """Position of a role in the credit order. Unknown roles sort last."""
    try:
        return STAFF_ROLE_ORDER.index(role)
    except ValueError:
        return len(STAFF_ROLE_ORDER)


def order_staff_credits(
    rows: Iterable[Sequence[object]],
    limit: int = DEFAULT_STAFF_LIMIT,
) -> list[dict]:
    """Collapse (staff_id, name, original, role) rows to one ordered entry per person.

    A person credited under several roles keeps all of them, ordered the same way, and
    is placed by their most significant one. Ties keep dump order, which follows the
    credit order on the source entry.
    """
    people: dict[str, dict] = {}
    order: list[str] = []

    for row in rows:
        staff_id, name, original, role = row[0], row[1], row[2], row[3]
        if not staff_id or not name:
            continue
        role_name = str(role) if role else "staff"
        entry = people.get(str(staff_id))
        if entry is None:
            entry = {
                "id": str(staff_id),
                "name": str(name),
                "original": str(original) if original else None,
                "roles": [],
            }
            people[str(staff_id)] = entry
            order.append(str(staff_id))
        if role_name not in entry["roles"]:
            entry["roles"].append(role_name)

    for entry in people.values():
        entry["roles"].sort(key=lambda r: (role_rank(r), r))

    ranked = sorted(
        order,
        key=lambda sid: (role_rank(people[sid]["roles"][0]), order.index(sid)),
    )
    if limit is not None and limit >= 0:
        ranked = ranked[:limit]
    return [people[sid] for sid in ranked]


def group_seiyuu_credits(
    rows: Iterable[Sequence[object]],
    limit: int = DEFAULT_SEIYUU_LIMIT,
) -> list[dict]:
    """Collapse (staff_id, name, original, char_id, char_name, char_original) rows.

    One entry per voice actor carrying every character they voice in this title, both in
    the order the rows arrive. Rows whose character is missing from the dump are dropped,
    since the entry exists to point at the character.
    """
    people: dict[str, dict] = {}
    order: list[str] = []

    for row in rows:
        staff_id, name, original = row[0], row[1], row[2]
        char_id, char_name, char_original = row[3], row[4], row[5]
        if not staff_id or not name or not char_id or not char_name:
            continue
        entry = people.get(str(staff_id))
        if entry is None:
            entry = {
                "id": str(staff_id),
                "name": str(name),
                "original": str(original) if original else None,
                "characters": [],
            }
            people[str(staff_id)] = entry
            order.append(str(staff_id))
        if any(c["id"] == str(char_id) for c in entry["characters"]):
            continue
        entry["characters"].append({
            "id": str(char_id),
            "name": str(char_name),
            "original": str(char_original) if char_original else None,
        })

    if limit is not None and limit >= 0:
        order = order[:limit]
    return [people[sid] for sid in order]
