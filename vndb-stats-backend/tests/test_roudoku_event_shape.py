"""Guards on the shape of the /events row that a Weekly Roudoku pick publishes.

The site's cover blur, the /vn/ deep link, and per-VN reveal persistence all
hang off two easily-broken details: url stays NULL, and vndb_id lives in
extra_data. None of them raises when wrong, so they get their own tests.
"""

import inspect

import pytest

pytest.importorskip("sqlalchemy")

from app.services import events_service
from app.services import roudoku_service


class _StubEvent:
    """Enough of an Event for event_to_dict; avoids needing a DB session."""

    def __init__(self, **kw):
        self.id = 1
        self.event_type = "roudoku"
        self.title = "Weekly Roudoku: Narcissu"
        self.description = None
        self.start_at = None
        self.end_at = None
        self.all_day = False
        self.image_url = None
        self.url = None
        self.location = None
        self.is_active = True
        self.external_key = "roudoku:2026-06-14"
        self.created_by = "ichijou"
        self.extra_data = {}
        for k, v in kw.items():
            setattr(self, k, v)


def _published_extra():
    """The extra_data _publish_pick writes, without needing a DB round trip."""
    return {
        "vndb_id": "v17",
        "votes": 4,
        "title_romaji": "Weekly Roudoku: Narcissu",
        "length_minutes": 90.0,
        "cover_mode": "auto",
    }


def test_url_is_composed_from_vndb_id_not_stored():
    # Setting Event.url to a vndb.org link would win over this fallback and take
    # the /vn/ link, the cover enrichment, and the NSFW blur down with it.
    ev = _StubEvent(url=None, extra_data=_published_extra())
    assert events_service.event_to_dict(ev)["url"] == "/vn/17/"


def test_composed_url_matches_the_cover_enrichment_pattern():
    ev = _StubEvent(url=None, extra_data=_published_extra())
    url = events_service.event_to_dict(ev)["url"]
    assert events_service._VN_URL_RE.match(url)


def test_roudoku_is_in_the_cover_enrichment_type_list():
    # enrich_with_covers hardcodes its event types; a roudoku row silently loses
    # cover_url and image_sexual (so NSFW covers stop blurring) if it drops out.
    source = inspect.getsource(events_service.enrich_with_covers)
    assert '"roudoku"' in source


def test_publish_never_sets_a_url():
    source = inspect.getsource(roudoku_service._publish_pick)
    assert "url=None" in source


def test_event_key_requires_a_session_date():
    class _Cycle:
        scheduled_for = None

    with pytest.raises(ValueError):
        roudoku_service._event_key(_Cycle())
