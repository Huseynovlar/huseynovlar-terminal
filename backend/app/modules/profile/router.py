from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_secret
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.db.models import SecretVaultEntry, User

router = APIRouter(prefix="/profile", tags=["profile"])

ALLOWED_VAULT_KEYS = {
    "google_ai_api_key",
    "telegram_bot_token",
    "telegram_chat_id",
    "alerts_bot_webhook_url",
    "alerts_bot_webhook_secret",
    "finnhub_api_key",
}


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=2000)
    social_links: dict[str, str] | None = None


class PreferencesUpdateRequest(BaseModel):
    preferences: dict[str, Any]


class VaultSecretUpdateRequest(BaseModel):
    value: str = Field(max_length=4096)


@router.get("/me")
async def get_my_profile(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "display_name": user.display_name,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "social_links": user.social_links,
        "totp_enabled": user.totp_enabled,
        "preferences": user.preferences,
        "created_at": user.created_at.isoformat(),
    }


@router.patch("/me")
async def update_my_profile(
    body: ProfileUpdateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.bio is not None:
        user.bio = body.bio.strip()
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url.strip()
    if body.social_links is not None:
        user.social_links = {k.strip(): v.strip() for k, v in body.social_links.items() if k.strip()}

    await record_audit(
        db,
        action="profile.updated",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
    return await get_my_profile(user)


@router.patch("/preferences")
async def update_preferences(
    body: PreferencesUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    merged = {**(user.preferences or {}), **body.preferences}
    user.preferences = merged
    await db.commit()
    return {"preferences": user.preferences}


@router.get("/vault")
async def list_vault_status(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(SecretVaultEntry))).scalars().all()
    configured = {r.key: r.updated_at.isoformat() for r in rows}
    return [
        {"key": key, "configured": key in configured, "updated_at": configured.get(key)}
        for key in sorted(ALLOWED_VAULT_KEYS)
    ]


@router.put("/vault/{secret_key}")
async def upsert_vault_secret(
    secret_key: str,
    body: VaultSecretUpdateRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if secret_key not in ALLOWED_VAULT_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported vault secret key")

    entry = await db.get(SecretVaultEntry, secret_key)
    encrypted = encrypt_secret(body.value.strip(), settings.vault_master_key)
    if entry:
        entry.value_enc = encrypted
    else:
        db.add(SecretVaultEntry(key=secret_key, value_enc=encrypted))

    await record_audit(
        db,
        action="vault.secret_updated",
        user_id=user.id,
        resource_type="secret_vault",
        resource_id=secret_key,
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
    return {"key": secret_key, "configured": True}
