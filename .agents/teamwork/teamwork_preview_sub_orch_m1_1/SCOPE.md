# Scope — Milestone 1 (`M1`): Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot`

- **Status**: `IN_PROGRESS`
- **Owner**: `teamwork_preview_sub_orch_m1_1`

## Exclusive Write-Owned Paths (STRICT)
Workers under `M1` MAY ONLY create/edit files inside:
1. `/home/antigravity/Huseynovlar/server_telegram_bot/**`
2. `/home/antigravity/Huseynovlar/huseynovlar-terminal/deploy/**`
3. `/home/antigravity/Huseynovlar/huseynovlar-terminal/config/**`
4. `/home/antigravity/Huseynovlar/huseynovlar-terminal/mql5/**`
5. `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/Dockerfile`
6. `/home/antigravity/Huseynovlar/huseynovlar-terminal/.env.example`
7. `/home/antigravity/Huseynovlar/huseynovlar-terminal/.github/workflows/**`

**STRICT PROHIBITIONS**:
- NEVER touch `backend/app/**`, `backend/tests/**`, `worker/**`, `frontend/**`, `e2e/**`, `docs/**`, or `PROJECT.md` (owned by concurrent milestones `M2`, `M3`, `M4`, `M5`, `E2E`).
- NEVER run `git commit` or `git push` in either repository.
- NEVER place `.agents/` or temporary scratch files inside either git repository.

## Detailed Acceptance Criteria

### 1. `server_telegram_bot` Webhook Fix, Tests & Deploy Parity
- In `/home/antigravity/Huseynovlar/server_telegram_bot/app/common/web.py`, add `"/internal/webhooks/trading"` to `DEFAULT_AUTH_SKIP_PATHS` so `internal_auth_middleware` no longer rejects `POST /internal/webhooks/trading` with `401 Invalid internal token` before `app/core/main.py` validates `TRADING_WEBHOOK_SECRET` (`X-Trading-Webhook-Secret` / `X-Webhook-Secret` / `Authorization: Bearer`).
- Add comprehensive unit/integration tests in `/home/antigravity/Huseynovlar/server_telegram_bot/tests/` exercising `POST /internal/webhooks/trading` through the full aiohttp middleware stack (`create_web_app` / `internal_auth_middleware` + trading webhook handler):
  - Valid secret via `X-Trading-Webhook-Secret`, `X-Webhook-Secret`, and `Bearer` WITHOUT internal auth header -> `200 OK` + `[TRADING]` alert formatting & severity/metadata handling.
  - Wrong or missing secret -> `401`/`403` (or `503`/configured unconfigured-secret behavior).
  - Invalid JSON / missing fields edge cases, and verifying non-skip internal routes still require internal token (`401`).
- Safely ensure `TRADING_WEBHOOK_SECRET` parity across `server_telegram_bot/deploy/docker-compose.yml`, `.env.example` (if present), `scripts/server/deploy.sh`, and `.github/workflows/deploy-production.yml` without breaking existing VPS deployment.
- Quality gates in `/home/antigravity/Huseynovlar/server_telegram_bot`:
  - `ruff check .` -> 0 errors
  - `ruff format --check .` -> 0 formatting diffs
  - `pytest -q -W error::ResourceWarning` -> 100% pass with zero `ResourceWarning`s.

### 2. `huseynovlar-terminal` Docker, Deploy, Backup, `.env.example` & CI
- `backend/Dockerfile`: set `ENV CONFIG_DIR=/app/config`.
- `deploy/docker-compose.yml`:
  - **MUST pass `docker compose -f deploy/docker-compose.yml config --quiet` on an unmodified VPS without pre-created external networks (other than existing `exness_mt5_ingest` or compose-managed networks — verify how `exness_mt5_ingest` is declared today!) or pre-created `/etc` files!**
  - `backend`:
    - Networks: add `panel_egress` and `dns: [1.1.1.1, 9.9.9.9]`; attach alias `ingest.terminal.local` on `exness_mt5_ingest` (`exness_mt5_ingest: { aliases: [ingest.terminal.local] }`).
    - Environment: add `CONFIG_DIR: /app/config`, `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env`, `GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY:-}`, `GOOGLE_AI_DEFAULT_MODEL: ${GOOGLE_AI_DEFAULT_MODEL:-gemini-2.5-flash}`, `ALERTS_BOT_WEBHOOK_URL: ${ALERTS_BOT_WEBHOOK_URL:-}`, `ALERTS_BOT_WEBHOOK_SECRET: ${ALERTS_BOT_WEBHOOK_SECRET:-}`.
    - Command: add `--forwarded-allow-ips=*` to `uvicorn` command.
  - `worker`:
    - Environment: add `CONFIG_DIR: /app/config` and `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env`.
  - `docker-proxy`:
    - Ensure `CONTAINERS: 1`, `POST: 1`, `INFO: 1`, `NETWORKS: 1` for container inspect, logs, stats, and lifecycle control.
- `deploy/scripts/setup-vps-integrations.sh`:
  - Executable (`chmod +x`), `bash -n` clean, `shellcheck`-clean, idempotent root setup script that:
    - Creates `/etc/huseynovlar-terminal/integrations.env` (`chmod 640`), preserving existing non-placeholder values on re-run.
    - Reads or generates `TRADING_WEBHOOK_SECRET` and syncs it cleanly with `/opt/huseynovlar-bot/.env` and `/etc/huseynovlar-terminal/integrations.env`.
    - Creates `/opt/huseynovlar-terminal/docker-compose.override.yml` mounting `/etc/huseynovlar-terminal:/etc/huseynovlar-terminal:ro` into `backend` and `worker` and bridging `huseynovlar-core` + `terminal-backend` + `terminal-worker` via internal Docker network `huseynovlar_webhooks` (`http://huseynovlar-core:8080/internal/webhooks/trading`).
    - Connects `mt5-xau` and `mt5-ustec` (if present) to `exness_mt5_ingest` idempotently.
    - Ensures `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec` in `/opt/huseynovlar-terminal/.env`.
    - Installs `/usr/local/bin/huseynovlar-terminal-backup` (`backup-db.sh`) and a daily systemd `.service` + `.timer` for automated backups.
- `deploy/scripts/backup-db.sh`:
  - Executable (`chmod +x`), `bash -n` clean, tested PostgreSQL `pg_dump` (compressed `.sql.gz` with atomic temp file write & integrity verification) + retention/rotation into `/var/backups/huseynovlar-terminal` (supporting testable env overrides for local verification!).
- `.env.example` & `.github/workflows/ci.yml` + `.github/workflows/deploy-production.yml`:
  - Remove confusing `telegram_bot_token` / `telegram_chat_id` references; clearly document `/etc/huseynovlar-terminal/integrations.env` and `http://ingest.terminal.local:8000`.
  - Add `../worker` to `ruff check` in `.github/workflows/ci.yml` and `.github/workflows/deploy-production.yml`.

### 3. Configuration Catalogs (`config/*.yaml`)
- Preserve 100% compatibility with existing & M2/M3 `PROJECT.md` consumers while enriching:
  - `config/news_sources.yaml`: 12+ verified institutional RSS feeds (`tier_1` / `tier_2` with `id`, `name`, `url`, `category`, `trust_tier`, `verified`/`is_verified`, `asset_tags`, `poll_interval_sec`) + `economic_calendar` section with ForexFactory JSON (`ff_calendar_thisweek.json`, `ff_calendar_nextweek.json`) & fallback macro RSS URLs.
  - `config/treemap.yaml`: complete real ticker/sector universes for `sp500_top` (40+ major S&P 500 names across all 11 GICS sectors using valid Yahoo Finance symbols like `BRK-B`), `nasdaq100`, `global_leaders`, `gold_commodities`, `crypto_majors`, `forex_majors`.
  - `config/assets.default.yaml`: default multi-asset hubs (`XAUUSD` incl. `XAUUSDc`/`XAUUSDm`, `USTEC` incl. `USTECc`/`USTECm`, `SP500`, `EURUSD`, `BTCUSD`, `USOIL`) with `code`, `name`, `group`, `category`, `status`, `color`, `icon`, `logo_url`, `broker_symbols`, `news_tags`, `macro_drivers`, `notes`.
  - `config/alerts.default.yaml`: comprehensive trading & infrastructure alert rules and thresholds.
  - `config/providers.yaml`: new centralized catalog of external market/quote/search, economic calendar, GeoIP, and asset logo endpoints + rate-limit/cache metadata.

### 4. MQL5 Dual-EA Bridge (`mql5/ExnessPanelBridge.mq5` & `mql5/ExnessPanelHook.mqh`)
- Default `ApiBaseUrl` in `mql5/ExnessPanelBridge.mq5` changed from `http://terminal-backend:8000/api/v1/ingest` to `http://ingest.terminal.local:8000/api/v1/ingest`.
- When `WebRequest()` returns `-1` and `GetLastError() == 4014` (`ERR_FUNCTION_NOT_ALLOWED`), log an unmistakable Russian + English instruction naming the exact base origin (`http://ingest.terminal.local:8000` or `https://terminal.huseynovlar.org`, dynamically derived from `ApiBaseUrl`) to add in `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL` (`Сервис -> Настройки -> Советники -> Разрешить WebRequest для следующих URL`).
- Lock-safe (`FILE_SHARE_READ | FILE_SHARE_WRITE`) reading & truncation of `ep_ipc\events_<login>.jsonl` written by `ExnessPanelHook.mqh` (verifying exact path/escaping, line parsing, and schema compatibility between `.mqh` writer and `.mq5` reader!).
- Automatic sibling-chart EA discovery (`ChartFirst()` / `ChartNext()`, `ChartGetString(cid, CHART_EXPERT_NAME)`, `ChartSymbol(cid)`, `ChartPeriod(cid)`, skipping the Bridge's own chart/EA) + scraping chart label/text objects (`OBJ_LABEL`, `OBJ_BUTTON`, `OBJ_EDIT` / `OBJPROP_TEXT`) for telemetry strings (`STATE:`, `Trend:`, `RSI:`, `ER:`, `Risk:`, `Seq:`, `Day:`, `DD:`, `Bal:`, `Work:`, `Bank:`, `ALGO:`, `MKT:`) so running `ExnessPanelBridge.mq5` on Chart Tab #2 automatically detects `NasdaqPulse v3.01` on Chart Tab #1 and merges/sends complete `robot_states` in `POST /snapshot` matching `backend/app/modules/ingest/router.py`'s schema!
