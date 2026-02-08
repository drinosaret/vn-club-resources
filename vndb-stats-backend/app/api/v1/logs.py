"""Application logs API endpoints for admin monitoring."""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func, desc, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db, async_session
from app.db.models import AppLog
from app.config import get_settings
from app.core.auth import require_admin

router = APIRouter()
settings = get_settings()
limiter = Limiter(key_func=get_remote_address)


# ==================== Pydantic Schemas ====================

class AppLogResponse(BaseModel):
    id: int
    timestamp: str
    level: str
    source: str
    module: Optional[str]
    message: str
    url: Optional[str]
    stack_trace: Optional[str]
    occurrence_count: int
    error_hash: Optional[str]
    correlation_id: Optional[str] = None

    class Config:
        from_attributes = True


class FrontendLogSubmission(BaseModel):
    level: str = "ERROR"
    message: str = ""
    url: str = ""
    user_agent: Optional[str] = None
    stack_trace: Optional[str] = None
    component: Optional[str] = None
    extra_data: Optional[dict] = None
    correlation_id: Optional[str] = None  # Can be passed in body or header

    @field_validator('message')
    @classmethod
    def limit_message(cls, v: str) -> str:
        return v[:5000] if v else v

    @field_validator('url')
    @classmethod
    def limit_url(cls, v: str) -> str:
        return v[:500] if v else v

    @field_validator('stack_trace')
    @classmethod
    def limit_stack_trace(cls, v: Optional[str]) -> Optional[str]:
        return v[:10000] if v else v

    @field_validator('user_agent')
    @classmethod
    def limit_user_agent(cls, v: Optional[str]) -> Optional[str]:
        return v[:500] if v else v

    @field_validator('level')
    @classmethod
    def validate_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in allowed:
            return "ERROR"
        return upper

    @field_validator('extra_data')
    @classmethod
    def limit_extra_data(cls, v: Optional[dict]) -> Optional[dict]:
        if v is not None:
            import json
            serialized = json.dumps(v, default=str)
            if len(serialized) > 10000:
                return {"truncated": True, "message": "extra_data exceeded 10KB limit"}
        return v


class LogStatsResponse(BaseModel):
    total_count: int
    error_count: int
    warning_count: int
    info_count: int
    backend_count: int
    frontend_count: int
    recent_errors: list[AppLogResponse]


# ==================== Helper Functions ====================

def _serialize_log(log: AppLog) -> AppLogResponse:
    """Convert AppLog model to response schema."""
    return AppLogResponse(
        id=log.id,
        timestamp=log.timestamp.isoformat() if log.timestamp else "",
        level=log.level,
        source=log.source,
        module=log.module,
        message=log.message,
        url=log.url,
        stack_trace=log.stack_trace,
        occurrence_count=log.occurrence_count or 1,
        error_hash=log.error_hash,
        correlation_id=log.correlation_id,
    )


def compute_error_hash(message: str, url: str, component: Optional[str] = None) -> str:
    """Compute hash for error deduplication."""
    # Normalize message - remove variable parts
    normalized = re.sub(r'at line \d+', 'at line X', message)
    normalized = re.sub(r'0x[0-9a-fA-F]+', '0xXXXX', normalized)
    normalized = re.sub(r'\d+', 'N', normalized)  # Replace numbers

    # Use path only from URL
    url_path = urlparse(url).path if url else ''

    content = f"{normalized}|{url_path}|{component or ''}"
    return hashlib.sha256(content.encode()).hexdigest()[:32]


# Rate limiting storage (simple in-memory, would use Redis in production)
_rate_limit_cache: dict[str, list[float]] = {}


def _escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters in user input."""
    return value.replace('%', r'\%').replace('_', r'\_')


def check_rate_limit(ip: str, limit: int = 100) -> bool:
    """Check if IP is within rate limit (100 logs/minute)."""
    now = datetime.now(timezone.utc).timestamp()
    window = 60  # 1 minute

    if ip not in _rate_limit_cache:
        _rate_limit_cache[ip] = []

    # Remove old entries
    _rate_limit_cache[ip] = [t for t in _rate_limit_cache[ip] if now - t < window]

    if len(_rate_limit_cache[ip]) >= limit:
        return False

    _rate_limit_cache[ip].append(now)
    return True


# ==================== Endpoints ====================

@router.get("", response_model=list[AppLogResponse], dependencies=[Depends(require_admin)])
async def get_logs(
    source: Optional[str] = Query(default=None, description="Filter by source: backend or frontend"),
    level: Optional[str] = Query(default=None, description="Filter by level: DEBUG, INFO, WARNING, ERROR"),
    search: Optional[str] = Query(default=None, description="Search in message"),
    hours: Optional[int] = Query(default=24, le=168, description="Time range in hours (max 168 = 7 days)"),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated application logs with filtering."""
    query = select(AppLog)

    # Apply filters
    if source:
        query = query.where(AppLog.source == source.lower())
    if level:
        query = query.where(AppLog.level == level.upper())
    if search:
        query = query.where(AppLog.message.ilike(f"%{_escape_like(search)}%"))
    if hours:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        query = query.where(AppLog.timestamp >= cutoff)

    # Order by timestamp desc and paginate
    query = query.order_by(desc(AppLog.timestamp)).limit(limit).offset(offset)

    result = await db.execute(query)
    logs = result.scalars().all()

    return [_serialize_log(log) for log in logs]


@router.get("/stream", dependencies=[Depends(require_admin)])
async def stream_logs(
    request: Request,
    source: Optional[str] = Query(default=None),
    level: Optional[str] = Query(default=None),
):
    """SSE endpoint for real-time log streaming with timeout protection."""

    # Configuration
    MAX_CONNECTION_SECONDS = 3600  # 1 hour max connection time
    HEARTBEAT_INTERVAL = 30  # Send heartbeat every 30 seconds

    async def event_generator():
        last_id = 0
        start_time = datetime.now(timezone.utc)
        last_heartbeat = start_time

        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                now = datetime.now(timezone.utc)

                # Check overall connection timeout
                elapsed = (now - start_time).total_seconds()
                if elapsed > MAX_CONNECTION_SECONDS:
                    yield f"event: timeout\ndata: {json.dumps({'message': 'Connection timeout after 1 hour', 'elapsed': elapsed})}\n\n"
                    break

                # Send heartbeat to detect dead clients
                heartbeat_elapsed = (now - last_heartbeat).total_seconds()
                if heartbeat_elapsed > HEARTBEAT_INTERVAL:
                    yield f"event: heartbeat\ndata: {json.dumps({'timestamp': now.isoformat()})}\n\n"
                    last_heartbeat = now

                async with async_session() as db:
                    # Build query for new logs
                    query = select(AppLog).where(AppLog.id > last_id)

                    if source:
                        query = query.where(AppLog.source == source.lower())
                    if level:
                        query = query.where(AppLog.level == level.upper())

                    query = query.order_by(AppLog.id).limit(50)

                    result = await db.execute(query)
                    logs = result.scalars().all()

                    for log in logs:
                        last_id = log.id
                        log_data = {
                            "id": log.id,
                            "timestamp": log.timestamp.isoformat() if log.timestamp else "",
                            "level": log.level,
                            "source": log.source,
                            "module": log.module,
                            "message": log.message,
                            "url": log.url,
                        }
                        yield f"event: log\ndata: {json.dumps(log_data)}\n\n"

                # Wait before next poll
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            logger.info("Log stream cancelled by client")
        except Exception as e:
            logger.error(f"Log stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': 'Internal server error'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/frontend")
async def submit_frontend_log(
    log: FrontendLogSubmission,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive frontend error logs.

    Features:
    - Rate limiting by IP
    - Error deduplication via hash
    - Input validation
    """
    # Get client IP
    client_ip = request.client.host if request.client else "unknown"

    # Check rate limit
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Max 100 logs per minute."
        )

    now = datetime.now(timezone.utc)

    # Compute error hash for deduplication
    error_hash = compute_error_hash(log.message, log.url, log.component)

    # Check for existing log with same hash (within last hour)
    one_hour_ago = now - timedelta(hours=1)
    result = await db.execute(
        select(AppLog)
        .where(AppLog.error_hash == error_hash)
        .where(AppLog.timestamp >= one_hour_ago)
        .limit(1)
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Update occurrence count instead of creating new entry
        existing.occurrence_count = (existing.occurrence_count or 1) + 1
        existing.last_seen = now
        await db.commit()
        return {"status": "deduplicated", "id": existing.id, "occurrence_count": existing.occurrence_count}

    # Get correlation ID from header or body
    correlation_id = (
        request.headers.get("X-Correlation-ID")
        or log.correlation_id
    )

    # Create new log entry
    log_entry = AppLog(
        timestamp=now,
        level=log.level.upper(),
        source="frontend",
        module=log.component,
        message=log.message[:5000],  # Limit message length
        url=log.url[:500] if log.url else None,
        user_agent=log.user_agent[:500] if log.user_agent else None,
        stack_trace=log.stack_trace[:10000] if log.stack_trace else None,
        error_hash=error_hash,
        occurrence_count=1,
        first_seen=now,
        last_seen=now,
        extra_data=log.extra_data,
        correlation_id=correlation_id,
    )
    db.add(log_entry)
    await db.commit()
    await db.refresh(log_entry)

    return {"status": "created", "id": log_entry.id}


@router.get("/stats", response_model=LogStatsResponse, dependencies=[Depends(require_admin)])
async def get_log_stats(
    hours: int = Query(default=24, le=168, description="Time range in hours"),
    db: AsyncSession = Depends(get_db),
):
    """Get log statistics for dashboard widgets."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Total count
    result = await db.execute(
        select(func.count()).select_from(AppLog).where(AppLog.timestamp >= cutoff)
    )
    total_count = result.scalar_one_or_none() or 0

    # Count by level
    level_counts = {}
    for level in ["ERROR", "WARNING", "INFO", "DEBUG"]:
        result = await db.execute(
            select(func.count())
            .select_from(AppLog)
            .where(AppLog.timestamp >= cutoff)
            .where(AppLog.level == level)
        )
        level_counts[level] = result.scalar_one_or_none() or 0

    # Count by source
    source_counts = {}
    for source in ["backend", "frontend"]:
        result = await db.execute(
            select(func.count())
            .select_from(AppLog)
            .where(AppLog.timestamp >= cutoff)
            .where(AppLog.source == source)
        )
        source_counts[source] = result.scalar_one_or_none() or 0

    # Recent errors (last 10)
    result = await db.execute(
        select(AppLog)
        .where(AppLog.level == "ERROR")
        .where(AppLog.timestamp >= cutoff)
        .order_by(desc(AppLog.timestamp))
        .limit(10)
    )
    recent_errors = [_serialize_log(log) for log in result.scalars().all()]

    return LogStatsResponse(
        total_count=total_count,
        error_count=level_counts.get("ERROR", 0),
        warning_count=level_counts.get("WARNING", 0),
        info_count=level_counts.get("INFO", 0),
        backend_count=source_counts.get("backend", 0),
        frontend_count=source_counts.get("frontend", 0),
        recent_errors=recent_errors,
    )


@router.delete("/cleanup", dependencies=[Depends(require_admin)])
@limiter.limit("5/minute")
async def cleanup_old_logs(
    request: Request,
    days: int = Query(default=30, ge=1, le=365, description="Delete logs older than N days"),
    db: AsyncSession = Depends(get_db),
):
    """Delete logs older than specified days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        delete(AppLog).where(AppLog.timestamp < cutoff)
    )
    await db.commit()

    return {"deleted_count": result.rowcount, "cutoff_date": cutoff.isoformat()}
