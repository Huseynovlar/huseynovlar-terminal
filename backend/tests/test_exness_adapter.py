from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from app.modules.brokers.exness import (
    EMPTY_BODY_SHA256_B64URL,
    load_ed25519_private_key,
    sign_exness_request,
)


def _b64url_decode(val: str) -> bytes:
    pad = "=" * (-len(val) % 4)
    return base64.urlsafe_b64decode(val + pad)


def test_ed25519_key_loaders_equivalent() -> None:
    key = Ed25519PrivateKey.generate()
    pem_str = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode("utf-8")
    raw_bytes = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    b64_str = base64.urlsafe_b64encode(raw_bytes).rstrip(b"=").decode("ascii")
    hex_str = raw_bytes.hex()

    k_pem = load_ed25519_private_key(pem_str)
    k_b64 = load_ed25519_private_key(b64_str)
    k_hex = load_ed25519_private_key(hex_str)

    pub_expected = key.public_key().public_bytes(Encoding.Raw, PrivateFormat.Raw) if False else None
    assert k_pem.public_key().public_bytes_raw() == key.public_key().public_bytes_raw()
    assert k_b64.public_key().public_bytes_raw() == key.public_key().public_bytes_raw()
    assert k_hex.public_key().public_bytes_raw() == key.public_key().public_bytes_raw()
    assert pub_expected is None


def test_sign_exness_get_request_matches_spec() -> None:
    key = Ed25519PrivateKey.generate()
    headers = sign_exness_request(
        api_key="exnsk-test123",
        private_key=key,
        method="GET",
        path_with_query="/v1/trading/access-point?account_id=253752700",
        timestamp_ms=1773656070123,
    )

    assert headers["EXN-API-KEY"] == "exnsk-test123"
    assert headers["EXN-IDEMPOTENCY-KEY"] == ""
    assert headers["EXN-TIMESTAMP"] == "1773656070123"
    assert headers["EXN-SIGN-VERSION"] == "1"
    assert "=" not in headers["EXN-DATA"]
    assert "=" not in headers["EXN-SIGN"]

    decoded_bytes = _b64url_decode(headers["EXN-DATA"])
    payload = json.loads(decoded_bytes.decode("utf-8"))
    assert payload == {
        "api_key": "exnsk-test123",
        "idempotency_key": "",
        "timestamp": 1773656070123,
        "sign_version": 1,
        "method": "GET",
        "path": "/v1/trading/access-point?account_id=253752700",
        "body_hash": EMPTY_BODY_SHA256_B64URL,
    }

    # Verify Ed25519 signature over decoded EXN-DATA payload bytes (not base64url string)
    sig_bytes = _b64url_decode(headers["EXN-SIGN"])
    key.public_key().verify(sig_bytes, decoded_bytes)


def test_invalid_private_key_raises() -> None:
    with pytest.raises(ValueError):
        load_ed25519_private_key("not-a-valid-key")
