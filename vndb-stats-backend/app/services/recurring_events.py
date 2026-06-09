"""Automatic (computed) calendar events.

These are NOT stored in the database and NOT driven by any bot; they are
generated deterministically from the date so recurring club rhythms always show
on /events without anyone creating them. They are display-only.

Add new automatic rules here: write a window builder, give it a distinct
_TYPE_* code (so synthetic ids stay unique), and surface it from for_month()
and upcoming().
"""

from datetime import datetime, timedelta, timezone

# Distinct type codes keep synthetic ids from colliding across rules.
_TYPE_VN_MONTH_VOTING = 1
_TYPE_VN_SEASON_VOTING = 2
_TYPE_MOVIE_NIGHT = 3
_TYPE_SEASON_START = 4
_TYPE_HOLIDAY = 5
_TYPE_ANNIVERSARY = 6

# Days before the 1st that VN-of-the-month voting opens.
VN_MONTH_VOTING_LEAD_DAYS = 7
# Days before a new season starts that VN-of-the-season voting opens.
SEASON_VOTING_LEAD_DAYS = 7
# Weekly movie night weekday (Mon=0 ... Sun=6). Saturday = 5.
MOVIE_NIGHT_WEEKDAY = 5
# How many upcoming movie nights to surface in the upcoming feed (the grid still
# shows every Saturday; this only limits the repetitive sidebar list).
MOVIE_NIGHT_UPCOMING_COUNT = 2

# Anime-season boundaries: month a season starts -> season name.
_SEASON_START_MONTHS = {1: "Winter", 4: "Spring", 7: "Summer", 10: "Fall"}


def _first_of_month(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)


def _add_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _synthetic_id(type_code: int, year: int, month: int) -> int:
    # Negative so it never collides with a positive DB row id.
    return -(type_code * 1_000_000 + year * 100 + month)


def _vn_month_voting_window(target_year: int, target_month: int) -> dict:
    """Voting window for the given month's VN of the Month.

    Opens VN_MONTH_VOTING_LEAD_DAYS before the 1st and ends the day before the
    1st, i.e. the last week of the previous month.
    """
    target_first = _first_of_month(target_year, target_month)
    open_at = target_first - timedelta(days=VN_MONTH_VOTING_LEAD_DAYS)
    end_at = target_first - timedelta(minutes=1)  # last minute of the day before
    month_name = target_first.strftime("%B")
    return {
        "id": _synthetic_id(_TYPE_VN_MONTH_VOTING, target_year, target_month),
        "event_type": "vn_month_voting",
        "title": f"VN of the Month voting ({month_name})",
        "description": f"Nominate and vote for {month_name}'s VN of the Month in Discord.",
        "start_at": open_at.isoformat(),
        "end_at": end_at.isoformat(),
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:vn_month_voting:{target_year}-{target_month:02d}",
        "created_by": "auto",
    }


def _vn_season_voting_window(season_year: int, season_start_month: int) -> dict:
    """Voting window for the VN of the Season starting in the given month.

    Opens SEASON_VOTING_LEAD_DAYS before the season's first day and ends the day
    before it (the last week of the prior month). Seasons start in Jan/Apr/Jul/Oct.
    """
    season_first = _first_of_month(season_year, season_start_month)
    open_at = season_first - timedelta(days=SEASON_VOTING_LEAD_DAYS)
    end_at = season_first - timedelta(minutes=1)
    season_name = _SEASON_START_MONTHS[season_start_month]
    return {
        "id": _synthetic_id(_TYPE_VN_SEASON_VOTING, season_year, season_start_month),
        "event_type": "vn_season_voting",
        "title": f"VN of the Season voting ({season_name} {season_year})",
        "description": f"Nominate and vote for the {season_name} {season_year} VN of the Season in Discord.",
        "start_at": open_at.isoformat(),
        "end_at": end_at.isoformat(),
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:vn_season_voting:{season_year}-{season_start_month:02d}",
        "created_by": "auto",
    }


def _saturdays_in_month(year: int, month: int) -> list[datetime]:
    first = _first_of_month(year, month)
    d = first + timedelta(days=(MOVIE_NIGHT_WEEKDAY - first.weekday()) % 7)
    out: list[datetime] = []
    while d.year == year and d.month == month:
        out.append(d)
        d += timedelta(days=7)
    return out


def _upcoming_saturdays(now: datetime, count: int) -> list[datetime]:
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    d = today + timedelta(days=(MOVIE_NIGHT_WEEKDAY - today.weekday()) % 7)
    return [d + timedelta(days=7 * i) for i in range(count)]


def _movie_night_event(d: datetime) -> dict:
    """Weekly movie night on the given Saturday (an all-day slot on the calendar).

    The actual film + showtime, once chosen by voting, is published separately as
    its own movie_night event; the API drops this placeholder for any date that
    already has one (see skip_movie_dates).
    """
    return {
        "id": -(_TYPE_MOVIE_NIGHT * 100_000_000 + d.year * 10_000 + d.month * 100 + d.day),
        "event_type": "movie_night",
        "title": "Movie Night",
        "description": "Weekly community movie night. Vote for the film in Discord.",
        "start_at": d.isoformat(),
        "end_at": None,
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:movie_night:{d.date().isoformat()}",
        "created_by": "auto",
    }


def _season_start_event(year: int, month: int) -> dict:
    """Marker for the first day of an anime/VN season (Jan/Apr/Jul/Oct)."""
    season = _SEASON_START_MONTHS[month]
    d = _first_of_month(year, month)
    return {
        "id": _synthetic_id(_TYPE_SEASON_START, year, month),
        "event_type": "season_start",
        "title": f"{season} {year} begins",
        "description": f"The {season} {year} season starts.",
        "start_at": d.isoformat(),
        "end_at": None,
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:season_start:{year}-{month:02d}",
        "created_by": "auto",
    }


# --- Holidays (grey, display-only; never surfaced in the Upcoming feed) -------

def _md(dt: datetime) -> tuple[int, int]:
    return (dt.month, dt.day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> datetime:
    """Date of the n-th given weekday (Mon=0 ... Sun=6) in a month (UTC)."""
    first = _first_of_month(year, month)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def _spring_equinox_day(year: int) -> int:
    # Astronomical approximation, valid ~1980-2099.
    return int(20.8431 + 0.242194 * (year - 1980) - (year - 1980) // 4)


def _autumn_equinox_day(year: int) -> int:
    return int(23.2488 + 0.242194 * (year - 1980) - (year - 1980) // 4)


# (English, Japanese, description); the JP name shows when the title preference is
# JP, and the description shows when the date is opened on the calendar.
# Fixed-date Japanese national holidays.
_JP_FIXED = {
    (1, 1): ("New Year's Day", "元日", "Japan's biggest holiday: families visit shrines (hatsumode) and eat osechi to welcome the new year."),
    (2, 11): ("National Foundation Day", "建国記念の日", "Commemorates the legendary founding of Japan by its first emperor, Jimmu."),
    (2, 23): ("Emperor's Birthday", "天皇誕生日", "A national holiday celebrating the reigning emperor's birthday."),
    (4, 29): ("Showa Day", "昭和の日", "Honors the Showa era and opens the Golden Week holiday stretch."),
    (5, 3): ("Constitution Memorial Day", "憲法記念日", "Marks the day Japan's post-war constitution took effect in 1947."),
    (5, 4): ("Greenery Day", "みどりの日", "A Golden Week holiday for appreciating nature and greenery."),
    (5, 5): ("Children's Day", "こどもの日", "Celebrates children's happiness; families fly carp streamers (koinobori)."),
    (8, 11): ("Mountain Day", "山の日", "Japan's newest national holiday, a day to appreciate its mountains."),
    (11, 3): ("Culture Day", "文化の日", "Promotes culture, the arts, and academic achievement."),
    (11, 23): ("Labor Thanksgiving Day", "勤労感謝の日", "Honors labor and gives thanks for the year's production."),
}

# Curated cultural / international observances (not national days off).
_INTL_FIXED = {
    (2, 3): ("Setsubun", "節分", "The eve of spring: roasted beans are thrown to drive out bad luck (oni wa soto, fuku wa uchi)."),
    (2, 14): ("Valentine's Day", "バレンタインデー", "In Japan women traditionally give chocolate: giri-choco to colleagues, honmei-choco to a sweetheart."),
    (3, 14): ("White Day", "ホワイトデー", "One month after Valentine's, the day to give a return gift to anyone who gave you chocolate."),
    (4, 8): ("4gatsu Day", "四月八日", "A nod to the visual novel 死月妖花 ～四月八日～ (April 8th)."),
    (7, 7): ("Tanabata", "七夕", "The star festival: wishes are written on tanzaku strips and hung on bamboo."),
    (10, 31): ("Halloween", "ハロウィン", "Costumes and street parties, hugely popular in Japan's cities."),
    (12, 24): ("Christmas Eve", "クリスマスイブ", "In Japan a romantic couples' evening; KFC and Christmas cake are traditions."),
    (12, 25): ("Christmas", "クリスマス", "Celebrated as a festive, secular event in Japan."),
    (12, 31): ("New Year's Eve", "大晦日", "Omisoka: families eat toshikoshi soba and hear the temple bells ring out the old year."),
}


def _holidays_for_year(year: int) -> dict[tuple[int, int], tuple[str, str, str]]:
    """{(month, day): (en, jp, description)} of holidays/observances (grey) for a year."""
    out = dict(_INTL_FIXED)
    out.update(_JP_FIXED)  # JP national takes precedence on any date overlap
    out[_md(_nth_weekday(year, 1, 0, 2))] = ("Coming of Age Day", "成人の日", "Celebrates those reaching adulthood; new adults attend ceremonies in formal wear.")  # 2nd Mon Jan
    out[_md(_nth_weekday(year, 7, 0, 3))] = ("Marine Day", "海の日", "A day to give thanks for the ocean and Japan's maritime prosperity.")  # 3rd Mon Jul
    out[_md(_nth_weekday(year, 9, 0, 3))] = ("Respect for the Aged Day", "敬老の日", "Honors elderly citizens and their contributions to society.")  # 3rd Mon Sep
    out[_md(_nth_weekday(year, 10, 0, 2))] = ("Sports Day", "スポーツの日", "Promotes sport and active living; many schools hold their field day.")  # 2nd Mon Oct
    out[(3, _spring_equinox_day(year))] = ("Vernal Equinox", "春分の日", "Day and night are nearly equal; a time to honor ancestors and welcome spring.")
    out[(9, _autumn_equinox_day(year))] = ("Autumnal Equinox", "秋分の日", "Day and night are nearly equal; a time to honor ancestors and welcome autumn.")
    return out


# --- Club anniversaries (gold, shown in both the grid and the Upcoming feed) ---

# {(month, day): (name, description)}. Community milestones, celebrated yearly.
_ANNIVERSARIES = {
    (1, 22): ("VNCR Founding (Resurrection)", "Anniversary of VNCR's re-founding (Resurrection)."),
    (3, 29): ("VNCR Founding (Reborn)", "Anniversary of the original VNCR founding (Reborn)."),
}


def _anniversary_event(year: int, month: int, day: int, name: str, description: str) -> dict:
    d = datetime(year, month, day, tzinfo=timezone.utc)
    return {
        "id": -(_TYPE_ANNIVERSARY * 100_000_000 + year * 10_000 + month * 100 + day),
        "event_type": "anniversary",
        "title": name,
        "title_jp": name,  # no JP translation; show the same name in JP mode
        "title_romaji": name,
        "description": description,
        "start_at": d.isoformat(),
        "end_at": None,
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:anniversary:{year}-{month:02d}-{day:02d}",
        "created_by": "auto",
    }


def _holiday_event(year: int, month: int, day: int, name_en: str, name_jp: str, description: str) -> dict:
    d = datetime(year, month, day, tzinfo=timezone.utc)
    return {
        "id": -(_TYPE_HOLIDAY * 100_000_000 + year * 10_000 + month * 100 + day),
        "event_type": "holiday",
        "title": name_en,
        "title_jp": name_jp,
        "title_romaji": name_en,
        "description": description,
        "start_at": d.isoformat(),
        "end_at": None,
        "all_day": True,
        "image_url": None,
        "url": None,
        "location": None,
        "is_active": True,
        "external_key": f"auto:holiday:{year}-{month:02d}-{day:02d}",
        "created_by": "auto",
    }


def for_month(year: int, month: int, skip_movie_dates: set[str] | None = None) -> list[dict]:
    """Synthetic events whose window falls within the given calendar month.

    Voting that happens during month M is for month M+1 (its window is M's last
    week). When M+1 also begins a new anime season, the season's voting window
    falls in the same week, so both can appear together. Movie nights fall on
    every Saturday. skip_movie_dates (ISO YYYY-MM-DD) suppresses the generic
    movie-night placeholder on days that already have a real one.
    """
    skip = skip_movie_dates or set()
    ny, nm = _add_month(year, month)
    out = [_vn_month_voting_window(ny, nm)]
    if nm in _SEASON_START_MONTHS:
        out.append(_vn_season_voting_window(ny, nm))
    for sat in _saturdays_in_month(year, month):
        if sat.date().isoformat() not in skip:
            out.append(_movie_night_event(sat))
    # Season start (grid marker) + holidays (grey). These are display-only and
    # intentionally absent from upcoming() so they never crowd the Upcoming feed.
    if month in _SEASON_START_MONTHS:
        out.append(_season_start_event(year, month))
    for (hm, hd), (name_en, name_jp, desc) in _holidays_for_year(year).items():
        if hm == month:
            out.append(_holiday_event(year, month, hd, name_en, name_jp, desc))
    for (am, ad), (name, desc) in _ANNIVERSARIES.items():
        if am == month:
            out.append(_anniversary_event(year, month, ad, name, desc))
    return out


def upcoming(now: datetime, months_ahead: int = 2, skip_movie_dates: set[str] | None = None) -> list[dict]:
    """Synthetic events ending at or after `now`, soonest first. Kept short
    (near-term voting windows + the next couple movie nights) so the Upcoming
    sidebar doesn't fill with repetitive recurring entries."""
    skip = skip_movie_dates or set()
    out: list[dict] = []
    y, m = now.year, now.month
    for _ in range(months_ahead + 1):
        ev = _vn_month_voting_window(y, m)
        if datetime.fromisoformat(ev["end_at"]) >= now:
            out.append(ev)
        if m in _SEASON_START_MONTHS:
            sev = _vn_season_voting_window(y, m)
            if datetime.fromisoformat(sev["end_at"]) >= now:
                out.append(sev)
        for (am, ad), (name, desc) in _ANNIVERSARIES.items():
            if am == m:
                aev = _anniversary_event(y, m, ad, name, desc)
                if aev["start_at"][:10] >= now.date().isoformat():  # include the day itself
                    out.append(aev)
        y, m = _add_month(y, m)

    today_iso = now.date().isoformat()
    for sat in _upcoming_saturdays(now, MOVIE_NIGHT_UPCOMING_COUNT):
        iso = sat.date().isoformat()
        if iso >= today_iso and iso not in skip:
            out.append(_movie_night_event(sat))

    out.sort(key=lambda e: e["start_at"])
    return out
