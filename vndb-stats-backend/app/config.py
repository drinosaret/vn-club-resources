"""
Application configuration using pydantic-settings.

============================================================================
IMPORTANT: DATA SOURCE ARCHITECTURE
============================================================================
This backend uses a LOCAL PostgreSQL database as the PRIMARY data source,
populated from VNDB daily database dumps. The database contains:
- 40k+ visual novels with complete metadata
- All tags, traits, staff, producers, characters
- User votes for statistics and recommendations
- Precomputed recommendation models

The VNDB dumps are downloaded daily and imported into PostgreSQL.
This approach provides:
- Complete dataset (not limited by API rate limits)
- Fast queries (local database vs remote API)
- Accurate statistics (full data, not sampled)
- Precomputed recommendations

VNDB API (vndb_api_url below) is ONLY used for:
- Real-time user list fetching
- Username/UID lookups
- Data that must be current (can't wait for daily dumps)

DO NOT add new features that query the VNDB API for VN metadata, tags,
staff, or any bulk data. Use the local database via app/db/models.py instead.
============================================================================
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # Ignore extra env vars (e.g., AUTH_* for auth module)
    )

    # Application
    app_name: str = "VNDB Stats API"
    debug: bool = False

    # Development mode - when True:
    # - Worker won't auto-trigger imports on startup
    # - More verbose logging about data persistence
    # Set DEV_MODE=true in docker-compose.yml for local development
    dev_mode: bool = False

    # Database — always override via DATABASE_URL env var in deployment
    database_url: str = "postgresql+asyncpg://vndb:changeme@localhost:5432/vndb_stats"
    database_pool_size: int = 30   # Increased for concurrent heavy stats calculations
    database_max_overflow: int = 50  # Allow burst capacity for large user profiles

    # Redis
    redis_url: str = "redis://localhost:6379"
    cache_ttl_seconds: int = 600  # 10 minutes default cache (increased from 5 min)

    # VNDB API
    vndb_api_url: str = "https://api.vndb.org/kana"
    vndb_api_token: str | None = None  # Optional, for private lists
    vndb_rate_limit_requests: int = 200
    vndb_rate_limit_window: int = 300  # 5 minutes

    # Data dumps
    vndb_dump_url_db: str = "https://dl.vndb.org/dump/vndb-db-latest.tar.zst"
    vndb_dump_url_votes: str = "https://dl.vndb.org/dump/vndb-votes-latest.gz"
    vndb_dump_url_tags: str = "https://dl.vndb.org/dump/vndb-tags-latest.json.gz"
    vndb_dump_url_traits: str = "https://dl.vndb.org/dump/vndb-traits-latest.json.gz"
    dump_storage_path: str = "/app/data"  # Persistent volume for downloaded dumps (mounted from docker-compose)

    # Admin authentication
    admin_api_key: str | None = None  # Required for admin/logs endpoints

    # CORS — production deployments MUST set CORS_ORIGINS env var explicitly.
    # Default includes localhost for development convenience only.
    cors_origins: list[str] = [
        "http://localhost:3000",
    ]

    # Recommendation engine
    cf_factors: int = 64  # Latent factors for collaborative filtering
    cf_iterations: int = 50
    cf_regularization: float = 0.1
    tag_weight: float = 0.4
    cf_weight: float = 0.6

    # Twitter/X integration (for news aggregation)
    twitter_auth_token: str | None = None  # Session cookie auth_token from twitter.com

    # =========================================================================
    # Timeout and Resilience Settings
    # =========================================================================

    # Timeouts (in seconds)
    vndb_pagination_timeout: int = 300  # 5 min for paginated user list fetching
    sse_connection_timeout: int = 3600  # 1 hour max SSE connection
    full_import_timeout: int = 14400  # 4 hours max for entire import pipeline
    http_request_timeout: int = 30  # Default HTTP request timeout

    # Concurrency limits
    max_concurrent_precompute: int = 20  # Max concurrent DB ops in precompute
    precompute_batch_size: int = 100  # Users per batch in precompute
    max_concurrent_user_stats: int = 5  # Max concurrent heavy user stats calculations
    user_stats_timeout: int = 60  # Timeout for user stats calculation (seconds)
    max_user_vns: int = 2000  # Maximum VNs to process per user (prevents extreme cases)
    vndb_parallel_pages: int = 5  # Number of pages to fetch in parallel from VNDB

    # Retry settings
    max_retry_attempts: int = 3  # Default retry attempts for network operations
    retry_base_delay: float = 1.0  # Initial retry delay in seconds
    retry_max_delay: float = 60.0  # Maximum retry delay

    # Logging handler
    log_handler_shutdown_timeout: float = 30.0  # Seconds to wait for log flush
    log_handler_circuit_breaker_threshold: int = 5  # Failures before circuit opens


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
