# Milestone 2 (`M2`) Scope & Authoritative Specification (`SCOPE.md`)

- **Status**: `IN_PROGRESS`
- **Milestone**: `M2` (`r2_1`) — Backend Core, DB Schema Reconciliation, Auth/Passkeys/Cookies/RBAC, Redis WS Hub & Ops/Wiki APIs
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Original Request (MANDATORY READ)**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Project Blueprint (AUTHORITATIVE)**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (`§ Interface Contracts 1, 2, 3, 4`, `F01`, `F08`–`F10`, `F12`, `F15`–`F18`, `F21`, `F24`, `F26`, `F31`–`F33`, `F35`, `F36`)

---

## 1. Strict Write Ownership Boundaries

**EXCLUSIVE ALLOWED WRITE PATHS**:
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/requirements.txt`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/pyproject.toml`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/alembic/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/main.py`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/core/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/db/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/auth/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/users/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/profile/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/ops/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/audit/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app/modules/wiki/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests/conftest.py`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests/test_m2_*.py`
- Plus installing pure-Python wheels (`segno`, `openpyxl`) into `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv`.

**STRICTLY FORBIDDEN**:
- NEVER touch `backend/Dockerfile`, `deploy/`, `config/`, `mql5/`, `frontend/`, `worker/`, `e2e/`, `docs/`, `PROJECT.md`, or `/home/antigravity/Huseynovlar/server_telegram_bot/`.
- NEVER touch `backend/app/modules/{accounts,ingest,assets,charts,analytics,intelligence}/` (owned by `M3` in Wave 2 — keep all existing imports/calls in those modules 100% compatible!).
- NEVER modify existing `backend/tests/test_*.py` files (other than `conftest.py` and new `test_m2_*.py`), and keep ALL existing tests 100% green!
- NEVER write source/script/probe files inside `/home/antigravity/.agents/teamwork/` (only `.md` coordination files in your own assigned state folder), and NEVER touch `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/` inside the git repo.
- NEVER run `git commit` or `git push`. (Note for all M2 Reviewers, Challengers, and Forensic Auditor: always inspect `git diff eae5685 -- backend/` against pre-overhaul base SHA `eae5685` so any wave-checkpoint sync commits by the Project Orchestrator never obscure M2's full diff!)
- ALWAYS run `pytest` with `PYTHONDONTWRITEBYTECODE=1` and an isolated `--basetemp` in `/tmp` (cleaned up after run) so no `.pytest_cache` or `__pycache__` pollution breaks sibling milestones.

---

## 2. Detailed Deliverables & Acceptance Criteria

### 2.1. Dependencies, Complete SQLAlchemy Models & Idempotent Schema Reconciliation (`requirements.txt`, `app/db/models.py`, `app/db/schema_sync.py`, `alembic/`)
1. **Packages (`requirements.txt` & `backend/.venv`)**:
   - Install `segno` (for real scannable `<svg` TOTP QR codes) and `openpyxl` (so M3 `.xlsx` statement export works without touching `requirements.txt` later) into `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv` and record them cleanly in `backend/requirements.txt` (and `pyproject.toml` if dependencies are mirrored there).
2. **Extend Existing ORM Models in `backend/app/db/models.py` (`PROJECT.md §1`)**:
   - `TradingAccount` (`trading_accounts`): add `platform` (`String(32)`, default `"MT5"`, server/column default `'MT5'`), `api_key_enc` (`Text`, nullable `True`).
   - `AssetHub` (`assets`): add `logo_url` (`Text`, nullable `True`), `category` (`String(32)`, default `"macro"`).
   - `Deal` (`deals`): add `notes` (`Text`, default `""`), `tags` (`JSON`, default `list`).
   - `BalanceOperation` (`balance_operations`): add `is_manual` (`Boolean`, default `False`), `notes` (`Text`, default `""`).
   - `User` (`users`): add `totp_backup_hashes` (`JSON`, default `list`); update default `preferences` factory to match institutional defaults (`theme_preset="tangerine"`, `theme_mode="dark"`, `font="geist"`, `sidebar_variant="floating"`, `sidebar_collapsible="icon"`, `content_layout="full-width"`, `navbar_style="sticky"`, `density="bloomberg"`, `timezone="UTC"`, `language="ru"`, `sound_enabled=True`, `ticker_enabled=True`, `privacy_mode=False`).
3. **Add New ORM Models in `backend/app/db/models.py` (`PROJECT.md §1`)**:
   - `NewsSource` (`news_sources`): `id` (`String(120)` PK — UUID or slug), `name` (`String(200)`), `url` (`Text`), `category` (`String(64)` default `"macro"`), `trust_tier` (`String(32)` default `"custom"` — `tier_1|tier_2|custom`), `is_verified` (`Boolean` default `False`), `is_enabled` (`Boolean` default `True`), `asset_tags` (`JSON` default `list`), `poll_interval_sec` (`Integer` default `300`), `last_polled_at` (`DateTime(timezone=True)` nullable), `last_error` (`Text` nullable), `article_count` (`Integer` default `0`), `created_at` (`DateTime(timezone=True)`).
   - `ChartState` (`chart_states`): `id` (UUID `String(36)` PK), `user_id` (`String(36)` FK `users.id` `ondelete="CASCADE"`, indexed), `symbol` (`String(64)`), `timeframe` (`String(16)` default `"M15"`), `indicators_json` (`JSON` default `dict`), `drawings_json` (`JSON` default `list`), `filters_json` (`JSON` default `dict`), `updated_at` (`DateTime(timezone=True)`); `UniqueConstraint("user_id", "symbol", name="uq_chart_states_user_symbol")`.
   - `WikiPage` (`wiki_pages`): `id` (UUID `String(36)` PK), `slug` (`String(120)`, unique, indexed), `title` (`String(255)`), `category` (`String(64)` default `"operations"`), `content_md` (`Text`), `is_pinned` (`Boolean` default `False`), `updated_by` (`String(120)` nullable), `created_at` (`DateTime(timezone=True)`), `updated_at` (`DateTime(timezone=True)`).
   - `MarketCache` (`market_cache`): `cache_key` (`String(128)` PK), `payload_json` (`JSON`), `updated_at` (`DateTime(timezone=True)`).
4. **Idempotent Startup Schema Sync (`backend/app/db/schema_sync.py` + `app/main.py` `_lifespan`)**:
   - Implement `async def ensure_schema_migrations(engine: AsyncEngine) -> None` and invoke it in `app/main.py` `_lifespan` (replacing bare `create_all`).
   - On PostgreSQL (`conn.dialect.name == "postgresql"`): acquire `SELECT pg_advisory_xact_lock(884210)`, run `await conn.run_sync(Base.metadata.create_all)`, and run `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` for every new column above (`trading_accounts.platform`, `trading_accounts.api_key_enc`, `assets.logo_url`, `assets.category`, `deals.notes`, `deals.tags`, `balance_operations.is_manual`, `balance_operations.notes`, `users.totp_backup_hashes`).
   - On SQLite (`conn.dialect.name == "sqlite"`): run `await conn.run_sync(Base.metadata.create_all)`, inspect each existing table via `PRAGMA table_info(<table>)`, and execute `ALTER TABLE <table> ADD COLUMN <col_ddl>` for any missing columns so legacy SQLite DBs also upgrade cleanly without error!
   - Seed 4 comprehensive institutional Russian/bilingual `WikiPage` playbooks if their slugs do not yet exist in `wiki_pages`:
     1. `mt5-dual-ea-setup` — Как запустить `ExnessPanelBridge.mq5` вместе с торговым роботом (`NasdaqPulse v3.01`) на двух графиках MT5 + опциональный `ExnessPanelHook.mqh`
     2. `mt5-error-4014-webrequest` — Устранение ошибки `ERR_FUNCTION_NOT_ALLOWED (4014)` и настройка `http://ingest.terminal.local:8000` / `https://terminal.huseynovlar.org` в MT5
     3. `api-keys-architecture` — Архитектура API-ключей: внутренний ключ моста `htk_...` vs ключи Личного кабинета Exness vs Google Gemini API
     4. `server-etc-integrations` — Серверная конфигурация `/etc/huseynovlar-terminal/integrations.env` и Telegram-алерты через `server_telegram_bot` (`X-Trading-Webhook-Secret`)
5. **Alembic Baseline (`backend/alembic/versions/0001_initial_baseline.py` & `alembic/env.py`)**:
   - Populate `backend/alembic/versions/0001_initial_baseline.py` creating missing tables if absent and adding new columns idempotently (`inspect(bind)` check) so `alembic` is clean and runnable on both fresh and existing DBs.

### 2.2. Config Path Fix, `/etc` Secrets Loader, Client IP Extraction & Redis Pub/Sub `ws_hub.py` (`app/core/`)
1. **`backend/app/core/config.py`**:
   - Set default **`access_token_expire_minutes: int = 120`** (2 hours, `F36`) and `refresh_token_expire_days: int = 14`.
   - Fix `config_dir` resolution (`F05`, `F18`, `F21`):
     - If `CONFIG_DIR` env var is explicitly set and non-empty, use `Path(os.environ["CONFIG_DIR"])`.
     - Else if `Path("/app/config").exists()`, use `Path("/app/config")`.
     - Else resolve `<repo_root>/config` (`Path(__file__).resolve().parents[3] / "config"` when running from `backend/app/core/config.py`) — NEVER `/config`!
   - Load `/etc/huseynovlar-terminal/integrations.env` (with `INTEGRATIONS_ENV_FILE` env var override for isolated unit testing, defaulting to `"/etc/huseynovlar-terminal/integrations.env"`):
     - If the file exists and is readable, parse `KEY=VALUE` lines (stripping comments `#`, blank lines, optional `export ` prefix, and surrounding single/double quotes) and populate/override settings (with fallback to `.env` / process env):
       - `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` -> `settings.google_ai_api_key`
       - `GEMINI_DEFAULT_MODEL` or `GEMINI_MODEL` or `GOOGLE_AI_DEFAULT_MODEL` -> `settings.google_ai_default_model` (default `"gemini-3.8-flash"`)
       - `TELEGRAM_WEBHOOK_URL` or `ALERTS_BOT_WEBHOOK_URL` -> `settings.alerts_bot_webhook_url`
       - `TELEGRAM_WEBHOOK_SECRET` or `TRADING_WEBHOOK_SECRET` or `ALERTS_BOT_WEBHOOK_SECRET` -> `settings.alerts_bot_webhook_secret`
       - `IP_GEO_API_URL` -> `settings.ip_geo_api_url` (default `"https://ipwho.is/{ip}"`)
     - Expose helper metadata (or method `get_integrations_sources()`) indicating whether each integration value came from `"/etc"` (`integrations.env`), `"env"`, or `"none"`, used by `GET /api/v1/ops/integrations/status`.
2. **`backend/app/core/ip_utils.py`**:
   - Implement `extract_client_ip(request: Request) -> str`:
     - Inspect `X-Forwarded-For` (left-most valid non-empty IP) and `X-Real-IP` when `request.client.host` is missing, `"testclient"`, loopback (`127.0.0.0/8`, `::1`), or private RFC1918 Docker/proxy (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
     - CRITICAL: Preserve CGNAT / NetBird VPN mesh addresses (`100.64.0.0/10`, specifically `100.104.x.x`) as real client IPs (do NOT treat `100.64.0.0/10` as disposable proxy internal IP!).
     - Wire `extract_client_ip(request)` across `auth`, `users`, `ops`, `profile`, `wiki`, etc. wherever client IP is recorded in `UserSession` or `AuditLog`.
3. **`backend/app/core/ws_hub.py`**:
   - Upgrade `LiveWebSocketHub` (`ws_hub`) to publish & subscribe over Redis Pub/Sub (`settings.redis_url`, channel `"terminal:live"`) with completely seamless, non-blocking in-memory fallback when Redis is unreachable/absent (so unit tests without Redis run in milliseconds with zero errors!).
   - Deduplicate self-published messages (e.g., via an instance UUID `_origin_id` envelope or pubsub routing) so local WebSocket clients receive each `broadcast`/`publish_event` message **exactly once** (not twice when Redis is active, and once when using local fallback!).
   - Keep `await ws_hub.broadcast(payload: dict)` 100% backward-compatible for `ingest` and `intelligence` callers, and provide `await ws_hub.publish_event(payload: dict)`.
   - Provide:
     - `authenticate_websocket(websocket: WebSocket, db: AsyncSession) -> User | None`: checks `?token=<jwt>` (rejecting `purpose=="download"`), `Authorization: Bearer <jwt>`, `websocket.cookies.get("ht_access_token")`, or `?dl_token=<jwt>` (`purpose=="download"`), including `sid` active-session check when `sid` is present!
     - `build_welcome_payload(portfolio: dict | None = None) -> dict`: `{"type": "welcome", "ts": iso_now, "server_time_msc": int(time.time() * 1000), "portfolio": portfolio or {}}`.
     - `handle_client_message(websocket: WebSocket, raw_text: str) -> None`: parses `"ping"` or `{"type": "ping", ...}` and immediately responds with `{"type": "pong", "ts": iso_now, "server_time_msc": int(time.time() * 1000), "client_ts": ...}`.
     - Background `10s` `heartbeat` task (`{"type": "heartbeat", "ts": iso_now, "server_time_msc": int(time.time() * 1000)}`) + Redis subscriber lifecycle `await ws_hub.start()` / `await ws_hub.stop()` cleanly started and stopped in `app/main.py` `_lifespan`!

### 2.3. Bulletproof Auth, `sid` Claims, Unified `Path="/"` Cookies, Reliable Logout, Signed Download Tokens, WebAuthn, 2FA SVG QR + Backup Codes, Sessions, Login History & Users RBAC (`app/core/security.py`, `app/core/deps.py`, `app/modules/auth/`, `app/modules/users/`)
1. **Extended Access Token TTL & `sid` Claim (`F35`, `F36` — MANDATORY)**:
   - `create_access_token` in `security.py` accepts optional `extra_claims: dict | None = None` (or `session_id: str | None = None`, `purpose: str | None = None`, `expires_delta: timedelta | None = None`).
   - `_issue_session_tokens` (used across `/bootstrap`, `/login`, `/refresh`, `/webauthn/login/verify`) MUST embed `"sid": session.id` inside the JWT access token payload!
   - In `deps.py:get_current_user`:
     - Extract token in exact priority order (`PROJECT.md §2`):
       1. `Authorization: Bearer <token>` -> decode JWT; **REJECT** with `401` if `payload.get("purpose") == "download"`.
       2. `request.cookies.get("ht_access_token")` -> decode JWT; **REJECT** with `401` if `payload.get("purpose") == "download"`.
       3. `request.query_params.get("dl_token")` -> decode JWT; **REQUIRE** `payload.get("purpose") == "download"` (else `401`).
     - Note: if `Authorization: Bearer <token>` is present and invalid/expired, raise `401 Invalid or expired token` directly (do NOT silently fall back to an older cookie, so Frontend `api-client.ts` reliably gets `401` to trigger `/auth/refresh`!). If `Authorization` header is absent and `ht_access_token` cookie is invalid/expired, if `?dl_token=` is present and valid allow `?dl_token=` (for Incognito/direct download links even if browser has a stale cookie!), otherwise raise `401 Invalid or expired token`.
     - **DB Session Verification (`sid`)**: whenever `"sid"` is present in the decoded JWT claims, query `UserSession` where `id == sid` and `user_id == sub`, and verify `session is not None`, `session.revoked is False`, and `session.expires_at > now_utc`! If the session was deleted, revoked, or expired, immediately raise `401 {"detail": "Invalid or expired token"}`! (If a raw unit-test JWT was minted without `"sid"`, still validate `sub` and active `User` cleanly.)
     - Attach `request.state.session_id = payload.get("sid")` when present so downstream handlers (`GET /auth/sessions`, `POST /auth/sessions/revoke-others`, `POST /auth/logout`) know the exact current session ID!
2. **Unified Cookie `Path="/"` & Bulletproof `POST /api/v1/auth/logout` (`F35` — OVERRIDES OLD COOKIE PATHS!)**:
   - `_issue_session_tokens` sets BOTH cookies on **`Path="/"`**:
     - `ht_access_token`: `httponly=True`, `secure=settings.cookie_secure`, `samesite="lax"`, `path="/"`, `max_age=settings.access_token_expire_minutes * 60`
     - `ht_refresh_token`: `httponly=True`, `secure=settings.cookie_secure`, `samesite="lax"`, `path="/"`, `max_age=settings.refresh_token_expire_days * 86400`
   - `POST /api/v1/auth/refresh`: accepts `ht_refresh_token` cookie cleanly (or optional JSON body `refresh_token` if passed), verifies `UserSession` (`revoked == False`, `expires_at > now`), rotates `refresh_token_hash`, embeds `"sid": session.id` in the new access token, sets both `Path="/"` cookies, and returns `TokenResponse`.
   - `POST /api/v1/auth/logout`:
     - Must NOT require `Depends(get_current_user)` (so logout still succeeds and clears cookies even if access token just expired!).
     - Inspects **BOTH**:
       (a) `request.cookies.get("ht_refresh_token")` -> SHA-256 / token hash match against `UserSession.refresh_token_hash`, AND
       (b) `Authorization: Bearer <jwt>` AND `request.cookies.get("ht_access_token")` -> decode JWT (ignoring `exp` if signature is valid, `options={"verify_exp": False}`!) to extract `sid` (`UserSession.id == sid`).
     - Marks `revoked = True` (or deletes) ALL matching `UserSession` rows in DB and commits!
     - Clears BOTH `ht_access_token` and `ht_refresh_token` across `path="/"`, `path="/api/v1"`, and legacy `path="/api/v1/auth"` so no stale cookie survives anywhere!
   - `GET /api/v1/auth/sessions`:
     - Queries ONLY active sessions of `current_user`: `UserSession.user_id == current_user.id`, `UserSession.revoked == False`, `UserSession.expires_at > now_utc`, ordered newest first (`UserSession.created_at.desc()`).
     - Computes `is_current: bool` accurately by matching `session.id == current_sid` (from Bearer/`ht_access_token` `sid` claim) OR matching `ht_refresh_token` cookie hash!
     - Thus, immediately after `POST /api/v1/auth/logout`, that session is gone from `GET /api/v1/auth/sessions` and its access token `sid` is rejected with `401`!
3. **Signed Download Token (`F09`)**:
   - `POST /api/v1/auth/download-token` (authenticated via `get_current_user`):
     - Mints a 15-minute (`900s`) JWT with claims `{"sub": current_user.id, "purpose": "download", ...}` (include `"sid": request.state.session_id` if present).
     - Returns `{"dl_token": token, "expires_in": 900}`.
4. **WebAuthn Passkeys (`F01`)**:
   - Store WebAuthn registration and login challenges in Redis (`TTL = 300` seconds) keyed by base64url `challenge` string (plus optional user/flow check) with automatic in-memory TTL dict fallback (`_challenge_fallback: dict[str, tuple[float, dict]]`) when Redis is offline.
   - Extract the `challenge` from the incoming `credential.response.clientDataJSON` during `register/verify` and `login/verify` to look up and atomically consume (`GETDEL` / `pop`) the challenge from Redis/fallback — eliminating the `"login:discoverable"` race condition while remaining 100% compatible with standard `{credential}` payloads!
   - Include `sign_count` (along with `id`, `credential_id`, `device_name`, `transports`, `created_at`, `last_used_at`) in `GET /api/v1/auth/webauthn/credentials`.
5. **Password Change, 2FA SVG QR + Backup Codes, Session Views, Login History & GeoIP (`F31`, `F32`)**:
   - `POST /api/v1/auth/change-password` (`{current_password, new_password, revoke_other_sessions: bool = True}`): verifies `current_password`, validates `len(new_password) >= 8` (and rejects empty/identical if appropriate), updates `password_hash` via Argon2id, revokes other sessions of the user (preserving `current_sid`!) when `revoke_other_sessions` is True, writes `AuditLog`, returns `{"ok": True}`.
   - `POST /api/v1/auth/2fa/setup`: generates TOTP secret & `otpauth://` `provisioning_uri`, renders a genuine scannable inline `<svg ...>...</svg>` QR code via `segno`, stores encrypted pending secret in `user.totp_secret_enc` (keeping `totp_enabled=False` until verified, or if re-setting up), returns `{"secret": secret, "provisioning_uri": uri, "qr_svg": svg_str}`.
   - `POST /api/v1/auth/2fa/verify` (`{code}`): verifies 6-digit TOTP `code`, sets `user.totp_enabled = True`, generates **10** cryptographically random one-time recovery backup codes (`XXXX-XXXX` uppercase hex/alphanumeric), stores their SHA-256 hashes in `user.totp_backup_hashes`, writes `AuditLog`, and returns `{"ok": True, "totp_enabled": True, "backup_codes": backup_codes}`.
   - Update `POST /api/v1/auth/login`: when `user.totp_enabled` is True, accept either a valid 6-digit TOTP code OR one of the unused recovery `backup_codes` in `totp_code` (normalizing case/hyphens consistently), atomically removing the consumed backup code hash from `user.totp_backup_hashes` and logging `auth.login.backup_code` in `AuditLog`!
   - `POST /api/v1/auth/2fa/disable` (`{password, code}`): verifies current `password` AND a valid TOTP or backup `code`, sets `totp_enabled = False`, clears `totp_secret_enc = None` and `totp_backup_hashes = []`, writes `AuditLog`, returns `{"ok": True, "totp_enabled": False}`.
   - `GET /api/v1/auth/sessions/{session_id}`: returns detail view of session (`404` if not found or if owned by another user and caller is not `ADMIN`), including `is_current`.
   - `DELETE /api/v1/auth/sessions/{session_id}`: marks `revoked = True` (`404` if not found or not owned unless `ADMIN`), writes `AuditLog`, returns `{"ok": True}`.
   - `POST /api/v1/auth/sessions/revoke-others`: marks `revoked = True` on all active sessions of `current_user` EXCEPT `current_sid` (determined from `request.state.session_id` or `ht_refresh_token` hash), returns `{"ok": True, "revoked_count": n}`.
   - `GET /api/v1/auth/login-history`: supports query params `action: str | None = None`, `ip: str | None = None`, `limit: int = 100`, returning matching auth `AuditLog` entries; `GET /api/v1/auth/login-history/{entry_id}` returns single entry detail (`404` if not found or unauthorized).
   - `GET /api/v1/auth/ip-lookup/{ip}`:
     - Validates IP format (`ipaddress.ip_address(ip)`, `400` on invalid IP string).
     - Classifies NetBird CGNAT (`100.64.0.0/10` / `100.104.x.x`) cleanly (`is_vpn_mesh=True`, `network="NetBird Zero-Trust VPN Mesh"`, `country="VPN Mesh"`, `org="NetBird CGNAT 100.64.0.0/10"`).
     - Classifies loopback/RFC1918 private IPs (`is_private=True`, `network="Internal / Private Network"`).
     - Queries `settings.ip_geo_api_url.format(ip=ip)` via `httpx.AsyncClient(timeout=4.0)` for public IPs with graceful fallback response (never `500` if offline!).
6. **Users Management RBAC CRUD + Detail View (`backend/app/modules/users/router.py`, mounted at `/api/v1/users` in `app/main.py`, `F17`)**:
   - All `/api/v1/users*` endpoints require `ADMIN` role (`403` for `OPERATOR` / `VIEWER`).
   - `GET /api/v1/users`: lists all users with `id`, `username`, `email`, `display_name`, `role`, `is_active`, `totp_enabled`, `active_sessions_count`, `passkeys_count`, `created_at`, `updated_at`.
   - `POST /api/v1/users`: creates user (`username`, `email`, `password` `>=8` chars, `role` in `ADMIN|OPERATOR|VIEWER`, `display_name`, `is_active=True`), enforces unique `username` & `email` (`409`), sets institutional default `preferences` (`tangerine`, `floating`, `bloomberg`, `UTC`, `ru`), writes `AuditLog`, returns `201` / `200` user payload.
   - `GET /api/v1/users/{user_id}`: rich detail view (`id`, `username`, `email`, `display_name`, `bio`, `avatar_url`, `role`, `is_active`, `totp_enabled`, `active_sessions_count`, `sessions` recent list, `passkeys_count`, `passkeys` summary, `recent_audit` entries, `last_login_at`, `created_at`, `updated_at`).
   - `PATCH /api/v1/users/{user_id}`: updates `display_name`, `email` (`409` on conflict), `role`, `is_active`, optional `password` reset (revoking user's active sessions if deactivated or password reset). **Guard**: forbid demoting (`role != "ADMIN"`) or deactivating (`is_active == False`) the last active `ADMIN` (`400`), and forbid self-deactivation/self-demotion if sole admin (`400`)!
   - `DELETE /api/v1/users/{user_id}`: **forbid self-deletion (`user_id == current_user.id` -> `400`)** and **forbid deleting the last active `ADMIN` (`400`)**; cleanly delete user's sessions, WebAuthn credentials, chart states (and nullify `AuditLog.user_id` if FK requires so audit history is preserved!), delete user, log audit event, return `{"ok": True}`.

### 2.4. Profile, Server Preferences, Ops Containers/Downloads/Integrations, Audit & Wiki (`modules/profile/`, `modules/ops/`, `modules/audit/`, `modules/wiki/`, `app/main.py`)
1. **Profile & Server-Persisted Preferences (`backend/app/modules/profile/router.py`, `F10`, `F26`)**:
   - `GET /api/v1/profile/me` & `PATCH /api/v1/profile/me` (`display_name`, `email` with duplicate check, `bio`, `avatar_url`, `social_links`), returning merged institutional default preferences so missing keys are always populated (`theme_preset="tangerine"`, `sidebar_variant="floating"`, `density="bloomberg"`, `timezone="UTC"`, `language="ru"`, etc.).
   - `GET /api/v1/profile/preferences` -> returns full merged preferences dict for `current_user`.
   - `PATCH /api/v1/profile/preferences` -> deep-merges nested dicts (e.g. `custom_hotkeys`, `analytics_filters`, `treemap_filters`) while replacing list values (`hidden_page_ids`, `sidebar_order`, `pinned_asset_codes`), normalizes `density` to `"bloomberg"` (`F03`), persists to `current_user.preferences` (`flag_modified(current_user, "preferences")`), and returns updated preferences!
   - Vault cleanup (`F18`): remove `telegram_bot_token` and `telegram_chat_id` from `ALLOWED_VAULT_KEYS`, keep `google_ai_api_key`, `alerts_bot_webhook_url`, `alerts_bot_webhook_secret` (for backward compatibility alongside `/etc`), and add `DELETE /api/v1/profile/vault/{key}` (`ADMIN` required).
2. **Operations, Containers CRUD+Stats+Logs, `.set`/`.mq5`/`.mqh` Downloads & `/etc` Integrations (`backend/app/modules/ops/router.py`, `F08`, `F09`, `F12`, `F18`, `F24`)**:
   - **Unified Container Authorization**: a container is authorized if its name is in `settings.allowed_mt5_containers`, OR its live Docker inspect/list labels have `exness-panel.managed == "true"`, OR it exists in the `docker_containers` DB table!
   - `GET /api/v1/ops/containers`: merges DB `docker_containers` rows + live Docker daemon containers (gracefully handling unreachable Docker socket in dev/test!) + linked `TradingAccount` summaries (`id`, `name`, `mt5_login`, `terminal_connected`).
   - `POST /api/v1/ops/containers` (`OPERATOR`/`ADMIN`): registers container in `docker_containers` (`409` if `container_name` already exists).
   - `GET /api/v1/ops/containers/{id_or_name}`: looks up by `DockerContainer.id == key OR DockerContainer.container_name == key` (or live allowlisted container name); returns DB metadata + live Docker inspect state/uptime/image/mounts/ports + live CPU % & RAM MB parsed from `/containers/{name}/stats?stream=false` when Docker daemon is reachable + linked `TradingAccount` list (`404` if neither registered nor allowlisted/found).
   - `PATCH /api/v1/ops/containers/{id_or_name}` (`OPERATOR`/`ADMIN`): updates `display_name`, `host_label`, `is_restart_allowed`, `container_name` (`409` on duplicate name).
   - `DELETE /api/v1/ops/containers/{id_or_name}` (`ADMIN`/`OPERATOR`): unlinks `TradingAccount.container_id = None` for linked accounts, deletes `DockerContainer` row, writes `AuditLog`, returns `{"ok": True}`.
   - `POST /api/v1/ops/containers/{name}/{action}` (`start|stop|restart`, `OPERATOR`/`ADMIN`): checks unified authorization; if `action in ("stop", "restart")` and DB record has `is_restart_allowed == False`, raises `403`; calls Docker proxy, updates `last_status` if registered, writes `AuditLog`.
   - `GET /api/v1/ops/containers/{name}/logs?tail=200`: checks unified authorization; fetches logs and redacts secrets (`htk_[A-Za-z0-9_-]+`, Bearer tokens, `AccountApiKey=...`, `password=...`).
   - `POST /api/v1/ops/kill-switch/{account_id_or_login}` (`OPERATOR`/`ADMIN`): resolves `TradingAccount` by `TradingAccount.id == key OR TradingAccount.mt5_login == key` (`404` if not found), enqueues `PendingCommand` (`CLOSE_ALL` / kill-switch), writes `AuditLog`.
   - `GET /api/v1/ops/setup-wizard/{account_id_or_login}/bridge.set?url_mode=internal|external`:
     - Resolves `TradingAccount` by `TradingAccount.id == key OR TradingAccount.mt5_login == key` (so `/api/v1/ops/setup-wizard/253752700/bridge.set` works!).
     - Decrypts `account.api_key_enc` via `decrypt_secret(account.api_key_enc)` when non-empty so `AccountApiKey=htk_...` contains the real key (falls back to `PASTE_YOUR_KEY_STARTING_WITH_{account.api_key_prefix}` comment/value ONLY if `api_key_enc` is `None` on an unrotated legacy account).
     - Emits `ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest` when `url_mode="internal"` (default) and `https://terminal.huseynovlar.org/api/v1/ingest` (or configured public base URL) when `url_mode="external"`.
     - Returns `PlainTextResponse` / `Response` with `Content-Disposition: attachment; filename="ExnessPanelBridge_{account.mt5_login}.set"` (works with `Authorization: Bearer`, `ht_access_token` cookie, OR `?dl_token=`!).
   - `GET /api/v1/ops/downloads/ExnessPanelBridge.mq5` & `GET /api/v1/ops/downloads/ExnessPanelHook.mqh`:
     - Reads real source file from `<repo_root>/mql5/` or `/app/mql5/` (NEVER modifying `mql5/`!) and serves as downloadable file with `Content-Disposition: attachment; filename="..."`.
   - `/etc` Integrations Status & Test Endpoints (`F18`):
     - `GET /api/v1/ops/integrations/status`: returns masked read-only health for:
       - `gemini`: `{configured: bool, source: "/etc"|"env"|"vault"|"none", model: str, masked_key: str | None, etc_file: str, etc_file_exists: bool}`
       - `telegram_webhook`: `{configured: bool, source: "/etc"|"env"|"vault"|"none", webhook_url: str | None, secret_configured: bool, auth_header: "X-Trading-Webhook-Secret"}`
       - `config_catalog`: `{config_dir: str, exists: bool, news_sources_count: int, treemap_universes_count: int, default_assets_count: int, alert_rules_count: int}`
     - `POST /api/v1/ops/alerts/test` (`OPERATOR`/`ADMIN`): resolves webhook URL & secret (`/etc` -> `env` -> `SecretVaultEntry` fallback), sends `POST` JSON `{"title": "Huseynovlar Terminal — Test Alert", "message": "...", "severity": "info", "source": "huseynovlar-terminal"}` with header **`X-Trading-Webhook-Secret: <secret>`** (and `X-Webhook-Secret: <secret>` for compatibility), returns clear diagnostic status (`400` if unconfigured, `502` / structured error if upstream unreachable, `200` on delivery).
     - `POST /api/v1/ops/integrations/gemini-test` (`OPERATOR`/`ADMIN`): resolves Gemini API key (`/etc` -> `env` -> `SecretVaultEntry` fallback) & model, performs lightweight live check against `generativelanguage.googleapis.com` with timeout, returns `{ok: bool, model: str, latency_ms: int, reply: str | None, detail: str | None}` (`400` if key not configured).
3. **Audit Log Filtering & Detail View (`backend/app/modules/audit/router.py`, `F32`)**:
   - `GET /api/v1/audit`: supports `action`, `resource_type`, `user_id`, `limit` (`1..500`, default `100`), returning audit rows enriched with `username` when `user_id` resolves.
   - `GET /api/v1/audit/{audit_id}`: returns single audit entry detail + `username` (`404` if not found).
4. **Markdown Wiki / Playbooks CRUD (`backend/app/modules/wiki/router.py`, mounted at `/api/v1/wiki` in `app/main.py`, `F33`)**:
   - `GET /api/v1/wiki`: supports `category: str | None = None`, `q: str | None = None` (case-insensitive search in `title`, `slug`, `content_md`), ordered by `is_pinned.desc(), updated_at.desc()`.
   - `POST /api/v1/wiki` (`OPERATOR`/`ADMIN`): creates `WikiPage` (`title`, optional `slug` auto-slugified if omitted with `409` or suffix check if duplicate explicit slug, `category`, `content_md`, `is_pinned`), sets `updated_by = current_user.username`, writes `AuditLog`.
   - `GET /api/v1/wiki/{slug_or_id}`: resolves by `WikiPage.slug == key OR WikiPage.id == key` (`404` if not found).
   - `PATCH /api/v1/wiki/{slug_or_id}` (`OPERATOR`/`ADMIN`): updates `title`, `slug` (`409` on collision), `category`, `content_md`, `is_pinned`, `updated_by`, `updated_at`, writes `AuditLog`.
   - `DELETE /api/v1/wiki/{slug_or_id}` (`OPERATOR`/`ADMIN`): deletes `WikiPage`, writes `AuditLog`, returns `{"ok": True}`.

---

## 3. Comprehensive Automated Test Suite & Canonical Verification (`backend/tests/test_m2_*.py`)

Create thorough async `pytest` suites (`test_m2_*.py`) testing every single contract above with real FastAPI ASGI requests and real SQLite DB state (no fake stubs!), including:
- `schema_sync.py` idempotent migration on a pre-existing legacy SQLite DB missing the new columns + automatic seeding of the 4 Russian/bilingual `WikiPage` playbooks + Alembic baseline verification;
- `config.py` `CONFIG_DIR` resolution + `INTEGRATIONS_ENV_FILE` `/etc` secret loading & precedence + `extract_client_ip` preserving NetBird `100.104.x.x` behind `172.18.0.5` Nginx;
- `F35` & `F36`: `120m` default access token TTL, `"sid"` embedded in JWT on `/bootstrap`, `/login`, `/refresh`, `/webauthn/login/verify`, BOTH `ht_access_token` and `ht_refresh_token` set on `Path="/"`, `POST /auth/logout` revoking session via Bearer `sid` AND via refresh cookie + clearing cookies across `/`, `/api/v1`, `/api/v1/auth` + immediate disappearance from `GET /auth/sessions` + immediate `401` on subsequent requests using the logged-out JWT;
- `F09`: `POST /auth/download-token` (`expires_in == 900`), `?dl_token=` accepted on `/ops/setup-wizard/253752700/bridge.set` & `.mq5`/`.mqh` downloads in cookie-less/Incognito requests, and `dl_token` rejected when passed as `Authorization: Bearer`;
- WebAuthn challenge TTL/isolation + `sign_count` in `/auth/webauthn/credentials`;
- `POST /auth/change-password`, `POST /auth/2fa/setup` (verifying `<svg` QR output from `segno`), `2fa/verify` (10 backup codes + one-time consumption on `/auth/login`), `2fa/disable`, `/auth/sessions/{id}`, `/auth/sessions/revoke-others`, `/auth/login-history` filters + `/{id}`, `/auth/ip-lookup/{ip}` (NetBird `100.104.116.58`, private IP, invalid IP `400`);
- `/api/v1/users` RBAC (`403` for non-admin, full CRUD+View, `400` on self-delete and last-ADMIN delete/demote/deactivate);
- `/api/v1/profile/me` & `/profile/preferences` deep-merge + `tangerine`/`floating`/`bloomberg` defaults + `/profile/vault/{key}` delete & scrubbed keys;
- `/api/v1/ops/containers` CRUD+View+Actions+Redacted Logs, `kill-switch/253752700`, `setup-wizard/253752700/bridge.set?url_mode=internal|external` with Fernet `api_key_enc` decryption & `http://ingest.terminal.local:8000/api/v1/ingest`, `.mq5`/`.mqh` downloads, `/ops/integrations/status`, `/ops/alerts/test` (`X-Trading-Webhook-Secret`), `/ops/integrations/gemini-test`;
- `/api/v1/audit` filters + `/{id}` and `/api/v1/wiki` seeded playbooks + full CRUD+View;
- `ws_hub.py` auth, `welcome`, `ping/pong`, broadcast/publish_event deduplication & lifecycle.

### Canonical Verification Commands
```bash
PYTHONDONTWRITEBYTECODE=1 /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/ruff check \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests

BASETEMP=$(mktemp -d /tmp/m2_pytest.XXXXXX)
PYTHONDONTWRITEBYTECODE=1 TMPDIR="$BASETEMP" \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/pytest -v \
  -c /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/pyproject.toml \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests \
  --basetemp="$BASETEMP/pytest"
rm -rf "$BASETEMP"
```
