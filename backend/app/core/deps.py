from __future__ import annotations

from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import hash_api_key
from app.core.database import get_db
from app.core.security import decode_token
from app.db.models import AuditLog, TradingAccount, User


async def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif "ht_access_token" in request.cookies:
        token = request.cookies.get("ht_access_token")

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    try:
        payload = decode_token(token, settings, expected_type="access")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive or not found")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user


async def verify_account_api_key(
    x_account_api_key: str | None = Header(default=None, alias="X-Account-Api-Key"),
    db: AsyncSession = Depends(get_db),
) -> TradingAccount:
    """Fail-closed authentication for MT5 ExnessPanelBridge.mq5 ingestion endpoints."""
    if not x_account_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-Account-Api-Key")

    digest = hash_api_key(x_account_api_key.strip())
    result = await db.execute(
        select(TradingAccount).where(TradingAccount.api_key_hash == digest, TradingAccount.is_active.is_(True))
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid account API key")
    return account


async def record_audit(
    db: AsyncSession,
    *,
    action: str,
    user_id: str | None = None,
    resource_type: str = "",
    resource_id: str = "",
    ip_address: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            details=details or {},
        )
    )
