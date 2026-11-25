from __future__ import annotations

import json
from copy import deepcopy
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_secret
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.db.models import SecretVaultEntry, StoredFile, User
from app.modules.auth.router import DEFAULT_USER_PREFERENCES
from app.modules.files.router import AVATAR_MAX_BYTES, sniff_image_type

router = APIRouter(prefix="/profile", tags=["profile"])

ALLOWED_VAULT_KEYS = {
    "google_ai_api_key",
    "telegram_bot_token",
    "telegram_chat_id",
    "alerts_bot_webhook_url",
    "alerts_bot_webhook_secret",
    "finnhub_api_key",
}


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _effective_preferences(stored: dict[str, Any] | None) -> dict[str, Any]:
    return _deep_merge(DEFAULT_USER_PREFERENCES, stored or {})


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    bio: str | None = Field(default=None, max_length=1000)
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
        "preferences": _effective_preferences(user.preferences),
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
    if body.email is not None:
        new_email = str(body.email).strip().lower()
        dup = (await db.execute(select(User).where(User.email == new_email, User.id != user.id))).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        user.email = new_email
    if body.bio is not None:
        user.bio = body.bio.strip()
    if body.social_links is not None:
        user.social_links = {k.strip(): v.strip() for k, v in body.social_links.items() if k.strip()}

    await record_audit(
        db,
        action="profile.updated",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return await get_my_profile(user)


@router.post("/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Private authenticated avatar upload; served only via /api/v1/files/{id}. No external URLs accepted."""
    data = await file.read(AVATAR_MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar exceeds 2 MB")
    mime = sniff_image_type(data)
    if not mime:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only PNG, JPEG, GIF or WebP images are allowed"
        )
    old = await db.execute(select(StoredFile).where(StoredFile.owner_id == user.id, StoredFile.kind == "avatar"))
    for row in old.scalars().all():
        await db.delete(row)
    stored = StoredFile(
        owner_id=user.id,
        kind="avatar",
        filename=(file.filename or "avatar")[:255],
        content_type=mime,
        size_bytes=len(data),
        data=data,
    )
    db.add(stored)
    await db.flush()
    user.avatar_url = f"/api/v1/files/{stored.id}"
    await record_audit(
        db,
        action="files.avatar_uploaded",
        user_id=user.id,
        resource_type="file",
        resource_id=stored.id,
        ip_address=extract_client_ip(request),
        details={"size_bytes": stored.size_bytes, "content_type": mime},
    )
    await db.commit()
    return await get_my_profile(user)


@router.delete("/avatar")
async def delete_avatar(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows = await db.execute(select(StoredFile).where(StoredFile.owner_id == user.id, StoredFile.kind == "avatar"))
    for row in rows.scalars().all():
        await db.delete(row)
    user.avatar_url = ""
    await db.commit()
    return await get_my_profile(user)


STYLE_PREF_KEYS = (
    "theme_preset",
    "theme_mode",
    "font",
    "sidebar_variant",
    "sidebar_collapsible",
    "content_layout",
    "navbar_style",
    "density",
    "language",
    "ticker_speed",
)
UI_PREFS_COOKIE = "ht_ui_prefs"
_MAX_SIDEBAR_ITEMS = 200


def _sanitize_preferences(patch: dict[str, Any]) -> dict[str, Any]:
    """Validate list-typed prefs so the server never persists junk (sidebar order, hidden pages)."""
    clean = dict(patch)
    for key in ("sidebar_order", "hidden_page_ids", "pinned_asset_codes"):
        if key in clean:
            value = clean[key]
            if not isinstance(value, list) or any(not isinstance(i, str) or len(i) > 200 for i in value):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be a list of strings"
                )
            clean[key] = list(dict.fromkeys(value))[:_MAX_SIDEBAR_ITEMS]
    for key in STYLE_PREF_KEYS:
        if key in clean and (not isinstance(clean[key], str) or len(clean[key]) > 64):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be a short string"
            )
    return clean


def _set_ui_cookie(response: Response, prefs: dict[str, Any], settings: Settings) -> None:
    """Mirror style/theme prefs into a readable cookie so SSR/first paint never resets to defaults."""
    style = {k: prefs[k] for k in STYLE_PREF_KEYS if k in prefs}
    response.set_cookie(
        key=UI_PREFS_COOKIE,
        value=quote(json.dumps(style, separators=(",", ":"))),
        max_age=365 * 86400,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.get("/preferences")
async def get_preferences(
    response: Response,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    prefs = _effective_preferences(user.preferences)
    _set_ui_cookie(response, prefs, settings)
    return {"preferences": prefs}


@router.patch("/preferences")
async def update_preferences(
    body: PreferencesUpdateRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    merged = _deep_merge(_effective_preferences(user.preferences), _sanitize_preferences(body.preferences))
    user.preferences = merged
    await db.commit()
    _set_ui_cookie(response, merged, settings)
    return {"preferences": user.preferences}


class SidebarOrderRequest(BaseModel):
    order: list[str] = Field(max_length=_MAX_SIDEBAR_ITEMS)


@router.get("/sidebar-order")
async def get_sidebar_order(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"order": list(_effective_preferences(user.preferences).get("sidebar_order") or [])}


@router.put("/sidebar-order")
async def put_sidebar_order(
    body: SidebarOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Persist custom sidebar menu ordering server-side (per user)."""
    order = list(dict.fromkeys(i.strip() for i in body.order if i.strip()))
    user.preferences = _deep_merge(_effective_preferences(user.preferences), {"sidebar_order": order})
    await db.commit()
    return {"order": order}


@router.get("/vault")
async def list_vault_status(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(SecretVaultEntry))).scalars().all()
    configured = {r.key: r.updated_at.isoformat() for r in rows}
    return page.apply(
        [
            {"key": key, "configured": key in configured, "updated_at": configured.get(key)}
            for key in sorted(ALLOWED_VAULT_KEYS)
        ]
    )


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
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {"key": secret_key, "configured": True}


@router.delete("/vault/{secret_key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vault_secret(
    secret_key: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if secret_key not in ALLOWED_VAULT_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported vault secret key")
    entry = await db.get(SecretVaultEntry, secret_key)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vault entry not found")
    await db.delete(entry)
    await record_audit(
        db,
        action="vault.secret_deleted",
        user_id=user.id,
        resource_type="secret_vault",
        resource_id=secret_key,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
