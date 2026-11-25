# E2E Harness & Backend/Bot Entrypoint Blueprint (`handoff.md`)

## 1. Observation
- **`backend/.venv` (`Python 3.12.16`)**: Installed: `httpx 0.28.1`, `websockets 17.4`, `cbor2 5.9.0`, `cryptography 46.0.7`, `pyotp 2.12.1`, `redis 5.3.1`, `uvicorn 0.54.0`, `webauthn 2.8.0`, `pytest 8.4.2`, `pytest-asyncio 0.26.0`, `fastapi 0.165.0`, `starlette 1.10.0`, `aiosqlite 0.22.1`, `pyyaml 6.0.4`. **Missing**: `aiohttp`, `openpyxl`, `wsproto`, and host `redis-server` binary.
- **`backend/app/core/config.py` & `app/main.py`**: Env aliases: `ENVIRONMENT` (**MUST NOT be `"test"`**, because `main.py:27` skips `_lifespan` DB `create_all`/`schema_sync` when `environment == "test"`!), `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY` (not `SECRET_KEY` — set both for safety), `VAULT_MASTER_KEY`, `COOKIE_SECURE`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `TERMINAL_DOMAIN`, `TERMINAL_ORIGIN` (not `WEBAUTHN_ORIGIN` — set both), `CONFIG_DIR`, `INTEGRATIONS_ENV_FILE` (`M2`), `MANAGED_CONTAINER_LABEL`, `ALLOWED_MT5_CONTAINERS`, `DOCKER_HOST`, `IP_GEO_API_URL`.
- **`server_telegram_bot` (`app/core/main.py:1122-1298`, `app/common/web.py:18-91`)**: No `.venv` yet in repo and system python lacks `aiohttp` (unless `M1` creates `server_telegram_bot/.venv`). `create_app(db_path=..., helper_url=...)` runs SQLite migrations (`connect(db_path)` + `run_migrations(conn)`), mounts `error_middleware` + `internal_auth_middleware()`, and registers `POST /internal/webhooks/trading` (checks `TRADING_WEBHOOK_SECRET` via `X-Trading-Webhook-Secret` / `X-Webhook-Secret`, writes `[TRADING] {title}` to SQLite `alerts`/`alert_deliveries`).

## 2. Logic Chain
- Missing `redis-server` binary → `conftest.py` MUST run an `asyncio.start_server` RESP2 TCP server supporting `PING`, `HELLO`/`CLIENT`/`SELECT`, `GET`/`SET`/`SETEX`/`PSETEX`/`DEL`/`EXPIRE`/`TTL`/`EXISTS`/`KEYS`, and `SUBSCRIBE`/`UNSUBSCRIBE`/`PUBLISH` (`terminal:live`).
- Missing `openpyxl` in `.venv` → validate `.xlsx` exports via stdlib `zipfile` + `xml.etree.ElementTree` (`xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`).
- `server_telegram_bot` subprocess → prefer `server_telegram_bot/.venv/bin/python` if `M1` created it (`aiohttp.web.run_app(create_app(db_path))`); fallback to `backend/.venv/bin/python` with a tiny `<tmpdir>/shim/aiohttp/web.py` Starlette/Uvicorn adapter in `PYTHONPATH` so the **real unmodified** `app/core/main.py:create_app` + `app/common/web.py` + SQLite `alerts` table execute identically on `127.0.0.1:<bot_port>`.

## 3. Caveats
- **SSRF Guard (`F21`)**: Custom news source testing may block `127.0.0.1`/loopback unless `ALLOW_LOCAL_FEEDS`/`ENVIRONMENT=development` or seeded `config/news_sources.yaml` feeds are used; test SSRF rejection explicitly in Tier 2 (`169.254.169.254`, `127.0.0.1`).
- **CORS & WebAuthn Origin**: Set `WEBAUTHN_RP_ID=localhost`, `TERMINAL_DOMAIN=localhost`, `TERMINAL_ORIGIN=http://localhost:<api_port>`, `COOKIE_SECURE=false` so virtual authenticator `origin="http://localhost:<api_port>"` and HTTP cookies pass verification.

## 4. Blueprint for `e2e/conftest.py`
1. **Packages to Use**: HTTP=`httpx`, WS=`websockets`, WebAuthn=`cbor2`+`cryptography` (EC P-256 + CBOR `attestationObject`), TOTP=`pyotp`, `.xlsx`=`zipfile`+`xml.etree.ElementTree`, Mock Upstream=`uvicorn`+`starlette` (in subprocess/thread on `127.0.0.1:<mock_port>`), Redis=stdlib `asyncio` RESP2 TCP server (`127.0.0.1:<redis_port>`).
2. **Backend Subprocess (`cwd=.../backend`)**:
   - Command: `.../backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port <api_port> --forwarded-allow-ips=*`
   - Env: `PYTHONDONTWRITEBYTECODE=1`, `ENVIRONMENT=development`, `DATABASE_URL=sqlite+aiosqlite:///<tmp>/terminal.db`, `REDIS_URL=redis://127.0.0.1:<redis_port>/0`, `JWT_SECRET_KEY=<32b>`, `SECRET_KEY=<32b>`, `VAULT_MASTER_KEY=<fernet_or_secret>`, `COOKIE_SECURE=false`, `WEBAUTHN_RP_ID=localhost`, `WEBAUTHN_ORIGIN=http://localhost:<api_port>`, `TERMINAL_DOMAIN=localhost`, `TERMINAL_ORIGIN=http://localhost:<api_port>`, `CONFIG_DIR=<tmp>/config`, `INTEGRATIONS_ENV_FILE=<tmp>/integrations.env`, `DOCKER_HOST=http://127.0.0.1:<mock_port>`, `DOCKER_PROXY_URL=http://127.0.0.1:<mock_port>`, `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec`, `IP_GEO_API_URL=http://127.0.0.1:<mock_port>/geo/{ip}`.
   - `<tmp>/integrations.env`: `GEMINI_API_KEY=test-gemini-key`, `GEMINI_DEFAULT_MODEL=gemini-2.5-flash`, `TELEGRAM_WEBHOOK_URL=http://127.0.0.1:<bot_port>/internal/webhooks/trading`, `TELEGRAM_WEBHOOK_SECRET=<bot_secret>`, `IP_GEO_API_URL=http://127.0.0.1:<mock_port>/geo/{ip}`.
3. **Real `server_telegram_bot` Subprocess (`cwd=/home/antigravity/Huseynovlar/server_telegram_bot`)**:
   - Env: `PYTHONDONTWRITEBYTECODE=1`, `TRADING_WEBHOOK_SECRET=<bot_secret>`, `INTERNAL_API_TOKEN=<internal_tok>`, `DB_PATH=<tmp>/bot.db`.
   - Launch `create_app('<tmp>/bot.db', helper_url='http://127.0.0.1:<mock_port>')` on `127.0.0.1:<bot_port>` (via `.venv/bin/python` if `aiohttp` present, else `backend/.venv/bin/python` + `<tmp>/aiohttp_shim` on `PYTHONPATH`); read delivered `[TRADING]` rows directly via `sqlite3.connect('<tmp>/bot.db')` (`SELECT title, body, severity, category FROM alerts`).
4. **Upstream Endpoints Mocked on `http://127.0.0.1:<mock_port>`** (wired via `<tmp>/config/{news_sources,providers,treemap,assets.default,alerts.default}.yaml` + env vars `YAHOO_FINANCE_BASE_URL`, `GEMINI_API_BASE_URL`, `GOOGLE_AI_BASE_URL`, `LOGO_CDN_URL`):
   - **RSS/Atom**: `GET /rss/<feed>.xml` (rewritten in `<tmp>/config/news_sources.yaml`).
   - **Calendar**: `GET /calendar/ff_calendar_thisweek.json` & `/ff_calendar_nextweek.json` (rewritten `calendar.primary_url`/`fallback_url`).
   - **Yahoo Finance**: `GET /yahoo/v8/finance/chart/{symbol}`, `GET /yahoo/v7/finance/quote`, `GET /yahoo/v1/finance/search` (+ root `/v8/...`, `/v7/...`, `/v1/...`).
   - **GeoIP**: `GET /geo/{ip}` -> `{success: true, ip, country: "Azerbaijan", country_code: "AZ", city: "Baku", latitude: 40.4093, longitude: 49.8671, connection: {isp: "NetBird"}}`.
   - **Docker Engine API**: `GET /containers/json` (`mt5-xau`, `mt5-ustec` with label `exness-panel.managed=true`), `GET /containers/{id}/json`, `GET /containers/{id}/stats?stream=false`, `GET /containers/{id}/logs`, `POST /containers/{id}/{start|stop|restart}` (`204`).
   - **Gemini API**: `POST /gemini/v1beta/models/{model}:generateContent` & `POST /v1beta/models/{model}:generateContent` (captures request payload & returns `{candidates:[{content:{parts:[{text:"..."}]}}]}`).
   - **Logos**: `GET /logos/{symbol}` -> `200 image/svg+xml`.
