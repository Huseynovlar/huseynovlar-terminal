# Scope — Milestone 1 (`M1`): Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot`

- **Status**: `IN_PROGRESS`
- **Owner**: `teamwork_preview_sub_orch_m1_r2_1`
- **Mandatory Verbatim Input**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Architecture & Contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`

## Exclusive Write-Owned Paths (STRICT)
Workers under `M1` MAY ONLY create/edit files inside:
1. `/home/antigravity/Huseynovlar/server_telegram_bot/**`
2. `/home/antigravity/Huseynovlar/huseynovlar-terminal/deploy/**`
3. `/home/antigravity/Huseynovlar/huseynovlar-terminal/config/**`
4. `/home/antigravity/Huseynovlar/huseynovlar-terminal/mql5/**`
5. `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/Dockerfile`
6. `/home/antigravity/Huseynovlar/huseynovlar-terminal/.env.example`
7. `/home/antigravity/Huseynovlar/huseynovlar-terminal/.github/workflows/**`
8. `/home/antigravity/Huseynovlar/huseynovlar-terminal/.gitignore` (**CRITICAL**: DO NOT add `.agents/`, `.agents/teamwork/`, or `PROJECT.md` to `huseynovlar-terminal/.gitignore`! Ensure `huseynovlar-terminal/.gitignore` allows `PROJECT.md` and `.agents/teamwork/` to be tracked on GitHub!)

**STRICT PROHIBITIONS & BASE COMMIT SHAs**:
- NEVER touch `backend/app/**`, `backend/tests/**`, `worker/**`, `frontend/**`, `e2e/**`, `docs/**`, `PROJECT.md`, or `huseynovlar-terminal/.agents/teamwork/**` (owned by concurrent milestones and the Project Orchestrator's checkpoint worker).
- NEVER run `git commit` or `git push` in either repository.
- NEVER place temporary scratch/probe files inside either git repository.
- **Pre-overhaul base commit SHAs for Verifiers**:
  - `huseynovlar-terminal`: `git diff eae5685 -- deploy config mql5 backend/Dockerfile .env.example .github .gitignore`
  - `server_telegram_bot`: `git diff 19a9ed7`

---

## Detailed Acceptance Criteria

### 1. `server_telegram_bot` Webhook Auth Skip, Deploy Parity & Tests
- In `/home/antigravity/Huseynovlar/server_telegram_bot/app/common/web.py`, add `"/internal/webhooks/trading"` to `DEFAULT_AUTH_SKIP_PATHS` so `internal_auth_middleware` no longer rejects `POST /internal/webhooks/trading` with `401 Invalid internal token` before `app/core/main.py` validates `TRADING_WEBHOOK_SECRET` (`X-Trading-Webhook-Secret` / `X-Webhook-Secret` / `Authorization: Bearer`).
- Ensure `.agents/` is listed in `/home/antigravity/Huseynovlar/server_telegram_bot/.gitignore`.
- Safely ensure `TRADING_WEBHOOK_SECRET` parity across `server_telegram_bot/deploy/docker-compose.yml`, `.env.example` (if present), `scripts/server/deploy.sh`, and `.github/workflows/deploy-production.yml` without breaking existing VPS deployment.
- Add comprehensive unit/integration tests in `/home/antigravity/Huseynovlar/server_telegram_bot/tests/` exercising `POST /internal/webhooks/trading` through the full aiohttp middleware stack (`create_web_app` / `internal_auth_middleware` + trading webhook handler):
  - Valid secret via `X-Trading-Webhook-Secret`, `X-Webhook-Secret`, and `Authorization: Bearer` **WITHOUT** any internal auth token header -> `200 OK` + `[TRADING]` alert formatting & severity/symbol/account_login/metadata handling.
  - Missing or wrong secret -> `401`/`403` (and test unconfigured `TRADING_WEBHOOK_SECRET` behavior -> `503` or configured fail-closed response).
  - Malformed JSON / missing fields edge cases -> proper `400` / handled response.
  - Confirm non-skip internal routes still strictly enforce internal auth token (`401 Invalid internal token`).
- Quality gates in `/home/antigravity/Huseynovlar/server_telegram_bot`:
  - `ruff check .` -> 0 errors
  - `ruff format --check .` -> 0 formatting diffs
  - `pytest -q -W error::ResourceWarning` -> 100% pass with zero `ResourceWarning`s.

### 2. `huseynovlar-terminal` Docker, Deploy, Backup, `.env.example`, `.gitignore` & CI
- `backend/Dockerfile`:
  - Set `ENV CONFIG_DIR=/app/config`.
  - Ensure `mql5/` is copied to `/app/mql5` (`COPY mql5 /app/mql5` and `.dockerignore` if any allows `mql5/` and `config/`) so `/api/v1/ops/downloads/ExnessPanelBridge.mq5` and `ExnessPanelHook.mqh` work inside the production container!
- `deploy/docker-compose.yml`:
  - **MUST pass `docker compose -f deploy/docker-compose.yml config --quiet` on an unmodified VPS without uncreated external networks or uncreated `/etc` files!** (Verify how `exness_mt5_ingest` and existing networks are declared today and preserve deploy safety on `git push`).
  - `backend`:
    - Networks: include `panel_egress` and `dns: [1.1.1.1, 9.9.9.9]`; attach alias `ingest.terminal.local` on `exness_mt5_ingest` (`exness_mt5_ingest: { aliases: [ingest.terminal.local] }`).
    - Environment: include `CONFIG_DIR: /app/config`, `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env`, `GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY:-}`, `GOOGLE_AI_DEFAULT_MODEL: ${GOOGLE_AI_DEFAULT_MODEL:-gemini-3.8-flash}`, `ALERTS_BOT_WEBHOOK_URL: ${ALERTS_BOT_WEBHOOK_URL:-}`, `ALERTS_BOT_WEBHOOK_SECRET: ${ALERTS_BOT_WEBHOOK_SECRET:-}`.
    - Command: include `--forwarded-allow-ips=*` on `uvicorn`.
  - `worker`:
    - Environment: include `CONFIG_DIR: /app/config` and `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env` (alongside its existing `panel_egress`, `dns: [1.1.1.1, 9.9.9.9]`, and AI/Webhook env vars).
  - `docker-proxy`:
    - Ensure `CONTAINERS: 1`, `POST: 1`, `INFO: 1`, `NETWORKS: 1` for container inspect, logs, stats, and lifecycle control.
- `deploy/scripts/setup-vps-integrations.sh`:
  - Executable (`chmod +x`), `bash -n` clean, idempotent setup script supporting env-var path overrides (`ETC_DIR`, `TERMINAL_DIR`, `BOT_DIR`, `BACKUP_BIN`, `SYSTEMD_DIR`, `SKIP_DOCKER=1` / `DRY_RUN=1` or mocked commands) so it can be locally tested safely in an isolated temp directory!
  - Creates `/etc/huseynovlar-terminal/integrations.env` (`chmod 640`), preserving existing non-placeholder values on re-run.
  - Reads or generates `TRADING_WEBHOOK_SECRET` and syncs it cleanly between `/opt/huseynovlar-bot/.env` and `/etc/huseynovlar-terminal/integrations.env`.
  - Writes `/opt/huseynovlar-terminal/docker-compose.override.yml` mounting `/etc/huseynovlar-terminal:/etc/huseynovlar-terminal:ro` into `backend` and `worker` and bridging `huseynovlar-core` + `terminal-backend` + `terminal-worker` via internal Docker network `huseynovlar_webhooks` (`http://huseynovlar-core:8080/internal/webhooks/trading`).
  - Connects `mt5-xau` and `mt5-ustec` (if present) to `exness_mt5_ingest` idempotently.
  - Ensures `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec` in `/opt/huseynovlar-terminal/.env`.
  - Installs `/usr/local/bin/huseynovlar-terminal-backup` (`backup-db.sh`) and daily systemd `.service` + `.timer` units for automated backups (and updates `/usr/local/bin/huseynovlar-terminal-deploy` if `deploy/scripts/deploy.sh` is present).
- `deploy/scripts/backup-db.sh`:
  - Executable (`chmod +x`), `bash -n` clean, locally testable via env overrides (`BACKUP_DIR`, `PG_DUMP_CMD` / `DOCKER_CMD`, `RETENTION_DAYS`, etc.): runs PostgreSQL `pg_dump` into compressed `.sql.gz` via atomic temp file write, verifies `gzip -t` + non-empty integrity before moving into place, and prunes backups older than retention policy in `/var/backups/huseynovlar-terminal`.
- `deploy/scripts/deploy.sh`:
  - Verify `deploy.sh` properly syncs `mql5/` if bundled, preserves `docker-compose.override.yml` if present on VPS (use `-f docker-compose.yml` + `-f docker-compose.override.yml` conditionally if override file exists!), and remains `bash -n` clean.
- `.env.example`, `.gitignore` & `.github/workflows/{ci.yml,deploy-production.yml}`:
  - `.env.example`: remove confusing `telegram_bot_token` / `telegram_chat_id` references; clearly document `/etc/huseynovlar-terminal/integrations.env` and `http://ingest.terminal.local:8000` (plus `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec`).
  - `.gitignore`: ensure `/home/antigravity/Huseynovlar/huseynovlar-terminal/.gitignore` does **NOT** ignore `PROJECT.md`, `.agents/`, or `.agents/teamwork/` so teamwork state can be mirrored & tracked in GitHub! (In `server_telegram_bot/.gitignore`, `.agents/` may remain ignored so stray files never enter the bot repo).
  - `.github/workflows/ci.yml` & `.github/workflows/deploy-production.yml`: include `../worker` in `ruff check` (`ruff check app tests ../worker`) and bundle `mql5/` in `deploy-production.yml` if needed.

### 3. Configuration Catalogs (`config/*.yaml`)
- Preserve 100% backward & forward compatibility with existing `backend/app/modules/*` consumers AND `PROJECT.md` `M2`/`M3` contracts while enriching:
  - `config/news_sources.yaml`:
    - 12+ verified institutional RSS feeds (`tier_1` / `tier_2` with `id`, `name`, `url`, `category`, `trust_tier`, both `verified: true` and `is_verified: true`, `is_enabled: true`, `asset_tags`, `poll_interval_sec`).
    - `economic_calendar` section with ForexFactory JSON (`https://nfs.faireconomy.media/ff_calendar_thisweek.json`, `https://nfs.faireconomy.media/ff_calendar_nextweek.json`) & fallback macro RSS URLs.
  - `config/treemap.yaml`:
    - Complete real ticker/sector universes for `sp500_top` (40+ major S&P 500 names across all 11 GICS sectors using valid Yahoo Finance symbols such as `BRK-B`, never `BRK.B`), `nasdaq100`, `global_leaders`, `gold_commodities`, `crypto_majors`, `forex_majors`.
    - Preserve exact YAML structure expected by current `intelligence/router.py` AND `M3` `treemap` collector (verify exact keys during exploration!).
  - `config/assets.default.yaml`:
    - Default multi-asset hubs (`XAUUSD` incl. `XAUUSDc`/`XAUUSDm`, `USTEC` incl. `USTECc`/`USTECm`, `SP500`, `EURUSD`, `BTCUSD`, `USOIL`) with `code`, `name`, `group`, `category`, `status`, `color`, `icon`, `logo_url`, `broker_symbols`, `news_tags`, `macro_drivers`, `notes`.
  - `config/alerts.default.yaml`:
    - Comprehensive trading & infrastructure alert rules and thresholds (drawdown, margin level, large loss/profit, EA heartbeat stale, bridge disconnect, high-impact macro event, container down).
  - `config/providers.yaml`:
    - New centralized catalog of external market/quote/search (Yahoo Finance chart/search/quote), economic calendar (ForexFactory JSON + RSS fallback), GeoIP (`ipwho.is` + fallback), and asset logo endpoints (FMP, Parqet, CoinCap/crypto) + rate-limit, timeout, and cache TTL metadata.

### 4. MQL5 Dual-EA Bridge (`mql5/ExnessPanelBridge.mq5` & `mql5/ExnessPanelHook.mqh`)
- Default `ApiBaseUrl` in `mql5/ExnessPanelBridge.mq5` updated to `"http://ingest.terminal.local:8000/api/v1/ingest"`.
- Actionable `err=4014` (`ERR_FUNCTION_NOT_ALLOWED`) diagnostic in `mql5/ExnessPanelBridge.mq5`:
  - When `WebRequest()` returns `-1` and `GetLastError() == 4014`, dynamically extract the exact base origin (`scheme://host[:port]`, e.g., `http://ingest.terminal.local:8000` or `https://terminal.huseynovlar.org`) from `ApiBaseUrl` and `Print(...)` a crystal-clear **Russian + English** error message instructing the user to add that exact origin in `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL` (`Сервис -> Настройки -> Советники -> Разрешить WebRequest для следующих URL`).
- Lock-safe IPC between `mql5/ExnessPanelHook.mqh` and `mql5/ExnessPanelBridge.mq5`:
  - Verify `ExnessPanelHook.mqh` writes valid, properly escaped JSONL lines to `ep_ipc\events_<login>.jsonl` using `FILE_SHARE_READ | FILE_SHARE_WRITE`.
  - Implement lock-safe (`FILE_SHARE_READ | FILE_SHARE_WRITE`) reader & truncator in `ExnessPanelBridge.mq5` for `ep_ipc\events_<login>.jsonl`, deduplicating latest state per `magic_number` and handling empty/missing/concurrently-written files gracefully without blocking trading EAs.
- Automatic sibling-chart EA discovery & `NasdaqPulse` telemetry scraping in `mql5/ExnessPanelBridge.mq5`:
  - Iterate all open MT5 charts via `ChartFirst()` / `ChartNext(cid)`, inspect `ChartGetString(cid, CHART_EXPERT_NAME)`, `ChartSymbol(cid)`, `ChartPeriod(cid)`, skipping the Bridge's own chart (`cid == ChartID()`) and Bridge EA name.
  - Scrape on-chart GUI objects (`OBJ_LABEL`, `OBJ_BUTTON`, `OBJ_EDIT` via `ObjectsTotal(cid, 0, -1)` / `ObjectName` / `ObjectGetInteger(cid, name, OBJPROP_TYPE)` / `ObjectGetString(cid, name, OBJPROP_TEXT)`) for `NasdaqPulse`-style telemetry (`STATE:`, `Trend:`, `RSI:`, `ER:`, `Risk:`, `Seq:`, `Day:`, `DD:`, `Bal:`, `Work:`, `Bank:`, `ALGO:`, `MKT:`).
  - Merge sibling-chart discovered EAs + `ep_ipc` hook states into `robot_states` array inside `POST /snapshot`, strictly matching the JSON schema expected by `backend/app/modules/ingest/router.py`!
