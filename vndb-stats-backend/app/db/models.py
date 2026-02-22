"""
SQLAlchemy ORM models for VNDB data.

============================================================================
LOCAL DATABASE = SOURCE OF TRUTH (ALL DATA FROM VNDB DUMPS)
============================================================================
These models represent the LOCAL PostgreSQL database which is the PRIMARY
and AUTHORITATIVE data source for this application. The database is
populated daily from official VNDB database dumps and contains:

- VisualNovel: 40k+ VNs with complete metadata (titles, ratings, images, etc.)
- Tag / VNTag: All VNDB tags and VN-tag relationships with scores
- Trait / Character / CharacterTrait: Character data and traits
- Staff / VNStaff / VNSeiyuu: Staff, voice actors, and their roles
- Producer: Developer/publisher information
- Release: Platform, language, and release date information
- GlobalVote: User votes for statistics and recommendation algorithms
- UlistVN / UlistLabel: USER VN LISTS - what users have played, their scores, labels

>>> ALWAYS QUERY THESE MODELS - NEVER CALL THE VNDB API <<<

Example - Getting VN metadata:
  CORRECT:   session.query(VisualNovel).filter(VisualNovel.id == "v17").first()
  WRONG:     vndb_client.get_vn_by_ids(["v17"])  # Don't use API for this!

Example - Getting user's VN list:
  CORRECT:   session.query(UlistVN).filter(UlistVN.uid == "u12345").all()
  WRONG:     vndb_client.get_full_user_list("u12345")  # Don't use API!

The VNDB API (app/core/vndb_client.py) should NOT be used for normal operations.
All data comes from the daily database dumps imported by importer.py.

Data flow: VNDB Dumps → importer.py → THIS DATABASE → API endpoints → Frontend
============================================================================
"""

from datetime import datetime, date
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, Date, DateTime,
    ForeignKey, ARRAY, JSON, Index, BigInteger, SmallInteger, CheckConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from app.db.database import Base


class VisualNovel(Base):
    """Visual novel metadata from VNDB dumps."""

    __tablename__ = "visual_novels"

    id = Column(String(10), primary_key=True)  # e.g., "v17"
    title = Column(String(500), nullable=False)
    title_romaji = Column(String(500))
    title_jp = Column(String(500))  # Original Japanese title (kanji/kana)
    aliases = Column(ARRAY(Text))
    description = Column(Text)
    image_url = Column(String(500))
    image_sexual = Column(Float)  # 0=safe, 1=suggestive, 2=explicit
    length = Column(Integer)  # 1-5 scale (legacy category value)
    length_minutes = Column(Integer)  # Average playtime from user votes (matches VNDB website)
    released = Column(Date)
    languages = Column(ARRAY(String(10)))
    platforms = Column(ARRAY(String(50)))
    developers = Column(ARRAY(String(200)))
    rating = Column(Float)  # Bayesian rating
    average_rating = Column(Float)  # Raw average from global_votes (not Bayesian-adjusted)
    votecount = Column(Integer, default=0)
    popularity = Column(Integer, default=0)
    minage = Column(Integer)  # Minimum age: 0, 6, 12, 15, 16, 17, 18
    devstatus = Column(Integer)  # Development status: 0=finished, 1=in dev, 2=cancelled
    olang = Column(String(10))  # Original language
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tags = relationship("VNTag", back_populates="visual_novel", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_vn_released", "released"),
        Index("idx_vn_rating", rating.desc()),
        Index("idx_vn_title", "title"),
        # Composite indexes for common browse patterns
        Index("idx_vn_olang_rating", "olang", rating.desc().nullslast(), "id"),
        Index("idx_vn_devstatus_rating", "devstatus", rating.desc().nullslast(), "id"),
        Index("idx_vn_olang", "olang"),
        Index("idx_vn_devstatus", "devstatus"),
        Index("idx_vn_votecount", votecount.desc()),
        Index("idx_vn_minage", "minage"),
    )


class Tag(Base):
    """Tags from VNDB tag dump."""

    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    category = Column(String(50))  # content, technical, sexual
    aliases = Column(ARRAY(Text))
    parent_id = Column(Integer, ForeignKey("tags.id"))
    searchable = Column(Boolean, default=True)
    applicable = Column(Boolean, default=True)
    vn_count = Column(Integer, default=0)

    # Relationships
    parent = relationship("Tag", remote_side=[id])
    vn_tags = relationship("VNTag", back_populates="tag")

    __table_args__ = (
        Index("idx_tags_category", "category"),
        Index("idx_tags_name", "name"),
    )


class TagParent(Base):
    """Many-to-many tag parent relationships (VNDB tags can have multiple parents)."""

    __tablename__ = "tag_parents"

    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    parent_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        Index("idx_tag_parents_parent_id", "parent_id"),
    )


class VNTag(Base):
    """Many-to-many relationship between VNs and tags with score."""

    __tablename__ = "vn_tags"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    score = Column(Float)  # 0-3 relevance score
    spoiler_level = Column(Integer, default=0)  # 0=none, 1=minor, 2=major
    lie = Column(Boolean, default=False)  # True if tag is disputed/incorrect (aggregate of lie votes)

    # Relationships
    visual_novel = relationship("VisualNovel", back_populates="tags")
    tag = relationship("Tag", back_populates="vn_tags")

    __table_args__ = (
        Index("idx_vn_tags_tag", "tag_id"),
        Index("idx_vn_tags_vn", "vn_id"),
        Index("idx_vn_tags_vn_spoiler", "vn_id", "spoiler_level"),  # Composite for filtered queries
        # Optimize tag analytics queries (score > 0 filter)
        Index("idx_vn_tags_vn_score_spoiler", "vn_id", "score", "spoiler_level"),
        Index("idx_vn_tags_tag_spoiler_score", "tag_id", "spoiler_level", "score"),
        Index("idx_vn_tags_tag_lie", "tag_id", "lie"),  # For filtering out lie tags
    )


class GlobalVote(Base):
    """Global votes from VNDB votes dump for collaborative filtering."""

    __tablename__ = "global_votes"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    user_hash = Column(String(64), primary_key=True)  # Anonymized user ID
    vote = Column(Integer, nullable=False)  # 10-100
    date = Column(Date)

    __table_args__ = (
        Index("idx_global_votes_vn", "vn_id"),
        Index("idx_global_votes_user", "user_hash"),
    )


# ============ User List Data from VNDB Dumps ============

class UlistVN(Base):
    """User VN list entries from VNDB database dumps.

    This table stores user VN lists imported from the daily VNDB dumps.
    It is the PRIMARY source of user list data - NOT the VNDB API.

    The data includes what VNs each user has added to their list, their votes,
    and dates for when they started/finished reading.
    """

    __tablename__ = "ulist_vns"

    uid = Column(String(20), primary_key=True)  # User ID, e.g., "u12345"
    vid = Column(String(10), primary_key=True)  # VN ID, e.g., "v17"
    added = Column(BigInteger)  # Unix timestamp when added to list
    lastmod = Column(BigInteger)  # Unix timestamp of last modification
    vote_date = Column(BigInteger)  # Unix timestamp when voted (renamed from 'voted')
    vote = Column(SmallInteger)  # 10-100 scale, null if not voted
    started = Column(Date)  # Date user started reading
    finished = Column(Date)  # Date user finished reading
    notes = Column(Text)  # User notes

    __table_args__ = (
        Index("idx_ulist_vns_uid", "uid"),
        Index("idx_ulist_vns_vid", "vid"),
        Index("idx_ulist_vns_vote", "vote"),
    )


class UlistLabel(Base):
    """User VN list labels from VNDB database dumps.

    This table stores the labels/categories users assign to VNs in their list.
    Standard labels:
        1 = Playing
        2 = Finished
        3 = Stalled
        4 = Dropped
        5 = Wishlist
        6 = Blacklist
    Users can also create custom labels with IDs >= 10.
    """

    __tablename__ = "ulist_labels"

    uid = Column(String(20), primary_key=True)  # User ID
    vid = Column(String(10), primary_key=True)  # VN ID
    label = Column(SmallInteger, primary_key=True)  # Label ID (1-6 standard, 10+ custom)

    __table_args__ = (
        Index("idx_ulist_labels_uid", "uid"),
        Index("idx_ulist_labels_uid_label", "uid", "label"),  # For filtering by label
    )


class VndbUser(Base):
    """VNDB user accounts from database dumps.

    Maps user IDs to usernames. Imported from the 'users' dump file.
    """

    __tablename__ = "vndb_users"

    uid = Column(String(20), primary_key=True)  # e.g., "u12345"
    username = Column(String(100), nullable=False)


class CachedUserList(Base):
    """Cached user list data fetched from VNDB API.

    DEPRECATED: This table was used when user lists were fetched from the API.
    Now user lists come from the ulist_vns and ulist_labels tables (dump data).
    Kept for backwards compatibility during migration.
    """

    __tablename__ = "cached_user_lists"

    vndb_uid = Column(String(20), primary_key=True)
    username = Column(String(100))
    list_data = Column(JSONB, nullable=False)  # Full user list
    vote_data = Column(JSONB)  # User votes
    fetched_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class UserStatsCache(Base):
    """Precomputed stats cache for users."""

    __tablename__ = "user_stats_cache"

    vndb_uid = Column(String(20), ForeignKey("cached_user_lists.vndb_uid"), primary_key=True)
    stats_json = Column(JSONB, nullable=False)
    computed_at = Column(DateTime, nullable=False)


class CFUserFactors(Base):
    """Collaborative filtering user latent factors."""

    __tablename__ = "cf_user_factors"

    user_hash = Column(String(64), primary_key=True)
    factors = Column(ARRAY(Float), nullable=False)
    computed_at = Column(DateTime, nullable=False)


class CFVNFactors(Base):
    """Collaborative filtering VN latent factors."""

    __tablename__ = "cf_vn_factors"

    vn_id = Column(String(10), ForeignKey("visual_novels.id"), primary_key=True)
    factors = Column(ARRAY(Float), nullable=False)
    computed_at = Column(DateTime, nullable=False)


class TagVNVector(Base):
    """Precomputed TF-IDF weighted tag vectors for VNs."""

    __tablename__ = "tag_vn_vectors"

    vn_id = Column(String(10), ForeignKey("visual_novels.id"), primary_key=True)
    tag_vector = Column(ARRAY(Float), nullable=False)
    computed_at = Column(DateTime, nullable=False)


# ============ Graph Neural Network Embeddings ============

class UserGraphEmbedding(Base):
    """User embeddings from HGAT graph neural network model.

    These embeddings are learned from the heterogeneous knowledge graph
    that captures relationships between users, VNs, tags, staff, etc.
    """

    __tablename__ = "user_graph_embeddings"

    user_hash = Column(String(64), primary_key=True)  # Links to global_votes user
    embedding = Column(ARRAY(Float), nullable=False)  # 128-dim vector
    model_version = Column(String(50), nullable=False)  # e.g., "hgat_v1"
    computed_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_user_graph_embed_version", "model_version"),
    )


class VNGraphEmbedding(Base):
    """VN embeddings from HGAT graph neural network model.

    These embeddings capture rich semantic information about VNs
    from their relationships with tags, staff, producers, characters, etc.
    """

    __tablename__ = "vn_graph_embeddings"

    vn_id = Column(String(10), ForeignKey("visual_novels.id"), primary_key=True)
    embedding = Column(ARRAY(Float), nullable=False)  # 128-dim vector
    model_version = Column(String(50), nullable=False)  # e.g., "hgat_v1"
    computed_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_vn_graph_embed_version", "model_version"),
    )


class SystemMetadata(Base):
    """System metadata for tracking update times and other info."""

    __tablename__ = "system_metadata"

    key = Column(String(100), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ Producer / Developer / Publisher Models ============

class Producer(Base):
    """Producers (developers & publishers) from VNDB."""

    __tablename__ = "producers"

    id = Column(String(10), primary_key=True)  # e.g., "p1"
    name = Column(String(500), nullable=False)
    original = Column(String(500))  # Original language name
    type = Column(String(50))  # "co" (company), "in" (individual), "ng" (amateur group)
    lang = Column(String(10))
    description = Column(Text)
    vn_count = Column(Integer, default=0)  # Precomputed: total VN count (any role)
    dev_vn_count = Column(Integer, default=0)  # Precomputed: VN count as developer
    pub_vn_count = Column(Integer, default=0)  # Precomputed: VN count as publisher

    __table_args__ = (
        Index("idx_producers_name", "name"),
        Index("idx_producers_type", "type"),
        Index("idx_producers_lang", "lang"),
        Index("idx_producers_vn_count", vn_count.desc().nullslast()),
    )


# ============ Staff Models ============

class Staff(Base):
    """Staff members (writers, artists, etc.)."""

    __tablename__ = "staff"

    id = Column(String(10), primary_key=True)  # e.g., "s1"
    name = Column(String(500), nullable=False)
    original = Column(String(500))
    lang = Column(String(10))
    gender = Column(String(10))
    description = Column(Text)
    vn_count = Column(Integer, default=0)  # Precomputed: COUNT(DISTINCT vn_id) from vn_staff
    roles = Column(ARRAY(Text))  # Precomputed: distinct roles from vn_staff
    seiyuu_vn_count = Column(Integer, default=0)  # Precomputed: COUNT(DISTINCT vn_id) from vn_seiyuu
    seiyuu_char_count = Column(Integer, default=0)  # Precomputed: COUNT(DISTINCT character_id) from vn_seiyuu

    __table_args__ = (
        Index("idx_staff_name", "name"),
        Index("idx_staff_lang", "lang"),
        Index("idx_staff_gender", "gender"),
        Index("idx_staff_vn_count", vn_count.desc().nullslast()),
        Index("idx_staff_seiyuu_vn_count", seiyuu_vn_count.desc().nullslast()),
    )


class VNStaff(Base):
    """VN-Staff relationship with role."""

    __tablename__ = "vn_staff"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    staff_id = Column(String(10), ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True)
    aid = Column(Integer)  # Alias ID for name variation
    role = Column(String(50), primary_key=True)  # "scenario", "art", "music", "songs", "director"
    note = Column(String(500))

    __table_args__ = (
        Index("idx_vn_staff_vn", "vn_id"),
        Index("idx_vn_staff_staff", "staff_id"),
        Index("idx_vn_staff_role", "role"),
        Index("idx_vn_staff_vn_role", "vn_id", "role"),  # Composite for role filtering
    )


# ============ Seiyuu (Voice Actor) Models ============

class VNSeiyuu(Base):
    """VN voice actor (seiyuu) credits."""

    __tablename__ = "vn_seiyuu"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    staff_id = Column(String(10), ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True)
    aid = Column(Integer)  # Alias ID
    character_id = Column(String(10), primary_key=True)  # Which character they voice
    note = Column(String(500))

    __table_args__ = (
        Index("idx_vn_seiyuu_vn", "vn_id"),
        Index("idx_vn_seiyuu_staff", "staff_id"),
    )


class VNRelation(Base):
    """VN-to-VN relationships (sequel, prequel, shares characters, etc.).

    Relations are stored bidirectionally in the VNDB dump:
    e.g., A->B as 'seq' and B->A as 'preq'.
    """

    __tablename__ = "vn_relations"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    related_vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    relation = Column(String(10), nullable=False)  # seq, preq, set, alt, char, side, par, ser, fan, orig
    official = Column(Boolean, default=True)

    __table_args__ = (
        Index("idx_vn_relations_vn", "vn_id"),
        Index("idx_vn_relations_related", "related_vn_id"),
    )


# ============ Character & Trait Models ============

class Trait(Base):
    """Character traits from VNDB."""

    __tablename__ = "traits"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    group_id = Column(Integer)
    group_name = Column(String(200))
    char_count = Column(Integer, default=0)
    aliases = Column(ARRAY(Text))
    searchable = Column(Boolean, default=True)
    applicable = Column(Boolean, default=True)

    __table_args__ = (
        Index("idx_traits_name", "name"),
        Index("idx_traits_group", "group_id"),
    )


class TraitParent(Base):
    """Many-to-many trait parent relationships (VNDB traits can have multiple parents)."""

    __tablename__ = "trait_parents"

    trait_id = Column(Integer, ForeignKey("traits.id", ondelete="CASCADE"), primary_key=True)
    parent_id = Column(Integer, ForeignKey("traits.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        Index("idx_trait_parents_parent_id", "parent_id"),
    )


class Character(Base):
    """Characters from VNDB."""

    __tablename__ = "characters"

    id = Column(String(10), primary_key=True)  # e.g., "c1"
    name = Column(String(500), nullable=False)
    original = Column(String(500))
    # Extended character data
    aliases = Column(ARRAY(Text))
    description = Column(Text)
    image_url = Column(String(500))
    image_sexual = Column(Float)  # 0=safe, 1=suggestive, 2=explicit
    sex = Column(String(10))  # "m", "f", "b" (both)
    blood_type = Column(String(20))  # "a", "b", "ab", "o", "unknown"
    height = Column(Integer)  # cm
    weight = Column(Integer)  # kg
    bust = Column(Integer)
    waist = Column(Integer)
    hips = Column(Integer)
    cup = Column(String(20))  # cup sizes can vary
    age = Column(Integer)
    birthday_month = Column(Integer)
    birthday_day = Column(Integer)

    __table_args__ = (
        Index("idx_characters_name", "name"),
    )


class CharacterVN(Base):
    """Character-VN relationship."""

    __tablename__ = "character_vn"

    character_id = Column(String(10), ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True)
    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String(20))  # "main", "primary", "side", "appears"
    spoiler_level = Column(Integer, default=0)  # 0=none, 1=minor, 2=major
    release_id = Column(String(10))

    __table_args__ = (
        Index("idx_character_vn_vn", "vn_id"),
        Index("idx_character_vn_char", "character_id"),
    )


class CharacterTrait(Base):
    """Character-Trait relationship."""

    __tablename__ = "character_traits"

    character_id = Column(String(10), ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True)
    trait_id = Column(Integer, ForeignKey("traits.id", ondelete="CASCADE"), primary_key=True)
    spoiler_level = Column(Integer, default=0)  # 0=none, 1=minor, 2=major

    __table_args__ = (
        Index("idx_character_traits_char", "character_id"),
        Index("idx_character_traits_trait", "trait_id"),
        Index("idx_character_traits_char_spoiler", "character_id", "spoiler_level"),  # Composite for filtered queries
    )


# ============ Release Models (for Publisher data) ============

class Release(Base):
    """VN releases from VNDB with comprehensive metadata."""

    __tablename__ = "releases"

    id = Column(String(10), primary_key=True)  # e.g., "r1"
    title = Column(String(500))
    released = Column(Date)
    minage = Column(Integer)
    # Extended fields
    gtin = Column(BigInteger)  # JAN/UPC/EAN/ISBN barcode
    olang = Column(String(10))  # Original/display language
    voiced = Column(SmallInteger)  # 0=not voiced, 1=partially, 2=fully
    reso_x = Column(SmallInteger)  # Resolution width
    reso_y = Column(SmallInteger)  # Resolution height
    has_ero = Column(Boolean, default=False)  # Contains erotic content
    patch = Column(Boolean, default=False)  # Is a patch release
    freeware = Column(Boolean, default=False)  # Free release
    doujin = Column(Boolean, default=False)  # Doujin/indie release
    uncensored = Column(Boolean, default=False)  # Uncensored version
    official = Column(Boolean, default=True)  # Official release
    catalog = Column(String(100))  # Catalog number
    notes = Column(Text)  # Release notes
    engine = Column(String(100))  # Game engine

    __table_args__ = (
        Index("idx_releases_released", "released"),
        Index("idx_releases_patch", "patch"),
        Index("idx_releases_freeware", "freeware"),
    )


class ReleaseVN(Base):
    """Release-VN relationship with release type."""

    __tablename__ = "release_vn"

    release_id = Column(String(10), ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    rtype = Column(String(20))  # "complete", "partial", "trial" - KEY for filtering

    __table_args__ = (
        Index("idx_release_vn_vn", "vn_id"),
        Index("idx_release_vn_release", "release_id"),
        Index("idx_release_vn_rtype", "rtype"),  # For filtering by release type
        Index("idx_release_vn_vn_rtype", "vn_id", "rtype"),  # Composite for VN + type queries
    )


class ReleaseProducer(Base):
    """Release-Producer relationship with developer/publisher flags."""

    __tablename__ = "release_producers"

    release_id = Column(String(10), ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    producer_id = Column(String(10), ForeignKey("producers.id", ondelete="CASCADE"), primary_key=True)
    developer = Column(Boolean, default=False)
    publisher = Column(Boolean, default=False)

    __table_args__ = (
        Index("idx_release_producers_release", "release_id"),
        Index("idx_release_producers_producer", "producer_id"),
        Index("idx_release_producers_publisher", "producer_id", "publisher"),  # For publisher queries
    )


class ReleasePlatform(Base):
    """Platforms a release is available on."""

    __tablename__ = "release_platforms"

    release_id = Column(String(10), ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    platform = Column(String(20), primary_key=True)  # win, lin, mac, ios, and, ps4, switch, etc.

    __table_args__ = (
        Index("idx_release_platforms_release", "release_id"),
        Index("idx_release_platforms_platform", "platform"),
    )


class ReleaseMedia(Base):
    """Physical media types for a release."""

    __tablename__ = "release_media"

    release_id = Column(String(10), ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    medium = Column(String(10), primary_key=True)  # cd, dvd, bd, usb, etc.
    quantity = Column(SmallInteger, default=1)

    __table_args__ = (
        Index("idx_release_media_release", "release_id"),
        Index("idx_release_media_medium", "medium"),
    )


class ReleaseExtlink(Base):
    """Release-level external links (junction table)."""

    __tablename__ = "release_extlinks"

    release_id = Column(String(10), primary_key=True)
    link_id = Column(Integer, primary_key=True)

    __table_args__ = (
        Index("idx_release_extlinks_release", "release_id"),
    )


class ExtlinksMaster(Base):
    """Master lookup table for all external links."""

    __tablename__ = "extlinks_master"

    id = Column(Integer, primary_key=True)
    site = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)

    __table_args__ = (
        Index("idx_extlinks_master_site", "site"),
    )


class VNExtlink(Base):
    """VN-level external links (junction table)."""

    __tablename__ = "vn_extlinks"

    vn_id = Column(String(10), primary_key=True)
    link_id = Column(Integer, primary_key=True)

    __table_args__ = (
        Index("idx_vn_extlinks_vn", "vn_id"),
    )


class WikidataEntry(Base):
    """Pre-resolved Wikidata entries from VNDB dump."""

    __tablename__ = "wikidata_entries"

    id = Column(Integer, primary_key=True)
    enwiki = Column(Text)
    jawiki = Column(Text)
    website = Column(Text)
    vndb = Column(Text)
    mobygames = Column(Text)
    mobygames_game = Column(Text)
    gamefaqs_game = Column(Text)
    gamefaqs_company = Column(Text)
    howlongtobeat = Column(Text)
    igdb_game = Column(Text)
    pcgamingwiki = Column(Text)
    giantbomb = Column(Text)
    steam = Column(Text)
    gog = Column(Text)
    lutris = Column(Text)
    wine = Column(Text)
    anidb_anime = Column(Text)
    ann_anime = Column(Text)
    acdb_source = Column(Text)


# ============ News Aggregation Models ============

class NewsItem(Base):
    """Aggregated news items from all sources."""

    __tablename__ = "news_items"

    id = Column(String(64), primary_key=True)  # e.g., "vndb-v12345", "rss-<hash>"
    source = Column(String(20), nullable=False)  # vndb, vndb_release, rss, twitter, announcement
    source_label = Column(String(100))  # Human-readable source name
    title = Column(String(500), nullable=False)
    summary = Column(Text)  # Description/excerpt
    url = Column(String(500))  # External link
    image_url = Column(String(500))  # Cover/thumbnail
    image_is_nsfw = Column(Boolean, default=False)  # NSFW flag for cover images
    published_at = Column(DateTime(timezone=True), nullable=False)
    fetched_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    tags = Column(ARRAY(String(50)))  # e.g., ["release", "announcement"]
    extra_data = Column(JSONB)  # Source-specific metadata (platforms, developers, etc.)
    is_hidden = Column(Boolean, default=False)  # Admin moderation flag

    __table_args__ = (
        Index("idx_news_source", "source"),
        Index("idx_news_published", published_at.desc()),
        Index("idx_news_hidden", "is_hidden"),
        Index("idx_news_source_published", "source", published_at.desc()),
    )


class Announcement(Base):
    """Custom admin announcements."""

    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    url = Column(String(500))
    image_url = Column(String(500))
    published_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True))  # Optional expiration
    is_active = Column(Boolean, default=True)
    created_by = Column(String(100))  # Admin username

    __table_args__ = (
        Index("idx_announcements_active", "is_active"),
        Index("idx_announcements_expires", "expires_at"),
    )


class RSSFeedConfig(Base):
    """Configurable RSS feed sources."""

    __tablename__ = "rss_feed_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)  # Human-readable name
    url = Column(String(500), nullable=False)  # RSS feed URL
    keywords = Column(ARRAY(Text))  # Include keywords (Japanese VN terms)
    exclude_keywords = Column(ARRAY(Text))  # Exclude keywords
    is_active = Column(Boolean, default=True)
    last_checked = Column(DateTime(timezone=True))
    check_interval_minutes = Column(Integer, default=60)

    __table_args__ = (
        Index("idx_rss_feeds_active", "is_active"),
    )


class PostedItemsTracker(Base):
    """Track posted items to prevent duplicates (90-day retention)."""

    __tablename__ = "posted_items_tracker"

    source = Column(String(20), primary_key=True)  # vndb, rss, twitter, etc.
    item_id = Column(String(100), primary_key=True)  # Source-specific ID
    posted_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("idx_posted_items_date", "posted_at"),
    )


# ============ Precomputed Similarity & Recommendation Cache ============

class VNSimilarity(Base):
    """Precomputed VN-VN similarity based on tag vectors.

    Stores top-K most similar VNs for each VN, enabling O(1) similar novels lookup.
    """

    __tablename__ = "vn_similarities"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    similar_vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    similarity_score = Column(Float, nullable=False)  # Cosine similarity 0-1
    computed_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_vn_sim_vn", "vn_id"),
        Index("idx_vn_sim_score", "vn_id", similarity_score.desc()),
    )


class UserRecommendationCache(Base):
    """Precomputed recommendation scores for active users.

    Caches combined scores to enable fast recommendations without
    running all recommenders on every request.
    """

    __tablename__ = "user_recommendation_cache"

    user_id = Column(String(20), primary_key=True)  # VNDB user ID
    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    combined_score = Column(Float, nullable=False)
    tag_score = Column(Float)
    cf_score = Column(Float)  # Legacy name for similar_games_score
    hgat_score = Column(Float)  # Legacy name for staff_score
    # New score columns (added to store all 8 signals)
    users_also_read_score = Column(Float)
    developer_score = Column(Float)
    seiyuu_score = Column(Float)
    trait_score = Column(Float)
    quality_score = Column(Float)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_user_rec_user", "user_id"),
        Index("idx_user_rec_score", "user_id", combined_score.desc()),
    )


class VNCoOccurrence(Base):
    """Item-item collaborative filtering based on co-rating patterns.

    Stores VN pairs that are frequently rated highly by the same users.
    Enables "users who liked X also liked Y" recommendations.
    """

    __tablename__ = "vn_cooccurrence"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    similar_vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    co_rating_score = Column(Float, nullable=False)  # Cosine similarity of user ratings
    user_count = Column(Integer, nullable=False)  # Number of users who rated both highly
    computed_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_vn_cooccur_vn", "vn_id"),
        Index("idx_vn_cooccur_score", "vn_id", co_rating_score.desc()),
    )


# ============ Import Tracking Models ============

class ImportRun(Base):
    """Tracks each import pipeline execution for admin monitoring."""

    __tablename__ = "import_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    status = Column(String(20), nullable=False, default="pending")  # pending, running, completed, failed, cancelled
    phase = Column(String(100))  # Current phase name (e.g., "Importing visual novels")
    current_step = Column(Integer, default=0)  # Current step number (0-21)
    total_steps = Column(Integer, default=21)  # Total steps in pipeline
    progress_percent = Column(Float, default=0.0)  # 0-100
    started_at = Column(DateTime(timezone=True))
    ended_at = Column(DateTime(timezone=True))
    error_message = Column(Text)
    triggered_by = Column(String(50), default="scheduled")  # scheduled, manual, api
    stats_json = Column(JSONB)  # {"vns_imported": 50000, "votes_imported": 10000000, ...}

    logs = relationship("ImportLog", back_populates="run", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_import_runs_status", "status"),
        Index("idx_import_runs_started", started_at.desc()),
    )


class ImportLog(Base):
    """Log entries for import runs, enabling detailed monitoring."""

    __tablename__ = "import_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("import_runs.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    level = Column(String(10), nullable=False)  # INFO, WARNING, ERROR
    message = Column(Text, nullable=False)
    phase = Column(String(100))  # Which import step this log belongs to
    extra_data = Column(JSONB)  # Optional structured data

    run = relationship("ImportRun", back_populates="logs")

    __table_args__ = (
        Index("idx_import_logs_run", "run_id"),
        Index("idx_import_logs_level", "level"),
        Index("idx_import_logs_timestamp", "timestamp"),
    )


# ============ Application Logging Models ============

class AppLog(Base):
    """General application logs for admin monitoring (backend + frontend)."""

    __tablename__ = "app_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    level = Column(String(10), nullable=False)  # DEBUG, INFO, WARNING, ERROR
    source = Column(String(20), nullable=False)  # "backend" or "frontend"
    module = Column(String(200))  # Logger name / component name
    message = Column(Text, nullable=False)

    # Frontend-specific fields
    url = Column(String(500))  # Page URL where error occurred
    user_agent = Column(String(500))
    stack_trace = Column(Text)

    # Error grouping (for deduplication)
    error_hash = Column(String(64), index=True)  # SHA256 of normalized error
    occurrence_count = Column(Integer, default=1)  # Number of occurrences
    first_seen = Column(DateTime(timezone=True))
    last_seen = Column(DateTime(timezone=True))

    # Extra context
    extra_data = Column(JSONB)

    # Request tracing
    correlation_id = Column(String(64), index=True)  # For tracing requests across frontend-backend

    __table_args__ = (
        Index("idx_app_logs_timestamp", timestamp.desc()),
        Index("idx_app_logs_source_level", "source", "level"),
        Index("idx_app_logs_level", "level"),
        Index("idx_app_logs_source", "source"),
    )


# ============ Cover Blacklist Models ============

class CoverBlacklistConfig(Base):
    """Configuration rules for automatic cover blacklisting.

    Rules can combine tag conditions (up to 3 tags with AND logic),
    age rating conditions (any 18+ or only 18+), and a votecount threshold.
    At least one condition (tag or age) must be set.
    """

    __tablename__ = "cover_blacklist_config"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Tag conditions (AND logic when multiple present)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True)
    tag_id_2 = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True)
    tag_id_3 = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True)

    # Age rating condition: NULL, 'any_18plus', or 'only_18plus'
    age_condition = Column(String(20), nullable=True)

    votecount_threshold = Column(Integer, nullable=False)
    min_tag_score = Column(Float, default=1.5)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))

    # Relationships
    tag = relationship("Tag", foreign_keys=[tag_id])
    tag2 = relationship("Tag", foreign_keys=[tag_id_2])
    tag3 = relationship("Tag", foreign_keys=[tag_id_3])

    @property
    def tag_ids_list(self) -> list[int]:
        """Return non-None tag IDs as a list."""
        return [t for t in [self.tag_id, self.tag_id_2, self.tag_id_3] if t is not None]

    @property
    def age_condition_label(self) -> str:
        """Human-readable age condition label."""
        labels = {"any_18plus": "any 18+", "only_18plus": "only 18+"}
        return labels.get(self.age_condition, "none")

    __table_args__ = (
        Index("idx_blacklist_config_tag", "tag_id"),
        Index("idx_blacklist_config_active", "is_active"),
        CheckConstraint(
            "tag_id IS NOT NULL OR age_condition IS NOT NULL",
            name="ck_blacklist_config_has_condition",
        ),
    )


class CoverBlacklist(Base):
    """Blacklisted VN covers (both manual and auto-blacklisted).

    Covers for VNs in this table will be replaced with a placeholder image.
    - reason='manual': Added manually by admin
    - reason='auto_tag': Added automatically based on tag rules
    """

    __tablename__ = "cover_blacklist"

    vn_id = Column(String(10), ForeignKey("visual_novels.id", ondelete="CASCADE"), primary_key=True)
    reason = Column(String(50), nullable=False)  # 'manual' or 'auto_tag'
    tag_ids = Column(ARRAY(Integer))  # Tags that triggered auto-blacklist
    added_at = Column(DateTime(timezone=True), nullable=False)
    added_by = Column(String(100))  # Admin username for manual entries
    notes = Column(Text)

    # Relationship
    visual_novel = relationship("VisualNovel")

    __table_args__ = (
        Index("idx_cover_blacklist_reason", "reason"),
    )
