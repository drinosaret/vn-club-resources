"""When a cached page may answer, and what the request path scores for the cache."""

from datetime import datetime, timedelta

from app.api.v1 import recommendations as api


def test_cached_page_answers_when_it_holds_the_page_or_ran_out():
    assert api.cache_fills_page(cached=100, limit=100, filters_active=False, page_limit=200) is True
    # Fewer rows than the page limit means the pool ran out, which is a complete answer.
    assert api.cache_fills_page(cached=40, limit=100, filters_active=False, page_limit=200) is True
    # A page cut at the limit cannot answer a request for more than it holds.
    assert api.cache_fills_page(cached=200, limit=201, filters_active=False, page_limit=200) is False


def test_filtered_read_needs_half_the_page():
    assert api.cache_fills_page(cached=50, limit=100, filters_active=True, page_limit=200) is True
    assert api.cache_fills_page(cached=49, limit=100, filters_active=True, page_limit=200) is False
    assert api.cache_fills_page(cached=1, limit=1, filters_active=True, page_limit=200) is True


def test_cutoff_is_the_later_of_ttl_and_last_import():
    now = datetime(2030, 1, 2, 12, 0, 0)
    assert api.cache_cutoff(now, last_import=None) == now - timedelta(hours=api.CACHE_TTL_HOURS)
    recent = now - timedelta(hours=3)
    assert api.cache_cutoff(now, last_import=recent) == recent
    old = now - timedelta(days=3)
    assert api.cache_cutoff(now, last_import=old) == now - timedelta(hours=api.CACHE_TTL_HOURS)


def test_cutoff_clamps_a_last_import_ahead_of_the_clock():
    # A stamp ahead of the reader's clock must not push the cutoff into the future.
    now = datetime(2030, 1, 2, 12, 0, 0)
    ahead = now + timedelta(hours=1)
    assert api.cache_cutoff(now, last_import=ahead) == now


def test_parse_import_stamp_normalises_timezone_aware_values_to_naive_utc():
    naive = api.parse_import_stamp("2030-01-02T12:00:00")
    assert naive == datetime(2030, 1, 2, 12, 0, 0)

    aware = api.parse_import_stamp("2030-01-02T12:00:00+05:00")
    assert aware == datetime(2030, 1, 2, 7, 0, 0)
    assert aware.tzinfo is None


def test_scored_page_size_covers_the_cache_write():
    assert api.scored_limit(limit=100, will_cache=True) == api.CACHED_PAGE_ROWS
    assert api.scored_limit(limit=100, will_cache=False) == 100
    assert api.scored_limit(limit=200, will_cache=True) == 200


def test_list_cache_key_names_everything_that_decides_the_answer():
    key = api.list_cache_key("u1", "tags", 100, 0)
    assert key.startswith("rec:list:")
    assert key != api.list_cache_key("u1", "tags", 50, 0)
    assert key != api.list_cache_key("u1", "premise", 100, 0)
    assert key != api.list_cache_key("u1", "tags", 100, 1)
    assert key != api.list_cache_key("u2", "tags", 100, 0)
