"""Store sentence embeddings of VN descriptions.

Descriptions are the only dense content signal that does not require an audience: they
are published with the work, where tags, ratings and co-occurrence only accumulate once
enough people have played it. Embedding them lets an entry nobody has voted on sit in the
same space as one everybody has.

The table is the source of truth; the matrix the engine reads is derived from it. Keeping
the vectors here rather than only in a file is what makes the nightly job incremental:
`text_hash` is the digest of the exact cleaned text a vector was produced from, so a run
re-encodes what the import actually changed and nothing else.

`vector` is a raw little-endian float16 buffer rather than a float array column. Vectors
are unit length, so half precision costs an error far below the gap between one neighbour
and the next, and the fixed-width buffer stays inline instead of being pushed out of line
and compressed per row. `dim` travels with it because a model swap changes the width, and
a buffer carries no shape of its own.

`model_version` is part of the key rather than a table-wide assumption, so a replacement
model can be built alongside the live one and the old rows dropped only once the new set
is complete.

Revision ID: 042_add_desc_embeddings
Revises: 041_add_rec_cache_rank
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "042_add_desc_embeddings"
down_revision: Union[str, None] = "041_add_rec_cache_rank"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS vn_description_embeddings (
                vn_id VARCHAR(10) NOT NULL,
                model_version VARCHAR(32) NOT NULL,
                text_hash VARCHAR(40) NOT NULL,
                dim SMALLINT NOT NULL,
                vector BYTEA NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                PRIMARY KEY (vn_id, model_version)
            )
            """
        )
    )
    # The matrix export reads one version in id order, and the incremental pass reads one
    # version's digests; both are a scan of a single version's rows.
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_vn_desc_emb_version "
            "ON vn_description_embeddings (model_version, vn_id)"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_desc_emb_version"))
    op.execute(sa.text("DROP TABLE IF EXISTS vn_description_embeddings"))
