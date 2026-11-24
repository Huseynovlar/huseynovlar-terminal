from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import Base, build_engine
from app.core.module_registry import ModuleSpec, register_modules
from app.db import models as _models  # noqa: F401
from app.modules.accounts.router import router as accounts_router
from app.modules.analytics.router import router as analytics_router
from app.modules.assets.router import router as assets_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.charts.router import router as charts_router
from app.modules.ingest.router import router as ingest_router
from app.modules.intelligence.router import router as intelligence_router
from app.modules.ops.router import router as ops_router
from app.modules.profile.router import router as profile_router


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.environment != "test":
        engine = build_engine(settings.database_url)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        finally:
            await engine.dispose()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/api/docs" if settings.environment != "production" else None,
        redoc_url=None,
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.terminal_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_modules(
        app,
        [
            ModuleSpec("auth", auth_router),
            ModuleSpec("profile", profile_router),
            ModuleSpec("assets", assets_router),
            ModuleSpec("accounts", accounts_router),
            ModuleSpec("audit", audit_router),
            ModuleSpec("ingest", ingest_router),
            ModuleSpec("charts", charts_router),
            ModuleSpec("analytics", analytics_router),
            ModuleSpec("intelligence", intelligence_router),
            ModuleSpec("ops", ops_router),
        ],
    )

    @app.get("/healthz", tags=["system"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "terminal-backend", "version": settings.app_version}

    return app


app = create_app()
