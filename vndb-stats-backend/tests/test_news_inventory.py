from app.services.news.inventory import list_sources
from app.services.news.sections import SECTIONS


def test_inventory_covers_every_registry_and_section():
    entries = list_sources()
    assert len(entries) > 100
    assert all(e["section"] in SECTIONS and e["url"].startswith("http") for e in entries)
    kinds = {e["kind"] for e in entries}
    assert {"feed", "site", "youtube", "bluesky", "x", "board", "store", "api"} <= kinds
    names = [(e["kind"], e["name"]) for e in entries]
    assert len(names) == len(set(names))
    assert {e["section"] for e in entries} == set(SECTIONS)
    assert any(e["name"] == "VNDB reviews" and e["section"] == "reviews" for e in entries)
