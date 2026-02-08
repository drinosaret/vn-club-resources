"""Create all missing indexes defined in ORM models.

The database was created via Alembic migrations before index definitions
were added to model __table_args__. As a result, all non-PK indexes are
missing. This migration creates every index defined in models.py using
CREATE INDEX IF NOT EXISTS for idempotency.

Also adds new composite indexes for common browse query patterns:
- (olang, rating DESC, id) for default browse (Japanese VNs sorted by rating)
- (devstatus, rating DESC, id) for status-filtered browse

Revision ID: 022_create_missing_indexes
Revises: 021_add_multi_parent_tables
Create Date: 2026-02-08
"""
from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "022_create_missing_indexes"
down_revision: Union[str, None] = "021_add_multi_parent_tables"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # Increase work_mem for faster index creation
    op.execute(sa.text("SET maintenance_work_mem = '512MB'"))

    # ========== visual_novels ==========
    # Existing model indexes
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_released ON visual_novels (released)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_rating ON visual_novels (rating DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_title ON visual_novels (title)"))
    # New composite indexes for common browse patterns
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_olang_rating ON visual_novels (olang, rating DESC NULLS LAST, id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_devstatus_rating ON visual_novels (devstatus, rating DESC NULLS LAST, id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_olang ON visual_novels (olang)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_devstatus ON visual_novels (devstatus)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_votecount ON visual_novels (votecount DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_minage ON visual_novels (minage)"))

    # ========== tags ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_tags_category ON tags (category)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name)"))

    # ========== tag_parents ==========
    # (idx_tag_parents_parent_id already created by migration 021, but IF NOT EXISTS is safe)
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_tag_parents_parent_id ON tag_parents (parent_id)"))

    # ========== vn_tags (937K rows — critical for tag filtering) ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_tag ON vn_tags (tag_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_vn ON vn_tags (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_vn_spoiler ON vn_tags (vn_id, spoiler_level)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_vn_score_spoiler ON vn_tags (vn_id, score, spoiler_level)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_tag_spoiler_score ON vn_tags (tag_id, spoiler_level, score)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_tags_tag_lie ON vn_tags (tag_id, lie)"))

    # ========== global_votes ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_global_votes_vn ON global_votes (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_global_votes_user ON global_votes (user_hash)"))

    # ========== ulist_vns ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_ulist_vns_uid ON ulist_vns (uid)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_ulist_vns_vid ON ulist_vns (vid)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_ulist_vns_vote ON ulist_vns (vote)"))

    # ========== ulist_labels ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_ulist_labels_uid ON ulist_labels (uid)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_ulist_labels_uid_label ON ulist_labels (uid, label)"))

    # ========== user_graph_embeddings / vn_graph_embeddings ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_graph_embed_version ON user_graph_embeddings (model_version)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_graph_embed_version ON vn_graph_embeddings (model_version)"))

    # ========== producers ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_producers_name ON producers (name)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_producers_type ON producers (type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_producers_lang ON producers (lang)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_producers_vn_count ON producers (vn_count DESC NULLS LAST)"))

    # ========== staff ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_staff_name ON staff (name)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_staff_lang ON staff (lang)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_staff_gender ON staff (gender)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_staff_vn_count ON staff (vn_count DESC NULLS LAST)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_staff_seiyuu_vn_count ON staff (seiyuu_vn_count DESC NULLS LAST)"))

    # ========== vn_staff ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_staff_vn ON vn_staff (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_staff_staff ON vn_staff (staff_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_staff_role ON vn_staff (role)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_staff_vn_role ON vn_staff (vn_id, role)"))

    # ========== vn_seiyuu ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_seiyuu_vn ON vn_seiyuu (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_seiyuu_staff ON vn_seiyuu (staff_id)"))

    # ========== vn_relations ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_relations_vn ON vn_relations (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_relations_related ON vn_relations (related_vn_id)"))

    # ========== traits ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_traits_name ON traits (name)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_traits_group ON traits (group_id)"))

    # ========== trait_parents ==========
    # (idx_trait_parents_parent_id already created by migration 021, but IF NOT EXISTS is safe)
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_trait_parents_parent_id ON trait_parents (parent_id)"))

    # ========== characters ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_characters_name ON characters (name)"))

    # ========== character_vn (186K rows) ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_character_vn_vn ON character_vn (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_character_vn_char ON character_vn (character_id)"))

    # ========== character_traits (2.8M rows) ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_character_traits_char ON character_traits (character_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_character_traits_trait ON character_traits (trait_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_character_traits_char_spoiler ON character_traits (character_id, spoiler_level)"))

    # ========== releases ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_releases_released ON releases (released)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_releases_patch ON releases (patch)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_releases_freeware ON releases (freeware)"))

    # ========== release_vn ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_vn_vn ON release_vn (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_vn_release ON release_vn (release_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_vn_rtype ON release_vn (rtype)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_vn_vn_rtype ON release_vn (vn_id, rtype)"))

    # ========== release_producers ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_producers_release ON release_producers (release_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_producers_producer ON release_producers (producer_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_producers_publisher ON release_producers (producer_id, publisher)"))

    # ========== release_platforms ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_platforms_release ON release_platforms (release_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_platforms_platform ON release_platforms (platform)"))

    # ========== release_media ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_media_release ON release_media (release_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_media_medium ON release_media (medium)"))

    # ========== release_extlinks ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_extlinks_release ON release_extlinks (release_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_release_extlinks_site ON release_extlinks (site)"))

    # ========== news_items ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_news_source ON news_items (source)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_news_hidden ON news_items (is_hidden)"))

    # ========== announcements ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_announcements_expires ON announcements (expires_at)"))

    # ========== rss_feed_configs ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_rss_feeds_active ON rss_feed_configs (is_active)"))

    # ========== posted_items_tracker ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_posted_items_date ON posted_items_tracker (posted_at)"))

    # ========== vn_similarities ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_sim_vn ON vn_similarities (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_sim_score ON vn_similarities (vn_id, similarity_score DESC)"))

    # ========== user_recommendation_cache ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_rec_user ON user_recommendation_cache (user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_rec_score ON user_recommendation_cache (user_id, combined_score DESC)"))

    # ========== vn_cooccurrence ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_cooccur_vn ON vn_cooccurrence (vn_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_vn_cooccur_score ON vn_cooccurrence (vn_id, co_rating_score DESC)"))

    # ========== import_runs / import_logs ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs (status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_import_runs_started ON import_runs (started_at DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_import_logs_run ON import_logs (run_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_import_logs_level ON import_logs (level)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_import_logs_timestamp ON import_logs (timestamp)"))

    # ========== app_logs ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs (timestamp DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_app_logs_source_level ON app_logs (source, level)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs (level)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_app_logs_source ON app_logs (source)"))

    # ========== cover_blacklist_config ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_blacklist_config_tag ON cover_blacklist_config (tag_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_blacklist_config_active ON cover_blacklist_config (is_active)"))

    # ========== cover_blacklist ==========
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_cover_blacklist_reason ON cover_blacklist (reason)"))

    # Reset maintenance_work_mem
    op.execute(sa.text("RESET maintenance_work_mem"))


def downgrade() -> None:
    # Drop only the NEW indexes added by this migration (not model-defined ones)
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_olang_rating"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_devstatus_rating"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_olang"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_devstatus"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_votecount"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_vn_minage"))
