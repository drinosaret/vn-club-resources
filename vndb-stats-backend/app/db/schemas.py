"""Pydantic schemas for API request/response validation."""

from datetime import date, datetime
from pydantic import BaseModel, Field


# ============ User Schemas ============

class UserLookupResponse(BaseModel):
    """Response for user lookup by username."""
    uid: str
    username: str


class UserProfileResponse(BaseModel):
    """User profile information."""
    uid: str
    username: str
    list_public: bool = True


class UserVNListItemImage(BaseModel):
    """Image information for a VN in user's list."""
    url: str
    sexual: float | None = None


class UserVNListItemVN(BaseModel):
    """VN metadata for user's list item."""
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image: UserVNListItemImage | None = None
    rating: float | None = None
    released: str | None = None
    olang: str | None = None


class UserVNListItemLabel(BaseModel):
    """Label information for a VN in user's list."""
    id: int
    label: str | None = None


class UserVNListItem(BaseModel):
    """Single VN in user's list with metadata."""
    id: str  # VN ID
    vote: int | None = None  # User's vote (10-100 scale)
    labels: list[UserVNListItemLabel] = []
    added: int | None = None  # Unix timestamp
    started: str | None = None  # ISO date
    finished: str | None = None  # ISO date
    vn: UserVNListItemVN | None = None


class UserVNListResponse(BaseModel):
    """Paginated user VN list response."""
    items: list[UserVNListItem]
    total: int
    page: int
    limit: int
    has_more: bool


# ============ Stats Schemas ============

class StatsSummary(BaseModel):
    """Summary statistics for a user."""
    total_vns: int
    completed: int
    playing: int
    dropped: int
    wishlist: int
    total_votes: int
    average_score: float
    score_stddev: float
    estimated_hours: int
    # New fields for vnstat.net-style display
    global_average: float | None = None  # Global avg score for comparison
    user_vs_global_diff: float | None = None  # e.g., +0.45
    score_min: float | None = None  # User's lowest score
    score_max: float | None = None  # User's highest score
    average_hours_per_vn: float | None = None  # Avg reading time per VN
    vns_with_length_data: int | None = None  # How many VNs have length info (for context)


class CategoryStats(BaseModel):
    """Stats for a single category (length or age rating)."""
    count: int
    avg_rating: float
    jp_count: int = 0  # Count of Japanese-original VNs (olang='ja')


class YearWithRating(BaseModel):
    """Release year with count and average rating."""
    year: int
    count: int
    avg_rating: float
    jp_count: int = 0  # Count of Japanese-original VNs (olang='ja')


class MonthlyActivity(BaseModel):
    """Monthly reading activity for trends charts."""
    month: str  # "YYYY-MM"
    completed: int  # VNs finished this month
    added: int  # VNs added to list this month
    hours: int  # Estimated hours for VNs finished
    avg_score: float | None  # Average user score for VNs finished


class UserInfo(BaseModel):
    """Basic user info."""
    uid: str
    username: str


class UserStatsResponse(BaseModel):
    """Complete user statistics response."""
    user: UserInfo
    summary: StatsSummary
    score_distribution: dict[str, int]
    release_year_distribution: dict[str, int]
    monthly_activity: list[MonthlyActivity]
    length_distribution: dict[str, int]
    platform_breakdown: dict[str, int]
    # New extended stats for vnstat.net-style charts
    length_distribution_detailed: dict[str, CategoryStats] | None = None  # with avg ratings
    age_rating_distribution: dict[str, CategoryStats] | None = None  # with avg ratings
    release_year_with_ratings: list[YearWithRating] | None = None  # for dual-axis chart
    # Detailed breakdowns for tabs (using forward references for schemas defined later)
    developers_breakdown: list["ProducerBreakdown"] | None = None
    publishers_breakdown: list["ProducerBreakdown"] | None = None
    staff_breakdown: list["StaffBreakdown"] | None = None
    seiyuu_breakdown: list["SeiyuuBreakdown"] | None = None
    traits_breakdown: list["TraitBreakdown"] | None = None
    last_updated: datetime | None = None  # When this data was last refreshed


class TagStats(BaseModel):
    """Statistics for a single tag."""
    tag_id: int
    name: str
    count: int
    avg_score: float
    bayesian_score: float | None = None  # Damped mean score for ranking
    weighted_score: float | None = None  # bayesian * log2(count+1) for confidence-weighted ranking
    global_avg_score: float | None = None  # VNDB's global avg for this tag


class TagPreference(BaseModel):
    """Tag preference comparison."""
    tag_id: int
    name: str
    user_avg: float
    global_avg: float


class TagAnalyticsResponse(BaseModel):
    """Tag analytics for a user."""
    top_tags: list[TagStats]
    tag_preferences: dict[str, list[TagPreference]]  # "loved" and "avoided"
    tag_trends: list[dict]
    tag_comparison_to_global: dict[str, list[str]]


class SharedVNScore(BaseModel):
    """A VN with scores from two users."""
    vn_id: str
    title: str
    image_url: str | None
    user1_score: float
    user2_score: float


class UserComparisonResponse(BaseModel):
    """Comparison between two users."""
    user1: UserInfo
    user2: UserInfo
    compatibility_score: float
    shared_vns: int
    score_correlation: float
    shared_favorites: list[SharedVNScore]
    biggest_disagreements: list[SharedVNScore]
    common_tags: list[str]
    differing_tastes: dict[str, list[str]]
    # Enhanced comparison metrics
    tag_similarity: float | None = None  # 0-1 tag preference similarity
    confidence: float | None = None  # 0-1 reliability of comparison
    jaccard_similarity: float | None = None  # List overlap metric
    cosine_similarity: float | None = None  # Rating vector similarity
    rating_agreement: float | None = None  # 0-1 how closely shared VNs are rated


class SimilarUserResponse(BaseModel):
    """A similar user with similarity metrics."""
    uid: str
    username: str
    compatibility: float  # 0-1 similarity score
    shared_vns: int
    tag_similarity: float | None = None
    total_vns: int
    avg_score: float | None = None


class GlobalStatsResponse(BaseModel):
    """Global database statistics."""
    total_vns: int
    total_with_ratings: int
    average_rating: float
    score_distribution: dict[str, int]
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


# ============ VN Schemas ============

class VNTagInfo(BaseModel):
    """Tag information for a VN."""
    id: str  # Format: "g123" for compatibility with tag detail pages
    name: str
    category: str | None
    score: float
    spoiler: int  # 0=none, 1=minor, 2=major
    vn_count: int = 0  # Number of VNs with this tag (for IDF calculation)


class VNRelationInfo(BaseModel):
    """Related VN information for VN detail pages."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    relation: str  # seq, preq, set, alt, char, side, par, ser, fan, orig
    relation_official: bool = True
    image_url: str | None = None
    image_sexual: float | None = None
    rating: float | None = None
    olang: str | None = None


class VNSummary(BaseModel):
    """Brief VN information for lists."""
    id: str
    title: str
    title_jp: str | None = None      # Original Japanese title (kanji/kana)
    title_romaji: str | None = None  # Romanized title
    image_url: str | None
    image_sexual: float | None = None
    released: date | None
    rating: float | None
    votecount: int
    olang: str | None = None  # Original language (e.g., "ja" for Japanese)


class TopVN(BaseModel):
    """Top VN entry for highest rated / most popular lists."""
    id: str
    title: str
    alttitle: str | None = None      # Alternative title (usually Japanese)
    image_url: str | None = None
    image_sexual: float | None = None
    released: str | None = None      # ISO date string
    rating: float | None = None
    votecount: int | None = None
    rank: int
    olang: str | None = None


class VNWithTags(BaseModel):
    """VN with full tag information for weighted sorting."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    released: str | None = None  # ISO date string
    rating: float | None = None
    votecount: int = 0
    olang: str | None = None
    tags: list[VNTagInfo]


class DeveloperInfo(BaseModel):
    """Developer/producer basic info."""
    id: str
    name: str  # Romaji/Latin name
    original: str | None = None  # Original language name (Japanese, etc.)


class VNDetailResponse(BaseModel):
    """Detailed VN information."""
    id: str
    title: str
    title_jp: str | None = None      # Original Japanese title (kanji/kana)
    title_romaji: str | None = None  # Romanized title
    description: str | None
    image_url: str | None
    image_sexual: float | None = None
    released: date | None
    length: int | None
    rating: float | None
    votecount: int
    languages: list[str]
    platforms: list[str]
    developers: list[DeveloperInfo]
    tags: list[VNTagInfo]
    relations: list[VNRelationInfo] = []
    olang: str | None = None  # Original language (e.g., "ja" for Japanese)
    updated_at: datetime | None = None


class VNSearchResponse(BaseModel):
    """Search results for VNs."""
    results: list[VNSummary]
    total: int
    total_with_spoilers: int | None = None  # Total count including all spoiler levels (when tag/trait filtering)
    page: int
    pages: int
    query_time: float | None = None  # Query execution time in seconds


class VNListByCategoryResponse(BaseModel):
    """Paginated list of VNs for a specific category filter."""
    vns: list[VNSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


# ============ Recommendation Schemas ============

class Recommendation(BaseModel):
    """Single recommendation with explanation."""
    vn_id: str
    title: str
    title_jp: str | None = None      # Original Japanese title (kanji/kana)
    title_romaji: str | None = None  # Romanized title
    image_url: str | None
    image_sexual: float | None = None  # For NSFW blur
    rating: float | None
    released: date | None
    score: float = Field(description="Recommendation confidence 0-1")
    reasons: list[str]
    tag_match_score: float | None = None
    cf_score: float | None = None
    olang: str | None = None  # Original language
    length: int | None = None  # 1-5 scale
    # Method-specific matched entities
    matched_tags: list[str] | None = None
    matched_traits: list[str] | None = None
    matched_staff: list[str] | None = None
    matched_seiyuu: list[str] | None = None  # Voice actors (separate from staff)
    matched_producer: str | None = None
    # Source traceability for specific methods
    similar_to_titles: list[str] | None = None  # For Similar Novels: which favorites this is similar to
    similar_user_count: int | None = None  # For Similar Users: how many similar users liked this
    # Multi-signal combined recommendations
    methods_matched: int | None = None  # How many recommendation methods scored this VN
    signal_scores: dict[str, float] | None = None  # Individual scores from each method


class RecommendationsResponse(BaseModel):
    """Recommendations response."""
    method: str
    recommendations: list[Recommendation]
    excluded_count: int
    # Detailed exclusion breakdown
    dropped_count: int = 0
    blacklisted_count: int = 0
    total_excluded_message: str | None = None


class SimilarVN(BaseModel):
    """Similar VN entry."""
    vn_id: str
    title: str
    title_jp: str | None = None      # Original Japanese title (kanji/kana)
    title_romaji: str | None = None  # Romanized title
    image_url: str | None
    image_sexual: float | None = None
    rating: float | None
    similarity: float
    olang: str | None = None  # Original language
    user_count: int | None = None  # For collaborative filtering: number of users who rated both highly


class SimilarVNsResponse(BaseModel):
    """Similar VNs response with separate content-based and collaborative filtering results."""
    content_similar: list[SimilarVN]  # Tag-based cosine similarity
    users_also_read: list[SimilarVN]  # Collaborative filtering based on user ratings


# ============ Tag Detail Schemas ============

class TagDetailResponse(BaseModel):
    """Tag detail information."""
    id: str  # Format: "g123"
    name: str
    description: str | None
    category: str | None
    vn_count: int
    aliases: list[str] | None


class TagStatsResponse(BaseModel):
    """Statistics for all VNs with a specific tag."""
    tag: TagDetailResponse
    average_rating: float
    total_votes: int  # Sum of all vote counts
    total_vns: int  # VNs with this tag that have ratings
    score_distribution: dict[str, int]
    score_distribution_jp: dict[str, int] | None = None  # JP-original VN counts per score
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


class TagVNsWithTagsResponse(BaseModel):
    """VNs with a specific tag, including full tag data for each VN."""
    tag: TagDetailResponse
    vns: list[VNWithTags]
    total: int
    page: int
    pages: int


# ============ Trait Detail Schemas ============

class TraitDetailResponse(BaseModel):
    """Trait detail information."""
    id: str  # Format: "i123"
    name: str
    description: str | None
    group_id: int | None
    group_name: str | None
    char_count: int
    aliases: list[str] | None
    applicable: bool = True  # False for meta/category traits that can't be directly applied


class TraitStatsResponse(BaseModel):
    """Statistics for all VNs with characters having a specific trait."""
    trait: TraitDetailResponse
    average_rating: float
    total_votes: int  # Sum of all vote counts
    total_vns: int  # VNs with this trait that have ratings
    score_distribution: dict[str, int]
    score_distribution_jp: dict[str, int] | None = None  # JP-original VN counts per score
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


class TraitVNsWithTagsResponse(BaseModel):
    """Paginated list of VNs with a trait, including full tag data for each VN."""
    vns: list[VNWithTags]
    total: int
    page: int
    pages: int


# ============ Producer Detail Schemas ============

class ProducerDetailResponse(BaseModel):
    """Producer detail information."""
    id: str  # Format: "p123"
    name: str
    original: str | None  # Original language name
    type: str | None  # "co" (company), "in" (individual), "ng" (amateur group)
    lang: str | None  # Primary language
    description: str | None
    vn_count: int
    aliases: list[str] | None


class ProducerStatsResponse(BaseModel):
    """Statistics for all VNs by a specific producer/developer."""
    producer: ProducerDetailResponse
    average_rating: float | None
    bayesian_rating: float | None  # Damped rating for fair comparison
    total_votes: int  # Sum of all vote counts
    total_vns: int  # VNs by this producer that have ratings
    score_distribution: dict[str, int]
    score_distribution_jp: dict[str, int] | None = None  # JP-original VN counts per score
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


class SimilarProducerResponse(BaseModel):
    """Similar producer based on VN/tag overlap."""
    id: str
    name: str
    original: str | None = None  # Romanized/latin name
    type: str | None
    vn_count: int
    shared_vns: int  # Number of VNs in common (via staff, tags, etc.)
    similarity: float  # 0-100 percentage


class ProducerVNsResponse(BaseModel):
    """Paginated list of VNs by a producer."""
    vns: list[VNSummary]
    total: int
    page: int
    pages: int


class ProducerVNsWithTagsResponse(BaseModel):
    """Paginated list of VNs by a producer, with full tag data for each VN."""
    vns: list[VNWithTags]
    total: int
    page: int
    pages: int


# ============ Staff Detail Schemas ============

class StaffDetailResponse(BaseModel):
    """Staff member detail information."""
    id: str  # Format: "s123"
    name: str
    original: str | None = None  # Original language name
    lang: str | None = None  # Primary language
    gender: str | None = None
    description: str | None = None
    vn_count: int = 0


class StaffStatsResponse(BaseModel):
    """Statistics for all VNs a staff member worked on."""
    staff: StaffDetailResponse
    average_rating: float | None
    bayesian_rating: float | None  # Damped rating for fair comparison
    total_votes: int  # Sum of all vote counts
    total_vns: int  # VNs this staff worked on that have ratings
    role_breakdown: dict[str, int]  # role -> count
    score_distribution: dict[str, int]
    score_distribution_jp: dict[str, int] | None = None  # JP-original VN counts per score
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


class StaffVNsResponse(BaseModel):
    """Paginated list of VNs a staff member worked on."""
    vns: list[VNSummary]
    total: int
    page: int
    pages: int


class StaffVNsWithTagsResponse(BaseModel):
    """Paginated list of VNs a staff member worked on, with full tag data for each VN."""
    vns: list[VNWithTags]
    total: int
    page: int
    pages: int


# ============ Seiyuu Detail Schemas ============

class SeiyuuStatsResponse(BaseModel):
    """Statistics for all VNs a voice actor appeared in."""
    staff: StaffDetailResponse
    average_rating: float | None
    bayesian_rating: float | None  # Damped rating for fair comparison
    total_votes: int  # Sum of all vote counts
    total_vns: int  # VNs this seiyuu voiced in that have ratings
    character_count: int  # Number of characters voiced
    score_distribution: dict[str, int]
    score_distribution_jp: dict[str, int] | None = None  # JP-original VN counts per score
    release_year_distribution: dict[str, int]
    release_year_with_ratings: list[YearWithRating]
    length_distribution: dict[str, CategoryStats]
    age_rating_distribution: dict[str, CategoryStats]
    last_updated: datetime | None = None  # When this data was last refreshed


class SeiyuuVNsResponse(BaseModel):
    """Paginated list of VNs a voice actor appeared in."""
    vns: list[VNSummary]
    total: int
    page: int
    pages: int


class SeiyuuVNsWithTagsResponse(BaseModel):
    """Paginated list of VNs a voice actor appeared in, with full tag data for each VN."""
    vns: list[VNWithTags]
    total: int
    page: int
    pages: int


class SeiyuuCharacterVNInfo(BaseModel):
    """VN info for a character voiced by a seiyuu."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None


class SeiyuuVoicedCharacter(BaseModel):
    """A character voiced by a seiyuu, with their VN appearances."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    sex: str | None = None
    vn_count: int = 0
    vns: list[SeiyuuCharacterVNInfo]
    note: str | None = None


class SeiyuuCharactersResponse(BaseModel):
    """Paginated list of characters voiced by a seiyuu."""
    characters: list[SeiyuuVoicedCharacter]
    total: int
    page: int
    pages: int


# ============ Trait Characters Schemas ============

class TraitCharacterVNInfo(BaseModel):
    """VN info for a character with a trait."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    olang: str | None = None


class TraitCharacter(BaseModel):
    """A character with a specific trait."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    sex: str | None = None
    vns: list[TraitCharacterVNInfo]


class TraitCharactersResponse(BaseModel):
    """Paginated list of characters with a specific trait."""
    characters: list[TraitCharacter]
    total: int
    page: int
    pages: int


# ============ User Stats Breakdown Schemas ============

class ProducerBreakdown(BaseModel):
    """Developer or publisher statistics for a user."""
    id: str  # e.g., "p1"
    name: str
    original: str | None = None  # Romanized/latin name
    type: str | None  # "co" (company), "in" (individual), "ng" (amateur group)
    count: int  # Number of VNs from this producer
    avg_rating: float  # User's average rating for VNs from this producer
    global_avg_rating: float | None = None  # Global average rating for VNs from this producer
    weighted_score: float | None = None  # Bayesian-weighted score for ranking


class StaffBreakdown(BaseModel):
    """Staff member statistics for a user."""
    id: str  # e.g., "s1"
    name: str
    original: str | None = None  # Romanized/latin name
    role: str  # "scenario", "art", "music", "songs", "director"
    count: int  # Number of VNs this staff worked on
    avg_rating: float  # User's average rating for VNs this staff worked on
    global_avg_rating: float | None = None  # Global average rating for VNs this staff worked on
    weighted_score: float | None = None  # Bayesian-weighted score for ranking


class SeiyuuBreakdown(BaseModel):
    """Voice actor (seiyuu) statistics for a user."""
    id: str  # Staff ID, e.g., "s1"
    name: str
    original: str | None = None  # Romanized/latin name
    count: int  # Number of VNs this seiyuu voiced in
    avg_rating: float  # User's average rating for VNs this seiyuu voiced in
    global_avg_rating: float | None = None  # Global average rating for VNs this seiyuu voiced in
    weighted_score: float | None = None  # Bayesian-weighted score for ranking


class TraitBreakdown(BaseModel):
    """Character trait statistics for a user."""
    id: int
    name: str
    group_name: str | None  # Trait category (e.g., "Hair", "Eyes", "Personality")
    count: int  # Number of characters with this trait in user's VNs
    vn_count: int  # Number of VNs with characters having this trait
    frequency: float  # Percentage of user's VNs that have this trait (0-100)
    avg_rating: float | None = None  # User's average rating for VNs with this trait
    global_avg_rating: float | None = None  # Global average rating for VNs with this trait
    weighted_score: float | None = None  # Bayesian-weighted score for ranking


# Rebuild models to resolve forward references
UserStatsResponse.model_rebuild()


# ============ News Schemas ============

from enum import Enum
from typing import Any


class NewsSource(str, Enum):
    """Available news sources."""
    vndb = "vndb"
    vndb_release = "vndb_release"
    rss = "rss"
    twitter = "twitter"
    announcement = "announcement"


class NewsItemResponse(BaseModel):
    """Single news item response."""
    id: str
    source: str
    sourceLabel: str
    title: str
    summary: str | None
    url: str | None
    imageUrl: str | None
    imageIsNsfw: bool = False
    publishedAt: datetime
    tags: list[str] | None
    extraData: dict[str, Any] | None = None

    class Config:
        from_attributes = True


class NewsDigestItem(BaseModel):
    """A digest card containing multiple news items grouped by date."""
    type: str = "digest"
    id: str  # e.g., "digest-vndb-2026-01-16"
    source: str
    sourceLabel: str
    title: str  # e.g., "Newly Added to VNDB - January 16, 2026"
    date: str  # ISO date string
    count: int
    items: list[NewsItemResponse]
    publishedAt: datetime
    # Preview data for the card
    previewImages: list[str]  # First 3-4 cover images


class NewsListItem(BaseModel):
    """Union type for news feed items - either individual or digest."""
    type: str = "item"  # "item" or "digest"
    # Fields for individual items
    id: str | None = None
    source: str | None = None
    sourceLabel: str | None = None
    title: str | None = None
    summary: str | None = None
    url: str | None = None
    imageUrl: str | None = None
    imageIsNsfw: bool = False
    publishedAt: datetime | None = None
    tags: list[str] | None = None
    extraData: dict[str, Any] | None = None
    # Fields for digest items
    date: str | None = None
    count: int | None = None
    items: list[NewsItemResponse] | None = None
    previewImages: list[str] | None = None


class NewsListResponse(BaseModel):
    """Paginated news list response."""
    items: list[NewsListItem]
    total: int
    page: int
    pages: int
    sources: dict[str, int]  # Count per source


class NewsSourceInfo(BaseModel):
    """Information about a news source."""
    id: str
    label: str
    count: int


class NewsSourcesResponse(BaseModel):
    """List of available news sources with counts."""
    sources: list[NewsSourceInfo]
    total: int


class AnnouncementCreate(BaseModel):
    """Create a new announcement."""
    title: str
    content: str | None = None
    url: str | None = None
    imageUrl: str | None = None
    expiresAt: datetime | None = None


class AnnouncementUpdate(BaseModel):
    """Update an announcement."""
    title: str | None = None
    content: str | None = None
    url: str | None = None
    imageUrl: str | None = None
    expiresAt: datetime | None = None
    isActive: bool | None = None


class AnnouncementResponse(BaseModel):
    """Announcement response."""
    id: int
    title: str
    content: str | None
    url: str | None
    imageUrl: str | None
    publishedAt: datetime
    expiresAt: datetime | None
    isActive: bool
    createdBy: str | None

    class Config:
        from_attributes = True


class RSSFeedConfigCreate(BaseModel):
    """Create a new RSS feed config."""
    name: str
    url: str
    keywords: list[str] | None = None
    excludeKeywords: list[str] | None = None
    isActive: bool = True
    checkIntervalMinutes: int = 60


class RSSFeedConfigUpdate(BaseModel):
    """Update an RSS feed config."""
    name: str | None = None
    url: str | None = None
    keywords: list[str] | None = None
    excludeKeywords: list[str] | None = None
    isActive: bool | None = None
    checkIntervalMinutes: int | None = None


class RSSFeedConfigResponse(BaseModel):
    """RSS feed config response."""
    id: int
    name: str
    url: str
    keywords: list[str] | None
    excludeKeywords: list[str] | None
    isActive: bool
    lastChecked: datetime | None
    checkIntervalMinutes: int

    class Config:
        from_attributes = True


# ============ Tag/Trait Search Schemas ============

class TagTraitSearchResult(BaseModel):
    """Single result from tag/trait search."""
    id: int
    name: str
    type: str  # "tag" or "trait"
    category: str | None  # For tags: content/technical/sexual; for traits: group_name
    count: int  # vn_count for tags, char_count for traits


class TagTraitSearchResponse(BaseModel):
    """Response for combined tag/trait search."""
    results: list[TagTraitSearchResult]
    total_tags: int
    total_traits: int


class FilterSearchResult(BaseModel):
    """Single result from combined filter search (tags, traits, staff, seiyuu, developers, publishers)."""
    id: str  # String to support both numeric tag IDs and prefixed entity IDs (s123, p456)
    name: str
    original: str | None = None  # Romanized/latin name for staff/producers (used when user prefers EN display)
    type: str  # "tag", "trait", "staff", "seiyuu", "developer", "publisher"
    category: str | None = None  # For tags: content/technical/sexual; for traits: group_name; for entities: role info
    count: int  # vn_count for tags/staff/producers, char_count for traits


class FilterSearchResponse(BaseModel):
    """Response for combined filter search."""
    results: list[FilterSearchResult]


# ============ Character Schemas ============

class CharacterTraitInfo(BaseModel):
    """Trait information for a character."""
    id: str  # Format: "i123"
    name: str
    group_id: int | None = None
    group_name: str | None = None
    spoiler: int  # 0=none, 1=minor, 2=major


class CharacterVNInfo(BaseModel):
    """VN information for a character's appearances."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    role: str  # "main", "primary", "side", "appears"
    image_url: str | None = None
    image_sexual: float | None = None


class VoiceActorInfo(BaseModel):
    """Voice actor information for a character."""
    id: str  # Staff ID
    name: str
    original: str | None = None
    note: str | None = None


class CharacterDetailResponse(BaseModel):
    """Full character details response."""
    id: str
    name: str
    original: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    sex: str | None = None
    blood_type: str | None = None
    height: int | None = None
    weight: int | None = None
    bust: int | None = None
    waist: int | None = None
    hips: int | None = None
    cup: str | None = None
    age: int | None = None
    birthday: list[int] | None = None  # [month, day]
    traits: list[CharacterTraitInfo]
    vns: list[CharacterVNInfo]
    voiced_by: list[VoiceActorInfo]


class VNCharacterResponse(BaseModel):
    """Character information for a VN's character list."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    role: str
    spoiler: int = 0  # 0=none, 1=minor, 2=major (character's role as spoiler)
    traits: list[CharacterTraitInfo]


class SimilarCharacterResponse(BaseModel):
    """Similar character based on shared traits."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    similarity: float  # 0-1
    shared_traits: list[str]  # Trait names
    vn_title: str | None = None  # Primary VN for context
    vn_title_jp: str | None = None  # Japanese title of primary VN
    vn_title_romaji: str | None = None  # Romanized title of primary VN
    olang: str | None = None  # Original language of primary VN


# ============ Browse Schemas ============

class BrowseTagItem(BaseModel):
    """A tag in browse results."""
    id: int
    name: str
    description: str | None = None
    category: str | None = None
    vn_count: int = 0

class BrowseTraitItem(BaseModel):
    """A trait in browse results."""
    id: int
    name: str
    description: str | None = None
    group_name: str | None = None
    char_count: int = 0

class BrowseStaffItem(BaseModel):
    """A staff member in browse results."""
    id: str
    name: str
    original: str | None = None
    gender: str | None = None
    lang: str | None = None
    vn_count: int = 0
    roles: list[str] = []
    description: str | None = None

class BrowseSeiyuuItem(BaseModel):
    """A voice actor in browse results."""
    id: str
    name: str
    original: str | None = None
    gender: str | None = None
    lang: str | None = None
    vn_count: int = 0
    character_count: int = 0
    description: str | None = None

class BrowseProducerItem(BaseModel):
    """A producer (developer or publisher) in browse results."""
    id: str
    name: str
    original: str | None = None
    type: str | None = None
    lang: str | None = None
    vn_count: int = 0
    description: str | None = None

class BrowseTagsResponse(BaseModel):
    """Paginated browse results for tags."""
    items: list[BrowseTagItem]
    total: int
    page: int
    pages: int

class BrowseTraitsResponse(BaseModel):
    """Paginated browse results for traits."""
    items: list[BrowseTraitItem]
    total: int
    page: int
    pages: int

class BrowseStaffResponse(BaseModel):
    """Paginated browse results for staff."""
    items: list[BrowseStaffItem]
    total: int
    page: int
    pages: int

class BrowseSeiyuuResponse(BaseModel):
    """Paginated browse results for seiyuu."""
    items: list[BrowseSeiyuuItem]
    total: int
    page: int
    pages: int

class BrowseProducersResponse(BaseModel):
    """Paginated browse results for producers."""
    items: list[BrowseProducerItem]
    total: int
    page: int
    pages: int
