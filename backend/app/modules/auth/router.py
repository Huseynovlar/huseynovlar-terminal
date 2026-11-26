from __future__ import annotations

import base64
import contextlib
import ipaddress
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.audit_events import audit_event_label
from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret, encrypt_secret, hash_api_key
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.core.security import (
    build_totp_uri,
    consume_backup_code,
    create_access_token,
    create_download_token,
    create_refresh_token,
    decode_token,
    generate_backup_codes,
    generate_totp_qr_svg,
    generate_totp_secret,
    hash_password,
    validate_password_strength,
    verify_password,
    verify_totp_code,
)
from app.db.models import AuditLog, User, UserSession, WebAuthnCredential

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory fallback challenge store when Redis is unavailable (e.g., unit tests / local dev)
_webauthn_challenges: dict[str, tuple[bytes, datetime]] = {}
_CHALLENGE_REDIS_PREFIX = "ht:webauthn:challenge:"


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


async def _get_redis_client(settings: Settings) -> Any | None:
    if settings.environment == "test" or not settings.redis_url:
        return None
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=1.5)
        await client.ping()
        return client
    except Exception:
        return None


async def _store_challenge(key: str, challenge: bytes, settings: Settings, ttl_sec: int = 300) -> None:
    encoded = bytes_to_base64url(challenge)
    client = await _get_redis_client(settings)
    if client is not None:
        try:
            await client.set(f"{_CHALLENGE_REDIS_PREFIX}{key}", encoded, ex=ttl_sec)
            await client.aclose()
            return
        except Exception as exc:
            logger.warning("webauthn: Redis store failed (%s); using in-memory fallback", exc)
            with contextlib.suppress(Exception):
                await client.aclose()
    _webauthn_challenges[key] = (challenge, datetime.now(UTC) + timedelta(seconds=ttl_sec))


async def _pop_challenge(key: str, settings: Settings) -> bytes:
    client = await _get_redis_client(settings)
    if client is not None:
        try:
            redis_key = f"{_CHALLENGE_REDIS_PREFIX}{key}"
            val = await client.get(redis_key)
            if val:
                await client.delete(redis_key)
                await client.aclose()
                return base64url_to_bytes(val)
            await client.aclose()
        except Exception as exc:
            logger.warning("webauthn: Redis pop failed (%s); checking in-memory fallback", exc)
            with contextlib.suppress(Exception):
                await client.aclose()

    entry = _webauthn_challenges.pop(key, None)
    if not entry:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn challenge missing or expired")
    challenge, expires_at = entry
    if datetime.now(UTC) > expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn challenge expired")
    return challenge


DEFAULT_USER_PREFERENCES: dict[str, Any] = {
    "theme_preset": "tangerine",
    "theme_mode": "dark",
    "font": "geist",
    "sidebar_variant": "floating",
    "sidebar_collapsible": "icon",
    "content_layout": "full-width",
    "navbar_style": "sticky",
    "density": "bloomberg",
    "language": "ru",
    "timezone": "UTC",
    "privacy_mode": False,
    "sound_enabled": False,
    "ticker_enabled": True,
    "ticker_speed": "normal",
    "hidden_page_ids": [],
    "sidebar_order": [],
    "pinned_asset_codes": [],
    "custom_hotkeys": {},
}


class BootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="Owner", max_length=120)


    @field_validator("password")
    @classmethod
    def _strong_password(cls, v: str) -> str:
        return validate_password_strength(v)


class LoginRequest(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    totp_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str
    totp_enabled: bool


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    totp_code: str | None = Field(default=None, max_length=16)
    revoke_other_sessions: bool = True

    @field_validator("new_password")
    @classmethod
    def _strong_password(cls, v: str) -> str:
        return validate_password_strength(v)


class TOTPVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=12)


class TOTPDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=16)


class WebAuthnRegisterVerifyRequest(BaseModel):
    device_name: str = Field(default="My Passkey", max_length=120)
    credential: dict[str, Any]


class WebAuthnLoginOptionsRequest(BaseModel):
    username: str | None = None


class WebAuthnLoginVerifyRequest(BaseModel):
    challenge_key: str
    credential: dict[str, Any]


def _resolve_current_sid(request: Request, settings: Settings) -> str | None:
    state_sid = getattr(request.state, "current_sid", None)
    if state_sid:
        return str(state_sid)

    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        try:
            sid = decode_token(auth_header[7:].strip(), settings, expected_type="access").get("sid")
            if sid:
                return str(sid)
        except jwt.PyJWTError:
            pass

    raw_access = request.cookies.get("ht_access_token")
    if raw_access:
        try:
            sid = decode_token(raw_access, settings, expected_type="access").get("sid")
            if sid:
                return str(sid)
        except jwt.PyJWTError:
            pass

    raw_refresh = request.cookies.get("ht_refresh_token")
    if raw_refresh:
        try:
            sid = decode_token(raw_refresh, settings, expected_type="refresh").get("sid")
            if sid:
                return str(sid)
        except jwt.PyJWTError:
            pass
    return None


async def _issue_session_tokens(
    *,
    user: User,
    request: Request,
    response: Response,
    db: AsyncSession,
    settings: Settings,
    mark_login: bool = False,
) -> TokenResponse:
    if mark_login:
        user.last_login_at = datetime.now(UTC)
    expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    session = UserSession(
        user_id=user.id,
        refresh_token_hash="pending",
        ip_address=extract_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:255],
        expires_at=expires_at,
    )
    db.add(session)
    await db.flush()

    access_token = create_access_token(user.id, user.role, settings, session_id=session.id)
    refresh_token = create_refresh_token(user.id, session.id, settings)
    session.refresh_token_hash = hash_api_key(refresh_token)

    response.set_cookie(
        key="ht_access_token",
        value=access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key="ht_refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )
    return TokenResponse(
        access_token=access_token,
        user_id=user.id,
        username=user.username,
        role=user.role,
        totp_enabled=user.totp_enabled,
    )


@router.get("/status")
async def auth_status(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    count = await db.scalar(select(func.count()).select_from(User))
    return {"initialized": bool(count and count > 0)}


@router.post("/bootstrap", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def bootstrap_owner(
    body: BootstrapRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    existing_count = await db.scalar(select(func.count()).select_from(User))
    if existing_count and existing_count > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Terminal owner is already bootstrapped")

    prefs = dict(DEFAULT_USER_PREFERENCES)
    prefs["timezone"] = settings.default_timezone or "UTC"
    user = User(
        username=body.username.strip().lower(),
        email=str(body.email).lower(),
        password_hash=hash_password(body.password),
        role="ADMIN",
        display_name=body.display_name.strip() or "Owner",
        preferences=prefs,
    )
    db.add(user)
    await db.flush()
    await record_audit(
        db,
        action="auth.bootstrap_owner",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
    )
    tokens = await _issue_session_tokens(
        user=user, request=request, response=response, db=db, settings=settings, mark_login=True
    )
    await db.commit()
    return tokens


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    result = await db.execute(select(User).where(User.username == body.username.strip().lower()))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    used_backup = False
    if user.totp_enabled:
        if not body.totp_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="TOTP 2FA code required")
        secret = decrypt_secret(user.totp_secret_enc or "", settings.vault_master_key)
        if not verify_totp_code(secret, body.totp_code):
            matched, remaining = consume_backup_code(body.totp_code, list(user.totp_backup_hashes or []))
            if not matched:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP 2FA code")
            user.totp_backup_hashes = remaining
            used_backup = True

    await record_audit(
        db,
        action="auth.login_password",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
        details={"used_backup_code": used_backup} if used_backup else {},
    )
    tokens = await _issue_session_tokens(
        user=user, request=request, response=response, db=db, settings=settings, mark_login=True
    )
    await db.commit()
    return tokens


@router.post("/refresh", response_model=TokenResponse)
async def refresh_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    raw_refresh = request.cookies.get("ht_refresh_token")
    if not raw_refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    try:
        payload = decode_token(raw_refresh, settings, expected_type="refresh")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    session_id = payload.get("sid")
    session = await db.get(UserSession, session_id) if session_id else None
    if (
        not session
        or session.revoked
        or _as_utc(session.expires_at) <= datetime.now(UTC)
        or session.refresh_token_hash != hash_api_key(raw_refresh)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked or invalid")

    user = await db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    await db.delete(session)
    tokens = await _issue_session_tokens(user=user, request=request, response=response, db=db, settings=settings)
    await db.commit()
    return tokens


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Reliably delete/revoke active UserSession via BOTH refresh cookie and Bearer/cookie access token sid."""
    sessions_to_delete: dict[str, UserSession] = {}

    raw_refresh = request.cookies.get("ht_refresh_token")
    if raw_refresh:
        refresh_hash = hash_api_key(raw_refresh)
        rows = (
            (await db.execute(select(UserSession).where(UserSession.refresh_token_hash == refresh_hash)))
            .scalars()
            .all()
        )
        for s in rows:
            sessions_to_delete[s.id] = s
        try:
            payload = decode_token(raw_refresh, settings, expected_type="refresh")
            sid = payload.get("sid")
            if sid and sid not in sessions_to_delete:
                s = await db.get(UserSession, sid)
                if s:
                    sessions_to_delete[s.id] = s
        except jwt.PyJWTError:
            pass

    candidate_access_tokens: list[str] = []
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        candidate_access_tokens.append(auth_header[7:].strip())
    cookie_access = request.cookies.get("ht_access_token")
    if cookie_access:
        candidate_access_tokens.append(cookie_access)

    for raw_access in candidate_access_tokens:
        try:
            payload = decode_token(raw_access, settings, expected_type="access")
            sid = payload.get("sid")
            if sid and sid not in sessions_to_delete:
                s = await db.get(UserSession, sid)
                if s:
                    sessions_to_delete[s.id] = s
        except jwt.PyJWTError:
            pass

    actor_user_id: str | None = None
    for s in sessions_to_delete.values():
        actor_user_id = actor_user_id or s.user_id
        await db.delete(s)

    if sessions_to_delete:
        await record_audit(
            db,
            action="auth.logout",
            user_id=actor_user_id,
            resource_type="user_session",
            resource_id=",".join(sessions_to_delete.keys())[:64],
            ip_address=extract_client_ip(request),
            details={"sessions_removed": len(sessions_to_delete)},
        )
        await db.commit()

    for cookie_name in ("ht_access_token", "ht_refresh_token"):
        for cookie_path in ("/", "/api/v1", "/api/v1/auth"):
            response.delete_cookie(cookie_name, path=cookie_path)

    return {"status": "logged_out", "sessions_removed": len(sessions_to_delete)}


@router.post("/download-token")
async def issue_download_token(
    request: Request,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Issue a short-lived (900s) signed JWT for direct/incognito file downloads via ?dl_token=."""
    ttl = 900
    sid = getattr(request.state, "current_sid", None)
    token = create_download_token(user.id, user.role, settings, session_id=sid, ttl_seconds=ttl)
    return {"dl_token": token, "expires_in": ttl}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if user.totp_enabled and user.totp_secret_enc:
        if not body.totp_code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP code required")
        secret = decrypt_secret(user.totp_secret_enc, settings.vault_master_key)
        valid = verify_totp_code(secret, body.totp_code)
        if not valid:
            valid, remaining = consume_backup_code(body.totp_code, list(user.totp_backup_hashes or []))
            if valid:
                user.totp_backup_hashes = remaining
        if not valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP or backup code")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password",
        )

    user.password_hash = hash_password(body.new_password)
    revoked_count = 0
    if body.revoke_other_sessions:
        current_sid = _resolve_current_sid(request, settings)
        stmt = select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked.is_(False))
        sessions = (await db.execute(stmt)).scalars().all()
        for s in sessions:
            if current_sid and s.id == current_sid:
                continue
            await db.delete(s)
            revoked_count += 1

    await record_audit(
        db,
        action="auth.password_changed",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
        details={"revoked_other_sessions": revoked_count},
    )
    await db.commit()
    return {"ok": True, "revoked_sessions": revoked_count}


@router.post("/2fa/setup")
async def setup_totp(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    secret = generate_totp_secret()
    user.totp_secret_enc = encrypt_secret(secret, settings.vault_master_key)
    await db.commit()
    uri = build_totp_uri(secret, user.username)
    qr_svg = generate_totp_qr_svg(uri)
    return {"secret": secret, "provisioning_uri": uri, "qr_svg": qr_svg}


@router.post("/2fa/verify")
async def verify_and_enable_totp(
    body: TOTPVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not user.totp_secret_enc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP setup not started")
    secret = decrypt_secret(user.totp_secret_enc, settings.vault_master_key)
    if not verify_totp_code(secret, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")

    backup_codes, backup_hashes = generate_backup_codes(10)
    user.totp_enabled = True
    user.totp_backup_hashes = backup_hashes
    await record_audit(
        db,
        action="auth.totp_enabled",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {"ok": True, "totp_enabled": True, "backup_codes": backup_codes}


@router.post("/2fa/disable")
async def disable_totp(
    body: TOTPDisableRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not user.totp_enabled or not user.totp_secret_enc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP 2FA is not enabled")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    secret = decrypt_secret(user.totp_secret_enc, settings.vault_master_key)
    valid = verify_totp_code(secret, body.code)
    if not valid:
        matched, _ = consume_backup_code(body.code, list(user.totp_backup_hashes or []))
        valid = matched
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP or backup code")

    user.totp_enabled = False
    user.totp_secret_enc = None
    user.totp_backup_hashes = []
    await record_audit(
        db,
        action="auth.totp_disabled",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {"ok": True, "totp_enabled": False}


@router.post("/webauthn/register/options")
async def webauthn_register_options(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    existing = (
        (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))).scalars().all()
    )
    exclude = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id)) for c in existing]

    options = generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.webauthn_rp_name,
        user_id=user.id.encode("utf-8"),
        user_name=user.username,
        user_display_name=user.display_name,
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    await _store_challenge(f"reg:{user.id}", options.challenge, settings)
    payload = json.loads(options_to_json(options))
    # Wrapped under "options" (same contract as /webauthn/login/options); top-level fields kept for compatibility.
    return {**payload, "options": payload}


@router.post("/webauthn/register/verify")
async def webauthn_register_verify(
    body: WebAuthnRegisterVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    expected_challenge = await _pop_challenge(f"reg:{user.id}", settings)
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=expected_challenge,
            expected_origin=settings.terminal_origin,
            expected_rp_id=settings.webauthn_rp_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Passkey verification failed: {exc}"
        ) from exc

    transports_raw = (body.credential.get("response") or {}).get("transports") or []
    transports = [str(t) for t in transports_raw if isinstance(t, str)]

    cred = WebAuthnCredential(
        user_id=user.id,
        credential_id=bytes_to_base64url(verified.credential_id),
        public_key=base64.b64encode(verified.credential_public_key).decode("ascii"),
        sign_count=verified.sign_count,
        device_name=body.device_name.strip() or "Passkey",
        transports=transports,
    )
    db.add(cred)
    await record_audit(
        db,
        action="auth.passkey_registered",
        user_id=user.id,
        resource_type="webauthn_credential",
        resource_id=cred.credential_id[:24],
        ip_address=extract_client_ip(request),
        details={"device_name": cred.device_name},
    )
    await db.commit()
    return {
        "id": cred.id,
        "device_name": cred.device_name,
        "sign_count": cred.sign_count,
        "transports": cred.transports,
        "created_at": cred.created_at.isoformat(),
    }


@router.post("/webauthn/login/options")
async def webauthn_login_options(
    body: WebAuthnLoginOptionsRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    allow_credentials: list[PublicKeyCredentialDescriptor] = []
    challenge_key = "login:discoverable"
    if body.username:
        user = (
            await db.execute(select(User).where(User.username == body.username.strip().lower()))
        ).scalar_one_or_none()
        if user:
            creds = (
                (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)))
                .scalars()
                .all()
            )
            allow_credentials = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id)) for c in creds]
            challenge_key = f"login:{user.id}"

    options = generate_authentication_options(
        rp_id=settings.webauthn_rp_id,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    await _store_challenge(challenge_key, options.challenge, settings)
    return {"challenge_key": challenge_key, "options": json.loads(options_to_json(options))}


@router.post("/webauthn/login/verify", response_model=TokenResponse)
async def webauthn_login_verify(
    body: WebAuthnLoginVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    expected_challenge = await _pop_challenge(body.challenge_key, settings)
    cred_id = body.credential.get("id")
    if not cred_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing credential id")

    cred = (
        await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.credential_id == cred_id))
    ).scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown passkey")

    try:
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.terminal_origin,
            credential_public_key=base64.b64decode(cred.public_key.encode("ascii")),
            credential_current_sign_count=cred.sign_count,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Passkey login failed: {exc}") from exc

    cred.sign_count = verified.new_sign_count
    cred.last_used_at = datetime.now(UTC)

    user = await db.get(User, cred.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    await record_audit(
        db,
        action="auth.login_passkey",
        user_id=user.id,
        resource_type="webauthn_credential",
        resource_id=cred.id,
        ip_address=extract_client_ip(request),
    )
    tokens = await _issue_session_tokens(
        user=user, request=request, response=response, db=db, settings=settings, mark_login=True
    )
    await db.commit()
    return tokens


@router.get("/webauthn/credentials")
async def list_passkeys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    creds = (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))).scalars().all()
    return page.apply([
        {
            "id": c.id,
            "device_name": c.device_name,
            "sign_count": c.sign_count,
            "transports": c.transports or [],
            "created_at": c.created_at.isoformat(),
            "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
        }
        for c in creds
    ])


@router.delete("/webauthn/credentials/{cred_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passkey(
    cred_id: str,
    request: Request,
    totp_code: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    if user.totp_enabled and user.totp_secret_enc:
        secret = decrypt_secret(user.totp_secret_enc, settings.vault_master_key)
        if not totp_code or not verify_totp_code(secret, totp_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Valid 2FA TOTP code is required to remove a WebAuthn Passkey",
            )
    cred = await db.get(WebAuthnCredential, cred_id)
    if not cred or cred.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not found")
    await db.delete(cred)
    await record_audit(
        db,
        action="auth.passkey_deleted",
        user_id=user.id,
        resource_type="webauthn_credential",
        resource_id=cred_id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()


@router.get("/ip-lookup/{ip_addr}")
async def lookup_ip_geolocation(
    ip_addr: str,
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Resolve IP geolocation for the Security Map (handles NetBird 100.104.x.x safely without SSRF)."""
    cleaned = ip_addr.strip()
    try:
        ip_obj = ipaddress.ip_address(cleaned)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid IP address") from exc

    netbird_net = ipaddress.ip_network("100.104.0.0/16")
    if ip_obj.version == 4 and ip_obj in netbird_net:
        return {
            "ip": cleaned,
            "is_private": True,
            "is_netbird": True,
            "country": "NetBird Private Mesh VPN",
            "country_code": "VPN",
            "city": "Encrypted Tunnel (100.104.0.0/16)",
            "region": "Zero-Trust WireGuard",
            "isp": "Huseynovlar NetBird Mesh",
            "lat": 40.4093,
            "lon": 49.8671,
        }

    if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved or ip_obj.is_link_local:
        return {
            "ip": cleaned,
            "is_private": True,
            "is_netbird": False,
            "country": "Local / Private Network",
            "country_code": "LAN",
            "city": "Internal Docker / LAN",
            "region": "RFC1918",
            "isp": "Local Interface",
            "lat": 40.4093,
            "lon": 49.8671,
        }

    try:
        geo_template = settings.ip_geo_api_url or "https://ipwho.is/{ip}"
        async with httpx.AsyncClient(timeout=4.0) as http:
            resp = await http.get(geo_template.format(ip=cleaned))
            data = resp.json()
            if data.get("success"):
                return {
                    "ip": cleaned,
                    "is_private": False,
                    "is_netbird": False,
                    "country": data.get("country") or "Unknown",
                    "country_code": data.get("country_code") or "",
                    "city": data.get("city") or "",
                    "region": data.get("region") or "",
                    "isp": (data.get("connection") or {}).get("isp") or "",
                    "lat": float(data.get("latitude") or 0.0),
                    "lon": float(data.get("longitude") or 0.0),
                }
    except Exception:
        pass

    return {
        "ip": cleaned,
        "is_private": False,
        "is_netbird": False,
        "country": "Lookup unavailable",
        "country_code": "",
        "city": "",
        "region": "",
        "isp": "",
        "lat": 0.0,
        "lon": 0.0,
    }


@router.get("/sessions")
async def list_active_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    """List active non-revoked, non-expired sessions with is_current flag."""
    current_sid = _resolve_current_sid(request, settings)
    now = datetime.now(UTC)

    rows = (
        (
            await db.execute(
                select(UserSession)
                .where(UserSession.user_id == user.id, UserSession.revoked.is_(False))
                .order_by(UserSession.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    return page.apply([
        {
            "id": s.id,
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "is_current": bool(current_sid and s.id == current_sid),
            "created_at": s.created_at.isoformat(),
            "expires_at": s.expires_at.isoformat(),
        }
        for s in rows
        if _as_utc(s.expires_at) > now
    ])


@router.get("/sessions/{session_id}")
async def get_session_detail(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    session = await db.get(UserSession, session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    current_sid = _resolve_current_sid(request, settings)
    return {
        "id": session.id,
        "user_id": session.user_id,
        "ip_address": session.ip_address,
        "user_agent": session.user_agent,
        "revoked": session.revoked,
        "is_current": bool(current_sid and session.id == current_sid),
        "is_expired": _as_utc(session.expires_at) <= datetime.now(UTC),
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
    }


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Terminate all active sessions for the current user except the active session."""
    current_sid = _resolve_current_sid(request, settings)
    rows = (
        (
            await db.execute(
                select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked.is_(False))
            )
        )
        .scalars()
        .all()
    )
    revoked_count = 0
    for s in rows:
        if current_sid and s.id == current_sid:
            continue
        await db.delete(s)
        revoked_count += 1

    await record_audit(
        db,
        action="auth.sessions_revoked_others",
        user_id=user.id,
        resource_type="user_session",
        resource_id=current_sid or "",
        ip_address=extract_client_ip(request),
        details={"revoked_count": revoked_count},
    )
    await db.commit()
    return {"ok": True, "revoked_count": revoked_count}


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    """Terminate any active session EXCEPT the current session."""
    current_sid = _resolve_current_sid(request, settings)
    if current_sid and current_sid == session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot terminate current active session; use Logout instead",
        )

    session = await db.get(UserSession, session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    await db.delete(session)
    await record_audit(
        db,
        action="auth.session_revoked",
        user_id=user.id,
        resource_type="user_session",
        resource_id=session_id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()


@router.get("/login-history")
async def get_login_history(
    q: str | None = Query(default=None),
    action: str | None = Query(default=None),
    ip: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.action.like("auth.%"))
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(AuditLog.id.ilike(pat) | AuditLog.action.ilike(pat) | AuditLog.ip_address.ilike(pat))
    if action:
        stmt = stmt.where(AuditLog.action == action.strip())
    if ip:
        stmt = stmt.where(AuditLog.ip_address.ilike(f"%{ip.strip()}%"))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    page.set_headers(int(total or 0))
    rows = (
        (await db.execute(stmt.order_by(AuditLog.created_at.desc()).limit(page.limit).offset(page.offset)))
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "action": r.action,
            "action_label": audit_event_label(r.action),
            "ip_address": r.ip_address,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/login-history/{entry_id}")
async def get_login_history_detail(
    entry_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await db.get(AuditLog, entry_id)
    if not row or not row.action.startswith("auth."):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login history entry not found")
    if row.user_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login history entry not found")
    return {
        "id": row.id,
        "user_id": row.user_id,
        "action": row.action,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "ip_address": row.ip_address,
        "details": row.details,
        "created_at": row.created_at.isoformat(),
    }
