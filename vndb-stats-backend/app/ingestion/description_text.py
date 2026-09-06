"""Normalize VNDB descriptions into plain text suitable for sentence embedding.

Distinct from `app.services.vndb_text`, which targets Discord embeds and therefore
emits markdown and keeps provenance visible. An embedding model needs the opposite:
no markup, and no provenance. Attribution trailers name the shop, wiki or fan site a
blurb was copied from, so titles sharing a source would otherwise be pulled together
by the text they have in common rather than by what they are about.

Stdlib only, so it can be unit-tested and reused without the ONNX runtime.
"""

import hashlib
import re
import unicodedata

# Bracketed or parenthesised trailer crediting where the blurb came from. Matched on
# the leading word inside, so ordinary bracketed asides keep their text.
_ATTRIBUTION_LEAD = (
    r"(?:(?:partially|mostly|loosely|slightly|roughly|shortly|freely|heavily|"
    r"machine|lightly|slight)\s+)?"
    r"(?:from|source|sources|translated|translation|edited?|editted|rewritten|reworded|"
    r"paraphrased|adapted|taken|copied|condensed|shortened|abridged|modified|summarised|"
    r"summarized|mtl|mtled|via|courtesy|description|blurb|synopsis|retrieved|excerpt|"
    r"official\s+(?:site|website)|based\s+(?:on|from))"
)
_ATTRIBUTION_BRACKET = re.compile(
    r"\[\s*" + _ATTRIBUTION_LEAD + r"\b[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]",
    re.IGNORECASE,
)
_ATTRIBUTION_PAREN = re.compile(
    r"\(\s*" + _ATTRIBUTION_LEAD + r"\b[^()]{0,200}\)",
    re.IGNORECASE,
)

_URL_TAG = re.compile(r"\[url=[^\]]*\](.*?)\[/url\]", re.DOTALL | re.IGNORECASE)
_URL_TAG_BARE = re.compile(r"\[url\](.*?)\[/url\]", re.DOTALL | re.IGNORECASE)
# Inline markup carries no meaning for a sentence encoder; the wrapped words do.
_INLINE_TAG = re.compile(
    r"\[/?(?:url(?:=[^\]]*)?|spoiler|b|i|u|s|quote|code|raw)\]", re.IGNORECASE
)
_BARE_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
# Bare database references such as a VN or character id left behind by an unwrapped link.
_DBID_REF = re.compile(r"\[?/(?:[vcprsgi])\d{1,7}\]?")
_WS_RUN = re.compile(r"[^\S\n]+")
_BLANK_RUN = re.compile(r"\n{2,}")

# Trailing editorial notes describing the database entry rather than the work.
_ENTRY_NOTE = re.compile(
    r"^[^\S\n]*(?:notes?:|this entry\b|the entry\b|entry for\b|see also\b).*$",
    re.IGNORECASE | re.MULTILINE,
)

# Descriptions carrying no sentence of their own are worse than absent: an encoder maps
# them all to the same region, which reads downstream as a cluster of similar titles.
MIN_USEFUL_LENGTH = 40


def clean_description_for_embedding(text: str | None) -> str:
    """Strip markup and provenance from a description, returning plain prose.

    Returns an empty string when nothing usable survives.
    """
    if not text:
        return ""

    # Line breaks arrive escaped rather than literal.
    text = text.replace("\\n", "\n")
    text = unicodedata.normalize("NFKC", text)

    # Drop credits before unwrapping links: a credit is usually one bracket wrapped
    # around a link, and unwrapping first would leave the shop name behind as prose.
    text = _ATTRIBUTION_BRACKET.sub(" ", text)
    text = _ATTRIBUTION_PAREN.sub(" ", text)

    text = _URL_TAG.sub(r"\1", text)
    text = _URL_TAG_BARE.sub(r"\1", text)
    # Unwrapping can expose a credit that held a nested link.
    text = _ATTRIBUTION_BRACKET.sub(" ", text)
    text = _ATTRIBUTION_PAREN.sub(" ", text)
    text = _INLINE_TAG.sub("", text)

    text = _BARE_URL.sub(" ", text)
    text = _DBID_REF.sub(" ", text)
    text = _ENTRY_NOTE.sub("", text)

    text = _WS_RUN.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_RUN.sub("\n", text)
    return text.strip()


def build_embedding_input(title: str | None, cleaned_description: str) -> str:
    """Compose the string handed to the encoder.

    The title leads because a short entry is otherwise near-contentless, and a title
    often names the setting or series the blurb assumes the reader already knows.
    """
    title = (title or "").strip()
    if not cleaned_description:
        return ""
    if not title:
        return cleaned_description
    return f"{title}. {cleaned_description}"


def prepare_embedding_input(title: str | None, description: str | None) -> str:
    """Clean a raw description and compose the encoder input in one step.

    Returns an empty string when the entry has too little prose to embed.
    """
    cleaned = clean_description_for_embedding(description)
    if len(cleaned) < MIN_USEFUL_LENGTH:
        return ""
    return build_embedding_input(title, cleaned)


def text_hash(text: str) -> str:
    """Stable digest of the encoder input, used to skip unchanged entries."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()
