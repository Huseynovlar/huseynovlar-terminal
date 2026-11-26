from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from app.modules.brokers.base import BrokerApiAdapter, BrokerConnectionResult

EMPTY_BODY_SHA256_B64URL = "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"

_EXNESS_ERROR_HINTS: dict[int, str] = {
    1000: "AUTH_INVALID_API_KEY: проверьте EXN-API-KEY, срок действия ключа и разрешённый IP сервера.",
    1001: (
        "AUTH_INVALID_SIGNATURE: проверьте Ed25519 приватный ключ "
        "(должен соответствовать зарегистрированному публичному ключу) и синхронизацию времени."
    ),
    1002: (
        "AUTH_PERMISSION_DENIED: у API-ключа нет прав на выбранный scope "
        "(Trading / Payments / Partnership) или IP сервера не в белом списке."
    ),
    1003: "AUTH_RATE_LIMIT: превышен лимит запросов аутентификации — повторите чуть позже.",
    2000: "ACCOUNT_NOT_FOUND: торговый счёт не найден или не доступен для этого API-ключа.",
    3001: "REQUEST_INVALID_PARAMETERS: некорректный формат параметров или account_id.",
}


def _b64url_no_pad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode_padded(val: str) -> bytes:
    cleaned = val.strip()
    pad = "=" * (-len(cleaned) % 4)
    return base64.urlsafe_b64decode(cleaned + pad)


def load_ed25519_private_key(raw_key: str) -> Ed25519PrivateKey:
    """Load an Ed25519 private key from PEM (PKCS8), base64/base64url raw 32-byte seed, or hex."""
    text = raw_key.strip()
    if not text:
        raise ValueError("Ed25519 private key is empty")

    # 1. PEM format (handles literal \n from env/form paste too)
    if "BEGIN" in text:
        normalized = text.replace("\\n", "\n").encode("utf-8")
        key_obj = load_pem_private_key(normalized, password=None)
        if not isinstance(key_obj, Ed25519PrivateKey):
            raise ValueError("Provided PEM key is not an Ed25519 private key")
        return key_obj

    # 2. Hex 32-byte seed (64 hex chars) or 64-byte keypair (128 hex chars -> first 32 bytes seed)
    compact = "".join(text.split())
    if len(compact) in (64, 128):
        try:
            raw_bytes = bytes.fromhex(compact)
            return Ed25519PrivateKey.from_private_bytes(raw_bytes[:32])
        except ValueError:
            pass

    # 3. Base64 or base64url encoded 32-byte seed or 64-byte keypair
    try:
        raw_bytes = _b64url_decode_padded(compact)
        if len(raw_bytes) in (32, 64):
            return Ed25519PrivateKey.from_private_bytes(raw_bytes[:32])
    except Exception:
        pass

    raise ValueError(
        "Unsupported Ed25519 private key format. Provide PEM (-----BEGIN PRIVATE KEY-----), "
        "32-byte base64/base64url seed, or 64-char hex."
    )


def sign_exness_request(
    *,
    api_key: str,
    private_key: Ed25519PrivateKey,
    method: str,
    path_with_query: str,
    body_bytes: bytes = b"",
    idempotency_key: str | None = None,
    timestamp_ms: int | None = None,
) -> dict[str, str]:
    """Build official Exness API v1 EXN-* signed headers using Ed25519.

    Per Exness Authentication / Request Signing spec:
    - EXN-DATA is base64url(no padding) of JSON payload bytes
    - EXN-SIGN is base64url(no padding) of Ed25519 signature over decoded EXN-DATA JSON bytes
    - For signed GET requests, EXN-IDEMPOTENCY-KEY MUST be present with empty value ""
    - For mutating requests, EXN-IDEMPOTENCY-KEY MUST be non-empty
    """
    upper_method = method.strip().upper()
    if upper_method == "GET":
        idem = ""
    else:
        idem = idempotency_key if (idempotency_key and idempotency_key.strip()) else str(uuid.uuid4())

    ts = int(timestamp_ms if timestamp_ms is not None else time.time() * 1000)
    body_hash = EMPTY_BODY_SHA256_B64URL if not body_bytes else _b64url_no_pad(hashlib.sha256(body_bytes).digest())

    payload = {
        "api_key": api_key.strip(),
        "idempotency_key": idem,
        "timestamp": ts,
        "sign_version": 1,
        "method": upper_method,
        "path": path_with_query,
        "body_hash": body_hash,
    }
    raw_payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    exn_data = _b64url_no_pad(raw_payload_bytes)
    exn_sign = _b64url_no_pad(private_key.sign(raw_payload_bytes))

    return {
        "EXN-API-KEY": api_key.strip(),
        "EXN-IDEMPOTENCY-KEY": idem,
        "EXN-TIMESTAMP": str(ts),
        "EXN-SIGN-VERSION": "1",
        "EXN-DATA": exn_data,
        "EXN-SIGN": exn_sign,
    }


def _normalize_base_url(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    if not cleaned:
        raise ValueError("Gateway URL is required (copy from Exness API Portal DNS widget)")
    if not cleaned.startswith(("https://", "http://")):
        cleaned = f"https://{cleaned}"
    parsed = urlparse(cleaned)
    if not parsed.netloc:
        raise ValueError(f"Invalid Gateway URL: {url}")
    return f"{parsed.scheme}://{parsed.netloc}"


def _extract_exness_error(resp: httpx.Response) -> tuple[str | None, str, str | None]:
    code_str: str | None = None
    msg = f"HTTP {resp.status_code}"
    hint: str | None = None
    try:
        data = resp.json()
        if isinstance(data, dict):
            raw_code = data.get("code")
            if isinstance(raw_code, int):
                code_str = str(raw_code)
                hint = _EXNESS_ERROR_HINTS.get(raw_code)
            elif raw_code is not None:
                code_str = str(raw_code)
            err_msg = data.get("error_message") or data.get("message") or data.get("description") or data.get("detail")
            if err_msg:
                msg = str(err_msg)
    except Exception:
        body_preview = (resp.text or "").strip()[:240]
        if body_preview:
            msg = f"HTTP {resp.status_code}: {body_preview}"
    if not hint:
        if resp.status_code == 401:
            hint = "Проверьте EXN-API-KEY, Ed25519 приватный ключ и синхронизацию системного времени."
        elif resp.status_code == 403:
            hint = "Доступ запрещён: проверьте scope API-ключа и белый список IP-адресов в Exness API Portal."
        elif resp.status_code == 429:
            hint = "Превышен rate-limit Exness API. Подождите Retry-After и повторите."
    return code_str, msg, hint


class ExnessApiAdapter(BrokerApiAdapter):
    """Official Exness API v1 adapter supporting Trading, Payments, and Partnership scopes."""

    broker_name = "exness"

    def __init__(
        self,
        *,
        api_key: str,
        private_key_raw: str,
        gateway_url: str,
        timeout_sec: float = 10.0,
    ) -> None:
        self.api_key = api_key.strip()
        if not self.api_key:
            raise ValueError("Exness API key is required")
        self.private_key = load_ed25519_private_key(private_key_raw)
        self.gateway_url = _normalize_base_url(gateway_url)
        self.timeout_sec = timeout_sec
        self._access_point_cache: dict[str, str] = {}

    async def _signed_request(
        self,
        base_url: str,
        method: str,
        path_with_query: str,
        *,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        body_bytes = b""
        extra_headers: dict[str, str] = {}
        if json_body is not None:
            body_bytes = json.dumps(json_body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            extra_headers["Content-Type"] = "application/json"

        headers = sign_exness_request(
            api_key=self.api_key,
            private_key=self.private_key,
            method=method,
            path_with_query=path_with_query,
            body_bytes=body_bytes,
            idempotency_key=idempotency_key,
        )
        headers.update(extra_headers)

        async with httpx.AsyncClient(timeout=self.timeout_sec, follow_redirects=False) as http:
            return await http.request(
                method=method.upper(),
                url=f"{base_url.rstrip('/')}{path_with_query}",
                content=body_bytes if body_bytes else None,
                headers=headers,
            )

    def build_ws_handshake_headers(self, ws_path_with_query: str) -> dict[str, str]:
        """Sign an Exness WebSocket handshake as GET per Subscribe To WebSocket Events spec."""
        return sign_exness_request(
            api_key=self.api_key,
            private_key=self.private_key,
            method="GET",
            path_with_query=ws_path_with_query,
            body_bytes=b"",
        )

    async def discover_access_point(self, account_id: str) -> str:
        clean_id = str(account_id).strip()
        if clean_id in self._access_point_cache:
            return self._access_point_cache[clean_id]
        path = f"/v1/trading/access-point?account_id={clean_id}"
        resp = await self._signed_request(self.gateway_url, "GET", path)
        if resp.status_code != 200:
            code, msg, _ = _extract_exness_error(resp)
            raise RuntimeError(f"Access point discovery failed ({resp.status_code}/{code}): {msg}")
        data = resp.json()
        ap = str(data.get("access_point") or "").strip().rstrip("/")
        if not ap:
            raise RuntimeError("Exness discovery response missing access_point")
        self._access_point_cache[clean_id] = ap
        return ap

    async def get_account_info(self, account_id: str, *, access_point: str | None = None) -> dict[str, Any]:
        clean_id = str(account_id).strip()
        ap = access_point or await self.discover_access_point(clean_id)
        path = f"/v1/configuration/accounts/{clean_id}/account"
        resp = await self._signed_request(ap, "GET", path)
        if resp.status_code != 200:
            code, msg, _ = _extract_exness_error(resp)
            raise RuntimeError(f"Account info failed ({resp.status_code}/{code}): {msg}")
        return resp.json()

    async def get_balance(self, account_id: str) -> dict[str, Any]:
        clean_id = str(account_id).strip()
        path = f"/v1/accounts/{clean_id}/balance"
        resp = await self._signed_request(self.gateway_url, "GET", path)
        if resp.status_code != 200:
            code, msg, _ = _extract_exness_error(resp)
            raise RuntimeError(f"Payments balance failed ({resp.status_code}/{code}): {msg}")
        return resp.json()

    async def get_positions(self, account_id: str) -> list[dict[str, Any]]:
        clean_id = str(account_id).strip()
        ap = await self.discover_access_point(clean_id)
        path = f"/v1/trading/accounts/{clean_id}/positions"
        resp = await self._signed_request(ap, "GET", path)
        if resp.status_code != 200:
            code, msg, _ = _extract_exness_error(resp)
            raise RuntimeError(f"Positions request failed ({resp.status_code}/{code}): {msg}")
        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return list(data.get("positions") or data.get("items") or [])
        return []

    async def test_connection(
        self,
        *,
        account_id: str | None = None,
        scope: str = "trading",
    ) -> BrokerConnectionResult:
        """Execute a live read-only signed verification call against Exness API v1."""
        t0 = time.perf_counter()
        clean_scope = (scope or "trading").strip().lower()
        clean_acc = str(account_id or "").strip()

        try:
            if clean_scope == "partnership":
                path = "/v1/partnership/partner/default-link"
                resp = await self._signed_request(self.gateway_url, "GET", path)
                latency_ms = int((time.perf_counter() - t0) * 1000)
                if resp.status_code == 200:
                    return BrokerConnectionResult(
                        ok=True,
                        broker=self.broker_name,
                        scope="partnership",
                        latency_ms=latency_ms,
                        http_status=200,
                        details=resp.json() if resp.content else {},
                    )
                code, msg, hint = _extract_exness_error(resp)
                return BrokerConnectionResult(
                    ok=False,
                    broker=self.broker_name,
                    scope="partnership",
                    latency_ms=latency_ms,
                    http_status=resp.status_code,
                    error_code=code,
                    error=msg,
                    hint=hint,
                )

            if not clean_acc:
                return BrokerConnectionResult(
                    ok=False,
                    broker=self.broker_name,
                    scope=clean_scope,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    error_code="MISSING_ACCOUNT_ID",
                    error="Для проверки Trading или Payments API укажите Account ID (номер торгового счёта Exness).",
                    hint="Введите номер счёта (например, 253752700) в поле Account ID для теста.",
                )

            if clean_scope == "payments":
                path = f"/v1/accounts/{clean_acc}/balance"
                resp = await self._signed_request(self.gateway_url, "GET", path)
                latency_ms = int((time.perf_counter() - t0) * 1000)
                if resp.status_code == 200:
                    bal = resp.json()
                    return BrokerConnectionResult(
                        ok=True,
                        broker=self.broker_name,
                        scope="payments",
                        latency_ms=latency_ms,
                        http_status=200,
                        account_id=clean_acc,
                        balance=bal,
                    )
                code, msg, hint = _extract_exness_error(resp)
                return BrokerConnectionResult(
                    ok=False,
                    broker=self.broker_name,
                    scope="payments",
                    latency_ms=latency_ms,
                    http_status=resp.status_code,
                    account_id=clean_acc,
                    error_code=code,
                    error=msg,
                    hint=hint,
                )

            # Default: Trading API -> Step 1: Discovery, Step 2: Account info
            disc_path = f"/v1/trading/access-point?account_id={clean_acc}"
            disc_resp = await self._signed_request(self.gateway_url, "GET", disc_path)
            if disc_resp.status_code != 200:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                code, msg, hint = _extract_exness_error(disc_resp)
                return BrokerConnectionResult(
                    ok=False,
                    broker=self.broker_name,
                    scope="trading",
                    latency_ms=latency_ms,
                    http_status=disc_resp.status_code,
                    account_id=clean_acc,
                    error_code=code,
                    error=msg,
                    hint=hint,
                )

            disc_json = disc_resp.json()
            access_point = str(disc_json.get("access_point") or "").strip().rstrip("/")
            if not access_point:
                return BrokerConnectionResult(
                    ok=False,
                    broker=self.broker_name,
                    scope="trading",
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    http_status=200,
                    account_id=clean_acc,
                    error="Gateway вернул 200, но поле access_point пустое.",
                )

            acc_path = f"/v1/configuration/accounts/{clean_acc}/account"
            acc_resp = await self._signed_request(access_point, "GET", acc_path)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if acc_resp.status_code == 200:
                return BrokerConnectionResult(
                    ok=True,
                    broker=self.broker_name,
                    scope="trading",
                    latency_ms=latency_ms,
                    http_status=200,
                    access_point=access_point,
                    account_id=clean_acc,
                    account_info=acc_resp.json() if acc_resp.content else {},
                )

            code, msg, hint = _extract_exness_error(acc_resp)
            return BrokerConnectionResult(
                ok=False,
                broker=self.broker_name,
                scope="trading",
                latency_ms=latency_ms,
                http_status=acc_resp.status_code,
                access_point=access_point,
                account_id=clean_acc,
                error_code=code,
                error=msg,
                hint=hint,
            )
        except httpx.RequestError as exc:
            return BrokerConnectionResult(
                ok=False,
                broker=self.broker_name,
                scope=clean_scope,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                account_id=clean_acc or None,
                error_code="NETWORK_ERROR",
                error=f"Ошибка сети при подключении к {self.gateway_url}: {exc}",
                hint="Проверьте Gateway URL (из DNS widget в Exness API Portal) и доступность узла с VPS.",
            )
        except Exception as exc:
            return BrokerConnectionResult(
                ok=False,
                broker=self.broker_name,
                scope=clean_scope,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                account_id=clean_acc or None,
                error_code="ADAPTER_ERROR",
                error=str(exc),
            )
