"""Render a 'VN of the Month'-style winner banner for Movie Night.

PIL, oversampled 2x then LANCZOS-downsampled for clean edges (matches the other
bots' card renderers). Fetches the TMDB poster and composites a wide card with a
blurred-poster backdrop. Degrades to None on any error so the caller can fall
back to a plain embed.
"""

import asyncio
import glob
import io
import logging

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont

logger = logging.getLogger(__name__)

S = 2  # oversample factor
W, H = 1000, 420  # final size
ACCENT = (244, 63, 94)  # rose
WHITE = (245, 245, 248)
MUTED = (188, 192, 204)

_FONT_CACHE: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    weight = "Bold" if bold else "Regular"
    patterns = [
        f"/usr/share/fonts/**/NotoSansCJK*{weight}*.*",
        "/usr/share/fonts/**/NotoSansCJK*.*",
        f"/usr/share/fonts/**/NotoSans*{weight}*.*",
        "/usr/share/fonts/**/*.ttf",
    ]
    font = ImageFont.load_default()
    for pat in patterns:
        files = sorted(glob.glob(pat, recursive=True))
        if files:
            try:
                font = ImageFont.truetype(files[0], size)
                break
            except Exception:
                continue
    _FONT_CACHE[key] = font
    return font


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_w: int, max_lines: int = 3) -> list[str]:
    def width(s: str) -> int:
        return draw.textbbox((0, 0), s, font=font)[2]

    words = text.split()
    # Word-wrap for spaced titles; char-wrap for unspaced (CJK) ones.
    tokens = words if len(words) > 1 else list(text)
    sep = " " if len(words) > 1 else ""
    lines: list[str] = []
    cur = ""
    for tok in tokens:
        trial = f"{cur}{sep}{tok}" if cur else tok
        if width(trial) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = tok
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if lines and width(lines[-1]) > max_w:
        while lines[-1] and width(lines[-1] + "…") > max_w:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines


def _render(poster: bytes | None, title: str, subtitle: str, meta: str, eyebrow: str) -> bytes:
    w, h = W * S, H * S
    img = Image.new("RGB", (w, h), (18, 18, 24))

    poster_img = None
    if poster:
        try:
            poster_img = Image.open(io.BytesIO(poster)).convert("RGB")
        except Exception:
            poster_img = None

    # Backdrop: blurred, cover-cropped poster (the VN-of-month look).
    if poster_img:
        bg = poster_img.copy()
        ratio = max(w / bg.width, h / bg.height)
        bg = bg.resize((int(bg.width * ratio) + 1, int(bg.height * ratio) + 1), Image.LANCZOS)
        left = (bg.width - w) // 2
        top = (bg.height - h) // 2
        bg = bg.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(20 * S))
        img.paste(bg, (0, 0))
    img = Image.alpha_composite(
        img.convert("RGBA"), Image.new("RGBA", (w, h), (10, 10, 14, 195))
    ).convert("RGB")

    draw = ImageDraw.Draw(img)
    pad = 36 * S
    text_x = pad

    # Sharp poster on the left.
    if poster_img:
        ph = h - 2 * pad
        pw = int(ph * poster_img.width / poster_img.height)
        pw = min(pw, int(w * 0.32))
        ph = int(pw * poster_img.height / poster_img.width)
        ptop = (h - ph) // 2
        sharp = poster_img.resize((pw, ph), Image.LANCZOS)
        mask = Image.new("L", (pw, ph), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw, ph), radius=12 * S, fill=255)
        img.paste(sharp, (pad, ptop), mask)
        draw = ImageDraw.Draw(img)
        text_x = pad + pw + pad

    text_w = w - text_x - pad

    draw.text((text_x, pad + 4 * S), eyebrow, font=_font(20 * S, bold=True), fill=ACCENT)

    title_font = _font(52 * S, bold=True)
    y = pad + 42 * S
    for line in _wrap(draw, title, title_font, text_w, max_lines=3):
        draw.text((text_x, y), line, font=title_font, fill=WHITE)
        y += 58 * S

    sub_font = _font(26 * S)
    y += 10 * S
    if subtitle:
        draw.text((text_x, y), subtitle, font=sub_font, fill=MUTED)
        y += 36 * S
    if meta:
        draw.text((text_x, y), meta, font=sub_font, fill=MUTED)

    draw.rectangle((0, 0, 8 * S, h), fill=ACCENT)  # accent bar

    img = img.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def render_winner_banner(
    *, poster_url, title, subtitle="", meta="", eyebrow="MOVIE NIGHT WINNER"
) -> bytes | None:
    """Fetch the poster and render the banner PNG (bytes), or None on error."""
    poster = None
    if poster_url:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(poster_url)
                resp.raise_for_status()
                poster = resp.content
        except Exception as e:
            logger.warning("Movie banner: poster fetch failed: %s", e)
    try:
        return await asyncio.to_thread(_render, poster, title, subtitle, meta, eyebrow)
    except Exception as e:
        logger.warning("Movie banner render failed: %s", e)
        return None
