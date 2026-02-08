"""Admin API endpoints for import management and system monitoring."""

import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func, desc, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db, async_session
from app.db.models import ImportRun, ImportLog, VisualNovel, SystemMetadata
from app.config import get_settings
from app.core.auth import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])
settings = get_settings()


# ==================== Pydantic Schemas ====================

class ImportRunResponse(BaseModel):
    id: int
    status: str
    phase: Optional[str]
    current_step: int
    total_steps: int
    progress_percent: float
    started_at: Optional[str]
    ended_at: Optional[str]
    duration_seconds: Optional[float]
    error_message: Optional[str]
    triggered_by: str
    stats_json: Optional[dict]

    class Config:
        from_attributes = True


class ImportStatusResponse(BaseModel):
    is_running: bool
    current_run: Optional[ImportRunResponse]
    last_completed: Optional[ImportRunResponse]
    next_scheduled: Optional[str]


class ImportLogResponse(BaseModel):
    id: int
    timestamp: str
    level: str
    message: str
    phase: Optional[str]

    class Config:
        from_attributes = True


class SystemHealthResponse(BaseModel):
    database: dict
    last_import: Optional[str]
    scheduler: dict


# ==================== Helper Functions ====================

def _serialize_run(run: Optional[ImportRun]) -> Optional[ImportRunResponse]:
    """Convert ImportRun model to response schema."""
    if not run:
        return None

    duration = None
    if run.started_at and run.ended_at:
        duration = (run.ended_at - run.started_at).total_seconds()
    elif run.started_at:
        duration = (datetime.now(timezone.utc) - run.started_at).total_seconds()

    return ImportRunResponse(
        id=run.id,
        status=run.status,
        phase=run.phase,
        current_step=run.current_step or 0,
        total_steps=run.total_steps or 21,
        progress_percent=run.progress_percent or 0.0,
        started_at=run.started_at.isoformat() if run.started_at else None,
        ended_at=run.ended_at.isoformat() if run.ended_at else None,
        duration_seconds=duration,
        error_message=run.error_message,
        triggered_by=run.triggered_by or "scheduled",
        stats_json=run.stats_json,
    )


def _serialize_log(log: ImportLog) -> ImportLogResponse:
    """Convert ImportLog model to response schema."""
    return ImportLogResponse(
        id=log.id,
        timestamp=log.timestamp.isoformat() if log.timestamp else "",
        level=log.level,
        message=log.message,
        phase=log.phase,
    )


# ==================== Import Status Endpoints ====================

@router.get("/import/status", response_model=ImportStatusResponse)
async def get_import_status(db: AsyncSession = Depends(get_db)):
    """Get current import status and last completed run."""
    # Current running import
    result = await db.execute(
        select(ImportRun).where(ImportRun.status == "running").limit(1)
    )
    current = result.scalar_one_or_none()

    # Last completed/failed import
    result = await db.execute(
        select(ImportRun)
        .where(ImportRun.status.in_(["completed", "failed", "cancelled"]))
        .order_by(desc(ImportRun.ended_at))
        .limit(1)
    )
    last = result.scalar_one_or_none()

    # Next scheduled time (placeholder - would need scheduler integration)
    # For now, return a rough estimate based on 4 AM UTC schedule
    from datetime import time as dt_time
    now = datetime.now(timezone.utc)
    next_run = now.replace(hour=4, minute=0, second=0, microsecond=0)
    if next_run <= now:
        from datetime import timedelta
        next_run += timedelta(days=1)

    return ImportStatusResponse(
        is_running=current is not None,
        current_run=_serialize_run(current),
        last_completed=_serialize_run(last),
        next_scheduled=next_run.isoformat(),
    )


@router.get("/import/history")
async def get_import_history(
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[ImportRunResponse]:
    """Get paginated import history."""
    result = await db.execute(
        select(ImportRun)
        .order_by(desc(ImportRun.started_at))
        .limit(limit)
        .offset(offset)
    )
    runs = result.scalars().all()
    return [_serialize_run(r) for r in runs]


@router.get("/import/logs/{run_id}")
async def get_import_logs(
    run_id: int,
    level: Optional[str] = Query(default=None),
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[ImportLogResponse]:
    """Get logs for a specific import run."""
    # Verify run exists
    result = await db.execute(select(ImportRun).where(ImportRun.id == run_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Import run not found")

    query = select(ImportLog).where(ImportLog.run_id == run_id)
    if level:
        query = query.where(ImportLog.level == level.upper())
    query = query.order_by(ImportLog.timestamp).limit(limit).offset(offset)

    result = await db.execute(query)
    logs = result.scalars().all()
    return [_serialize_log(log) for log in logs]


@router.get("/import/logs-stream/{run_id}")
async def stream_import_logs(request: Request, run_id: int):
    """SSE endpoint for real-time log streaming during an active import with timeout protection."""

    # Configuration
    MAX_CONNECTION_SECONDS = 3600  # 1 hour max connection time
    MAX_STATUS_UNCHANGED_SECONDS = 300  # 5 minutes without progress = stale warning
    HEARTBEAT_INTERVAL = 30  # Send heartbeat every 30 seconds

    async def event_generator():
        import logging
        logger = logging.getLogger(__name__)

        last_id = 0
        start_time = datetime.now(timezone.utc)
        last_heartbeat = start_time
        last_status = None
        status_unchanged_since = start_time

        try:
            while True:
                # Detect client disconnect to avoid resource leak
                if await request.is_disconnected():
                    logger.info("SSE client disconnected for run %d", run_id)
                    break

                now = datetime.now(timezone.utc)

                # Check overall connection timeout
                elapsed = (now - start_time).total_seconds()
                if elapsed > MAX_CONNECTION_SECONDS:
                    yield f"event: timeout\ndata: {json.dumps({'reason': 'connection_timeout', 'elapsed': elapsed})}\n\n"
                    break

                # Send heartbeat to detect dead clients
                heartbeat_elapsed = (now - last_heartbeat).total_seconds()
                if heartbeat_elapsed > HEARTBEAT_INTERVAL:
                    yield f"event: heartbeat\ndata: {json.dumps({'timestamp': now.isoformat()})}\n\n"
                    last_heartbeat = now

                async with async_session() as db:
                    # Check if run exists and get its status
                    result = await db.execute(
                        select(ImportRun).where(ImportRun.id == run_id)
                    )
                    run = result.scalar_one_or_none()

                    if not run:
                        yield f"event: error\ndata: {json.dumps({'error': 'Run not found'})}\n\n"
                        break

                    # Track status changes for stale detection
                    current_status = (run.status, run.phase, run.current_step)
                    if current_status != last_status:
                        last_status = current_status
                        status_unchanged_since = now
                    else:
                        stale_seconds = (now - status_unchanged_since).total_seconds()
                        if stale_seconds > MAX_STATUS_UNCHANGED_SECONDS:
                            yield f"event: stale\ndata: {json.dumps({'message': f'No progress for {int(stale_seconds)}s', 'last_phase': run.phase})}\n\n"
                            # Reset to avoid spamming stale events
                            status_unchanged_since = now

                    # Send status update
                    status_data = {
                        "status": run.status,
                        "phase": run.phase,
                        "current_step": run.current_step,
                        "total_steps": run.total_steps,
                        "progress_percent": run.progress_percent,
                    }
                    yield f"event: status\ndata: {json.dumps(status_data)}\n\n"

                    # If run is no longer active, send final status and close
                    if run.status not in ["pending", "running"]:
                        yield f"event: complete\ndata: {json.dumps({'status': run.status})}\n\n"
                        break

                    # Get new logs since last check
                    result = await db.execute(
                        select(ImportLog)
                        .where(ImportLog.run_id == run_id)
                        .where(ImportLog.id > last_id)
                        .order_by(ImportLog.id)
                        .limit(100)
                    )
                    logs = result.scalars().all()

                    for log in logs:
                        last_id = log.id
                        log_data = {
                            "id": log.id,
                            "timestamp": log.timestamp.isoformat() if log.timestamp else "",
                            "level": log.level,
                            "message": log.message,
                            "phase": log.phase,
                        }
                        yield f"event: log\ndata: {json.dumps(log_data)}\n\n"

                # Wait before next poll
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            logger.info(f"Import log stream cancelled for run {run_id}")
        except Exception as e:
            logger.error(f"Import log stream error for run {run_id}: {e}")
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


# ==================== System Health Endpoints ====================

@router.get("/system/health", response_model=SystemHealthResponse)
async def get_system_health(db: AsyncSession = Depends(get_db)):
    """Get overall system health metrics."""
    # Database status - count VNs
    try:
        result = await db.execute(select(func.count()).select_from(VisualNovel))
        vn_count = result.scalar_one_or_none() or 0
        db_status = "healthy"
    except Exception as e:
        vn_count = 0
        db_status = "error: database unavailable"

    # Last import time from system_metadata
    try:
        result = await db.execute(
            select(SystemMetadata).where(SystemMetadata.key == "last_import")
        )
        metadata = result.scalar_one_or_none()
        last_import = metadata.value if metadata else None
    except Exception:
        last_import = None

    # Count recent import runs
    try:
        result = await db.execute(
            select(func.count()).select_from(ImportRun)
        )
        total_imports = result.scalar_one_or_none() or 0
    except Exception:
        total_imports = 0

    return SystemHealthResponse(
        database={
            "status": db_status,
            "vn_count": vn_count,
        },
        last_import=last_import,
        scheduler={
            "status": "running",
            "total_imports": total_imports,
        },
    )


@router.get("/system/stats")
async def get_system_stats(db: AsyncSession = Depends(get_db)):
    """Get detailed system statistics for the admin dashboard."""
    stats = {}

    # Table counts
    from app.db.models import (
        Tag, VNTag, GlobalVote, Producer, Staff,
        Character, Release, Trait
    )

    tables = [
        ("visual_novels", VisualNovel),
        ("tags", Tag),
        ("vn_tags", VNTag),
        ("global_votes", GlobalVote),
        ("producers", Producer),
        ("staff", Staff),
        ("characters", Character),
        ("releases", Release),
        ("traits", Trait),
    ]

    for name, model in tables:
        try:
            result = await db.execute(select(func.count()).select_from(model))
            stats[name] = result.scalar_one_or_none() or 0
        except Exception:
            stats[name] = -1

    return {"table_counts": stats}
