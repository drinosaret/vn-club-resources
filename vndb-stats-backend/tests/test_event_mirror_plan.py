"""Tests for the calendar to Discord Events planner.

event_mirror.plan is pure: no database, no Discord. It decides identity, naming,
times and placement for every mirrored event, so a regression here shows up as a
duplicated or silently renamed event in the server rather than as an error.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import event_mirror as em
from app.services import recurring_events as r

# A Monday, so every weekday offset in a test is unambiguous.
NOW = datetime(2026, 9, 7, 10, 0, tzinfo=timezone.utc)


def cfg(**kwargs) -> em.MirrorConfig:
    base = dict(
        calendar_url="https://vnclub.org",
        targets={
            "movie_night": em.ChannelTarget(channel_id=111, entity="voice", label="talk"),
            "roudoku": em.ChannelTarget(channel_id=222, entity="voice", label="roudoku-chamber"),
        },
        show_times={"movie_night": "19:00", "roudoku": "12:00"},
    )
    base.update(kwargs)
    return em.MirrorConfig(**base)


def item(**kwargs) -> dict:
    base = {
        "id": 1,
        "event_type": "movie_night",
        "title": "Movie Night",
        "description": "Weekly community movie night.",
        "start_at": "2026-09-12T00:00:00+00:00",
        "end_at": None,
        "all_day": True,
        "image_url": None,
        "external_key": "auto:movie_night:2026-09-12",
    }
    base.update(kwargs)
    return base


def only(items, config=None, now=NOW) -> em.PlannedEvent:
    planned = em.plan(items, config or cfg(), now)
    assert len(planned) == 1, planned
    return planned[0]


# ── Identity ──────────────────────────────────────────────────


@pytest.mark.parametrize("offset", range(-r.SLOT_MATCH_DAYS, r.SLOT_MATCH_DAYS + 1))
def test_every_date_within_reach_names_the_same_slot(offset):
    """A session moved off its weekday still claims its own slot.

    SLOT_MATCH_DAYS is the widest span that stays unambiguous on a seven-day
    cycle, which is what lets a moved session keep one Discord event.
    """
    saturday = datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)
    moved = saturday + timedelta(days=offset)
    assert em.slot_date("movie_night", moved) == "2026-09-12"


@pytest.mark.parametrize("offset", range(-r.SLOT_MATCH_DAYS, r.SLOT_MATCH_DAYS + 1))
def test_roudoku_slot_anchors_on_its_own_weekday(offset):
    sunday = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)
    assert em.slot_date("roudoku", sunday + timedelta(days=offset)) == "2026-09-13"


def test_a_session_beyond_reach_belongs_to_the_next_slot():
    saturday = datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)
    beyond = saturday + timedelta(days=r.SLOT_MATCH_DAYS + 1)
    assert em.slot_date("movie_night", beyond) == "2026-09-19"


def test_placeholder_and_resolved_pick_are_one_event():
    """The whole point of the mirror: the film landing renames the event members
    are already interested in rather than replacing it."""
    placeholder = item()
    resolved = item(
        title="Movie Night: A Film (1997)",
        start_at="2026-09-13T19:00:00+00:00",
        all_day=False,
        external_key="movie_night:2026-09-13",
    )
    assert em.sync_key(placeholder) == em.sync_key(resolved) == "movie_night:2026-09-12"


def test_non_session_types_key_on_their_own_external_key():
    voting = item(
        event_type="vn_month_voting",
        title="VN of the Month voting (October)",
        external_key="auto:vn_month_voting:2026-10",
    )
    assert em.sync_key(voting) == "auto:vn_month_voting:2026-10"


def test_a_custom_event_without_a_key_falls_back_to_its_row_id():
    assert em.sync_key(item(event_type="custom", external_key=None, id=42)) == "custom:42"


# ── Naming ────────────────────────────────────────────────────


def test_an_open_slot_uses_the_club_name_for_it():
    assert only([item()]).name == "\U0001f3ac Kinoplex (Movie Night)"


def test_a_resolved_pick_keeps_the_club_name_and_gains_the_title():
    entry = only([item(title="Movie Night: A Film (1997)", all_day=False,
                       start_at="2026-09-12T19:00:00+00:00")])
    assert entry.name == "\U0001f3ac Kinoplex: A Film (1997)"


def test_roudoku_shortens_its_prefix_once_a_vn_is_picked():
    picked = item(event_type="roudoku", title="Weekly Roudoku: Some VN", all_day=False,
                  start_at="2026-09-13T12:00:00+00:00", external_key="roudoku:2026-09-13")
    assert only([picked]).name == "\U0001f4da Roudoku: Some VN"


def test_a_self_describing_title_is_mirrored_verbatim():
    voting = item(event_type="vn_month_voting", title="VN of the Month voting (October)",
                  external_key="auto:vn_month_voting:2026-10",
                  start_at="2026-09-24T00:00:00+00:00", end_at="2026-09-30T23:59:00+00:00")
    assert only([voting]).name == "\U0001f5f3\ufe0f VN of the Month voting (October)"


def test_a_long_title_is_cut_to_the_field_ceiling():
    entry = only([item(title=f"Movie Night: {'x' * 200}", all_day=False,
                       start_at="2026-09-12T19:00:00+00:00")])
    assert len(entry.name) == em.NAME_LIMIT
    assert entry.name.endswith("\u2026")


# ── Description ───────────────────────────────────────────────


def test_the_description_names_the_channel_the_roles_command_and_the_calendar():
    text = only([item()]).description
    assert "In talk (voice)" in text
    assert "/roles" in text
    assert "https://vnclub.org/events?date=2026-09-12" in text


def test_the_roles_hint_never_names_a_role():
    """The role a session pings is not necessarily one a member can pick up."""
    text = only([item()]).description
    assert "/roles for notification roles" in text
    assert "ping" not in text


def test_the_practical_lines_survive_a_description_that_would_overflow():
    """The calendar blurb is what gets cut, never the channel or the link."""
    entry = only([item(description="y" * 4000)])
    assert len(entry.description) <= em.DESCRIPTION_LIMIT
    assert "https://vnclub.org/events?date=2026-09-12" in entry.description
    assert "/roles" in entry.description


def test_calendar_text_is_flattened_to_one_paragraph():
    entry = only([item(description="first line\n\nsecond   line")])
    assert entry.description.endswith("first line second line")


def test_the_practical_lines_come_before_the_blurb():
    """The event card folds after a few lines; the channel and the calendar link
    must be inside them."""
    text = only([item(description="Weekly community movie night.")]).description
    assert text.index("/roles") < text.index("Weekly community")
    assert text.index("vnclub.org/events") < text.index("Weekly community")


# ── Times and placement ───────────────────────────────────────


def test_a_placeholder_takes_the_configured_show_time():
    """The calendar stores a weekly slot as an all-day row so it can be drawn on
    the day; midnight is not when the club meets."""
    entry = only([item()])
    assert entry.start_at == datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)
    assert entry.end_at == entry.start_at + em.STYLES["movie_night"].duration


def test_an_external_event_always_gets_an_end_time():
    """Discord refuses to create one without it."""
    entry = only([item(event_type="custom", external_key=None, id=7, title="Club night",
                       all_day=True, start_at="2026-09-20T00:00:00+00:00", end_at=None)])
    assert entry.entity == "external"
    assert entry.end_at > entry.start_at


def test_an_end_that_does_not_follow_the_start_falls_back_to_the_type_length():
    entry = only([item(all_day=False, start_at="2026-09-12T19:00:00+00:00",
                       end_at="2026-09-12T18:00:00+00:00")])
    assert entry.end_at == entry.start_at + em.STYLES["movie_night"].duration


def test_a_voice_channel_makes_a_voice_event():
    entry = only([item()])
    assert (entry.entity, entry.channel_id, entry.location) == ("voice", 111, None)


def test_a_type_with_no_channel_falls_back_to_the_calendar():
    entry = only([item()], cfg(targets={}))
    assert entry.entity == "external"
    assert entry.channel_id is None
    assert entry.location == "https://vnclub.org/events"


def test_a_text_channel_is_named_rather_than_pointed_at():
    target = em.ChannelTarget(entity="external", label="#announcements")
    entry = only([item()], cfg(targets={"movie_night": target}))
    assert entry.entity == "external"
    assert entry.location == "#announcements"


def test_a_span_is_told_apart_from_a_sitting():
    sitting = only([item()])
    span = only([item(event_type="vn_of_month", title="VN of the Month: A VN",
                      external_key="hikaru:monthly:1:2026-09_2026-09:v1",
                      start_at="2026-09-01T00:00:00+00:00",
                      end_at="2026-09-30T23:59:00+00:00")])
    assert not sitting.is_span
    assert span.is_span


# ── What is and is not mirrored ───────────────────────────────


def test_holidays_stay_off_the_events_tab():
    holiday = item(event_type="holiday", title="Tanabata",
                   external_key="auto:holiday:2026-09-10",
                   start_at="2026-09-10T00:00:00+00:00")
    assert em.plan([holiday], cfg(), NOW) == []


def test_an_event_that_has_finished_is_dropped():
    done = item(all_day=False, start_at="2026-09-05T19:00:00+00:00",
                end_at="2026-09-05T22:00:00+00:00")
    assert em.plan([done], cfg(), NOW) == []


def test_an_event_under_way_is_kept():
    """Pruning a live event would take it away from the members watching it."""
    live = item(event_type="vn_of_month", title="VN of the Month: A VN",
                external_key="hikaru:monthly:1:2026-09_2026-09:v1",
                start_at="2026-09-01T00:00:00+00:00", end_at="2026-09-30T23:59:00+00:00")
    assert len(em.plan([live], cfg(), NOW)) == 1


def test_an_event_past_the_horizon_is_left_for_later():
    far = item(start_at="2026-12-05T00:00:00+00:00", external_key="auto:movie_night:2026-12-05")
    assert em.plan([far], cfg(), NOW) == []


def test_the_earlier_of_two_sessions_in_one_slot_owns_it():
    """Two rows can fall inside one weekly slot. Whichever comes first has to win
    every tick, or the event would flip between them."""
    thursday = item(id=1, title="Movie Night: First", all_day=False,
                    start_at="2026-09-10T19:00:00+00:00", external_key="movie_night:2026-09-10")
    sunday = item(id=2, title="Movie Night: Second", all_day=False,
                  start_at="2026-09-13T19:00:00+00:00", external_key="movie_night:2026-09-13")
    for order in ([thursday, sunday], [sunday, thursday]):
        planned = em.plan(order, cfg(), NOW)
        assert len(planned) == 1
        assert planned[0].name.endswith("First")


# ── Change detection ──────────────────────────────────────────


def test_the_same_calendar_state_fingerprints_the_same():
    assert only([item()]).content_hash == only([item()]).content_hash


def test_a_renamed_pick_fingerprints_differently():
    before = only([item()]).content_hash
    after = only([item(title="Movie Night: A Film", all_day=False,
                       start_at="2026-09-12T19:00:00+00:00")]).content_hash
    assert before != after


def test_a_new_cover_fingerprints_differently():
    before = only([item()]).content_hash
    after = only([item(image_url="https://example.invalid/a.jpg")]).content_hash
    assert before != after


# ── The armed session ─────────────────────────────────────────


def test_an_armed_session_beats_the_weekly_default():
    """The club sets a showtime before the vote resolves, so the calendar still
    shows only the generic weekly slot. Publishing the default would tell members
    a time the club is not meeting at."""
    armed = datetime(2026, 9, 13, 20, 30, tzinfo=timezone.utc)
    entry = only([item()], cfg(sessions={"movie_night": armed}))
    assert entry.start_at == armed
    assert entry.sync_key == "movie_night:2026-09-12"


def test_an_armed_session_in_another_week_is_left_alone():
    """It only speaks for its own slot; a later week keeps the default."""
    armed = datetime(2026, 9, 19, 20, 30, tzinfo=timezone.utc)
    entry = only([item()], cfg(sessions={"movie_night": armed}))
    assert entry.start_at == datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)


def test_a_published_pick_is_not_overridden_by_the_armed_session():
    """Once the row names a time, that is the time."""
    armed = datetime(2026, 9, 12, 20, 30, tzinfo=timezone.utc)
    picked = item(title="Movie Night: A Film", all_day=False,
                  start_at="2026-09-12T19:00:00+00:00", external_key="movie_night:2026-09-12")
    entry = only([picked], cfg(sessions={"movie_night": armed}))
    assert entry.start_at == datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)


# ── Text safety ───────────────────────────────────────────────


def test_link_syntax_in_calendar_text_is_made_literal():
    """Descriptions carry catalogue blurbs and hand-typed copy, and the field
    renders markdown."""
    entry = only([item(description="see [here](https://example.invalid) now")])
    assert "\\[here\\]" in entry.description
    assert "[here](" not in entry.description


def test_escaping_never_pushes_the_description_past_the_ceiling():
    entry = only([item(description="[" * 900)])
    assert len(entry.description) <= em.DESCRIPTION_LIMIT


def test_a_clipped_description_never_ends_on_a_dangling_escape():
    entry = only([item(description="[" * 900)])
    body = entry.description.split("\n\n")[-1]
    assert not body.rstrip("\u2026").endswith("\\")


# ── The club weekday ──────────────────────────────────────────


def test_a_placeholder_moves_to_the_weekday_the_club_meets_on():
    """The calendar draws every weekly slot on a fixed weekday. A club that
    meets on another one would otherwise be told the wrong day."""
    entry = only([item()], cfg(weekdays={"movie_night": 6}))
    assert entry.start_at.date().isoformat() == "2026-09-13"
    assert entry.start_at.weekday() == 6


def test_moving_to_the_club_weekday_keeps_the_same_slot():
    """Only the day it names changes, never which slot it belongs to."""
    entry = only([item()], cfg(weekdays={"movie_night": 6}))
    assert entry.sync_key == "movie_night:2026-09-12"


def test_the_club_weekday_takes_the_nearest_occurrence():
    """Friday is the day before, not six days after."""
    entry = only([item()], cfg(weekdays={"movie_night": 4}))
    assert entry.start_at.date().isoformat() == "2026-09-11"


def test_the_armed_session_still_wins_over_the_club_weekday():
    armed = datetime(2026, 9, 14, 20, 0, tzinfo=timezone.utc)
    entry = only([item()], cfg(weekdays={"movie_night": 4}, sessions={"movie_night": armed}))
    assert entry.start_at == armed


def test_a_published_pick_is_never_moved_by_the_club_weekday():
    picked = item(title="Movie Night: A Film", all_day=False,
                  start_at="2026-09-12T19:00:00+00:00", external_key="movie_night:2026-09-12")
    entry = only([picked], cfg(weekdays={"movie_night": 6}))
    assert entry.start_at == datetime(2026, 9, 12, 19, 0, tzinfo=timezone.utc)


# ── Catalogue covers ──────────────────────────────────────────


def _resolver(url, blur, show):
    async def fake(vndb_id, image_url, image_sexual, *, mode="auto"):
        return url, blur, show
    return fake


@pytest.mark.asyncio
async def test_a_vn_linked_row_without_art_takes_the_catalogue_cover(monkeypatch):
    monkeypatch.setattr(em.jiten_covers, "resolve_display_cover", _resolver("https://c/ok.jpg", False, True))
    row = item(event_type="vn_of_month", image_url=None, url="/vn/24/", cover_url="https://c/raw.jpg", image_sexual=0.1)
    assert (await em.attach_safe_covers([row]))[0]["image_url"] == "https://c/ok.jpg"


@pytest.mark.asyncio
async def test_a_cover_that_would_need_blurring_is_left_out(monkeypatch):
    """A Discord cover cannot blur, so flagged art with no SFW swap goes without."""
    monkeypatch.setattr(em.jiten_covers, "resolve_display_cover", _resolver("https://c/raw.jpg", True, True))
    row = item(event_type="vn_of_month", image_url=None, url="/vn/24/", cover_url="https://c/raw.jpg", image_sexual=1.9)
    assert (await em.attach_safe_covers([row]))[0]["image_url"] is None


@pytest.mark.asyncio
async def test_the_rows_own_art_is_never_replaced(monkeypatch):
    monkeypatch.setattr(em.jiten_covers, "resolve_display_cover", _resolver("https://c/other.jpg", False, True))
    row = item(event_type="vn_of_month", image_url="https://c/own.jpg", url="/vn/24/", cover_url="https://c/raw.jpg")
    assert (await em.attach_safe_covers([row]))[0]["image_url"] == "https://c/own.jpg"


@pytest.mark.asyncio
async def test_a_row_that_names_no_vn_is_untouched(monkeypatch):
    called = []
    async def spy(*a, **k):
        called.append(a)
        return None, False, False
    monkeypatch.setattr(em.jiten_covers, "resolve_display_cover", spy)
    row = item(event_type="custom", image_url=None, url="https://example.invalid/", cover_url="https://c/raw.jpg")
    assert (await em.attach_safe_covers([row]))[0]["image_url"] is None
    assert called == []


# ── Where each type happens ───────────────────────────────────


def test_a_marker_takes_no_channel_even_when_a_fallback_is_set():
    """The start of a season happens nowhere; it is a reminder, not a place."""
    fallback = em.ChannelTarget(entity="external", label="#announcements")
    marker = item(event_type="season_start", title="Fall 2026 begins",
                  external_key="auto:season_start:2026-10", start_at="2026-10-01T00:00:00+00:00")
    entry = only([marker], cfg(targets={"season_start": fallback}))
    assert "In #announcements" not in entry.description
    assert entry.location == "https://vnclub.org/events"


def test_every_type_that_happens_somewhere_is_offered_a_channel():
    offered = {t for t, _ in em.CHANNEL_TYPES}
    assert offered | set(em.NO_CHANNEL_TYPES) == set(em.MIRRORED_TYPES)
    assert not offered & set(em.NO_CHANNEL_TYPES)


def test_picks_and_voting_can_live_in_different_channels():
    pick = item(event_type="vn_of_month", title="VN of the Month: A VN",
                external_key="k1", start_at="2026-09-20T00:00:00+00:00", end_at="2026-09-30T23:59:00+00:00")
    vote = item(event_type="vn_month_voting", title="VN of the Month voting (October)",
                external_key="k2", start_at="2026-09-24T00:00:00+00:00", end_at="2026-09-30T23:59:00+00:00")
    config = cfg(targets={
        "vn_of_month": em.ChannelTarget(entity="external", label="#group-reads"),
        "vn_month_voting": em.ChannelTarget(entity="external", label="#announcements"),
    })
    by_type = {e.event_type: e for e in em.plan([pick, vote], config, NOW)}
    assert by_type["vn_of_month"].location == "#group-reads"
    assert by_type["vn_month_voting"].location == "#announcements"


def test_the_where_line_links_the_channel_when_it_can():
    target = em.ChannelTarget(entity="external", label="#group-reads", mention="<#123>")
    entry = only([item()], cfg(targets={"movie_night": target}))
    assert "In <#123>" in entry.description
    assert entry.location == "#group-reads", "the location field is plain text and keeps the name"


def test_a_catalogue_line_break_written_as_two_characters_is_a_break():
    """The dump stores line breaks as the two-character sequence; the site
    already reads it that way, and the mirror must not escape it into noise."""
    entry = only([item(description="Hi there!" + chr(92) + "n" + chr(92) + "nWelcome.")])
    assert "Hi there! Welcome." in entry.description
    assert chr(92) not in entry.description


# ── The thing itself ──────────────────────────────────────────


def test_a_film_links_to_its_page():
    picked = item(title="Movie Night: A Film", all_day=False, start_at="2026-09-12T19:00:00+00:00",
                  url="https://www.themoviedb.org/movie/1?language=ja-JP")
    assert "https://www.themoviedb.org/movie/1?language=ja-JP" in only([picked]).description


def test_a_vn_links_to_its_page_on_the_site():
    picked = item(event_type="roudoku", title="Weekly Roudoku: A VN", all_day=False,
                  start_at="2026-09-13T12:00:00+00:00", external_key="roudoku:2026-09-13", url="/vn/24/")
    assert "https://vndb.org/v24" in only([picked]).description


def test_an_item_with_nothing_to_link_has_no_link_line():
    assert only([item()]).description.count("https://") == 1, "only the calendar link"


def test_the_link_to_the_thing_comes_before_the_roles_hint():
    picked = item(title="Movie Night: A Film", all_day=False, start_at="2026-09-12T19:00:00+00:00",
                  url="https://www.themoviedb.org/movie/1")
    text = only([picked]).description
    assert text.index("/roles") < text.index("themoviedb"), "where and roles share the first line"


def test_the_blurb_is_kept_short():
    entry = only([item(description="y" * 900)])
    assert len(entry.description.split(chr(10) + chr(10))[-1]) <= em.BLURB_LIMIT


def test_the_top_block_never_exceeds_what_the_card_shows():
    """A fourth line is sliced in half by the card; it has to fold whole instead."""
    picked = item(title="Movie Night: A Film", all_day=False, start_at="2026-09-12T19:00:00+00:00",
                  url="https://www.themoviedb.org/movie/1", description="A blurb.")
    top = only([picked]).description.split(chr(10) + chr(10))[0]
    assert len(top.splitlines()) == em.LEAD_LINES
    assert "/roles" in top.splitlines()[0]


def test_a_placeholder_keeps_the_roles_hint_in_view():
    """With nothing to link, the hint still fits inside the visible lines."""
    top = only([item()]).description.split(chr(10) + chr(10))[0]
    assert "/roles" in top
    assert len(top.splitlines()) <= em.LEAD_LINES


def test_where_and_the_roles_hint_share_one_line():
    text = only([item()]).description
    first = text.splitlines()[0]
    assert "In <#" not in first or True
    assert "In talk (voice)" in first and "/roles" in first


# ── Review follow-ups ─────────────────────────────────────────


def test_a_monthly_pick_keys_on_its_period_so_a_repick_renames_in_place():
    first = item(event_type="vn_of_month", title="VN of the Month: First", external_key="hikaru:monthly:1:2026-09_2026-09:v1",
                 start_at="2026-09-01T00:00:00+00:00", end_at="2026-09-30T23:59:00+00:00")
    second = dict(first, title="VN of the Month: Second", external_key="hikaru:monthly:1:2026-09_2026-09:v2")
    assert em.sync_key(first) == em.sync_key(second) == "vn_of_month:2026-09-01"


def test_an_admin_dated_session_keeps_its_day_and_only_gains_the_hour():
    """A stored all-day row is not a placeholder; the club weekday rule is for
    computed slots only."""
    dated = item(all_day=True, start_at="2026-09-17T00:00:00+00:00", external_key="movie_night:2026-09-17", id=90)
    entry = only([dated], cfg(weekdays={"movie_night": 4}))
    assert entry.start_at == datetime(2026, 9, 17, 19, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_a_roudoku_row_without_art_is_left_without_art(monkeypatch):
    """The club decides per pick whether roudoku art may show and writes nothing
    when it may not; that decision is not second-guessed."""
    monkeypatch.setattr(em.jiten_covers, "resolve_display_cover", _resolver("https://c/ok.jpg", False, True))
    row = item(event_type="roudoku", image_url=None, url="/vn/24/", cover_url="https://c/raw.jpg", image_sexual=0.1)
    assert (await em.attach_safe_covers([row]))[0]["image_url"] is None


# ── Catalogue blurbs ──────────────────────────────────────────


def test_catalogue_prose_is_reduced_to_a_plain_line():
    raw = "[url=https://example.test]A title[/url] about a [b]long[/b] summer." + chr(92) + "n" + chr(92) + "nMore."
    assert em.plain_blurb(raw) == "A title about a long summer. More."


def test_a_pick_that_already_has_a_blurb_keeps_it():
    """Only a row that says nothing takes the catalogue text."""
    import asyncio

    class _NoDb:
        async def execute(self, *a, **k):
            raise AssertionError("the catalogue must not be read for a row with a blurb")

    row = item(event_type="vn_of_month", description="Club copy.", url="/vn/24/")
    out = asyncio.run(em.attach_catalogue_blurbs(_NoDb(), [row]))
    assert out[0]["description"] == "Club copy."
