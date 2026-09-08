"""Pydantic schemas for API request/response validation."""

from datetime import date, datetime
from pydantic import BaseModel


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
    #: The database's own title, which for a Japanese work is the Japanese form. The other
    #: two travel with it so the client can honour the reader's title setting.
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image_url: str | None
    user1_score: float
    user2_score: float


class UserComparisonResponse(BaseModel):
    """Comparison between two users."""
    user1: UserInfo
    user2: UserInfo
    compatibility_score: float
    shared_vns: int
    score_correlation: float | None = None  # Undefined without enough shared rated titles
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
    description: str | None = None  # Truncated description snippet (for search results)
    metric_value: float | None = None  # Value of the ranking metric, when sorting by one


class TopVN(BaseModel):
    """Top VN entry for highest rated / most popular lists."""
    id: str
    title: str
    alttitle: str | None = None      # Alternative title (usually Japanese)
    title_romaji: str | None = None  # Romanized title
    image_url: str | None = None
    image_sexual: float | None = None
    released: str | None = None      # ISO date string
    rating: float | None = None
    votecount: int | None = None
    rank: int
    olang: str | None = None


class ProducerCredit(BaseModel):
    """A studio credit carrying both scripts.

    Which one a reader sees is a browser setting, so a payload that carries only one
    forces every surface reading it to show the same script to everyone.
    """
    name: str
    original: str | None = None  # Romanized/latin name, where the catalogue has one


class UpcomingRelease(BaseModel):
    """A title whose first release has not happened yet."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    released: str                    # ISO date, clamped where the dump was imprecise
    date_precision: str              # day, month or year: how much of it was announced
    developers: list[ProducerCredit] = []
    platforms: list[str] = []
    languages: list[str] = []
    japanese: bool = False           # has, or is due, a Japanese release
    minage: int | None = None


class UpcomingReleasesResponse(BaseModel):
    """Upcoming releases in date order, with the day they were selected against."""
    as_of: str                       # ISO date the cutoff was taken from
    total: int
    items: list[UpcomingRelease]


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
    name: str  # As the catalogue writes it, which for a Japanese studio is Japanese
    original: str | None = None  # Romanized/latin name, where the catalogue has one


class ExtlinkInfo(BaseModel):
    """External link with resolved URL."""
    site: str
    url: str
    label: str


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
    links: list[ExtlinkInfo] = []
    shops: list[ExtlinkInfo] = []


class VNMonthlyVotes(BaseModel):
    """Monthly vote count for time series."""
    month: str  # "YYYY-MM" format
    count: int
    cumulative: int


class VNMonthlyScore(BaseModel):
    """Monthly average score for time series."""
    month: str  # "YYYY-MM" format
    avg_score: float
    cumulative_avg: float
    vote_count: int


class DeveloperRankContext(BaseModel):
    """How this VN ranks among its developer's catalog."""
    developer_id: str
    developer_name: str
    developer_name_original: str | None = None
    rank: int
    total: int
    total_all: int | None = None


class GenrePercentileContext(BaseModel):
    """How this VN's rating compares within its dominant genre."""
    tag_id: int
    tag_name: str
    percentile: float
    total_in_genre: int
    jp_count: int = 0


class LengthComparisonContext(BaseModel):
    """How this VN's rating compares to VNs of similar length."""
    vn_score: float
    length_avg_score: float
    length_label: str
    count_in_length: int
    jp_count: int = 0


class ComparativeContext(BaseModel):
    """Contextual comparisons for a VN's rating."""
    developer_rank: DeveloperRankContext | None = None
    genre_percentile: GenrePercentileContext | None = None
    length_comparison: LengthComparisonContext | None = None


class GlobalMedians(BaseModel):
    """Global percentile data for niche quadrant positioning."""
    median_rating: float
    median_votecount: float
    p75_rating: float
    p75_votecount: float


class VNVoteStatsResponse(BaseModel):
    """Vote statistics for a single VN."""
    vn_id: str
    total_votes: int
    average_score: float | None
    score_distribution: dict[str, int]
    votes_over_time: list[VNMonthlyVotes]
    score_over_time: list[VNMonthlyScore]
    context: ComparativeContext | None = None
    global_medians: GlobalMedians | None = None


class VNSearchResponse(BaseModel):
    """Search results for VNs."""
    results: list[VNSummary]
    total: int
    total_with_spoilers: int | None = None  # Total count including all spoiler levels (when tag/trait filtering)
    page: int
    pages: int
    query_time: float | None = None  # Query execution time in seconds
    # Set when sorting by a ranking metric. The floor is part of the sort rather than a
    # filter the reader chose, so the interface has to be able to state it.
    metric: str | None = None
    metric_label: str | None = None
    metric_floor_note: str | None = None
    metric_high_means: str | None = None
    metric_low_means: str | None = None


class VNListByCategoryResponse(BaseModel):
    """Paginated list of VNs for a specific category filter."""
    vns: list[VNSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


# ============ Recommendation Schemas ============

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
    vnId: str | None = None

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
    vnId: str | None = None
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


class NewsDateInfo(BaseModel):
    """Info about a single date's news content."""
    date: str  # YYYY-MM-DD
    count: int
    sources: dict[str, int]  # Per-source counts


class NewsDateListResponse(BaseModel):
    """List of dates that have news content."""
    dates: list[NewsDateInfo]
    total_dates: int


class NewsFeedResponse(BaseModel):
    """One page of a section, newest first, with the cursor for the page after it and the
    cursor of its newest row, which a reader's poll for new rows starts from."""
    items: list[NewsItemResponse]
    nextCursor: str | None = None
    newestCursor: str | None = None


class NewsTickerResponse(BaseModel):
    """The newest rows across the sections a reader watches, for the strip above the tabs."""
    items: list[NewsItemResponse] = []


class NewsRailSection(BaseModel):
    """A few of another section's newest rows, for the panel that points elsewhere."""
    section: str
    items: list[NewsItemResponse] = []


class NewsRailVN(BaseModel):
    """A title with how many reviews it drew inside the window."""
    vnId: str
    title: str
    titleJp: str | None = None
    imageUrl: str | None = None
    imageIsNsfw: bool = False
    count: int


class NewsRailReviewer(BaseModel):
    """A reviewer and how many reviews they filed inside the window."""
    name: str
    count: int
    # The reviewer's page on the catalogue site, absent for rows filed before it was read.
    url: str | None = None


class NewsRailResponse(BaseModel):
    """What a section page's rails and inline modules need in one call. Every field is
    filled whatever the section, since the payload is small and one call keeps the pages
    simple."""
    elsewhere: list[NewsRailSection] = []
    boards: list[NewsItemResponse] = []
    creators: list[NewsItemResponse] = []
    mostReviewed: list[NewsRailVN] = []
    reviewers: list[NewsRailReviewer] = []
    trailers: list[NewsItemResponse] = []
    covers: list[NewsItemResponse] = []
    reviews: list[NewsItemResponse] = []


class NewsFrontResponse(BaseModel):
    """What the front page's rail needs in one call."""
    releasesToday: list[NewsItemResponse]
    releasesTomorrow: list[NewsItemResponse]
    catalogue: list[NewsItemResponse]
    trailers: list[NewsItemResponse]
    reviews: list[NewsItemResponse] = []
    sale: list[NewsItemResponse]
    announcements: list["AnnouncementResponse"]
    dlsiteRanking: list[dict[str, Any]] = []


class NewsDlsiteResponse(BaseModel):
    """The store's weekly rankings for adventure games, commercial and doujin."""
    asOf: str | None = None
    pro: list[dict[str, Any]] = []
    maniax: list[dict[str, Any]] = []


class NewsSourceEntry(BaseModel):
    name: str
    kind: str
    url: str
    section: str
    lang: str | None = None


class NewsInventoryResponse(BaseModel):
    sources: list[NewsSourceEntry] = []


class NewsReleasesResponse(BaseModel):
    """The releases page: what is out, what is coming, what is cheaper, and the rankings."""
    outNow: list[NewsItemResponse] = []
    comingUp: list[NewsItemResponse] = []
    onSale: list[NewsItemResponse] = []
    doujin: list[NewsItemResponse] = []
    dlsite: dict[str, Any] = {}
    getchu: dict[str, Any] = {}


class NewsGetchuResponse(BaseModel):
    """The retailer's pre-order and sales rankings for PC games."""
    asOf: str | None = None
    reserve: list[dict[str, Any]] = []
    sales: list[dict[str, Any]] = []


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


class BatchItemBrief(BaseModel):
    """Minimal VN or character info for batch loading shared layouts."""
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None


class BatchItemBlurb(BatchItemBrief):
    """A VN with the prose a layout that sets a cover beside text needs.

    Separate from the brief above because that one answers for characters as well, and a
    release date says nothing about a character. The description arrives stripped of markup and
    cut to a readable length: a page of them is requested at once and a few lines of each are
    shown.
    """
    description: str | None = None
    released: str | None = None


class VNCharacterResponse(BaseModel):
    """Character information for a VN's character list."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    role: str
    spoiler: int = 0  # 0=none, 1=minor, 2=major (character's role as spoiler)
    traits: list[CharacterTraitInfo]


class VNStaffCreditResponse(BaseModel):
    """One credited staff member on a VN, with every role they are credited under."""
    id: str  # Staff ID
    name: str
    original: str | None = None
    roles: list[str]


class VNSeiyuuCharacterInfo(BaseModel):
    """A character a voice actor plays in this VN."""
    id: str
    name: str
    original: str | None = None


class VNSeiyuuCreditResponse(BaseModel):
    """One voice actor on a VN, with the characters they voice in it."""
    id: str  # Staff ID
    name: str
    original: str | None = None
    characters: list[VNSeiyuuCharacterInfo]


class VNCreditsResponse(BaseModel):
    """Capped credits for a VN: who made it and who voices it."""
    staff: list[VNStaffCreditResponse]
    seiyuu: list[VNSeiyuuCreditResponse]
    staff_total: int  # Distinct credited people before the cap
    seiyuu_total: int


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


# ============ Character Search Schemas ============

class CharacterSearchResult(BaseModel):
    """A character in search results."""
    id: str
    name: str
    original: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    vn_id: str | None = None
    vn_name: str | None = None
    vn_title_jp: str | None = None
    vn_title_romaji: str | None = None


class CharacterSearchResponse(BaseModel):
    """Response for character search."""
    results: list[CharacterSearchResult]


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
