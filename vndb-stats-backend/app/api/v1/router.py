"""API v1 router - aggregates all endpoint routers."""

from fastapi import APIRouter

from app.api.v1 import stats, recommendations, vn, user, news, admin, logs, characters, browse, blacklist

api_router = APIRouter()

api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
api_router.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
api_router.include_router(vn.router, prefix="/vn", tags=["visual-novels"])
api_router.include_router(characters.router, prefix="/characters", tags=["characters"])
api_router.include_router(user.router, prefix="/user", tags=["user"])
api_router.include_router(news.router, prefix="/news", tags=["news"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])
api_router.include_router(browse.router, prefix="/browse", tags=["browse"])
api_router.include_router(blacklist.router, prefix="/blacklist", tags=["blacklist"])
