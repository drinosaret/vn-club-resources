"""The news package.

Jobs in `app.ingestion.news_aggregator` drive the adapters; the API and the bot need only
`store` and `sections`.
"""

from app.services.news import sections, store  # noqa: F401
