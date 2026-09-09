"""Render the cover image for a mirrored Discord scheduled event.

Discord shows an event's cover as a wide band, so a portrait VN cover or film
poster cannot be handed over as-is without being cropped to its middle. This
composites one into a 5:2 card the same way the other banners do: a blurred
copy fills the frame, the sharp art sits on the left, and the type, title and
time sit beside it.

Degrades to None on any failure, which the caller treats as "no cover" rather
than as an error, since an event with no picture is still worth publishing.
"""

import asyncio
import functools
import io
import ipaddress
import logging
import re
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import httpx
from PIL import Image, ImageDraw, ImageFilter

from app.services.banner_text import font as _font, wrap as _wrap

logger = logging.getLogger(__name__)

# Discord draws the event cover as a 5:2 band.
S = 2  # oversample factor, downsampled at the end for clean edges
W, H = 800, 320
WHITE = (245, 245, 248)
MUTED = (188, 192, 204)
BACKDROP = (18, 18, 24)

USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"
FETCH_TIMEOUT = 15
# The art is bounded before it reaches the decoder rather than after: the address
# comes from a calendar row, which an admin can edit by hand.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_REDIRECTS = 3
# A label the resolver would read as part of a numeric address.
_NUMERIC_LABEL = re.compile(r"^(0x[0-9a-f]+|[0-9]+)$")

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def is_public_url(url: str) -> bool:
    """Whether an address is worth asking for at all.

    Cover addresses come from calendar rows, which carry both third-party
    catalogue links and hand-typed ones. Only names that resolve outside this
    network are fetched: a bare single-label name is how the services beside
    this one are addressed, and a literal address in a private range is the same
    request spelled differently.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").strip().rstrip(".")
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return address.is_global
    labels = host.lower().split(".")
    # The system resolver also accepts shorthand and hexadecimal address forms
    # that the address parser above does not, so a name made only of such
    # labels is an address in disguise and is refused before any lookup.
    if all(_NUMERIC_LABEL.match(label) for label in labels):
        return False
    return len(labels) > 1 and host.lower() != "localhost"


async def _resolves_public(url: str) -> bool:
    """Whether every address a name answers with is outside this network.

    The name is what was checked; the address is what gets connected to, and a
    public-looking name can answer with a private one.
    """
    host = (urlparse(url).hostname or "").strip().rstrip(".")
    try:
        ipaddress.ip_address(host)
        return True  # a literal address was already judged by is_public_url
    except ValueError:
        pass
    try:
        infos = await asyncio.get_running_loop().run_in_executor(
            None, functools.partial(socket.getaddrinfo, host, None, type=socket.SOCK_STREAM)
        )
    except (socket.gaierror, OSError, ValueError):
        return False
    addresses = {info[4][0] for info in infos if info and info[4]}
    if not addresses:
        return False
    try:
        return all(ipaddress.ip_address(a.split("%", 1)[0]).is_global for a in addresses)
    except ValueError:
        return False


async def _fetch_art(url: str) -> bytes | None:
    """Read a cover, refusing anything that is not a bounded image response.

    Redirects are followed by hand so each hop is checked the same way as the
    address that was configured.
    """
    if not is_public_url(url or "") or not await _resolves_public(url):
        logger.warning("Event cover: the configured address was not eligible to fetch")
        return None
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as client:
            for _ in range(MAX_REDIRECTS + 1):
                async with client.stream("GET", url, headers={"User-Agent": USER_AGENT}) as resp:
                    if resp.has_redirect_location:
                        target = urljoin(url, resp.headers.get("location", ""))
                        if not is_public_url(target) or not await _resolves_public(target):
                            logger.warning("Event cover: a redirect was not eligible to follow")
                            return None
                        url = target
                        continue
                    resp.raise_for_status()
                    content_type = (resp.headers.get("content-type") or "").split(";")[0].strip()
                    if not content_type.lower().startswith("image/"):
                        logger.warning("Event cover: %s is not an image response", content_type or "an untyped")
                        return None
                    declared = resp.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
                        return None
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes(64 * 1024):
                        buf.extend(chunk)
                        if len(buf) > MAX_IMAGE_BYTES:
                            logger.warning("Event cover: response exceeded the size cap, dropped")
                            return None
                    return bytes(buf)
            logger.warning("Event cover: too many redirects, dropped")
            return None
    except Exception as e:
        logger.warning("Event cover fetch failed: %s", e)
        return None


def _open(art: bytes | None) -> Image.Image | None:
    if not art:
        return None
    try:
        with Image.open(io.BytesIO(art)) as opened:
            return opened.convert("RGB")
    except Exception as e:
        logger.warning("Event cover decode failed: %s", e)
        return None


def _render(art: bytes | None, eyebrow: str, title: str, subtitle: str, accent: tuple[int, int, int]) -> bytes:
    w, h = W * S, H * S
    img = Image.new("RGB", (w, h), BACKDROP)
    cover = _open(art)

    if cover:
        bg = cover.copy()
        ratio = max(w / bg.width, h / bg.height)
        bg = bg.resize((int(bg.width * ratio) + 1, int(bg.height * ratio) + 1), Image.LANCZOS)
        left = (bg.width - w) // 2
        top = (bg.height - h) // 2
        bg = bg.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(18 * S))
        img.paste(bg, (0, 0))
        scrim = 200
    else:
        # With no art the frame would read as a flat slab, so the accent sweeps
        # in from the trailing edge and leaves the text side dark.
        ramp = Image.linear_gradient("L").rotate(90, expand=True).resize((w, h), Image.BILINEAR)
        ramp = ramp.point(lambda v: int(max(0, v - 96) / 159 * 150))
        wash = Image.new("RGB", (w, h), accent)
        img = Image.composite(wash, img, ramp)
        scrim = 110

    img = Image.alpha_composite(
        img.convert("RGBA"), Image.new("RGBA", (w, h), (10, 10, 14, scrim))
    ).convert("RGB")

    draw = ImageDraw.Draw(img)
    pad = 28 * S
    text_x = pad

    if cover:
        art_h = h - 2 * pad
        art_w = int(art_h * cover.width / cover.height)
        art_w = min(art_w, int(w * 0.30))
        art_h = int(art_w * cover.height / cover.width)
        art_top = (h - art_h) // 2
        sharp = cover.resize((art_w, art_h), Image.LANCZOS)
        mask = Image.new("L", (art_w, art_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, art_w, art_h), radius=10 * S, fill=255)
        img.paste(sharp, (pad, art_top), mask)
        draw = ImageDraw.Draw(img)
        text_x = pad + art_w + pad

    # A little more room on the trailing edge than the leading one, so a title
    # that fills the column does not run up against the frame.
    text_w = w - text_x - pad - 10 * S
    eyebrow_font = _font(15 * S, bold=True)
    title_font = _font(36 * S, bold=True)
    sub_font = _font(19 * S)

    lines = _wrap(draw, title, title_font, text_w, max_lines=2)
    line_h = 43 * S
    block = 24 * S + len(lines) * line_h + (28 * S if subtitle else 0)
    y = max(pad, (h - block) // 2)

    draw.text((text_x, y), eyebrow, font=eyebrow_font, fill=accent)
    y += 26 * S
    for line in lines:
        draw.text((text_x, y), line, font=title_font, fill=WHITE)
        y += line_h
    if subtitle:
        draw.text((text_x, y + 4 * S), subtitle, font=sub_font, fill=MUTED)

    draw.rectangle((0, 0, 7 * S, h), fill=accent)

    img = img.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def when_label(start: datetime, end: datetime | None = None) -> str:
    """The subtitle line: the day, and the time when the event keeps one."""
    start = start.astimezone(timezone.utc)
    all_day = start.hour == 0 and start.minute == 0 and end is not None
    if all_day and end.astimezone(timezone.utc).date() > start.date():
        return f"{start:%d %b} to {end.astimezone(timezone.utc):%d %b}"
    if all_day and end - start >= timedelta(hours=23):
        return f"{start:%a %d %b}"
    return f"{start:%a %d %b} \u00b7 {start:%H:%M} UTC"


async def render_event_cover(
    *,
    image_url: str | None,
    eyebrow: str,
    title: str,
    subtitle: str = "",
    accent: tuple[int, int, int],
) -> bytes | None:
    """The event's cover as PNG bytes, or None when it cannot be produced.

    Only the address the calendar row carries is ever read, which is the same
    one the site publishes as metadata and the channel embed shows. The row is
    left empty where the club has decided a cover should not go out unblurred,
    and blurring is not something a Discord cover can do, so there is no second
    source to fall back to.
    """
    art = await _fetch_art(image_url) if image_url else None
    try:
        return await asyncio.to_thread(_render, art, eyebrow, title, subtitle, accent)
    except Exception as e:
        logger.warning("Event cover render failed: %s", e)
        return None
