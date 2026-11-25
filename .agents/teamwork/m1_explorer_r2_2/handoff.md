# M1 Explorer 2 Handoff (`m1_explorer_r2_2`)

## 1. Docker, Deploy, Scripts, `.env.example`, `.gitignore` & Workflows (Verified Exact Lines)
- **`backend/Dockerfile` (`24` lines; NO `.dockerignore` in repo or `backend/`)**:
  - Lines `3-5`: add `CONFIG_DIR=/app/config` to `ENV`.
  - Lines `14-18`: add `COPY mql5 /app/mql5` right after `COPY config /app/config`.
  - Line `23`: add `"--forwarded-allow-ips=*"` to `CMD ["uvicorn", ...]`.
- **`deploy/docker-compose.yml` (`180` lines)**:
  - `networks.exness_mt5_ingest` (`L175-176`): currently `external: true` (already passes `docker compose config --quiet` in CI!).
  - `backend` (`L45-81`):
    - `command` (`L49`): append `"--forwarded-allow-ips=*"`.
    - `environment` (`L50-63`): add `CONFIG_DIR: /app/config`, `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env`, `GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY:-}`, `GOOGLE_AI_DEFAULT_MODEL: ${GOOGLE_AI_DEFAULT_MODEL:-gemini-3.8-flash}`, `ALERTS_BOT_WEBHOOK_URL: ${ALERTS_BOT_WEBHOOK_URL:-}`, `ALERTS_BOT_WEBHOOK_SECRET: ${ALERTS_BOT_WEBHOOK_SECRET:-}`.
    - `networks` (`L65`): convert from list `[panel_internal, exness_mt5_ingest, panel_docker_proxy]` to map so `exness_mt5_ingest: { aliases: [ingest.terminal.local] }`, plus `panel_internal: {}`, `panel_egress: {}`, `panel_docker_proxy: {}`; add `dns: [1.1.1.1, 9.9.9.9]`.
  - `worker` (`L82-109`): add `CONFIG_DIR: /app/config` and `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env` to `environment` (`L88-98`); optionally drop legacy `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` or keep empty-defaulted.
  - `docker-proxy` (`L159-161`): currently only `CONTAINERS: 1` and `POST: 1`; add `INFO: 1` and `NETWORKS: 1`.
- **`deploy/scripts/`**:
  - `backup-db.sh` **ALREADY EXISTS** (`1,652` bytes, `-rwxr-xr-x`) — M1 Worker MUST `view_file` `deploy/scripts/backup-db.sh` before editing (`Overwrite: false` / `replace_file_content`) and ensure env-var overrides (`BACKUP_DIR`, `PG_DUMP_CMD`/`DOCKER_CMD`, `RETENTION_DAYS`) + atomic `.sql.gz` + `gzip -t` check.
  - `setup-vps-integrations.sh` does NOT exist yet — create with `chmod +x` and env overrides (`ETC_DIR`, `TERMINAL_DIR`, `BOT_DIR`, `BACKUP_BIN`, `SYSTEMD_DIR`, `SKIP_DOCKER`, `DRY_RUN`).
  - `deploy.sh` (`L19-38`): sync `$TMP/mql5` -> `$BASE/mql5` if bundled; in `dc()` (`L34-38`), append `-f "$BASE/docker-compose.override.yml"` conditionally when `[ -f "$BASE/docker-compose.override.yml" ]`.
- **`.env.example` (`43` lines)**:
  - `L30`: `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec`.
  - `L32-39`: remove `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`; document `/etc/huseynovlar-terminal/integrations.env`, `ALERTS_BOT_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading`, and MT5 WebRequest URL `http://ingest.terminal.local:8000`.
- **`.gitignore` (`41` lines)**:
  - Currently does NOT ignore `PROJECT.md` or `.agents/`. Note `L19` has `*.local` — keep `PROJECT.md` and `.agents/teamwork/` unignored!
- **`.github/workflows/ci.yml` (`L33`) & `deploy-production.yml` (`L41`, `L69-71`)**:
  - Change `ruff check app tests` -> `ruff check app tests ../worker` in both workflows.
  - In `deploy-production.yml` (`L70`), add `cp -r mql5 bundle/mql5` alongside `cp -r config bundle/config`.

## 2. Config Catalogs (`config/*.yaml`) Note for M1 Worker
- Existing files in `config/`: `alerts.default.yaml` (`1,228B`), `assets.default.yaml` (`1,757B`), `news_sources.yaml` (`4,832B`), `treemap.yaml` (`1,409B`); `providers.yaml` is new.
- M1 Worker should inspect those 4 existing YAML files + `backend/app/modules/{intelligence,assets}/router.py` directly before enriching so top-level keys remain 100% compatible with both existing routers and `SCOPE.md` Section 3 (`tier_1`/`tier_2`, both `verified: true` & `is_verified: true`, `economic_calendar`, `BRK-B` in `sp500_top`, `logo_url`/`category` on `assets.default.yaml`, and new `providers.yaml`).
