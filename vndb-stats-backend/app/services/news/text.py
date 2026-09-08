"""Text cleanup shared by the adapters."""

from __future__ import annotations

import html
import ipaddress
import logging
import re
from urllib.parse import urljoin, urlparse

import aiohttp

logger = logging.getLogger(__name__)

_TAG = re.compile(r"<[^>]+>")
_BB_URL = re.compile(r"\[url=[^\]]*\]([^\[]*)\[/url\]")
_BB_OTHER = re.compile(r"\[/?(?:b|i|u|s|spoiler|quote|code|raw)\]")
_WS = re.compile(r"\s+")
_SPOILER = re.compile(r"<span class=\"spoiler\">.*?</span>", re.S | re.I)
_KANA_KANJI = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")
_LATIN = re.compile(r"[A-Za-z]")
# Below this share of Japanese script among letters, a text is taken to be English.
_JA_SHARE = 0.3
_OG_IMAGE = re.compile(
    r'<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"', re.I
)
_OG_IMAGE_REV = re.compile(
    r'<meta\s+content="([^"]+)"\s+(?:property|name)="(?:og:image|twitter:image)"', re.I
)


def clean_html(text: str | None) -> str:
    """Tags and VNDB BBCode out, entities decoded, whitespace collapsed."""
    if not text:
        return ""
    text = _TAG.sub(" ", text)
    text = _BB_URL.sub(r"\1", text)
    text = _BB_OTHER.sub("", text)
    text = html.unescape(text)
    return _WS.sub(" ", text).strip()


def strip_spoilers(markup: str) -> str:
    """Markup with its spoiler spans removed, so an excerpt never gives one away."""
    return _SPOILER.sub(" ", markup or "")


def script_lang(text: str) -> str:
    """Which of the two languages a text is written in, judged by its script."""
    ja = len(_KANA_KANJI.findall(text or ""))
    latin = len(_LATIN.findall(text or ""))
    if ja == 0 and latin == 0:
        return "en"
    return "ja" if ja / (ja + latin) >= _JA_SHARE else "en"


# A short Latin term is a word, not a fragment: a term at or below this length would
# otherwise turn up inside ordinary words and file posts about something else. The edge is drawn
# against Latin letters and digits alone, since Japanese runs such a term straight up
# against the words around it.
SHORT_TERM_LENGTH = 3
_ASCII_TERM = re.compile(r"^[a-z0-9 ]+$")


def _term_matches(term: str, lowered: str) -> bool:
    term = term.lower()
    if len(term.strip()) > SHORT_TERM_LENGTH or not _ASCII_TERM.match(term):
        return term in lowered
    pattern = r"(?<![a-z0-9])" + re.escape(term.strip()) + r"(?![a-z0-9])"
    return re.search(pattern, lowered) is not None


# Phrases that deny a translation rather than announce one. An exclude term reaches
# inside them as a substring, which would drop the posts about works in their original
# language that the exclude term exists to leave room for.
EXCLUDE_NEGATIONS = ["untranslated", "no translation", "without translation", "not translated"]


def matches_keywords(text: str, include: list[str] | None, exclude: list[str] | None) -> bool:
    lowered = text.lower()
    if include and not any(_term_matches(k, lowered) for k in include):
        return False
    if exclude:
        # A space in place of each phrase, so removing one cannot join its neighbours.
        testable = lowered
        for phrase in EXCLUDE_NEGATIONS:
            testable = testable.replace(phrase, " ")
        if any(_term_matches(k, testable) for k in exclude):
            return False
    return True


def _cut(line: str, limit: int) -> str:
    return line if len(line) <= limit else line[: limit - 1] + "…"


def first_line(text: str, limit: int) -> str:
    """A title for a post that has none: its first line, cut with an ellipsis."""
    return _cut(text.strip().split("\n", 1)[0].strip(), limit)


# A post often opens with a line naming the kind of announcement it is rather than what
# it announces. Such a line is short, and is either wholly bracketed or carries no
# letters or digits at all: a rule, a run of marks, a decorative separator.
HEADING_LIMIT = 24
_BRACKETED_LINE = re.compile(r"^\W*[【〖\[「『][^】〗\]」』]*[】〗\]」』]\W*$")
_LETTER_OR_DIGIT = re.compile(r"[^\W_]")


def is_heading(line: str) -> bool:
    """Whether a line names the kind of post rather than what the post says."""
    line = (line or "").strip()
    if not line or len(line) > HEADING_LIMIT:
        return False
    return bool(_BRACKETED_LINE.match(line)) or not _LETTER_OR_DIGIT.search(line)


def post_title(text: str, limit: int) -> str:
    """A title for a post: its opening line, or a heading joined to the line beneath it."""
    lines = [line.strip() for line in (text or "").splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""
    if len(lines) == 1 or not is_heading(lines[0]):
        return _cut(lines[0], limit)
    return _cut(f"{lines[0]} {lines[1]}", limit)





def public_web_url(url: str) -> bool:
    """Whether an address names a page on the open web: http(s) on a default port, a dotted
    public hostname, never an address literal, a bare name or a local suffix. Feeds and
    posts name the addresses the worker opens, so anything on this network is refused."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if parsed.port not in (None, 80, 443):
        return False
    host = parsed.hostname.lower().strip("[]")
    if "." not in host or host.endswith((".local", ".localhost", ".internal", ".lan")):
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved)


# What is read of a page: the metadata sits in the head, and a body past this is cut.
MAX_PAGE_BYTES = 512 * 1024
MAX_REDIRECTS = 3
_REDIRECT_STATUSES = frozenset((301, 302, 303, 307, 308))
_PAGE_TIMEOUT = aiohttp.ClientTimeout(total=10)


async def read_public_page(
    session: aiohttp.ClientSession,
    url: str,
    *,
    timeout: aiohttp.ClientTimeout | None = None,
) -> tuple[bytes, str] | None:
    """The opening bytes of a page on the open web and the address that served them, or
    None. Redirects are taken by hand so that every hop is held to the same address rule
    as the first."""
    for _ in range(MAX_REDIRECTS + 1):
        if not public_web_url(url):
            return None
        async with session.get(
            url, timeout=timeout or _PAGE_TIMEOUT, allow_redirects=False
        ) as resp:
            location = resp.headers.get("Location") if resp.status in _REDIRECT_STATUSES else None
            if location:
                url = urljoin(url, location)
                continue
            if resp.status != 200:
                return None
            return await resp.content.read(MAX_PAGE_BYTES), url
    return None


def decode_page(raw: bytes) -> str:
    """Japanese sites still ship legacy encodings."""
    for enc in ("utf-8", "euc-jp", "shift_jis"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


async def extract_og_image(session: aiohttp.ClientSession, url: str) -> str | None:
    """The page's social image as a public web address, or None."""
    try:
        got = await read_public_page(session, url)
    except Exception as e:  # noqa: BLE001
        logger.debug("og:image lookup failed for %s: %s", url, e)
        return None
    if got is None:
        return None
    raw, final_url = got
    page = decode_page(raw)
    m = _OG_IMAGE.search(page) or _OG_IMAGE_REV.search(page)
    if not m:
        return None
    resolved = urljoin(final_url, html.unescape(m.group(1)))
    return resolved if public_web_url(resolved) else None
