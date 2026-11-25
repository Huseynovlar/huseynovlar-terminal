# Backend, Worker, Infra, MQL5/MT5, Auth, WebSockets & Telegram Bot Survey (`handoff.md`)

**Core Summary:** While the backend/infra skeleton passes its 9 unit tests in SQLite memory, **production is broken by 18 concrete architectural and integration bugs** — most notably `config_dir` resolving to `/config` instead of `/app/config` inside Docker (wiping out all YAML news/asset/treemap configs), `terminal-backend` lacking `panel_egress` + `dns` (blocking Yahoo Finance, Gemini, GeoIP, RSS, and Telegram), missing `ht_access_token` cookies + missing 401 refresh interceptor (breaking downloads and container actions after 30m), unencoded WebAuthn `ArrayBuffer` fields (`TypeError`), in-memory-only `ws_hub` without Redis Pub/Sub or heartbeats, `hash()` fake treemap numbers + unpopulated `EconomicEvent` calendar, dotless MT5 URL `http://terminal-backend:8000` (`err=4014`), and `/internal/webhooks/trading` missing from `DEFAULT_AUTH_SKIP_PATHS` in `server_telegram_bot` (`HTTP 401`).

---

## 1. Observation

### 1.1. Attached Screenshots & Workspace Files
- **Symlinks in `/home/antigravity/`** (`-> /home/antigravity/upload/`):
  - **`/home/antigravity/image.png`** (18,252 B, Nov 24 20:29): MetaTrader 5 `Tools -> Options -> Expert Advisors` dialog (in Russian):
    - Checkbox `[✓] Разрешить WebRequest для следующих URL:` is checked.
    - Selected blue row displays: `+ добавить URL в формате 'https://www.mql5.com'`.
    - No URLs are listed below it because MT5's dialog rejected `http://terminal-backend:8000`.
  - **`/home/antigravity/image_2.png`** (75,184 B, Nov 24 20:29): User's live MetaTrader 5 chart window:
    - Chart symbol & timeframe: **`USTECc, M5: US Tech 100 Index`** (Exness Standard Cent symbol `USTECc`).
    - Attached trading robot custom GUI panel: **`NasdaqPulse v3.01 ALL-WEATHER  USTECc`** (with `[-]` collapse button).
    - Top status pills: **`ALGO: ON`** (green) | **`MKT: OPEN`** (green).
    - Session/state line: **`STATE: OFF_SESSION (19:22:15)`** (amber).
    - Strategy telemetry box:
      - `Trend: H4+H1 BEAR | RSI: 41.1 | ER: 0.23`
      - `Risk: TURBO | P-KELLY (0.00L) | Sp: 1.12pt`
      - `Seq: FLAT | Pos: 0 | Trd: 0`
    - Account/Equity telemetry box (denominated in Exness Cents `¢` / `USC`):
      - `Day: +¢0.00 | DD: 0.0%`
      - `Bal: ¢2600 | Work: ¢2600` (`2600 USC` = `$26.00 USD`)
      - `Bank: ¢0 (WAIT)`
    - Bottom interactive buttons: **`PAUSE`** | **`CLOSE ALL`** (red).
    - Corroborated by MT5 Experts log in `ORIGINAL_REQUEST.md:89-91`: `2026.11.24 19:34:00.998 ee (USTECc,M5) [ExnessPanelBridge] POST /snapshot failed: HTTP -1 (err=4014)` and `POST /bars failed: HTTP -1 (err=4014)` (user compiled `ExnessPanelBridge.mq5` as `ee` on `USTECc,M5`).
  - **`/home/antigravity/image_3.png`** (41,403 B, Nov 24 18:18) & **`/home/antigravity/image_4.png`** (8,206 B, Nov 24 18:18): Earlier UI screenshots showing Studio Admin template leftovers (`Arham Khan / hello@arhamkhnz.com`, `Have something in mind?`, `Quick Create`, fake `XAUUSD • Magic #77701`) that were partially purged in commit `68c65fa`.
  - **MQL5 files in workspace**: Only `/home/antigravity/Huseynovlar/huseynovlar-terminal/mql5/ExnessPanelBridge.mq5` and `mql5/ExnessPanelHook.mqh` exist (user's `NasdaqPulse` `.mq5`/`.ex5` is not in the workspace).

### 1.2. VM Environment, Runtimes, Git & CI/CD
- **Installed Runtimes & Tools**:
  - Python: `Python 3.12.16` (`/opt/pyenv/shims/python3`), global `pytest 9.2.0` (`/opt/pipx/bin/pytest`), `uvicorn` (`/opt/pyenv/shims/uvicorn`).
  - Pre-built Backend Venv: `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv` (`Python 3.12.16`, `pytest 8.4.2`, `ruff`, `fastapi`, `sqlalchemy`, `aiosqlite`, `webauthn`, `pyotp`, `cryptography`, `httpx`).
  - Node / JS: `node v22.23.5`, `npm 12.2.2`, `pnpm 12.21.0`, `yarn`, `bun`; `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/node_modules` is pre-installed.
  - Containers & GitHub CLI: `Docker version 29.10.0` (`docker ps` works, 0 local containers running), `gh version 2.103.3` (authenticated via `github` plugin).
- **Git Status & Remotes**:
  - `/home/antigravity/Huseynovlar/huseynovlar-terminal`: branch `main...origin/main` (clean, HEAD `eae5685`), remote `https://github.com/Huseynovlar/huseynovlar-terminal.git`.
  - `/home/antigravity/Huseynovlar/server_telegram_bot`: branch `main...origin/main` (clean, HEAD `19a9ed7`), remote `https://github.com/Huseynovlar/server_telegram_bot.git`.
- **CI/CD Pipelines**:
  - `huseynovlar-terminal/.github/workflows/ci.yml:1-50`: `docker compose -f deploy/docker-compose.yml config --quiet`, `ruff check app tests` + `pytest -v` (in `backend/`), `npm ci` + `npm run build` (in `frontend/`).
  - `huseynovlar-terminal/.github/workflows/deploy-production.yml:1-122` + `deploy/scripts/deploy.sh:1-59`: triggered on push to `main`; runs backend & frontend checks, builds `huseynovlar-terminal-backend:$TAG` and `huseynovlar-terminal-frontend:$TAG`, tars `backend.tar` + `frontend.tar` + `deploy/docker-compose.yml` + `config/` into `release.tgz`, joins NetBird (`https://vpn.huseynovlar.org`), and streams `release.tgz` over SSH to `deploy-bot@100.104.116.58` (`/usr/local/bin/huseynovlar-terminal-deploy`, base `/opt/huseynovlar-terminal`), with automatic rollback to `previous_tag` on failure.
  - `server_telegram_bot/.github/workflows/ci.yml:1-21` & `deploy-production.yml:1-86` + `scripts/server/deploy.sh:1-47`: Python 3.13, `ruff check .`, `ruff format --check .`, `pytest -q -W error::ResourceWarning`. **Critical note (`deploy-production.yml:38-42`, `scripts/server/deploy.sh:7,18-27`)**: `server_telegram_bot` bundles **ONLY `image.tar`** and does **NOT** sync `deploy/docker-compose.yml` to `/opt/huseynovlar-bot/docker-compose.yml` on deploy!

### 1.3. Auth, Cookies, Downloads, Container Token Expiry & WebAuthn (`huseynovlar-terminal`)
- **Cookie & Token Issuance (`backend/app/modules/auth/router.py:104-143`, `backend/app/core/deps.py:17-45`, `backend/app/core/config.py:31-33`)**:
  - `config.py:31-33`: `access_token_expire_minutes = 30`, `refresh_token_expire_days = 14`, `cookie_secure = True`.
  - `deps.py:24-30`: `get_current_user` checks `Authorization: Bearer <token>`, then `elif "ht_access_token" in request.cookies: token = request.cookies.get("ht_access_token")`, else raises `401 {"detail": "Authentication required"}`.
  - `auth/router.py:127-135`: `_issue_session_tokens` sets **ONLY** `ht_refresh_token` (`httponly=True, secure=settings.cookie_secure, samesite="strict", path="/api/v1/auth"`). **It NEVER sets `ht_access_token` cookie!**
  - `frontend/src/framework/api-client.ts:3-46`: stores `access_token` only in `window.sessionStorage.getItem("ht_access_token")` and attaches `Authorization: Bearer ${accessToken}` ONLY on `apiRequest()` `fetch` calls. It has **no 401 interceptor** to call `POST /api/v1/auth/refresh`.
  - `frontend/src/routes/(main)/dashboard/route.tsx:33-38`: `if (!getAccessToken())` only calls `/auth/refresh` if `sessionStorage` is completely empty.
  - `frontend/src/routes/(main)/dashboard/academy/route.tsx:66` & `analytics/route.tsx:119`: use `window.open("/api/v1/ops/setup-wizard/.../bridge.set", "_blank")` and `window.open("/api/v1/analytics/statement.csv", "_blank")`, which send **no `Authorization` header** and **no `ht_access_token` cookie**, always failing with `401 {"detail": "Authentication required"}`.
  - `backend/app/modules/ops/router.py:336-346` & `238-256`: `download_mt5_bridge_set` and `trigger_kill_switch` look up `await db.get(TradingAccount, account_id)` (internal 36-char UUID), whereas the UI (`default/route.tsx:319`) only displays `#253752700` (`mt5_login`). When the user visits `/api/v1/ops/setup-wizard/253752700/bridge.set`, even after auth, `db.get` by UUID returns `None` (`404 Account not found`)!
  - Furthermore, `ops/router.py:352` writes literal placeholder `AccountApiKey=PASTE_YOUR_KEY_STARTING_WITH_{account.api_key_prefix}` instead of a working key, and there are **zero endpoints** to download `ExnessPanelBridge.mq5` or `ExnessPanelHook.mqh`.
- **WebAuthn Passkeys (`backend/app/modules/auth/router.py:47-62, 316-512`, `profile/route.tsx:214-235`, `login/route.tsx:58-77`)**:
  - `auth/router.py:340` & `412`: `json.loads(options_to_json(options))` returns `challenge` (`str`), `user.id` (`str`), `excludeCredentials[].id` (`str`), and `allowCredentials[].id` (`str`) as base64url strings (verified via Python execution in `backend/.venv`).
  - `profile/route.tsx:221-229`: passes raw JSON `options` directly to `navigator.credentials.create({ publicKey: options })` -> throws browser **`TypeError`** because WebAuthn DOM API requires `BufferSource` (`Uint8Array` / `ArrayBuffer`) for `challenge`, `user.id`, and `excludeCredentials[].id`. Then passes raw `PublicKeyCredential` instance `cred` to `JSON.stringify({ credential: cred })` without converting `ArrayBuffer` fields (`rawId`, `response.clientDataJSON`, `response.attestationObject`, `response.transports`) to base64url JSON.
  - `login/route.tsx:66-70`: identical `TypeError` bug on `navigator.credentials.get({ publicKey: options })` (`challenge` and `allowCredentials[].id` are strings) and raw `cred` serialization.
  - `auth/router.py:47, 392`: `_webauthn_challenges` is an in-process dict using static key `"login:discoverable"` (race condition if two login requests occur, and wiped on container restart instead of using Redis).
  - `auth/router.py:472-480`: `list_passkeys` omits `"sign_count": c.sign_count`, while `profile/route.tsx:417` renders `{pk.sign_count}` (`undefined`).

### 1.4. Database Models, Migrations, Config Path Bug & Complete Endpoint Map
- **Alembic & Schema Initialization**:
  - `backend/alembic/versions/` is **completely empty** (0 migration files).
  - `backend/app/main.py:27-33`: runs `Base.metadata.create_all` on startup. **Critical risk**: `create_all` creates new tables in PostgreSQL `terminal_pgdata`, **but NEVER adds new columns or alters existing tables**! Any column added to an existing model in `models.py` will crash production PostgreSQL with `UndefinedColumnError` unless migrated via Alembic or idempotent DDL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- **CRITICAL PRODUCTION CONFIG BUG (`backend/app/core/config.py:37`, `backend/Dockerfile:7,14-18`)**:
  - `config.py:37`: `config_dir: Path = Field(default=Path(__file__).resolve().parents[3] / "config", alias="CONFIG_DIR")`.
  - In local repo (`backend/app/core/config.py`), `parents[3]` is repo root -> `<repo>/config` (so `pytest` passes!).
  - Inside `backend/Dockerfile` (`WORKDIR /app`, `COPY backend/app /app/app`, `COPY config /app/config`), `__file__` is `/app/app/core/config.py` -> **`parents[3]` is `/`**, so `config_dir` resolves to **`/config`** (does not exist; files are at `/app/config`, and `CONFIG_DIR` is not set in `Dockerfile` or `deploy/docker-compose.yml`)!
  - `load_yaml_config()` (`config.py:42-48`) silently returns `{}` when `not path.exists()`. Consequently in production:
    - `GET /api/v1/intelligence/sources` -> `[]` (Verified Sources Registry is **completely empty**!).
    - `run_news_refresh()` in `worker` and `POST /api/v1/intelligence/news/refresh` -> `feeds = []` (**zero news ever fetched**!).
    - `GET /api/v1/intelligence/treemap` -> `sectors = []` (empty).
    - `POST /api/v1/assets/seed-defaults` -> `seeded = []` (empty).
- **ORM Models Inventory (`backend/app/db/models.py:33-430` — 16 tables)**:
  1. `User` (`users`): `id`, `username`, `email`, `password_hash`, `role` (`ADMIN|OPERATOR|VIEWER`), `is_active`, `display_name`, `bio`, `avatar_url`, `social_links` (JSON), `totp_secret_enc`, `totp_enabled`, `preferences` (JSON), `created_at`, `updated_at`.
  2. `WebAuthnCredential` (`webauthn_credentials`): `id`, `user_id`, `credential_id`, `public_key`, `sign_count`, `device_name`, `transports` (JSON), `created_at`, `last_used_at`.
  3. `UserSession` (`user_sessions`): `id`, `user_id`, `refresh_token_hash`, `ip_address`, `user_agent`, `revoked`, `created_at`, `expires_at`.
  4. `AuditLog` (`audit_logs`): `id`, `user_id`, `action`, `resource_type`, `resource_id`, `ip_address`, `details` (JSON), `created_at`.
  5. `ExnessProfile` (`exness_profiles`): `id`, `name`, `notes`, `external_api_key_enc`, `external_api_secret_enc`, `created_at`.
  6. `DockerContainer` (`docker_containers`): `id`, `container_name`, `display_name`, `host_label`, `is_restart_allowed`, `last_status`, `created_at`.
  7. `AssetHub` (`assets`): `id`, `code`, `name`, `group`, `status` (`active|watchlist|archived`), `color`, `icon`, `broker_symbols` (JSON), `news_tags` (JSON), `macro_drivers` (JSON), `notes`, `created_at`. *(Missing: `logo_url` / exchange metadata).*
  8. `TradingAccount` (`trading_accounts`): `id`, `profile_id`, `container_id`, `primary_asset_id`, `name`, `mt5_login`, `mt5_server`, `account_type`, `currency` (`USD|USC|EUR`), `currency_divisor`, `leverage`, `is_demo`, `is_active`, `api_key_prefix`, `api_key_hash`, `last_seen_at`, `algo_trading_enabled`, `terminal_connected`, `last_ping_ms`, `last_synced_deal_ticket`, `last_balance`, `last_equity`, `last_floating_pnl`, `last_margin_level`, `created_at`. *(Missing: `api_key_enc` so `.set` downloads can embed the real `htk_...` key directly).*
  9. `Robot` (`robots`): `id`, `account_id`, `asset_id`, `magic_number`, `name`, `symbol`, `program_name`, `version`, `strategy_notes`, `params_json`, `live_status`, `live_state_json`, `last_execution_ms`, `last_heartbeat_at`, `is_active`, `created_at`.
  10. `SecretVaultEntry` (`secret_vault`): `key`, `value_enc`, `updated_at`.
  11. `Deal` (`deals`): `id`, `account_id`, `mt5_deal_ticket`, `order_ticket`, `position_id`, `magic_number`, `symbol`, `deal_type`, `entry_type`, `volume`, `price`, `commission`, `swap`, `profit`, `fee`, `net_profit`, `net_profit_usd`, `comment`, `time_msc`. *(Missing: user journal `notes` / `tags`!).*
  12. `BalanceOperation` (`balance_operations`): `id`, `account_id`, `mt5_deal_ticket`, `op_kind` (`DEPOSIT|WITHDRAWAL|INTERNAL_TRANSFER|EXNESS_VAULT|REBATE`), `amount`, `amount_usd`, `comment`, `time_msc`. *(Missing: manual transfer entry/notes fields if reconciled manually).*
  13. `OpenPositionLive` (`open_positions_live`): live open positions + `mae_usd`, `mfe_usd`.
  14. `EquitySnapshot` (`equity_snapshots`): historical equity/balance/margin snapshots.
  15. `MarketBar` (`market_bars`): OHLCV candles (`symbol`, `timeframe`, `bar_time`).
  16. `PendingCommand` (`pending_commands`), `NewsItem` (`news_items`), `EconomicEvent` (`economic_events`), `AiBriefing` (`ai_briefings`). *(Note: 19 model classes total in `models.py`; missing a DB model `NewsSource` for user-managed custom RSS/news feeds!)*
- **Server-Side Preferences Split-Brain**:
  - `PATCH /api/v1/profile/preferences` (`profile/router.py:88-98`) merges JSON into `users.preferences`, and `GET /api/v1/profile/me` returns `preferences`.
  - **Zero frontend code ever calls `PATCH /profile/preferences` or hydrates from `profile.preferences`!**
  - Instead:
    1. `frontend/src/lib/preferences/preferences-config.ts:55-104` stores `theme_mode` (`"dark"`), `theme_preset` (`"default"` — user wants `"tangerine"`!), `font` (`"geist"`), `content_layout` (`"full-width"`), `navbar_style` (`"sticky"`), `sidebar_variant` (`"sidebar"` — user wants `"floating"`!), `sidebar_collapsible` (`"icon"`) in **browser cookies only**.
    2. `frontend/src/framework/terminal-store.ts:54-99` stores `currencyMode`, `privacyMode`, `timezone`, `language`, `density` (`"comfortable"` / `"compact"` — user wants `"bloomberg"` only!), `tickerEnabled`, `tickerSpeed`, `soundEnabled`, `hiddenPageIds`, `pinnedAssetCodes`, `customHotkeys` in **`localStorage` only**.
    3. `frontend/src/framework/components/LiveAssetChart.tsx:157` stores chart drawings in **`localStorage` only** (`ht_drawings_${asset}`), and indicator settings (`EMA20/50/200`, `BB`, `timeframe`) are ephemeral React state (lost on every page navigation!).
- **Complete Audit of Broken / Fake / Missing Backend Endpoints**:

| Module / Router | Existing Endpoints | Bugs, Fake Data & Missing CRUD / View Endpoints |
|---|---|---|
| `auth` (`auth/router.py`) | `GET /auth/status`, `POST /auth/bootstrap`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/2fa/setup`, `POST /auth/2fa/verify`, `POST /auth/webauthn/register/options`, `POST /auth/webauthn/register/verify`, `POST /auth/webauthn/login/options`, `POST /auth/webauthn/login/verify`, `GET /auth/webauthn/credentials`, `DELETE /auth/webauthn/credentials/{id}`, `GET /auth/ip-lookup/{ip}`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/login-history` | 1. Never sets `ht_access_token` cookie (`deps.py:26` expects it).<br/>2. `request.client.host` logs Docker Nginx IP `172.x.x.x` instead of NetBird IP `100.104.x.x` because `uvicorn` lacks `--forwarded-allow-ips=*`.<br/>3. `list_passkeys` omits `sign_count`; challenges in memory.<br/>4. `ip-lookup` fails for public IPs because `backend` has no `panel_egress`.<br/>5. **Missing**: `POST /auth/change-password`, `POST /auth/2fa/disable`, `GET /auth/sessions/{id}`, `GET /auth/login-history/{id}`, and **entire Users Management CRUD** (`GET /users`, `GET /users/{id}`, `POST /users`, `PATCH /users/{id}`, `DELETE /users/{id}`). |
| `profile` (`profile/router.py`) | `GET /profile/me`, `PATCH /profile/me`, `PATCH /profile/preferences`, `GET /profile/vault`, `PUT /profile/vault/{key}` | 1. `ALLOWED_VAULT_KEYS` has `telegram_bot_token` & `telegram_chat_id` exposed in UI when user only needs `alerts_bot_webhook_url`, `alerts_bot_webhook_secret`, `google_ai_api_key` (moved to System/Settings `/etc`).<br/>2. **Missing**: `DELETE /profile/vault/{key}` (clear secret), avatar upload or validation, preference schema sync. |
| `accounts` (`accounts/router.py`) | `GET /profiles`, `POST /profiles`, `GET /accounts`, `POST /accounts`, `POST /accounts/{id}/rotate-key`, `GET /robots`, `POST /robots` | 1. **Frontend calls `GET /api/v1/accounts/robots` (`default/route.tsx:84`) -> 404** because backend route is `GET /api/v1/robots`!<br/>2. `GET /robots` (`accounts/router.py:264-279`) **omits** `live_status`, `live_state_json`, `last_execution_ms`, `last_heartbeat_at`, `params_json`!<br/>3. **Missing**: `GET /profiles/{id}`, `PATCH /profiles/{id}`, `DELETE /profiles/{id}`; `GET /accounts/{id}` (full account view), `PATCH /accounts/{id}`, `DELETE /accounts/{id}`; `GET /robots/{id}` (full robot view), `PATCH /robots/{id}`, `DELETE /robots/{id}`. |
| `assets` (`assets/router.py`) | `GET /assets`, `POST /assets`, `PATCH /assets/{id}`, `DELETE /assets/{id}`, `POST /assets/seed-defaults` | 1. `seed-defaults` returns `[]` in Docker due to `/config` path bug.<br/>2. **Missing**: `GET /assets/{code_or_id}` (rich Hub detail bundle: live quote, accounts, robots, deals, news, calendar, logos). |
| `charts` (`charts/router.py`) | `GET /charts/explore`, `GET /charts/{asset_code}`, `WS /ws/live` | 1. `GET /charts/explore` fails with `502 Bad Gateway` in Docker because `terminal-backend` is not on `panel_egress`!<br/>2. **Missing**: `GET /charts/search?q=...` (Yahoo Finance symbol search/autocomplete + logo metadata), server-side chart layout/drawings/indicators persistence, macro quotes ribbon endpoint (`GET /charts/macro` for `SP500`, `NASDAQ`, `DXY`, `US10Y`, `VIX`, `XAUUSD`, `BTCUSD` — explains why Global Market buttons had zero effect!). |
| `ingest` (`ingest/router.py`) | `POST /ingest/bootstrap`, `POST /ingest/snapshot`, `POST /ingest/trade-event`, `POST /ingest/bars` | 1. Does not auto-register unknown `Robot` by `magic_number` when deals/positions/states arrive from MT5 (`ingest/router.py:182-192` ignores `robot_states` if `Robot` wasn't manually created first, contradicting `default/route.tsx:393` text `"Роботы появятся автоматически"`!).<br/>2. `ingest_bars` does not broadcast live bar updates to `ws_hub`. |
| `analytics` (`analytics/router.py`) | `GET /analytics/overview`, `GET /analytics/treasury`, `GET /analytics/statement.csv` | 1. `total_commission_usd` & `total_swap_usd` (`analytics/router.py:94-95`) sum native `d.commission` / `d.swap` **without dividing by `currency_divisor`** (`100.0` for `USC` cent accounts — 100x inflation bug on cent accounts!).<br/>2. `statement.csv` fails on direct browser download (no cookie) and exports `.csv` only (no `.xlsx` or balance/transfer rows).<br/>3. **Missing**: `GET /analytics/deals` & `GET /analytics/deals/{id}` (paginated Trade Journal + View + notes/tags), `GET /analytics/positions` (live positions table), `GET /analytics/transfers/{id}` & manual treasury note/entry CRUD, Risk Lab endpoints (correlation matrix, Monte Carlo, TCA execution quality). |
| `intelligence` (`intelligence/router.py`) | `GET /intelligence/sources`, `GET /intelligence/news`, `POST /intelligence/news/refresh`, `GET /intelligence/calendar`, `GET /intelligence/treemap`, `POST /intelligence/ai/analyze` | 1. **`GET /intelligence/treemap` (`lines 320-323`) returns 100% FAKE `hash()` data** (`((hash(f"{ticker}:{period}") % 700) - 300) / 100.0`)!<br/>2. **`GET /intelligence/calendar` (`lines 284-301`) is 100% UNIMPLEMENTED** (`EconomicEvent` is never fetched from ForexFactory JSON anywhere!).<br/>3. `sources` & `news/refresh` fail in Docker due to `/config` path bug AND `backend` lacking `panel_egress`.<br/>4. `POST /intelligence/ai/analyze` fails in Docker (`backend` has no `panel_egress` to reach `generativelanguage.googleapis.com`!).<br/>5. **Missing**: Custom News Sources CRUD (`POST/PATCH/DELETE /intelligence/sources`), live news search (`?q=...`), single news view (`GET /intelligence/news/{id}`), AI Briefing history (`GET /intelligence/ai/briefings`, `GET /intelligence/ai/briefings/{id}`, `DELETE`). |
| `ops` (`ops/router.py`) | `POST /ops/containers`, `GET /ops/containers`, `POST /ops/containers/{name}/{action}`, `GET /ops/containers/{name}/logs`, `POST /ops/kill-switch/{account_id}`, `POST /ops/alerts/test`, `GET /ops/setup-wizard/{account_id}/bridge.set` | 1. `mt5-xau` and `mt5-ustec` are **REAL Docker containers on the VPS** (not fake seed data — `PREVIEW_CONTAINERS` were removed in `68c65fa`).<br/>2. `control_managed_container` (`line 172`) & `get_container_logs` (`line 222`) reject DB-registered `DockerContainer` rows with `403` unless also in `.env` `ALLOWED_MT5_CONTAINERS`.<br/>3. `setup-wizard/{account_id}/bridge.set` & `kill-switch/{account_id}` reject `mt5_login` (`253752700`), output `http://terminal-backend:8000/api/v1/ingest` (invalid in MT5), and output placeholder `AccountApiKey=PASTE_YOUR_KEY...`.<br/>4. **Missing**: `GET /ops/containers/{name}` detail/stats, `DELETE /ops/containers/{id}`, `GET /ops/mql5/ExnessPanelBridge.mq5`, `GET /ops/mql5/ExnessPanelHook.mqh`. |
| `audit` (`audit/router.py`) | `GET /audit` | **Missing**: filtering (`action`, `resource_type`, `user_id`, date range) and `GET /audit/{id}` detail view. |

### 1.5. Worker, Docker Networking, Caddy/Nginx & WebSockets
- **`deploy/docker-compose.yml` Network Isolation Bugs**:
  - `frontend` (`line 33`): `networks: [panel_internal, panel_egress]`, binds `127.0.0.1:18443:8080`. Caddy (`deploy/caddy/terminal.Caddyfile:5-19`) terminates TLS via Cloudflare DNS-01 on `terminal.huseynovlar.org`, restricts `@admins remote_ip 100.104.0.0/16` (NetBird VPN), and reverse-proxies to `127.0.0.1:18443`.
  - `backend` (`line 65`): `networks: [panel_internal, exness_mt5_ingest, panel_docker_proxy]`. **All three networks are `internal: true`!** `backend` is **missing `panel_egress` and `dns: [1.1.1.1, 9.9.9.9]`** (mandatory on this VPS because host DNS is NetBird `100.x`, unreachable from bridge containers, as documented in `server_telegram_bot/deploy/docker-compose.yml:60`).
  - `backend` command (`line 49`): `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]` — missing `--forwarded-allow-ips=*`, so Uvicorn ignores `X-Forwarded-For` from `terminal-frontend` (`172.x.x.x`).
  - `worker` (`lines 82-109`, `worker/main.py:1-38`): has `networks: [panel_internal, panel_egress]` and `dns: [1.1.1.1, 9.9.9.9]`, **but `worker/main.py` ONLY calls `run_news_refresh()`** (which did nothing due to `/config` path bug!). Worker never refreshes Economic Calendar, Market Treemap, Macro Quotes, or Alert Rules (`alerts.default.yaml`).
- **WebSockets (`backend/app/core/ws_hub.py`, `charts/router.py:245-253`, `frontend/src/framework/use-live-socket.ts`)**:
  - `REDIS_URL` is configured in `docker-compose.yml`, and `redis>=5.2.0` is in `requirements.txt`, **but `redis` is NEVER imported anywhere in `backend/` or `worker/`**!
  - `ws_hub` is an in-process `set[WebSocket]`. Any `ws_hub.broadcast()` called in `terminal-worker` (`intelligence/router.py:259`) broadcasts to `0` connections!
  - `websocket_live` (`charts/router.py:245`) performs **no authentication**, sends **no initial state/welcome payload**, and sends **no periodic server heartbeat/timestamp frame**. Thus Chrome DevTools WS inspector displays only `WebSocket Connection Established 1795546543.078971` with zero frames.
  - Frontend pages (`default/route.tsx`, `LiveAssetChart.tsx`, `BloombergTickerTape.tsx`, `infrastructure/route.tsx`, `finance/route.tsx`) do not subscribe to `useLiveTerminalSocket` to update balances, equity, ticks, positions, robot states, or news in real time.

### 1.6. MQL5 Bridge (`ExnessPanelBridge.mq5`, `ExnessPanelHook.mqh`), Exness Keys & `server_telegram_bot`
- **MT5 URL Validation & `err=4014`**:
  - `mql5/ExnessPanelBridge.mq5:17` and `ops/router.py:351` hardcode `ApiBaseUrl = "http://terminal-backend:8000/api/v1/ingest"`.
  - MetaTrader 5's `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL` UI rejects hostnames without a dot (`.`). Because no URL could be added, MQL5 `WebRequest()` (`ExnessPanelBridge.mq5:96`) immediately fails locally with HTTP `-1` and `GetLastError() == 4014` (`ERR_FUNCTION_NOT_ALLOWED`).
  - **Clean Zero-Latency Fix**: Add Docker network alias `ingest.terminal.local` to `backend` on `exness_mt5_ingest` in `deploy/docker-compose.yml` (and also support `https://terminal.huseynovlar.org/api/v1/ingest`). Docker's internal DNS resolves `http://ingest.terminal.local:8000` in `<1 ms` inside `mt5-xau` and `mt5-ustec`, and MT5's WebRequest dialog accepts `http://ingest.terminal.local:8000` because it contains dots!
- **Running Two EAs in MT5 & `ExnessPanelHook.mqh` Integration**:
  - MetaTrader 5 allows **1 Expert Advisor per chart tab**, NOT per MT5 terminal. Opening a second chart tab (`File -> New Chart -> USTECc`) lets `NasdaqPulse v3.01` run on Tab 1 while `ExnessPanelBridge.mq5` runs on Tab 2 in its own thread with zero interference.
  - **Bug in `ExnessPanelBridge.mq5` vs `ExnessPanelHook.mqh`**: `ExnessPanelHook.mqh:25-42` writes JSONL telemetry to `MQL5/Files/ep_ipc\events_<login>.jsonl`, **but `ExnessPanelBridge.mq5` has zero code to read `ep_ipc` or send `robot_states`!** Furthermore, `ExnessPanelBridge.mq5` can automatically discover running EAs on other chart tabs in the same MT5 instance via `ChartFirst()`/`ChartNext()` + `ChartGetString(chart_id, CHART_EXPERT_NAME)` (and even scrape on-chart label text like `NasdaqPulse`'s `STATE: OFF_SESSION`, `Trend`, `Risk`) **without requiring the user to modify or recompile `NasdaqPulse`** — while also reading `ep_ipc` if `ExnessPanelHook.mqh` is optionally `#include`d!
- **Exness Personal Area API Keys vs Terminal `htk_...` Key**:
  - Exness Personal Area API keys (scopes: `Full access / Read-only partnership`, `Internal transfers`, `Partner transfers`) are strictly for Exness Partner / Wallet APIs — Exness does **not** use API keys for MT5 trading accounts.
  - The user does **NOT** need to recreate Exness accounts and does **NOT** need an Exness Personal Area API key. Huseynovlar Terminal generates its own per-account ingestion key `htk_...` (`X-Account-Api-Key`) for `ExnessPanelBridge.mq5`.
- **`server_telegram_bot` (`/internal/webhooks/trading`)**:
  - `server_telegram_bot/app/core/main.py:1122-1165, 1292`: `POST /internal/webhooks/trading` verifies `TRADING_WEBHOOK_SECRET` via `X-Trading-Webhook-Secret` / `X-Webhook-Secret` / `Bearer`, formats `[TRADING] {title}`, and calls `notif.enqueue_alert(category="services", ...)`. `huseynovlar-alerts-bot` automatically delivers it to subscribed Telegram users — **confirming `telegram_bot_token` and `telegram_chat_id` are completely unnecessary in `huseynovlar-terminal`**.
  - **3 Bugs Blocking Delivery**:
    1. **`server_telegram_bot/app/common/web.py:18-23`**: `DEFAULT_AUTH_SKIP_PATHS` contains `("/health", "/internal/webhooks/grafana", "/internal/webhooks/ssh-login", "/internal/webhooks/backup")` — **`"/internal/webhooks/trading"` was forgotten!** `internal_auth_middleware` intercepts every call and returns `401 {"error": "unauthorized", "message": "Invalid internal token"}`!
    2. **`server_telegram_bot` deploy script (`scripts/server/deploy.sh`, `.github/workflows/deploy-production.yml:38`)**: deploys `image.tar` only; `/opt/huseynovlar-bot/docker-compose.yml` on the VPS is not auto-updated with `TRADING_WEBHOOK_SECRET: ${TRADING_WEBHOOK_SECRET:-}`.
    3. **Container Loopback Bug**: `.env.example:37` sets `ALERTS_BOT_WEBHOOK_URL=http://127.0.0.1:18080/internal/webhooks/trading`. Inside `terminal-backend` / `terminal-worker`, `127.0.0.1` is the container itself, not the VPS host where `huseynovlar-core` binds `127.0.0.1:18080:8080`! Connecting `huseynovlar-core`, `terminal-backend`, and `terminal-worker` to a shared `--internal` Docker network (e.g. `huseynovlar_webhooks` or `exness_mt5_ingest`) allows calling `http://huseynovlar-core:8080/internal/webhooks/trading` directly.

---

## 2. Logic Chain

1. **Why News, Verified Sources Registry, Calendar, Treemap & Global Market Buttons Failed**:
   - From `backend/app/core/config.py:37` + `backend/Dockerfile:14-18` → inside Docker `/app/app/core/config.py`, `parents[3]` is `/`, so `load_yaml_config()` looks in `/config` instead of `/app/config` and returns `{}` → `GET /intelligence/sources` returns `[]` and `worker` fetches `0` feeds.
   - From `deploy/docker-compose.yml:65` → `terminal-backend` has no `panel_egress` or `dns` → `GET /charts/explore`, `POST /intelligence/news/refresh`, `POST /intelligence/ai/analyze`, and `GET /auth/ip-lookup/{ip}` cannot reach the internet.
   - From `intelligence/router.py:284-333` → `EconomicEvent` has zero ingestion code (`calendar` is always empty), and `/treemap` uses `hash()` instead of real Yahoo Finance market data.
2. **Why Passkeys, Downloads & Container Buttons Failed**:
   - From `auth/router.py:340,412` + `profile/route.tsx:224` + `login/route.tsx:67` → `options_to_json` emits base64url strings while `navigator.credentials.create/get` demands `BufferSource` (`Uint8Array`) → browser throws `TypeError`.
   - From `deps.py:26` + `auth/router.py:127-135` → `deps.py` looks for cookie `ht_access_token`, which `auth/router.py` never sets → direct browser/incognito links (`bridge.set`, `statement.csv`) return `401 {"detail": "Authentication required"}`.
   - From `config.py:31` + `api-client.ts:18-46` + `dashboard/route.tsx:33` → `ht_access_token` in `sessionStorage` expires after 30 minutes with no 401 refresh retry → clicking Restart/Start/Stop/Logs on real VPS containers `mt5-xau` / `mt5-ustec` fails with `Invalid or expired token`.
3. **Why MT5 Bridge (`err=4014`), Robot Statuses & Clock Failed**:
   - From `image.png` + `ExnessPanelBridge.mq5:17,96` → MT5 rejects dotless `http://terminal-backend:8000` in its WebRequest allowlist → `WebRequest()` returns `-1` (`err=4014`).
   - From `default/route.tsx:84,94` + `accounts/router.py:251-279` → frontend requests `/api/v1/accounts/robots` (404; actual route `/api/v1/robots` also omits `live_status`/`live_state_json`), and the UTC clock uses `setInterval(..., 5000)` instead of `1000` ms.
4. **Why WebSocket Looked Dead & Telegram Webhook Failed**:
   - From `ws_hub.py:12` + `charts/router.py:245` → `ws_hub` is in-memory only (no Redis Pub/Sub across `worker` -> `backend`) and sends zero handshake/heartbeat frames → DevTools shows only `WebSocket Connection Established <timestamp>`.
   - From `server_telegram_bot/app/common/web.py:18-23` → `/internal/webhooks/trading` is blocked by `internal_auth_middleware` (`401`) and `127.0.0.1:18080` points to container loopback instead of `huseynovlar-core`.

---

## 3. Caveats

- **Live VPS `.env` & PostgreSQL state**: We cannot SSH into `100.104.116.58` directly from this devbox; live container names (`mt5-xau`, `mt5-ustec`) and user MT5 account (`253752700`, `USTECc, M5`, `NasdaqPulse v3.01`, `¢2600` USC) were verified from `ORIGINAL_REQUEST.md` and `/home/antigravity/image_2.png`. Because PostgreSQL `terminal_pgdata` already has live tables on the VPS, schema changes MUST run idempotent migrations (`alembic upgrade head` or startup `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) rather than relying on `Base.metadata.create_all`.
- **User's proprietary EA source (`NasdaqPulse v3.01`)**: Only shown in `image_2.png` (not uploaded as `.mq5`). Designing `ExnessPanelBridge.mq5` to auto-discover EAs on sibling charts via `ChartFirst()`/`ChartNext()` + `ObjectGetString` AND optionally read `ep_ipc` from `ExnessPanelHook.mqh` guarantees 100% compatibility without needing the user's `.mq5` source.
- **Frontend component-by-component UI audit**: Detailed frontend route/template cleanup (`Studio Admin` demo pages, i18n keys, skeletons, toasts, sidebar/header layout) is covered by Survey Explorer 2; frontend files cited here were inspected specifically to trace auth, cookies, WebAuthn, WebSockets, preferences persistence, and API contract mismatches.

---

## 4. Conclusion

To make the entire ecosystem work seamlessly out-of-the-box on first login, the rebuild plan must address all five layers together:

1. **Docker, Networking & Config Fixes (`huseynovlar-terminal` & `server_telegram_bot`)**:
   - Fix `backend/app/core/config.py:37` (`CONFIG_DIR` default `/app/config` when `/app/config` exists, else repo `config/`, plus explicit `CONFIG_DIR=/app/config` in `Dockerfile` and `deploy/docker-compose.yml`).
   - Add `panel_egress` + `dns: [1.1.1.1, 9.9.9.9]` to `terminal-backend` in `deploy/docker-compose.yml`, add `--forwarded-allow-ips=*` to `uvicorn`, and add network alias `ingest.terminal.local` on `exness_mt5_ingest` so MT5 accepts `http://ingest.terminal.local:8000`.
   - Fix `server_telegram_bot/app/common/web.py` (`DEFAULT_AUTH_SKIP_PATHS` += `"/internal/webhooks/trading"`), update `server_telegram_bot` deploy bundle/script to sync `docker-compose.yml` (or provide exact VPS one-liner), and bridge `terminal-backend`/`terminal-worker` to `http://huseynovlar-core:8080/internal/webhooks/trading` over a shared internal Docker network.
2. **Zero-Friction Auth, Cookies, Downloads & WebAuthn**:
   - Set HttpOnly `ht_access_token` cookie (`path="/api/v1"`, `samesite="lax"`) alongside `ht_refresh_token` (`path="/api/v1"`), add automatic `401 -> /auth/refresh` retry in `api-client.ts`, add signed download tokens (`?dl_token=...`) so `.set`, `.mq5`, `.mqh`, `.csv`, and `.xlsx` downloads work even when pasted into an Incognito window, and implement proper base64url ↔ `Uint8Array` WebAuthn helpers on client + Redis-backed challenges on server.
3. **Real Market Data, Worker Engine & Redis WebSocket Hub**:
   - Wire Redis Pub/Sub into `ws_hub.py` so `worker` and `backend` stream real-time `connected`, `heartbeat` (every 5s), `snapshot` (balances/equity/floating PnL/ping), `tick`, `bar`, `trade_event`, `robot_state`, `breaking_news`, `calendar`, and `container_status` events to all UI pages.
   - Expand `worker/main.py` to continuously fetch & cache **real** Yahoo Finance quotes/treemap/macro indices (`SP500`, `NASDAQ`, `DXY`, `US10Y`, `VIX`, `XAUUSD`, `BTCUSD`), **real** ForexFactory economic calendar (`EconomicEvent`), RSS + custom user news feeds, and evaluate alert rules (`alerts.default.yaml` -> `server_telegram_bot`).
4. **Complete CRUD + View APIs, Migrations & Server-Persisted Preferences**:
   - Add idempotent DB migrations for new columns/tables (`api_key_enc`, custom `news_sources`, journal `notes`/`tags`, `logo_url`) and complete CRUD + detail View endpoints for Users, Sessions, Login History, Profile/Preferences (`tangerine` + `floating` + `bloomberg` + `UTC` + `RU/EN/AZ` + chart drawings/indicators all synced to `users.preferences`), Assets/Hubs (with symbol search & logos), Exness Accounts, Robots (auto-discovered + manual CRUD + `.mq5`/`.mqh`/pre-filled `.set` downloads), Deals/Positions/Transfers Journal, News & Verified Sources, Gemini Co-Pilot Briefings, and Docker Containers (`mt5-xau`, `mt5-ustec`).
5. **Upgraded `ExnessPanelBridge.mq5` & Clear Setup Guide**:
   - Default `ApiBaseUrl` to `http://ingest.terminal.local:8000/api/v1/ingest`, pre-fill `AccountApiKey=htk_...` inside generated `.set` files (accepting UUID or `mt5_login`), read both sibling-chart EAs (`NasdaqPulse`) and `ep_ipc` (`ExnessPanelHook.mqh`), fix `USC` commission/swap normalization in `analytics/router.py`, and provide clear Russian instructions on 2-chart MT5 setup, `GEMINI_API_KEY`, and `TRADING_WEBHOOK_SECRET` (confirming zero Exness account recreation needed).

---

## 5. Verification Method

Run these read-only verification commands in `/home/antigravity` to independently confirm every finding:

```bash
# 1. Run existing backend lint & unit tests (9/9 pass in 5s using scratch TMPDIR):
mkdir -p /home/antigravity/.gemini/jetski/scratch/teamwork_tmp/verify
TMPDIR=/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/verify \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/ruff check \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/app \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests
TMPDIR=/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/verify \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/pytest -v \
  -c /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/pyproject.toml \
  /home/antigravity/Huseynovlar/huseynovlar-terminal/backend/tests \
  --basetemp=/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/verify/pytest
rm -rf /home/antigravity/.gemini/jetski/scratch/teamwork_tmp/verify

# 2. Inspect critical bugs directly in source:
# - Docker /config path bug: backend/app/core/config.py:37 vs backend/Dockerfile:14-18
# - Missing backend panel_egress: deploy/docker-compose.yml:65
# - Missing ht_access_token cookie: backend/app/core/deps.py:26 vs backend/app/modules/auth/router.py:127-135
# - Fake hash() treemap & empty calendar: backend/app/modules/intelligence/router.py:284-333
# - /accounts/robots 404 & 5000ms clock: frontend/src/routes/(main)/dashboard/default/route.tsx:84,94
# - Missing /internal/webhooks/trading auth skip: server_telegram_bot/app/common/web.py:18-23
```

**Invalidation Conditions:** Any commit pushed after `eae5685` (`huseynovlar-terminal`) or `19a9ed7` (`server_telegram_bot`) modifying the cited files requires re-checking the corresponding line numbers.
