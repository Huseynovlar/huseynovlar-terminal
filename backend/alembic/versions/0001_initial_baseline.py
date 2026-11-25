"""Initial baseline schema for Huseynovlar Terminal (M2).

Revision ID: 0001_initial_baseline
Revises:
Create Date: 2026-11-25 00:00:00.000000
"""

from __future__ import annotations

from sqlalchemy import text

from alembic import op
from app.core.database import Base
from app.db import models as _models  # noqa: F401
from app.db.schema_sync import COLUMN_MIGRATIONS

revision = "0001_initial_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

    if bind.dialect.name == "postgresql":
        for table_name, col_name, pg_ddl, _sqlite_ddl in COLUMN_MIGRATIONS:
            bind.execute(text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {pg_ddl}"))


def downgrade() -> None:
    # Baseline revision: do not drop production data on accidental downgrade.
    pass
