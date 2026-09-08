from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters import vndb_reviews
from app.services.news.adapters.vndb_reviews import (
    draft_review,
    excerpt,
    fetch_new_reviews,
    parse_review_list,
    parse_review_page,
)
from app.services.news.text import script_lang, strip_spoilers

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


@dataclass
class _VN:
    id: str = "v900001"
    title: str = "Kakuu no Koi Monogatari"
    title_jp: str | None = "架空の恋物語"
    title_romaji: str | None = "Kakuu no Koi Monogatari"
    image_url: str | None = "https://t.vndb.org/cv/01/900001.jpg"
    image_sexual: float | None = 0.4


def test_list_rows_carry_ids_titles_votes_and_lengths():
    stubs = parse_review_list((FIX / "vndb_reviews_list.html").read_text(encoding="utf-8"))
    assert [s.id for s in stubs] == ["w900001", "w900002", "w800000"]
    first, second = stubs[0], stubs[1]
    assert first.user == "reader-one" and first.vote == 8 and first.length == "long"
    assert first.title_original == "架空の恋物語" and first.title_romaji == "Kakuu no Koi Monogatari"
    assert first.comments == 2 and first.date == datetime(2026, 9, 6, tzinfo=timezone.utc)
    assert first.user_id == "9900001" and second.user_id == "9900002"
    assert second.vote is None and second.length == "short" and second.title_original is None


def test_review_page_yields_subject_vote_and_a_spoiler_free_body():
    detail = parse_review_page((FIX / "vndb_review_full.html").read_text(encoding="utf-8"))
    assert detail.vn_id == "v900001" and detail.vote == 8 and detail.user == "reader-one"
    assert detail.user_id == "9900001"
    assert detail.date == datetime(2026, 9, 6, tzinfo=timezone.utc)
    assert "letters were never sent" not in detail.body
    assert detail.body.startswith("A warm story") and detail.chars == len(detail.body)


def test_excerpt_cuts_on_a_word_and_marks_the_cut():
    body = "word " * 100
    cut = excerpt(body.strip(), limit=50)
    assert len(cut) <= 51 and cut.endswith("…")
    assert excerpt("short", limit=50) == "short"


def test_spoilers_and_script_detection():
    assert strip_spoilers('a <span class="spoiler">b</span> c') == "a   c"
    assert script_lang("とても良い作品でした。ルートの構成が見事。") == "ja"
    assert script_lang("A quiet story, well paced, with a strong last route.") == "en"
    assert script_lang("") == "en"


def test_draft_shape_and_blur_bar():
    stub = parse_review_list((FIX / "vndb_reviews_list.html").read_text(encoding="utf-8"))[0]
    detail = parse_review_page((FIX / "vndb_review_full.html").read_text(encoding="utf-8"))
    draft = draft_review(stub, detail, _VN())
    assert draft.source == "vndb_review" and draft.item_id == "vndb_review-w900001"
    assert draft.url == "https://vndb.org/w900001" and draft.vn_id == "v900001"
    assert draft.title == "Kakuu no Koi Monogatari" and draft.image_is_nsfw is False
    assert draft.extra["reviewer"] == "reader-one" and draft.extra["vote"] == 8
    assert draft.extra["length"] == "long" and draft.extra["lang"] == "en"
    assert draft.extra["reviewer_url"] == "https://vndb.org/u9900001"
    assert draft.published_at == stub.date
    adult = draft_review(stub, detail, _VN(image_sexual=1.8))
    assert adult.image_is_nsfw is True


class _Resp:
    def __init__(self, status, text):
        self.status, self._text = status, text

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, **kw):
        self.calls.append(url)
        return _Resp(200, self.pages.get(url, "")) if url in self.pages else _Resp(404, "")


@pytest.mark.asyncio
async def test_fetch_reads_only_unseen_reviews_with_pacing(monkeypatch):
    list_page = (FIX / "vndb_reviews_list.html").read_text(encoding="utf-8")
    full = (FIX / "vndb_review_full.html").read_text(encoding="utf-8")
    session = _Session({vndb_reviews.VNDB_REVIEWS_URL: list_page, "https://vndb.org/w900001": full})
    sleeps: list[float] = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    async def fake_unknown(db, source, keys):
        assert source == "vndb_review"
        return [k for k in keys if k != "w900002"]

    async def fake_resolve(sess, db, vn_id):
        return _VN() if vn_id == "v900001" else None

    monkeypatch.setattr(vndb_reviews.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(vndb_reviews.store, "unknown_keys", fake_unknown)
    monkeypatch.setattr(vndb_reviews, "_resolve_vn", fake_resolve)
    drafts = await fetch_new_reviews(session, db=None, now=NOW, delay=10.0)
    # The stale row is outside the window, the seen one is skipped, one detail page is read.
    assert [d.key for d in drafts] == ["w900001"]
    assert session.calls == [vndb_reviews.VNDB_REVIEWS_URL, "https://vndb.org/w900001"]
    assert sleeps == [10.0]


NO_USER_LINK_ROW = (
    '<table><tr><td class="tc1">2026-09-06</td><td class="tc2">reader-one</td>'
    '<td class="tc3">8</td><td class="tc4">Long</td>'
    '<td class="tc5"><a href="/w900003" lang="en">A Story</a></td>'
    '<td class="tc7">0</td><td class="tc8"></td></tr></table>'
)


def test_a_review_without_a_user_link_carries_no_reviewer_address():
    stub = parse_review_list(NO_USER_LINK_ROW)[0]
    assert stub.user == "" and stub.user_id is None
    detail = parse_review_page((FIX / "vndb_review_full.html").read_text(encoding="utf-8"))
    anonymous = replace(detail, user_id=None)
    assert "reviewer_url" not in draft_review(stub, anonymous, _VN()).extra
    # The page's byline names the account when the listing row does not.
    assert draft_review(stub, detail, _VN()).extra["reviewer_url"] == "https://vndb.org/u9900001"
