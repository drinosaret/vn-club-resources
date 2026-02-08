# VNDB Stats Backend

Python/FastAPI backend for VNDB user statistics and recommendations.

## Features

- User statistics (score distribution, tag analytics, activity)
- Personalized recommendations (tag-based + collaborative filtering)
- Daily ingestion of VNDB data dumps
- Rate-limited VNDB API integration
- Redis caching layer

## Quick Start

### Using Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# Run initial data import
docker-compose exec api python scripts/initial_import.py

# View logs
docker-compose logs -f api
```

### Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Run database migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

## API Endpoints

### Stats
- `GET /api/v1/stats/{uid}` - User statistics
- `GET /api/v1/stats/{uid}/tags` - Tag analytics
- `GET /api/v1/stats/{uid}/compare/{other_uid}` - Compare users

### Recommendations
- `GET /api/v1/recommendations/{uid}` - Personalized recommendations
- `GET /api/v1/recommendations/{uid}/similar/{vn_id}` - Similar VNs

### User
- `GET /api/v1/user/lookup?username=...` - Lookup user by username

### VN
- `GET /api/v1/vn/{vn_id}` - VN details
- `GET /api/v1/vn/search/` - Search VNs

## Data Ingestion

The scheduler automatically downloads and imports VNDB dumps daily at 09:00 UTC.

To run manually:
```bash
python -m app.ingestion.scheduler
```

## Environment Variables

See `.env.example` for all available options.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `VNDB_API_TOKEN` - Optional VNDB API token for private lists
