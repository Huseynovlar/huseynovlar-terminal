from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_admin
from app.db.models import AuditLog, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit_logs(
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = (
        select(AuditLog, User.username)
        .outerjoin(User, AuditLog.user_id == User.id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action.strip()}%"))
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type.strip())
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id.strip())

    rows = (await db.execute(stmt.limit(limit))).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "username": username or "",
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "ip_address": r.ip_address,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r, username in rows
    ]


@router.get("/{audit_id}")
async def get_audit_log_detail(
    audit_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    stmt = (
        select(AuditLog, User.username)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.id == audit_id)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit log entry not found")
    r, username = row
    return {
        "id": r.id,
        "user_id": r.user_id,
        "username": username or "",
        "action": r.action,
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "ip_address": r.ip_address,
        "details": r.details,
        "created_at": r.created_at.isoformat(),
    }
