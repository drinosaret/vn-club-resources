"""Shared search-ranking utilities for SQLAlchemy queries."""

import re

from sqlalchemy import case, func, or_


def escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters in user input."""
    return value.replace("%", r"\%").replace("_", r"\_")


def _strip(col):
    """Strip non-alphanumeric characters and lowercase for normalized matching.

    Returns lower(regexp_replace(col, ...)) to match the expression GIN indexes
    defined in migration 032.
    """
    return func.lower(func.regexp_replace(col, '[^a-zA-Z0-9]', '', 'g'))


def relevance_rank(q: str, name_columns: list) -> case:
    """Build a relevance CASE expression for search ordering.

    Returns a ``case()`` expression that evaluates to:
      - 0  exact match    (case-insensitive) on any column
      - 1  normalized exact match  ("muvluv" matches "Muv-Luv")
      - 2  starts-with    on any column
      - 3  normalized starts-with
      - 4  word-boundary  query appears as a complete word within any column
      - 5  everything else (substring hits caught by the WHERE clause)

    Usage::

        from app.core.search_utils import relevance_rank

        rank = relevance_rank(q, [Tag.name])
        query = query.order_by(rank.asc(), Tag.vn_count.desc())
    """
    q_lower = q.lower()
    eq = escape_like(q)
    starts_with = f"{eq}%"

    # Normalized query (strip punctuation/spaces)
    normalized_q = re.sub(r'[^a-zA-Z0-9]', '', q).lower()

    exact_conditions = [func.lower(col) == q_lower for col in name_columns]
    prefix_conditions = [col.ilike(starts_with) for col in name_columns]

    # Normalized exact: "muvluv" matches "Muv-Luv", "steinsgate" matches "Steins;Gate"
    # _strip() already applies lower(), so use == and like (not ilike)
    norm_exact_conditions = []
    norm_prefix_conditions = []
    if len(normalized_q) >= 2:
        for col in name_columns:
            norm_exact_conditions.append(_strip(col) == normalized_q)
            norm_prefix_conditions.append(_strip(col).like(f"{escape_like(normalized_q)}%"))

    # Word-boundary: query appears as a complete space-delimited word
    word_conditions = []
    for col in name_columns:
        word_conditions.extend([
            col.ilike(f"{eq} %"),    # first word (not exact — that's tier 0)
            col.ilike(f"% {eq}"),    # last word
            col.ilike(f"% {eq} %"),  # middle word
        ])

    tiers = [
        (or_(*exact_conditions), 0),
        (or_(*prefix_conditions), 2),
    ]
    if norm_exact_conditions:
        tiers.insert(1, (or_(*norm_exact_conditions), 1))
    if norm_prefix_conditions:
        tiers.insert(-1 if not norm_exact_conditions else 2, (or_(*norm_prefix_conditions), 3))
    tiers.append((or_(*word_conditions), 4))

    return case(*tiers, else_=5)
