# M2 Partition 1 Handoff Blueprint (`m2_explorer_r2_1`)

## Key Layout & Existing Signatures Verified
- **DB & Modules Layout**: `tests/conftest.py:10` imports `Base, get_db` from `app.core.database` (verify `app/core/database.py` + `app/db/models.py` before adding `schema_sync.py`); domain routers live in `app/modules/{charts,ingest,intelligence,auth,ops,...}/router.py`.
- **`app/core/deps.py` (L1–90)**:
  - `get_current_user(...) -> User` (L37–44): currently checks `payload.get("sub")` + `user.is_active` only (missing `sid` active `UserSession` check, cookie fallback `ht_access_token`, and signed download token fallback).
  - `require_admin(user: User = Depends(get_current_user)) -> User` (L47–50).
  - `verify_account_api_key(x_account_api_key: str | None = Header(default=None, alias="X-Account-Api-Key"), db: AsyncSession = Depends(get_db)) -> TradingAccount` (L53–68).
  - `record_audit(db: AsyncSession, *, action: str, user_id: str | None = None, resource_type: str = "", resource_id: str = "", ip_address: str = "", details: dict[str, Any] | None = None) -> None` (L71–90).
- **`app/core/ws_hub.py` (L1–43)**:
  - `LiveWebSocketHub`: `connect(self, ws: WebSocket) -> None` (L16–20), `disconnect(self, ws: WebSocket) -> None` (L21–23), `broadcast(self, event_type: str, data: dict[str, Any]) -> None` sending `{"type": event_type, "data": data}` (L25–40); singleton `ws_hub = LiveWebSocketHub()` (L43).
- **`tests/conftest.py` (L1–47)**:
  - `test_settings() -> Settings` (L15–24) passes `ENVIRONMENT`, `TERMINAL_DOMAIN`, `TERMINAL_ORIGIN`, `WEBAUTHN_RP_ID`, `JWT_SECRET_KEY`, `VAULT_MASTER_KEY`, `COOKIE_SECURE=False`.
  - `client(test_settings)` (L28–47) uses `sqlite+aiosqlite:///:memory:`, `Base.metadata.create_all`, `create_app()`, overriding `get_db` and `get_settings`.

## Zero-Breakage Caller Compatibility Rules
1. **`app/modules/intelligence/router.py` (L16, L98, L187, L312, L347)**: Calls `settings.load_yaml_config("news_sources.yaml" | "treemap.yaml")` and `decrypt_secret(vault_entry.value_enc, settings.vault_master_key)` — preserve `Settings.load_yaml_config`, `settings.vault_master_key`, `get_settings`, and `decrypt_secret` signatures unchanged.
2. **`app/modules/ingest/router.py` (L12–13, L250, L345)**: Uses `Depends(verify_account_api_key)` and `await ws_hub.broadcast(event_type, data)` — keep exact 2-arg `broadcast(event_type, data)` signature and `{"type", "data"}` envelope.
3. **`app/modules/charts/router.py` (L11–12, L246–253)**: `websocket_live(ws: WebSocket)` calls `await ws_hub.connect(ws)` and `await ws_hub.disconnect(ws)` — preserve `connect(ws)`/`disconnect(ws)` compatibility while enforcing cookie/token session validation and periodic heartbeat/status metadata.

## Partition 1 Implementation Actions for M2 Worker
- **Auth Cookies & Download Tokens (`config.py`, `security.py`, `deps.py`)**: Add `ht_access_token` (`HttpOnly`, `path="/api/v1"`) + consistent `ht_refresh_token` (`path="/"` or `/api/v1`), extend access TTL + embed `sid` in JWT, validate non-revoked/unexpired `UserSession` in `get_current_user`, and support signed download tokens / cookie auth so incognito direct `<a href>` downloads (`.set`, `.csv`, `.mq5`) succeed without `Authorization` header.
- **Logout & Session Revocation (`deps.py` / `auth`)**: Ensure `/api/v1/auth/logout` revokes/deletes `UserSession` via BOTH Bearer `sid` and `ht_refresh_token` cookie and clears cookies on matching paths.
- **DB Schema & `integrations.env` (`models.py`, `schema_sync.py`, `0001_initial_baseline.py`, `config.py`, `ip_utils.py`, `main.py`, `conftest.py`)**: Add `/etc/huseynovlar-terminal/integrations.env` reader in `Settings`, client IP/Geo helper in `ip_utils.py`, idempotent startup `schema_sync` in `main.py` lifespan (SQLite-safe for `conftest.py`!), and baseline Alembic revision.
