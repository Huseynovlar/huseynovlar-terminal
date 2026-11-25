from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.database import Base
from app.db import models as _models  # noqa: F401 — ensure all models are registered

logger = logging.getLogger(__name__)

SCHEMA_SYNC_LOCK_ID = 884210

# (table_name, column_name, postgres_ddl, sqlite_ddl)
COLUMN_MIGRATIONS: list[tuple[str, str, str, str]] = [
    ("users", "totp_backup_hashes", "JSON NOT NULL DEFAULT '[]'", "JSON NOT NULL DEFAULT '[]'"),
    ("trading_accounts", "platform", "VARCHAR(32) NOT NULL DEFAULT 'MT5'", "VARCHAR(32) NOT NULL DEFAULT 'MT5'"),
    ("trading_accounts", "api_key_enc", "TEXT NULL", "TEXT NULL"),
    ("assets", "logo_url", "TEXT NULL", "TEXT NULL"),
    ("assets", "category", "VARCHAR(32) NOT NULL DEFAULT 'macro'", "VARCHAR(32) NOT NULL DEFAULT 'macro'"),
    ("deals", "notes", "TEXT NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"),
    ("deals", "tags", "JSON NOT NULL DEFAULT '[]'", "JSON NOT NULL DEFAULT '[]'"),
    ("balance_operations", "is_manual", "BOOLEAN NOT NULL DEFAULT FALSE", "BOOLEAN NOT NULL DEFAULT 0"),
    ("balance_operations", "notes", "TEXT NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"),
]


async def reconcile_schema(engine: AsyncEngine) -> None:
    """Idempotently create missing tables and add missing columns on startup.

    Uses pg_advisory_xact_lock(884210) on PostgreSQL to prevent concurrent multi-worker
    DDL races, and falls back to PRAGMA table_info inspection on SQLite.
    """
    async with engine.begin() as conn:
        dialect = conn.dialect.name
        if dialect == "postgresql":
            await conn.execute(text(f"SELECT pg_advisory_xact_lock({SCHEMA_SYNC_LOCK_ID})"))

        await conn.run_sync(Base.metadata.create_all)

        if dialect == "postgresql":
            for table_name, col_name, pg_ddl, _sqlite_ddl in COLUMN_MIGRATIONS:
                stmt = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {pg_ddl}"
                await conn.execute(text(stmt))
        elif dialect == "sqlite":
            table_cols_cache: dict[str, set[str]] = {}
            for table_name, col_name, _pg_ddl, sqlite_ddl in COLUMN_MIGRATIONS:
                if table_name not in table_cols_cache:
                    rows = (await conn.execute(text(f"PRAGMA table_info({table_name})"))).fetchall()
                    table_cols_cache[table_name] = {str(r[1]) for r in rows}
                if col_name not in table_cols_cache[table_name]:
                    stmt = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {sqlite_ddl}"
                    await conn.execute(text(stmt))
                    table_cols_cache[table_name].add(col_name)
        else:
            logger.warning("schema_sync: unsupported dialect %s; ran create_all only", dialect)
