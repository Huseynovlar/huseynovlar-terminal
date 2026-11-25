# Milestone 2 (`M2`) Scope & Specification (`SCOPE.md`)

- **Status**: `IN_PROGRESS`
- **Milestone**: `M2` — Backend Core, DB Schema Reconciliation, Auth/Passkeys/Cookies/RBAC, Redis WS Hub & Ops/Wiki APIs
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Original Request**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Project Blueprint**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (`§ Interface Contracts 1, 2, 3, 4`)

## Strict Write Ownership Boundaries
Allowed paths ONLY:
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
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests/conftest.py` & `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests/test_m2_*.py`

Forbidden paths (owned by concurrent milestones M1, M3, M4, M5, E2E):
- NEVER touch `backend/Dockerfile`, `deploy/`, `config/`, `mql5/`, `frontend/`, `worker/`, `e2e/`
- NEVER touch `backend/app/modules/{accounts,ingest,assets,charts,analytics,intelligence}/`
- NEVER touch existing `backend/tests/test_*.py` (other than `conftest.py` and `test_m2_*.py`), and keep ALL existing tests passing!
- NEVER run `git commit` or `git push`.

## Detailed Deliverables & Acceptance Criteria

### 1. Complete SQLAlchemy Models & Idempotent Schema Reconciliation (`app/db/models.py`, `app/db/schema_sync.py`, `alembic/`)
1. Extend existing models in `backend/app/db/models.py` (`PROJECT.md §1`):
   - `TradingAccount`: `platform` (`VARCHAR(32)`, default `'MT5'`), `api_key_enc` (`TEXT`, nullable `True`).
   - `AssetHub`: `logo_url` (`TEXT`, nullable `True`), `category` (`VARCHAR(32)`, default `'macro'`).
   - `Deal`: `notes` (`TEXT`, default `''`), `tags` (`JSON`, default `list`).
   - `BalanceOperation`: `is_manual` (`Boolean`, default `False`), `notes` (`TEXT`, default `''`).
   - `User`: `totp_backup_hashes` (`JSON`, default `list`).
2. Add new models in `backend/app/db/models.py` (`PROJECT.md §1`):
   - `NewsSource` (`news_sources`): `id` (UUID/slug PK `VARCHAR(120)`), `name`, `url`, `category`, `trust_tier` (`tier_1|tier_2|custom`), `is_verified` (`bool`), `is_enabled` (`bool`), `asset_tags` (`JSON`), `poll_interval_sec` (`int`), `last_polled_at` (`DateTime(timezone=True)` nullable), `last_error` (`TEXT` nullable), `article_count` (`int` default `0`), `created_at` (`DateTime(timezone=True)`).
   - `ChartState` (`chart_states`): `id` (UUID PK), `user_id` (FK `users.id` ondelete CASCADE), `symbol` (`VARCHAR(64)`), `timeframe` (`VARCHAR(16)`), `indicators_json` (`JSON`), `drawings_json` (`JSON`), `filters_json` (`JSON`), `updated_at` (`DateTime(timezone=True)`); `UniqueConstraint("user_id", "symbol")`.
   - `WikiPage` (`wiki_pages`): `id` (UUID PK), `slug` (Unique `VARCHAR(120)`), `title`, `category`, `content_md` (`TEXT`), `is_pinned` (`bool` default `False`), `updated_by` (`VARCHAR(120)` nullable), `created_at` (`DateTime(timezone=True)`), `updated_at` (`DateTime(timezone=True)`).
   - `MarketCache` (`market_cache`): `cache_key` (PK `VARCHAR(128)`), `payload_json` (`JSON`), `updated_at` (`DateTime(timezone=True)`).
3. Implement `ensure_schema_migrations(engine)` in `backend/app/db/schema_sync.py` and invoke inside `app/main.py` `_lifespan`:
   - Uses `SELECT pg_advisory_xact_lock(884210)` on PostgreSQL (`dialect.name == "postgresql"`), no-op lock on SQLite.
   - Calls `Base.metadata.create_all` AND executes idempotent column upgrades: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` on PostgreSQL, and `PRAGMA table_info(...)` check + `ALTER TABLE ... ADD COLUMN ...` on SQLite so pre-existing tables upgrade cleanly in both PostgreSQL and SQLite tests!
   - Seeds default `WikiPage` articles if `wiki_pages` does not already contain those slugs (4 comprehensive institutional articles in Russian/bilingual clarity: 1. MT5 2-Chart Setup alongside `NasdaqPulse`, 2. Error `4014` Fix & `http://ingest.terminal.local:8000` WebRequest allowlist, 3. API Keys Guide (`htk_...` vs Exness PA vs Gemini), 4. `/etc/huseynovlar-terminal/integrations.env` Server Configuration & Telegram Webhook).
4. Populate baseline Alembic migration in `backend/alembic/versions/0001_initial_baseline.py` (and ensure `alembic/env.py` imports `Base` cleanly).

### 2. Config Path Fix, `/etc` Secrets Loader, Client IP Extraction & Redis Pub/Sub `ws_hub.py` (`app/core/`)
1. `backend/app/core/config.py`:
   - Fix `config_dir` resolution: `CONFIG_DIR` env var if set and non-empty -> `Path("/app/config")` if `/app/config` exists -> repo `<root>/config` (NEVER `/config`!).
   - Load `/etc/huseynovlar-terminal/integrations.env` (or `INTEGRATIONS_ENV_FILE` env override for testability, defaulting to `/etc/huseynovlar-terminal/integrations.env`) when the file exists and is readable, with fallback to `.env` / environment variables for:
     - `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` -> `settings.google_ai_api_key`
     - `GEMINI_DEFAULT_MODEL` / `GOOGLE_AI_DEFAULT_MODEL` -> `settings.google_ai_default_model` (default `"gemini-3.8-flash"`)
     - `TELEGRAM_WEBHOOK_URL` / `ALERTS_BOT_WEBHOOK_URL` -> `settings.alerts_bot_webhook_url`
     - `TELEGRAM_WEBHOOK_SECRET` / `ALERTS_BOT_WEBHOOK_SECRET` -> `settings.alerts_bot_webhook_secret`
     - `IP_GEO_API_URL` -> `settings.ip_geo_api_url` (default `"https://ipwho.is/{ip}"`)
2. `backend/app/core/ip_utils.py`:
   - Implement `extract_client_ip(request: Request) -> str`: when `request.client.host` is loopback/private/Docker proxy (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `testclient`, or missing), inspect `X-Forwarded-For` (first valid client IP) and `X-Real-IP` so NetBird CGNAT VPN IPs (`100.64.0.0/10`, specifically `100.104.x.x`) and real public client IPs are accurately extracted instead of Docker Nginx `172.x.x.x`. Use across `auth`, `users`, `ops`, `audit`, etc.
3. `backend/app/core/ws_hub.py`:
   - Upgrade `LiveWebSocketHub` to publish & subscribe via Redis (`settings.redis_url`, channel `terminal:live`) with graceful in-process fallback when Redis is absent/unreachable in unit tests (never crash or block if Redis is offline).
   - Provide `publish_event(payload: dict)` usable from both `backend` and `worker` (and keep `broadcast(payload)` compatible with existing callers in `ingest`/`intelligence`!).
   - Provide per-socket auth validation helper (`authenticate_websocket(websocket)` checking `?token=`, `Authorization: Bearer`, `ht_access_token` cookie, or `?dl_token=`), immediate `welcome` payload helper (`{"type": "welcome", "ts": ..., "server_time_msc": ..., "portfolio": ...}`), `ping` -> `pong` responder helper, and `10s` background `heartbeat` task (`{"type": "heartbeat", "ts": ..., "server_time_msc": ...}`), plus clean lifecycle startup/shutdown hooked into `app/main.py` `_lifespan`!

### 3. Bulletproof Auth, Cookies, Signed Downloads, WebAuthn, Password, 2FA, Sessions, Login History & Users RBAC (`modules/auth/`, `modules/users/`, `core/deps.py`, `core/security.py`)
1. Cookies & Default Preferences:
   - `_issue_session_tokens` (used on `/bootstrap`, `/login`, `/refresh`, `/webauthn/login/verify`): sets BOTH:
     - `ht_access_token`: `HttpOnly=True`, `Secure=settings.cookie_secure`, `SameSite="lax"`, `Path="/"`, `max_age=settings.access_token_expire_minutes * 60`
     - `ht_refresh_token`: `HttpOnly=True`, `Secure=settings.cookie_secure`, `SameSite="lax"`, `Path="/api/v1/auth"`, `max_age=settings.refresh_token_expire_days * 86400`
   - `/logout` clears BOTH `ht_access_token` (`Path="/"`) and `ht_refresh_token` (`Path="/api/v1/auth"`).
   - Default new user preferences (in `models.py` default & `/bootstrap` & `POST /users`): `theme_preset="tangerine"`, `theme_mode="dark"`, `font="geist"`, `sidebar_variant="floating"`, `sidebar_collapsible="icon"`, `content_layout="full-width"`, `navbar_style="sticky"`, `density="bloomberg"`, `timezone="UTC"`, `language="ru"`, `sound_enabled=True`, `ticker_enabled=True`, `privacy_mode=False`.
2. Signed Download Tokens & `deps.py`:
   - `POST /api/v1/auth/download-token` -> issues 5-minute signed JWT (`{"sub": user.id, "purpose": "download", "exp": ...}`) returning `{"dl_token": "...", "expires_in": 300}`.
   - `deps.py:get_current_user` checks in order: (1) `Authorization: Bearer <token>` (rejecting `purpose=="download"` or accepting normal access tokens), (2) `request.cookies.get("ht_access_token")`, (3) `request.query_params.get("dl_token")` (must have `"purpose": "download"` and valid signature/expiry!).
3. WebAuthn:
   - Store registration and login challenges in Redis (`TTL=300s`) keyed by unique `challenge_id` / challenge bytes base64url (so concurrent discoverable logins NEVER overwrite each other!) with clean in-memory TTL dict fallback when Redis is unavailable. Support lookup by challenge extracted from `clientDataJSON` (and/or optional `challenge_id`) so standard WebAuthn clients passing `{credential}` without extra fields work seamlessly too!
   - Include `sign_count` (alongside `id`, `credential_id`, `device_name`, `transports`, `created_at`, `last_used_at`) in `GET /api/v1/auth/webauthn/credentials`.
4. Password, 2FA SVG QR + Backup Codes, Sessions, Login History & GeoIP:
   - `POST /api/v1/auth/change-password` (`{current_password, new_password, revoke_other_sessions?: bool}`): validates current password, enforces minimum password length (`>=8` / `>=10` reasonable validation, check existing bootstrap/login rules so tests/UX match!), hashes with Argon2id, optionally revokes other sessions, logs audit event.
   - `POST /api/v1/auth/2fa/setup` -> returns `{secret, provisioning_uri, qr_svg}` with real, scannable inline `<svg ...>` QR code (`segno` installed in `requirements.txt` & `backend/.venv`, or pure-Python ISO 18004 QR SVG if needed — installing `segno` in `backend/.venv` and adding to `requirements.txt` is clean, lightweight, zero C deps!).
   - `POST /api/v1/auth/2fa/verify` (`{code}`) -> verifies TOTP code, enables `totp_enabled=True`, generates 10 one-time recovery `backup_codes` (e.g. `XXXX-XXXX`), stores their SHA-256/Argon2 hashes in `user.totp_backup_hashes`, and returns `{ok: True, totp_enabled: True, backup_codes: [...]}`.
   - Accept one-time backup code in `/api/v1/auth/login` (`totp_code` field) when `totp_enabled` is True, consuming (removing) the used backup code hash atomically!
   - `POST /api/v1/auth/2fa/disable` (`{password, code}`) -> verifies current password AND valid TOTP or backup code, disables 2FA, clears secret & backup hashes, logs audit event, returns `{ok: True, totp_enabled: False}`.
   - `GET /api/v1/auth/sessions/{id}` (session detail view, 404 if not owned by user unless ADMIN) & `POST /api/v1/auth/sessions/revoke-others` (revokes all active sessions of current user except current session, identifying current session via refresh cookie or session id). Also protect `DELETE /api/v1/auth/sessions/{id}` from accidentally leaving ambiguous errors or handle cleanly.
   - `GET /api/v1/auth/login-history` (supports `action`, `ip`, `limit` query filters) + `GET /api/v1/auth/login-history/{id}` (detail view).
   - `GET /api/v1/auth/ip-lookup/{ip}`: detects NetBird CGNAT (`100.64.0.0/10` / `100.104.x.x`) as Zero-Trust NetBird VPN mesh, private RFC1918/loopback as Local/Internal Network, and queries `settings.ip_geo_api_url.format(ip=ip)` with resilient timeout/fallback for public IPs.
5. Users Management RBAC (`backend/app/modules/users/router.py` mounted at `/api/v1/users` in `app/main.py`):
   - `GET /api/v1/users` (`ADMIN` required): list users with session/passkey summary metadata.
   - `POST /api/v1/users` (`ADMIN` required): create user (`username`, `email`, `password`, `role` in `ADMIN|OPERATOR|VIEWER`, `display_name`, `is_active`), default preferences (`tangerine`, `floating`, `bloomberg`, `UTC`, `ru`).
   - `GET /api/v1/users/{id}` (`ADMIN` required): rich detail view (profile, role, 2FA status, active sessions count & recent sessions, passkeys count, recent audit entries, last login).
   - `PATCH /api/v1/users/{id}` (`ADMIN` required): update `display_name`, `email`, `role`, `is_active`, optional `password` reset; **forbid demoting or deactivating the last active `ADMIN`** (`400`).
   - `DELETE /api/v1/users/{id}` (`ADMIN` required): **forbid self-deletion** (`400`) and **forbid deleting the last active `ADMIN`** (`400`); clean up dependent sessions/credentials/chart_states and audit-log the deletion.

### 4. Profile, Preferences, Ops, Downloads, `/etc` Status/Test, Audit & Wiki (`modules/profile/`, `modules/ops/`, `modules/audit/`, `modules/wiki/`, `main.py`)
1. `profile` (`backend/app/modules/profile/router.py`):
   - `GET /api/v1/profile/me` & `PATCH /api/v1/profile/me` (`display_name`, `email`, `bio`, `avatar_url`, `social_links`).
   - `GET /api/v1/profile/preferences` & `PATCH /api/v1/profile/preferences`: deep-merges nested dicts in preferences JSON (while replacing arrays like `hidden_page_ids`, `sidebar_order`, `pinned_asset_codes`), enforces `density="bloomberg"` normalization if legacy `"comfortable"`/`"compact"` is passed or defaults missing keys cleanly.
   - Clean up `ALLOWED_VAULT_KEYS` (remove `telegram_bot_token` and `telegram_chat_id`) and add `DELETE /api/v1/profile/vault/{key}`.
2. `ops` (`backend/app/modules/ops/router.py`):
   - Containers full CRUD + View + Lifecycle:
     - Authorization helper: allow container if present in `settings.allowed_mt5_containers`, OR Docker container has label `exness-panel.managed=true`, OR registered in `docker_containers` DB table!
     - `GET /api/v1/ops/containers` (merges live Docker daemon list + DB `docker_containers` records + linked `TradingAccount` summaries).
     - `POST /api/v1/ops/containers` (register container in DB, `409` if duplicate `container_name`).
     - `GET /api/v1/ops/containers/{id_or_name}` (detail view: DB metadata + live Docker inspect + live CPU/RAM stats from `/containers/{name}/stats?stream=false` when reachable + linked `TradingAccount` list).
     - `PATCH /api/v1/ops/containers/{id_or_name}` (update `display_name`, `host_label`, `is_restart_allowed`, `container_name`).
     - `DELETE /api/v1/ops/containers/{id_or_name}` (unregister from `docker_containers` DB, unlink `TradingAccount.container_id = None`).
     - `POST /api/v1/ops/containers/{name}/{start|stop|restart}` (respecting `is_restart_allowed` if registered with `False`, recording audit log).
     - `GET /api/v1/ops/containers/{name}/logs?tail=200` (with secret redaction for `htk_`, Bearer tokens, passwords).
   - `POST /api/v1/ops/kill-switch/{account_id_or_login}`: lookup by `TradingAccount.id == key OR TradingAccount.mt5_login == key`.
   - `GET /api/v1/ops/setup-wizard/{account_id_or_login}/bridge.set?url_mode=internal|external`:
     - Lookup by `TradingAccount.id == key OR TradingAccount.mt5_login == key` (so `/api/v1/ops/setup-wizard/253752700/bridge.set` works!).
     - Decrypt `account.api_key_enc` via Fernet (`security.decrypt_secret`) when present so `AccountApiKey=htk_...` is pre-filled directly (fallback to clear instructions with `account.api_key_prefix` only if `api_key_enc` is NULL on a legacy row before key rotation).
     - Emit `ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest` by default (`url_mode=internal`) or `https://terminal.huseynovlar.org/api/v1/ingest` when `url_mode=external` (or derived external URL).
     - Serve with `Content-Disposition: attachment; filename="ExnessPanelBridge_{account.mt5_login}.set"`.
   - `GET /api/v1/ops/downloads/ExnessPanelBridge.mq5` & `GET /api/v1/ops/downloads/ExnessPanelHook.mqh`:
     - Read actual file from `<repo>/mql5/` (or `/app/mql5` fallback; never modify `mql5/`!) and serve with `Content-Disposition: attachment; filename="..."`.
   - `/etc` Integrations Status & Test Endpoints:
     - `GET /api/v1/ops/integrations/status`: read-only masked health for Gemini (`configured`, `source` `/etc`|`env`|`vault`|`none`, `model`, `masked_key`), Telegram Webhook (`configured`, `source`, `webhook_url`, `auth_header`: `"X-Trading-Webhook-Secret"`, `secret_configured`), and `CONFIG_DIR` YAML load counts (`config_dir`, `exists`, counts of `news_sources`, `treemap_universes`, `default_assets`, `alert_rules`).
     - `POST /api/v1/ops/alerts/test`: sends `{title, message, severity: "info", source: "huseynovlar-terminal"}` with `X-Trading-Webhook-Secret` header matching `server_telegram_bot` contract!
     - `POST /api/v1/ops/integrations/gemini-test`: tests Gemini API connectivity using configured `google_ai_api_key` & `google_ai_default_model` with clear diagnostic response (`ok`, `model`, `latency_ms`, `reply` or clear error if key not configured / upstream error).
3. `audit` (`backend/app/modules/audit/router.py`):
   - `GET /api/v1/audit`: add query filters (`action`, `resource_type`, `user_id`, `limit`).
   - `GET /api/v1/audit/{id}`: detail view returning full audit entry + resolved username if available (`404` if not found).
4. `wiki` (`backend/app/modules/wiki/router.py` mounted at `/api/v1/wiki` in `app/main.py`):
   - `GET /api/v1/wiki` (with optional `category` & `q` search filters, pinned first).
   - `POST /api/v1/wiki` (`OPERATOR` or `ADMIN`, auto-generating/normalizing unique `slug` if omitted).
   - `GET /api/v1/wiki/{slug_or_id}` (lookup by `WikiPage.slug == key OR WikiPage.id == key`).
   - `PATCH /api/v1/wiki/{slug_or_id}` (`OPERATOR` or `ADMIN`).
   - `DELETE /api/v1/wiki/{slug_or_id}` (`ADMIN` or `OPERATOR`).

### 5. Comprehensive Automated Test Suite (`backend/tests/test_m2_*.py`)
- Thorough async pytest integration tests covering all M2 deliverables and edge cases while keeping existing `backend/tests/test_*.py` 100% green.
- Verification commands:
  - `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/ruff check /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests`
  - `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/pytest -v -c /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/pyproject.toml /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests`
