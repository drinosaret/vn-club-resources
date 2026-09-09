"""Brand official sites that publish no feed, only a dated news list on a page.

Each site is one entry in a table with a small extractor that yields (date text, title
markup, link) triples from the raw page; everything after that (date parsing, the age
window, the per-site cap, keys, page images) is shared. The extractors work on the page
with HTML comments removed, since several sites keep stale entries commented out in
place. Lists are newest first on every site here, so scanning stops after a fixed number
of entries rather than reading a whole archive page.

Pages are decoded by their declared charset first: a legacy-encoded page often decodes
without error as another legacy encoding, so guessing by trial is only the fallback.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Iterator
from urllib.parse import urljoin, urlsplit

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.text import extract_og_image

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
MAX_AGE = timedelta(days=14)
MAX_ITEMS = 5
# Entries read from a page before giving up; lists are newest first, so anything past
# this is older than the window on every site listed.
MAX_SCAN = 40
FETCH_STAGGER = 2.0
PAGE_PAUSE = 1.0
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
# Some of these hosts answer a library client with an empty page or a refusal.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept-Language": "ja,en;q=0.5",
}
LANG = "ja"

Entry = tuple[str, str, str | None]
Extractor = Callable[[str], Iterable[Entry]]


@dataclass(frozen=True)
class BrandSite:
    name: str
    slug: str
    # May carry a {year} placeholder for sites that keep one page per year.
    url: str
    extract: Extractor
    lang: str = LANG
    # Set when the page's declared charset is absent or wrong.
    encoding: str | None = None
    # An adult brand's page pictures are adult art; the site shows them behind a blur.
    nsfw_images: bool = False


_COMMENT = re.compile(r"<!--.*?-->", re.S)
_HREF = re.compile(r"""href\s*=\s*["']\s*([^"']+?)\s*["']""", re.I)
_DATE = re.compile(r"(\d{4})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})")
_CHARSET = re.compile(r"charset\s*=\s*[\"']?\s*([\w-]+)", re.I)
_IMAGE_EXT = re.compile(r"\.(?:jpe?g|png|gif|webp)(?:[?#].*)?$", re.I)
_LEADING_MARK = re.compile(r"^[■●・\-\s]+")
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_ENCODINGS = {
    "shift_jis": "cp932",
    "shift-jis": "cp932",
    "sjis": "cp932",
    "x-sjis": "cp932",
    "windows-31j": "cp932",
    "euc-jp": "euc_jp",
    "eucjp": "euc_jp",
    "utf8": "utf-8",
}


def parse_date(text: str) -> date | None:
    """A calendar date from the forms these sites use, including ISO datetime attributes."""
    m = _DATE.search(text or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def decode_page(raw: bytes, site: BrandSite) -> str:
    head = raw[:4096].decode("ascii", errors="ignore")
    declared = _CHARSET.search(head)
    candidates = [site.encoding, declared.group(1) if declared else None, "utf-8", "cp932", "euc_jp"]
    seen: set[str] = set()
    for enc in candidates:
        if not enc:
            continue
        enc = _ENCODINGS.get(enc.lower(), enc.lower())
        if enc in seen:
            continue
        seen.add(enc)
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def _first_link(fragment: str) -> str | None:
    m = _HREF.search(fragment)
    if not m:
        return None
    href = m.group(1)
    if href.startswith(("javascript:", "#")):
        return None
    return href


def _after(page: str, marker: str) -> str:
    """The page from the first occurrence of a marker, or nothing when it is absent."""
    i = page.find(marker)
    return page[i:] if i >= 0 else ""


def _blocks(page: str, marker: str) -> Iterator[str]:
    parts = page.split(marker)
    return iter(parts[1:])


def _pairs(page: str, pattern: re.Pattern) -> Iterator[Entry]:
    """Entries from a pattern with groups (date, link, title) in that order."""
    for m in pattern.finditer(page):
        yield m.group(1), m.group(3), m.group(2)


def _dated_lines(page: str, pattern: re.Pattern) -> Iterator[Entry]:
    """Entries from a pattern with groups (date, body) where the body holds several
    line-broken items, each with an optional link of its own."""
    for m in pattern.finditer(page):
        for line in re.split(r"<br\s*/?>", m.group(2), flags=re.I):
            if _text(line):
                yield m.group(1), line, _first_link(line)


def _tokens(page: str, date_pattern: re.Pattern, item_pattern: re.Pattern) -> Iterator[Entry]:
    """Entries from a list where one date heading is followed by its items."""
    combined = re.compile(f"(?:{date_pattern.pattern})|(?:{item_pattern.pattern})", re.S | re.I)
    current: str | None = None
    for m in combined.finditer(page):
        if m.group(1):
            current = m.group(1)
        elif current:
            yield current, m.group(3), m.group(2)


def _text(markup: str) -> str:
    """Tags dropped rather than turned into spaces: a name marked up as its own element
    sits inside quoting brackets or runs straight into a particle."""
    return _WS.sub(" ", html.unescape(_TAG.sub("", markup))).strip()


def _title(markup: str) -> str:
    return _LEADING_MARK.sub("", _text(markup)).strip()[:500]


# --- per-site extractors -------------------------------------------------------------

_CIRCUS_DATE = re.compile(r'<div class="date">\s*([\d-]+)\s*</div>')
_CIRCUS_TITLE = re.compile(r"<h3>.*?<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", re.S)


def _circus(page: str) -> Iterator[Entry]:
    for block in _blocks(page, '<div class="article">'):
        d, t = _CIRCUS_DATE.search(block), _CIRCUS_TITLE.search(block)
        if d and t:
            yield d.group(1), t.group(2), t.group(1)


_ASA_DATE = re.compile(r'<time datetime="([^"]+)"')
_ASA_ITEM = re.compile(r'<p class="txt">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)


def _asa(page: str) -> Iterator[Entry]:
    for block in _blocks(_after(page, 'class="news-list"'), "<li>"):
        d = _ASA_DATE.search(block)
        if not d:
            continue
        for href, title in _ASA_ITEM.findall(block):
            yield d.group(1), title, href


# The paragraph is never closed; the row's end bounds it.
_HOOK = re.compile(
    r'<p class="life"><strong>\s*(\d{4}\.\d{1,2}\.\d{1,2})\s*(.*?)</strong>(.*?)(?:</p>|</td>|</tr>)',
    re.S,
)


def _hook(page: str) -> Iterator[Entry]:
    for m in _HOOK.finditer(page):
        yield m.group(1), m.group(2), _first_link(m.group(3))


_EUSHULLY = re.compile(r'<td width="290"[^>]*>\s*<b>\s*([\d/]+)\s*</b>\s*<br\s*/?>(.*?)</td>', re.S)


def _eushully(page: str) -> Iterator[Entry]:
    return _dated_lines(page, _EUSHULLY)


_CUFFS = re.compile(
    r'<div class="date">\s*([\d.]+)\s*</div>\s*<dl[^>]*>.*?<dd class="title">\s*(?:<a href="([^"]+)"[^>]*>)?(.*?)</dd>',
    re.S,
)


def _cuffs(page: str) -> Iterator[Entry]:
    return _pairs(_after(page, 'id="newsList"'), _CUFFS)


_LILITH_DATE = re.compile(r'<p class="date">\s*([\d.]+)\s*</p>')
_LILITH_TITLE = re.compile(r'<p class="ttl">(.*?)</p>', re.S)


def _lilith(page: str) -> Iterator[Entry]:
    for block in _blocks(page, '<div class="newslistbox">'):
        d, t = _LILITH_DATE.search(block), _LILITH_TITLE.search(block)
        if d and t:
            yield d.group(1), t.group(1), _first_link(block)


_ESCUDE = re.compile(
    r"<dl>\s*<dt>(?:<a[^>]*>)?\s*(\d{4}年\d{1,2}月\d{1,2}日)[^<]*.*?"
    r'<dd class="up">\s*<a href="([^"]+)"[^>]*>\s*<b>(.*?)</b>',
    re.S | re.I,
)


def _escude(page: str) -> Iterator[Entry]:
    return _pairs(page, _ESCUDE)


_SILKYS_DATE = re.compile(r'<dd class="time"><time datetime="([^"]+)"')
_SILKYS_ITEM = re.compile(r'<dd class="bb">()(.*?)</dd>')


def _silkys(page: str) -> Iterator[Entry]:
    section = _after(page, '<div class="news">')
    for d, body, _ in _tokens(section, _SILKYS_DATE, _SILKYS_ITEM):
        # The heading names the work; its first bullet says what changed.
        heading, _, rest = body.partition("<ul")
        first = re.search(r"<li>(.*?)</li>", rest, re.S)
        title = _text(heading)
        if first:
            title = f"{title} {_text(first.group(1))}"
        yield d, title, _first_link(heading) or _first_link(body)


_GUILTY_DATE = re.compile(r'<dt[^>]*class="news_date2"[^>]*>\s*([\d/]+)\s*</dt>')
_GUILTY_ITEM = re.compile(r'<dd class="news_text2">\s*<a href="([^"]+)"[^>]*>(.*?)</a>')


def _guilty(page: str) -> Iterator[Entry]:
    return _tokens(page, _GUILTY_DATE, _GUILTY_ITEM)


_LAPLACIAN = re.compile(r"<tr>\s*<th>\s*([\d.]+)\s*</th>\s*<td>(.*?)</td>", re.S)


def _laplacian(page: str) -> Iterator[Entry]:
    for m in _LAPLACIAN.finditer(_after(page, "f-1140_tb2")):
        yield m.group(1), m.group(2), _first_link(m.group(2))


_WAFFLE = re.compile(r"<li>\s*<p>\s*([\d.]+)\s*<span>\s*<b>\s*<a href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", re.S)


def _waffle(page: str) -> Iterator[Entry]:
    return _pairs(_after(page, 'id="ticker"'), _WAFFLE)


_YUZU_DATE = re.compile(r'<div class="date">\s*([\d.]+)\s*</div>')
_YUZU_TEXT = re.compile(r'<div class="text">(.*?)</div>', re.S)


def _yuzu(page: str) -> Iterator[Entry]:
    for block in _blocks(_after(page, "topic-wrap"), '<div class="topic-box">'):
        d, t = _YUZU_DATE.search(block), _YUZU_TEXT.search(block)
        if d and t:
            yield d.group(1), t.group(1), _first_link(block)


_MARMALADE = re.compile(r'<section class="clearfix">.*?<time datetime="([^"]+)">.*?</time>(.*?)</p>', re.S)


def _marmalade(page: str) -> Iterator[Entry]:
    for m in _MARMALADE.finditer(_after(page, "wh-news")):
        yield m.group(1), m.group(2), _first_link(m.group(2))


_MINATO_DATE = re.compile(r'<p id="history-date">\s*([\d年月日]+)\s*</p>')
_MINATO_ITEM = re.compile(r'<li[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)</a>')


def _minato(page: str) -> Iterator[Entry]:
    return _tokens(_after(page, 'id="history-box"'), _MINATO_DATE, _MINATO_ITEM)


_NAVEL = re.compile(
    r'<span class="colorRedBold">\s*([\d/]+)\s*</span>.*?<td>\s*<a href="([^"]+)"[^>]*>(.*?)</a>\s*</td>', re.S
)


def _navel(page: str) -> Iterator[Entry]:
    return _pairs(page, _NAVEL)


_LIAR = re.compile(r"<article>\s*<time>\s*([\d.]+)\s*</time>\s*<p>(.*?)</p>", re.S)
_LIAR_DETAIL = re.compile(r"[（(]詳細[)）]")


def _liar(page: str) -> Iterator[Entry]:
    for m in _LIAR.finditer(_after(page, 'id="information"')):
        body = m.group(2)
        yield m.group(1), _LIAR_DETAIL.sub("", _text(body)), _first_link(body)


_PALETTE = re.compile(r'<span class="date">\s*([\d.]+)\s*</span>\s*<p>(.*?)</p>', re.S)


def _palette(page: str) -> Iterator[Entry]:
    for m in _PALETTE.finditer(page):
        yield m.group(1), m.group(2), _first_link(m.group(2))


_WINDMILL = re.compile(r"<p>\s*<strong>\s*■?\s*([\d.]+)\s*</strong>\s*<br\s*/?>(.*?)</p>", re.S)


def _windmill(page: str) -> Iterator[Entry]:
    return _dated_lines(_after(page, "s_con_n"), _WINDMILL)


_CLOCKUP = re.compile(r"<dt>\s*([\d.]+)\s*</dt>\s*<dd>\s*<a href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", re.S)


def _clockup(page: str) -> Iterator[Entry]:
    return _pairs(_after(page, "top_news"), _CLOCKUP)


_INNOCENT_GREY = re.compile(r'<td[^>]*class="normal0"[^>]*>\s*([\d.]+)\s*</td>\s*<td[^>]*class="normal0"[^>]*>(.*?)</td>', re.S)


def _innocent_grey(page: str) -> Iterator[Entry]:
    for m in _INNOCENT_GREY.finditer(page):
        yield m.group(1), m.group(2), _first_link(m.group(2))


BRAND_SITES: list[BrandSite] = [
    BrandSite("CIRCUS", "circus", "https://circus-co.jp/information/", _circus),
    BrandSite("ASa Project", "asaproject", "https://asa-pro.com/top.html", _asa),
    BrandSite("HOOKSOFT", "hooksoft", "http://www.hook-net.jp/htm/index_02.htm", _hook),
    BrandSite("Eushully", "eushully", "https://eukleia.co.jp/eushully/main_update.html", _eushully),
    BrandSite("CUFFS", "cuffs", "https://www.cuffs.co.jp/main/news/", _cuffs),
    BrandSite("Lilith", "lilith", "https://www.lilith-soft.com/news", _lilith, nsfw_images=True),
    BrandSite("Escu:de", "escude", "https://www.escude.co.jp/info_top.html", _escude, nsfw_images=True),
    BrandSite("SILKY'S PLUS", "silkysplus", "http://www.silkysplus.jp/html/index.html", _silkys),
    BrandSite("Guilty", "guilty", "https://guilty-soft.com/news{year}.html", _guilty, nsfw_images=True),
    BrandSite("Laplacian", "laplacian", "https://laplacian.jp/", _laplacian),
    # The host's certificate is not maintained; the page is served over plain HTTP.
    BrandSite("Waffle", "waffle", "http://www.waffle1999.com/official/index2.html", _waffle, nsfw_images=True),
    BrandSite("ゆずソフト", "yuzusoft", "https://www.yuzu-soft.com/", _yuzu),
    BrandSite("まるまれーど", "marmalade", "http://www.web-marmalade.com/index2.html", _marmalade),
    BrandSite("みなとそふと", "minatosoft", "http://minatosoft.com/", _minato),
    BrandSite("Navel", "navel", "https://project-navel.com/", _navel),
    BrandSite("Liar-soft", "liarsoft", "https://www.liar.co.jp/", _liar),
    BrandSite("Palette", "palette", "https://palette.clearrave.co.jp/news/", _palette),
    BrandSite("ういんどみる", "windmill", "https://windmill.suki.jp/main.html", _windmill),
    BrandSite("CLOCKUP", "clockup", "http://clockup.net/top/", _clockup, nsfw_images=True),
    BrandSite("Innocent Grey", "innocentgrey", "http://www.gungnir.co.jp/innocentgrey/news.html", _innocent_grey),
]


# --- shared pipeline -----------------------------------------------------------------


def candidate_urls(site: BrandSite, now: datetime) -> list[str]:
    """The page to read, or for a per-year page the current year's then the previous one's,
    since the new year's page appears some time after the year turns."""
    if "{year}" not in site.url:
        return [site.url]
    year = now.astimezone(JST).year
    return [site.url.format(year=year), site.url.format(year=year - 1)]


def _page_url(site: BrandSite, now: datetime) -> str:
    return candidate_urls(site, now)[0]


def _same_host(link: str, page_url: str) -> bool:
    a, b = urlsplit(link).hostname or "", urlsplit(page_url).hostname or ""
    return a.removeprefix("www.") == b.removeprefix("www.")




def parse_site(page: str, site: BrandSite, now: datetime, page_url: str | None = None) -> list[NewsDraft]:
    page_url = page_url or _page_url(site, now)
    page = _COMMENT.sub("", page)
    drafts: list[NewsDraft] = []
    seen: set[str] = set()
    for i, (date_text, title_markup, href) in enumerate(site.extract(page)):
        if i >= MAX_SCAN or len(drafts) >= MAX_ITEMS:
            break
        day = parse_date(date_text)
        title = _title(title_markup)
        if not day or not title:
            continue
        published = datetime(day.year, day.month, day.day, tzinfo=JST).astimezone(timezone.utc)
        if now - published > MAX_AGE or published - now > timedelta(days=1):
            continue
        link = urljoin(page_url, href) if href else None
        # One row per dated item: a site can point the same page at several dates as it
        # reports each change to it.
        key = f"{site.slug}-" + hashlib.md5(f"{day.isoformat()}|{title}|{link or ''}".encode("utf-8")).hexdigest()[:16]
        if key in seen:
            continue
        seen.add(key)
        drafts.append(
            NewsDraft(
                source="rss",
                source_label=site.name,
                key=key,
                title=title,
                url=link or page_url,
                image_url=link if link and _IMAGE_EXT.search(link) else None,
                image_is_nsfw=site.nsfw_images,
                published_at=published,
                tags=["news"],
                extra={"feed_name": site.name, "lang": site.lang, "brand": True},
            )
        )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts


async def _get(session: aiohttp.ClientSession, url: str) -> tuple[int, bytes]:
    async with session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            return resp.status, b""
        return resp.status, await resp.read()


async def fetch_site(session: aiohttp.ClientSession, site: BrandSite, now: datetime) -> list[NewsDraft]:
    raw, page_url = b"", None
    for url in candidate_urls(site, now):
        status, raw = await _get(session, url)
        if status == 200:
            page_url = url
            break
        logger.info("brand site %s returned %s for %s", site.name, status, url)
    if page_url is None:
        return []
    drafts = parse_site(decode_page(raw, site), site, now, page_url)
    for i, draft in enumerate(drafts):
        # Only an article page on the brand's own host has a picture worth showing; a
        # link elsewhere is a store or a stream, and a link to a picture is the picture.
        if draft.image_url or draft.url == page_url or not _same_host(draft.url, page_url):
            continue
        if i:
            await asyncio.sleep(PAGE_PAUSE)
        draft.image_url = await extract_og_image(session, draft.url)
    return drafts


async def _staggered(session: aiohttp.ClientSession, site: BrandSite, now: datetime, delay: float) -> list[NewsDraft]:
    await asyncio.sleep(delay)
    try:
        return await fetch_site(session, site, now)
    except Exception as e:  # noqa: BLE001
        logger.warning("brand site %s failed: %s", site.name, e)
        return []


async def fetch_all(session: aiohttp.ClientSession, now: datetime) -> list[NewsDraft]:
    """Every site, started a little apart so the batch is not one burst from one address."""
    batches = await asyncio.gather(
        *[_staggered(session, site, now, i * FETCH_STAGGER) for i, site in enumerate(BRAND_SITES)]
    )
    return [d for batch in batches for d in batch]
