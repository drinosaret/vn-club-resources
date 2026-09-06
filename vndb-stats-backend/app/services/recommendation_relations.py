"""Titles connected to a reader's own list through the relation table.

Two readers of the table. The first answers "what is related to these titles", for the
exclusion the engine applies when it is told to keep a reader's page clear of what they
have effectively already read. The second answers "which unread sequels continue the
titles this reader liked", for the strip the page shows above its results.

The table stores every pair in both directions, so a single direction covers every
relation once the input is on either side of it. Nothing here imports the scoring stack:
the harness and the request path both read this without loading a recommender.
"""

from sqlalchemy import literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VNRelation, VisualNovel
from app.db.query_utils import in_ids, not_in_ids

# Entries the strip shows. A continuation is by definition something the reader already
# knows about, so a handful is a reminder and a page of them is noise.
CONTINUATION_LIMIT = 6

# The relation a sequel carries toward the title it follows. The row sits on the sequel
# and names the earlier title, so a match on it is "this unread title continues that
# read one".
SEQUEL_RELATION = "preq"


async def related_to(db: AsyncSession, vn_ids: set[str]) -> set[str]:
    """Every title related to any of `vn_ids`, by any relation, minus the input."""
    if not vn_ids:
        return set()
    rows = (
        await db.execute(
            select(VNRelation.related_vn_id).where(in_ids(VNRelation.vn_id, vn_ids))
        )
    ).all()
    return {row.related_vn_id for row in rows} - set(vn_ids)


async def continuations(
    db: AsyncSession,
    *,
    vn_scores: dict[str, float],
    threshold: float,
    blocked: set[str],
    japanese_only: bool = True,
    limit: int = CONTINUATION_LIMIT,
) -> list[dict]:
    """Unread, finished sequels of the titles the reader marked at or above `threshold`.

    `vn_scores` is the reader's own marks on the 0-10 scale. `blocked` is everything else
    the page must not show. The reader's own scored titles are excluded regardless of
    whether they appear in `blocked`, since a liked title that is itself the sequel of
    another liked title must not become its own continuation. One entry per sequel, kept
    against the best source where a sequel continues more than one liked title, ordered
    by the reader's mark for the source, then the sequel's own rating, then id.
    """
    liked = {vn_id for vn_id, score in vn_scores.items() if score >= threshold}
    if not liked:
        return []

    excluded = blocked | set(vn_scores)

    query = (
        select(
            VNRelation.vn_id,
            VNRelation.related_vn_id,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
        )
        .join(VisualNovel, VisualNovel.id == VNRelation.vn_id)
        .where(VNRelation.relation == SEQUEL_RELATION)
        .where(VNRelation.official == literal(True))
        .where(in_ids(VNRelation.related_vn_id, liked))
        .where(VisualNovel.devstatus == 0)
    )
    if excluded:
        query = query.where(not_in_ids(VNRelation.vn_id, excluded))
    if japanese_only:
        query = query.where(VisualNovel.olang == "ja")

    rows = (await db.execute(query)).all()
    if not rows:
        return []

    best: dict[str, tuple[tuple, object, float]] = {}
    for row in rows:
        source_score = float(vn_scores[row.related_vn_id])
        key = (-source_score, -float(row.rating or 0.0), row.vn_id)
        current = best.get(row.vn_id)
        if current is None or key < current[0]:
            best[row.vn_id] = (key, row, source_score)
    chosen = sorted(best.values(), key=lambda item: item[0])[:limit]

    source_ids = {row.related_vn_id for _, row, _ in chosen}
    source_rows = (
        await db.execute(
            select(
                VisualNovel.id, VisualNovel.title, VisualNovel.title_jp, VisualNovel.title_romaji
            ).where(in_ids(VisualNovel.id, source_ids))
        )
    ).all()
    sources = {row.id: row for row in source_rows}

    block: list[dict] = []
    for _, row, source_score in chosen:
        source = sources.get(row.related_vn_id)
        block.append(
            {
                "vn_id": row.vn_id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "rating": row.rating,
                "continues": {
                    "vn_id": row.related_vn_id,
                    "title": source.title if source is not None else row.related_vn_id,
                    "title_jp": source.title_jp if source is not None else None,
                    "title_romaji": source.title_romaji if source is not None else None,
                    "score": round(source_score, 1),
                },
            }
        )
    return block
