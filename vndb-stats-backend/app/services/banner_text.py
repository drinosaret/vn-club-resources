"""Font loading and text wrapping shared by the rendered banners.

One font cache for the whole process, and one wrapping rule, so a Japanese title
breaks the same way wherever it is drawn.
"""

import glob
import logging

from PIL import ImageDraw, ImageFont

logger = logging.getLogger(__name__)

_FONT_CACHE: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """A CJK-capable face at the given size, falling back to whatever is installed."""
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
    loaded = ImageFont.load_default()
    for pattern in patterns:
        files = sorted(glob.glob(pattern, recursive=True))
        if files:
            try:
                loaded = ImageFont.truetype(files[0], size)
                break
            except Exception:
                continue
    _FONT_CACHE[key] = loaded
    return loaded


def wrap(draw: ImageDraw.ImageDraw, text: str, face, max_w: int, max_lines: int = 3) -> list[str]:
    """Break text to fit a column, ellipsizing the last line it cannot finish."""

    def width(s: str) -> int:
        return draw.textbbox((0, 0), s, font=face)[2]

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
        while lines[-1] and width(lines[-1] + "\u2026") > max_w:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "\u2026"
    return lines
