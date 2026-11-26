from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.core.security import hash_password, validate_password_strength
from app.db.models import User
from app.modules.auth.router import DEFAULT_USER_PREFERENCES

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {"ADMIN", "OPERATOR", "VIEWER"}


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="VIEWER", pattern="^(ADMIN|OPERATOR|VIEWER)$")
    display_name: str = Field(default="", max_length=120)
    is_active: bool = True

    @field_validator("password")
    @classmethod
    def _strong_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserUpdateRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: str | None = Field(default=None, pattern="^(ADMIN|OPERATOR|VIEWER)$")
    display_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None

    @field_validator("password")
    @classmethod
    def _strong_password(cls, v: str | None) -> str | None:
        return validate_password_strength(v) if v is not None else v


def _serialize_user(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "display_name": u.display_name,
        "bio": u.bio,
        "avatar_url": u.avatar_url,
        "totp_enabled": u.totp_enabled,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat(),
        "updated_at": u.updated_at.isoformat() if u.updated_at else u.created_at.isoformat(),
    }


async def _count_active_admins(db: AsyncSession) -> int:
    count = await db.scalar(
        select(func.count()).select_from(User).where(User.role == "ADMIN", User.is_active.is_(True))
    )
    return int(count or 0)


@router.get("")
async def list_users(
    role: str | None = Query(default=None),
    q: str | None = Query(default=None),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(User).order_by(User.created_at.asc())
    if role and role.upper() in VALID_ROLES:
        stmt = stmt.where(User.role == role.upper())
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            User.id.ilike(pattern)
            | User.username.ilike(pattern)
            | User.email.ilike(pattern)
            | User.display_name.ilike(pattern)
            | User.role.ilike(pattern)
        )
    users = (await db.execute(stmt)).scalars().all()
    return page.apply([_serialize_user(u) for u in users])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreateRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    username = body.username.strip().lower()
    email = str(body.email).strip().lower()

    dup = (
        await db.execute(select(User).where((User.username == username) | (User.email == email)))
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email already exists")

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        is_active=body.is_active,
        display_name=body.display_name.strip() or username,
        preferences=dict(DEFAULT_USER_PREFERENCES),
    )
    db.add(user)
    await db.flush()
    await record_audit(
        db,
        action="users.created",
        user_id=admin.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
        details={"username": user.username, "role": user.role},
    )
    await db.commit()
    await db.refresh(user)
    return _serialize_user(user)


@router.get("/{user_id}")
async def get_user_detail(
    user_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from datetime import timedelta

    from app.core.audit_events import audit_event_label
    from app.db.models import AuditLog, UserSession

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    now = datetime.now(UTC)
    sessions = (
        (
            await db.execute(
                select(UserSession)
                .where(
                    UserSession.user_id == user.id,
                    UserSession.revoked.is_(False),
                    UserSession.expires_at > now,
                )
                .order_by(UserSession.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )

    recent_logins = (
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.user_id == user.id, AuditLog.action.like("auth.%"))
                .order_by(AuditLog.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )

    recent_audit = (
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.user_id == user.id)
                .order_by(AuditLog.created_at.desc())
                .limit(15)
            )
        )
        .scalars()
        .all()
    )

    online_cutoff = now - timedelta(minutes=20)
    latest_activity = recent_audit[0].created_at if recent_audit else (sessions[0].created_at if sessions else None)
    if latest_activity and latest_activity.tzinfo is None:
        latest_activity = latest_activity.replace(tzinfo=UTC)
    is_online = bool(sessions and latest_activity and latest_activity >= online_cutoff)

    last_ip = (
        (sessions[0].ip_address if sessions else None)
        or (recent_logins[0].ip_address if recent_logins else None)
        or (recent_audit[0].ip_address if recent_audit else None)
        or ""
    )

    base = _serialize_user(user)
    base.update(
        {
            "is_online": is_online,
            "last_ip": last_ip,
            "active_sessions": [
                {
                    "id": s.id,
                    "ip_address": s.ip_address,
                    "user_agent": s.user_agent,
                    "created_at": s.created_at.isoformat(),
                    "expires_at": s.expires_at.isoformat(),
                }
                for s in sessions
            ],
            "recent_logins": [
                {
                    "id": r.id,
                    "action": r.action,
                    "action_label": audit_event_label(r.action),
                    "ip_address": r.ip_address,
                    "created_at": r.created_at.isoformat(),
                }
                for r in recent_logins
            ],
            "recent_audit": [
                {
                    "id": r.id,
                    "action": r.action,
                    "action_label": audit_event_label(r.action),
                    "resource_type": r.resource_type,
                    "resource_id": r.resource_id,
                    "ip_address": r.ip_address,
                    "created_at": r.created_at.isoformat(),
                }
                for r in recent_audit
            ],
        }
    )
    return base


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    would_demote_or_disable_admin = user.role == "ADMIN" and user.is_active and (
        (body.role is not None and body.role != "ADMIN") or (body.is_active is False)
    )
    if would_demote_or_disable_admin and await _count_active_admins(db) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot demote or disable the last active ADMIN user",
        )

    if body.email is not None:
        new_email = str(body.email).strip().lower()
        existing = (
            await db.execute(select(User).where(User.email == new_email, User.id != user.id))
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        user.email = new_email
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.role is not None:
        user.role = body.role
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.is_active is not None:
        user.is_active = body.is_active

    await record_audit(
        db,
        action="users.updated",
        user_id=admin.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
        details={"role": user.role, "is_active": user.is_active},
    )
    await db.commit()
    await db.refresh(user)
    return _serialize_user(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.role == "ADMIN" and user.is_active and await _count_active_admins(db) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last active ADMIN user",
        )

    username = user.username
    await db.delete(user)
    await record_audit(
        db,
        action="users.deleted",
        user_id=admin.id,
        resource_type="user",
        resource_id=user_id,
        ip_address=extract_client_ip(request),
        details={"username": username},
    )
    await db.commit()
