from __future__ import annotations

import pyotp

from app.core.crypto import (
    decrypt_secret,
    encrypt_secret,
    generate_account_api_key,
    verify_api_key,
)
from app.core.security import generate_totp_secret, hash_password, verify_password, verify_totp_code


def test_aes_256_gcm_roundtrip_and_random_nonce():
    master = "super-secret-master-key"
    c1 = encrypt_secret("AIzaSyDummyGoogleKey", master)
    c2 = encrypt_secret("AIzaSyDummyGoogleKey", master)
    assert c1 != c2  # random 96-bit nonce every time
    assert decrypt_secret(c1, master) == "AIzaSyDummyGoogleKey"
    assert decrypt_secret(c2, master) == "AIzaSyDummyGoogleKey"


def test_account_api_key_hash_and_verify():
    plaintext, prefix, digest = generate_account_api_key()
    assert plaintext.startswith("htk_")
    assert plaintext.startswith(prefix)
    assert verify_api_key(plaintext, digest) is True
    assert verify_api_key(plaintext + "x", digest) is False


def test_argon2id_and_totp():
    hashed = hash_password("StrongPassphrase!2026")
    assert verify_password("StrongPassphrase!2026", hashed) is True
    assert verify_password("wrong", hashed) is False

    secret = generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    assert verify_totp_code(secret, code) is True
    assert verify_totp_code(secret, "000000") is False
