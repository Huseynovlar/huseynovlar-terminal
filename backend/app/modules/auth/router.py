from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
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

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret, encrypt_secret, hash_api_key
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit
from app.core.security import (
    build_totp_uri,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_totp_secret,
    hash_password,
    verify_password,
    verify_totp_code,
)
from app.db.models import User, UserSession, WebAuthnCredential

router = APIRouter(prefix="/auth", tags=["auth"])

# Short-lived in-memory challenge store (replaced/backed by Redis in multi-worker prod)
_webauthn_challenges: dict[str, tuple[bytes, datetime]] = {}


def _store_challenge(key: str, challenge: bytes, ttl_sec: int = 300) -> None:
    _webauthn_challenges[key] = (challenge, datetime.now(UTC) + timedelta(seconds=ttl_sec))


def _pop_challenge(key: str) -> bytes:
    entry = _webauthn_challenges.pop(key, None)
    if not entry:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn challenge missing or expired")
    challenge, expires_at = entry
    if datetime.now(UTC) > expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn challenge expired")
    return challenge


class BootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(default="Owner", max_length=120)


class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str
    totp_enabled: bool


class TOTPVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class WebAuthnRegisterVerifyRequest(BaseModel):
    device_name: str = Field(default="My Passkey", max_length=120)
    credential: dict[str, Any]


class WebAuthnLoginOptionsRequest(BaseModel):
    username: str | None = None


class WebAuthnLoginVerifyRequest(BaseModel):
    challenge_key: str
    credential: dict[str, Any]


async def _issue_session_tokens(
    *,
    user: User,
    request: Request,
    response: Response,
    db: AsyncSession,
    settings: Settings,
) -> TokenResponse:
    access_token = create_access_token(user.id, user.role, settings)
    expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    session = UserSession(
        user_id=user.id,
        refresh_token_hash="pending",
        ip_address=request.client.host if request.client else "",
        user_agent=request.headers.get("user-agent", "")[:255],
        expires_at=expires_at,
    )
    db.add(session)
    await db.flush()

    refresh_token = create_refresh_token(user.id, session.id, settings)
    session.refresh_token_hash = hash_api_key(refresh_token)

    response.set_cookie(
        key="ht_refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
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

    user = User(
        username=body.username.strip().lower(),
        email=str(body.email).lower(),
        password_hash=hash_password(body.password),
        role="ADMIN",
        display_name=body.display_name.strip() or "Owner",
        preferences={
            "language": "ru",
            "timezone": settings.default_timezone,
            "currency_mode": "USD",
            "density": "comfortable",
            "privacy_mode": False,
            "ticker_enabled": True,
            "ticker_speed": "normal",
        },
    )
    db.add(user)
    await db.flush()
    await record_audit(
        db,
        action="auth.bootstrap_owner",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=request.client.host if request.client else "",
    )
    tokens = await _issue_session_tokens(user=user, request=request, response=response, db=db, settings=settings)
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

    if user.totp_enabled:
        if not body.totp_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="TOTP 2FA code required")
        secret = decrypt_secret(user.totp_secret_enc or "", settings.vault_master_key)
        if not verify_totp_code(secret, body.totp_code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP 2FA code")

    await record_audit(
        db,
        action="auth.login_password",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=request.client.host if request.client else "",
    )
    tokens = await _issue_session_tokens(user=user, request=request, response=response, db=db, settings=settings)
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
    if not session or session.revoked or session.refresh_token_hash != hash_api_key(raw_refresh):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked or invalid")

    user = await db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    session.revoked = True
    tokens = await _issue_session_tokens(user=user, request=request, response=response, db=db, settings=settings)
    await db.commit()
    return tokens


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    raw_refresh = request.cookies.get("ht_refresh_token")
    if raw_refresh:
        try:
            payload = decode_token(raw_refresh, settings, expected_type="refresh")
            session = await db.get(UserSession, payload.get("sid"))
            if session:
                session.revoked = True
                await db.commit()
        except jwt.PyJWTError:
            pass
    response.delete_cookie("ht_refresh_token", path="/api/v1/auth")
    return {"status": "logged_out"}


@router.post("/2fa/setup")
async def setup_totp(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    secret = generate_totp_secret()
    user.totp_secret_enc = encrypt_secret(secret, settings.vault_master_key)
    await db.commit()
    return {"secret": secret, "provisioning_uri": build_totp_uri(secret, user.username)}


@router.post("/2fa/verify")
async def verify_and_enable_totp(
    body: TOTPVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    if not user.totp_secret_enc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP setup not started")
    secret = decrypt_secret(user.totp_secret_enc, settings.vault_master_key)
    if not verify_totp_code(secret, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")
    user.totp_enabled = True
    await record_audit(
        db,
        action="auth.totp_enabled",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
    return {"totp_enabled": True}


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
    _store_challenge(f"reg:{user.id}", options.challenge)
    return json.loads(options_to_json(options))


@router.post("/webauthn/register/verify")
async def webauthn_register_verify(
    body: WebAuthnRegisterVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    expected_challenge = _pop_challenge(f"reg:{user.id}")
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

    cred = WebAuthnCredential(
        user_id=user.id,
        credential_id=bytes_to_base64url(verified.credential_id),
        public_key=base64.b64encode(verified.credential_public_key).decode("ascii"),
        sign_count=verified.sign_count,
        device_name=body.device_name.strip() or "Passkey",
    )
    db.add(cred)
    await record_audit(
        db,
        action="auth.passkey_registered",
        user_id=user.id,
        resource_type="webauthn_credential",
        resource_id=cred.credential_id[:24],
        ip_address=request.client.host if request.client else "",
        details={"device_name": cred.device_name},
    )
    await db.commit()
    return {"id": cred.id, "device_name": cred.device_name, "created_at": cred.created_at.isoformat()}


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
    _store_challenge(challenge_key, options.challenge)
    return {"challenge_key": challenge_key, "options": json.loads(options_to_json(options))}


@router.post("/webauthn/login/verify", response_model=TokenResponse)
async def webauthn_login_verify(
    body: WebAuthnLoginVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    expected_challenge = _pop_challenge(body.challenge_key)
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
        ip_address=request.client.host if request.client else "",
    )
    tokens = await _issue_session_tokens(user=user, request=request, response=response, db=db, settings=settings)
    await db.commit()
    return tokens


@router.get("/webauthn/credentials")
async def list_passkeys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    creds = (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))).scalars().all()
    return [
        {
            "id": c.id,
            "device_name": c.device_name,
            "created_at": c.created_at.isoformat(),
            "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
        }
        for c in creds
    ]


@router.delete("/webauthn/credentials/{cred_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passkey(
    cred_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
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
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
