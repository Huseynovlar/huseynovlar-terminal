from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_events import audit_event_catalog, audit_event_label
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.pagination import Page
from app.db.models import AuditLog, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit_logs(
    q: str | None = Query(default=None),
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = (
        select(AuditLog, User.username)
        .outerjoin(User, AuditLog.user_id == User.id)
        .order_by(AuditLog.created_at.desc())
    )
    count_stmt = select(func.count()).select_from(AuditLog).outerjoin(User, AuditLog.user_id == User.id)
    if q and q.strip():
        pat = f"%{q.strip()}%"
        cond = (
            AuditLog.id.ilike(pat)
            | AuditLog.action.ilike(pat)
            | AuditLog.resource_type.ilike(pat)
            | AuditLog.resource_id.ilike(pat)
            | AuditLog.ip_address.ilike(pat)
            | User.username.ilike(pat)
        )
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action.strip()}%"))
        count_stmt = count_stmt.where(AuditLog.action.ilike(f"%{action.strip()}%"))
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type.strip())
        count_stmt = count_stmt.where(AuditLog.resource_type == resource_type.strip())
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id.strip())
        count_stmt = count_stmt.where(AuditLog.user_id == user_id.strip())
    page.set_headers(int(await db.scalar(count_stmt) or 0))
    rows = (await db.execute(stmt.limit(page.limit).offset(page.offset))).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "username": username or "",
            "action": r.action,
            "action_label": audit_event_label(r.action),
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "ip_address": r.ip_address,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r, username in rows
    ]


@router.get("/events")
async def list_audit_event_keys(_: User = Depends(require_admin)) -> list[dict[str, Any]]:
    """Translation catalog (en/ru/az) for every dot-notation audit event key."""
    return audit_event_catalog()


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
        "action_label": audit_event_label(r.action),
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "ip_address": r.ip_address,
        "details": r.details,
        "created_at": r.created_at.isoformat(),
    }
