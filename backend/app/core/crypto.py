from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

API_KEY_PREFIX = "htk_"


def _derive_aes_key(master_key: str) -> bytes:
    """Derive a deterministic 256-bit key from VAULT_MASTER_KEY."""
    return hashlib.sha256(master_key.encode("utf-8")).digest()


def encrypt_secret(plaintext: str, master_key: str) -> str:
    """Encrypt sensitive strings (Google AI key, Telegram token, external keys) with AES-256-GCM."""
    if not plaintext:
        return ""
    key = _derive_aes_key(master_key)
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(token: str, master_key: str) -> str:
    """Decrypt an AES-256-GCM encrypted secret."""
    if not token:
        return ""
    raw = base64.urlsafe_b64decode(token.encode("ascii"))
    if len(raw) < 13:
        raise ValueError("Invalid encrypted secret payload")
    nonce, ciphertext = raw[:12], raw[12:]
    key = _derive_aes_key(master_key)
    return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")


def generate_account_api_key() -> tuple[str, str, str]:
    """Generate a new MT5 account API key.

    Returns (plaintext_key, display_prefix, sha256_hex_hash).
    Plaintext is returned once at creation/rotation and never stored in DB.
    """
    raw = f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"
    prefix = raw[:12]
    digest = hash_api_key(raw)
    return raw, prefix, digest


def hash_api_key(plaintext_key: str) -> str:
    return hashlib.sha256(plaintext_key.encode("utf-8")).hexdigest()


def verify_api_key(plaintext_key: str, expected_hash: str) -> bool:
    if not plaintext_key or not expected_hash:
        return False
    return hmac.compare_digest(hash_api_key(plaintext_key), expected_hash)
