from __future__ import annotations

import hashlib
import hmac
import io
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pyotp
import segno
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import Settings

_password_hasher = PasswordHasher()

PASSWORD_MIN_LENGTH = 8
PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 8 characters and contain an uppercase letter, "
    "a lowercase letter, a digit and a special character"
)


def validate_password_strength(password: str) -> str:
    """Enforce 8+ chars with upper, lower, digit and special character; returns the password."""
    ok = (
        len(password) >= PASSWORD_MIN_LENGTH
        and any(c.isupper() for c in password)
        and any(c.islower() for c in password)
        and any(c.isdigit() for c in password)
        and any(not c.isalnum() for c in password)
    )
    if not ok:
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return password


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(
    user_id: str,
    role: str,
    settings: Settings,
    session_id: str | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_download_token(
    user_id: str,
    role: str,
    settings: Settings,
    session_id: str | None = None,
    ttl_seconds: int = 900,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "type": "download",
        "purpose": "download",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, session_id: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "sid": session_id,
        "type": "refresh",
        "jti": secrets.token_hex(16),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.refresh_token_expire_days)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, settings: Settings, expected_type: str | None = None) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if expected_type and payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def build_totp_uri(secret: str, username: str, issuer: str = "Huseynovlar Terminal") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)


def generate_totp_qr_svg(provisioning_uri: str) -> str:
    qr = segno.make(provisioning_uri, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", xmldecl=False, scale=4, border=2, dark="#111827", light="#FFFFFF")
    return buf.getvalue().decode("utf-8")


def verify_totp_code(secret: str, code: str) -> bool:
    cleaned = code.strip().replace(" ", "")
    if not cleaned:
        return False
    return pyotp.TOTP(secret).verify(cleaned, valid_window=1)


def _normalize_backup_code(code: str) -> str:
    return code.strip().upper().replace("-", "").replace(" ", "")


def hash_backup_code(code: str) -> str:
    normalized = _normalize_backup_code(code)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def generate_backup_codes(count: int = 10) -> tuple[list[str], list[str]]:
    plaintext: list[str] = []
    hashes: list[str] = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()
        formatted = f"{raw[:4]}-{raw[4:]}"
        plaintext.append(formatted)
        hashes.append(hash_backup_code(formatted))
    return plaintext, hashes


def consume_backup_code(code: str, stored_hashes: list[str]) -> tuple[bool, list[str]]:
    if not stored_hashes:
        return False, []
    candidate = hash_backup_code(code)
    matched_idx = -1
    for idx, stored in enumerate(stored_hashes):
        if hmac.compare_digest(stored, candidate):
            matched_idx = idx
            break
    if matched_idx < 0:
        return False, list(stored_hashes)
    remaining = [h for i, h in enumerate(stored_hashes) if i != matched_idx]
    return True, remaining
