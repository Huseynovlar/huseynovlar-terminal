# E2E Test Infrastructure & Traceability Specification (`TEST_INFRA.md`)

- **Project**: Huseynovlar Institutional Multi-Asset Trading & Risk Terminal
- **Primary Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repository**: `/home/antigravity/Huseynovlar/server_telegram_bot`
- **Authoritative Spec**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` & `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Total Tracked Features (`N`)**: **`36` (`F01`–`F36`)**
- **Minimum Opaque-Box Test Floor**: **`>= 414` genuine requirement-driven tests** (`Tier 1 >= 180`, `Tier 2 >= 180`, `Tier 3 >= 36`, `Tier 4 >= 18`)

---

## 1. Progressive Opaque-Box Verification Channels

All tests inside `e2e/` operate strictly as an **opaque-box external observer/user** without importing internal application modules (`backend/app/**` or `frontend/src/**` runtime imports are forbidden). Every requirement is verified through public interfaces and build/config artifacts:

1. **HTTP / REST & Dual-Cookie / Bearer / `?dl_token=` / `X-Account-Api-Key` Channel**:
   - Exercises real `uvicorn app.main:app` on `http://127.0.0.1:<free_port>/api/v1/*` with `Authorization: Bearer <jwt>`, `HttpOnly` cookies (`ht_access_token` `Path="/"`, `ht_refresh_token` `Path="/"`), signed download query tokens (`?dl_token=<jwt>`), and MT5 ingestion header `X-Account-Api-Key: htk_...`.
   - Verifies status codes, JSON schemas, RFC-compliant headers (`Content-Disposition`, `Content-Type`, `Set-Cookie`), SQLite/PostgreSQL persistence across restarts/requests, RBAC boundaries (`ADMIN` / `OPERATOR` / `VIEWER`), and cryptographic WebAuthn (`CBOR` + `ECDSA P-256` virtual authenticator) & TOTP (`RFC 6238`) flows.
2. **Real-Time WebSocket Channel (`WS /api/v1/ws/live`)**:
   - Connects with `ht_access_token` cookie or `?token=<jwt>`, validates immediate `welcome` handshake frame (`server_time_msc`, `portfolio`), `ping` -> `pong` RTT frames, periodic `heartbeat` frames, and Redis Pub/Sub `terminal:live` event fan-out (`snapshot`, `trade_event`, `bar_update`, `robot_state`, `breaking_news`, `calendar_alert`, `container_event`, `macro_quotes`).
3. **Cross-Repo Webhook Channel (`server_telegram_bot`)**:
   - Launches the real `server_telegram_bot` webhook server (`POST /internal/webhooks/trading` authenticated by `X-Trading-Webhook-Secret`) on an ephemeral localhost port and verifies that `huseynovlar-terminal` alert tests (`POST /api/v1/ops/alerts/test` & worker rules) deliver `[TRADING]` payloads end-to-end without `401 Unauthorized` middleware blocks and without requiring `telegram_bot_token` or `telegram_chat_id`.
4. **Public Deployment, Config & MQL5 Artifact Channel**:
   - Validates `deploy/docker-compose.yml` (`docker compose config`, `panel_egress` + `dns: [1.1.1.1, 9.9.9.9]` on `backend` & `worker`, `CONFIG_DIR=/app/config`, `--forwarded-allow-ips=*`, `ingest.terminal.local` network alias on `exness_mt5_ingest`, `docker-proxy` `INFO: 1`), `deploy/scripts/setup-vps-integrations.sh` & `backup-db.sh`, `config/*.yaml` seed catalogs, and `mql5/ExnessPanelBridge.mq5` + `mql5/ExnessPanelHook.mqh` (`http://ingest.terminal.local:8000/api/v1/ingest` default, `4014` diagnostic guidance, `ChartFirst`/`ChartNext` sibling-chart EA discovery, and `ep_ipc` JSONL reader).
5. **Frontend Source, Route Tree, i18n, Dialog & Production Bundle Channel**:
   - Inspects public frontend route artifacts (`frontend/src/routes/**`), i18n dictionaries (`ru`, `en`, `az`), `preferences-config.ts` defaults (`theme_preset="tangerine"`, `sidebar_variant="floating"`, Bloomberg-only density), `api-client.ts` (single-flight `401 -> /auth/refresh -> retry` + instant `/auth/v2/login` redirect + Bearer+cookie logout + `apiDownload`), `webauthn.ts` (`Uint8Array` / `ArrayBuffer` converters), zero native `window.confirm` / `window.prompt` / `window.alert` (`F34`) with styled shadcn `AlertDialog` / `Dialog`, complete Studio Admin demo route purge (`F33`), and built `.output/` SSR/client bundle when present.

---

## 2. Deterministic Ephemeral Harness Architecture (`e2e/conftest.py`)

To run 100% deterministically in `< 60s` with zero flaky internet dependencies, zero port collisions, and zero repository pollution:

1. **Lazy Fixture Activation**:
   - `--collect-only` and `--help` load ZERO network servers and complete in `< 5s`.
   - Live `--tier 1..4` runs spin up session-scoped isolated services bound strictly to `127.0.0.1:<ephemeral_free_port>`:
     - **Mock Upstream HTTP Server (`aiohttp` on `127.0.0.1:<port>`)**: deterministically serves RSS/Atom XML feeds, ForexFactory calendar JSON (`ff_calendar_thisweek.json`), Yahoo Finance v8/v7 quote/chart/search JSON (real market-cap & price structures across `nasdaq100`, `sp500_top`, `global_leaders`, `gold_commodities`, `crypto_majors`, `forex_majors`), GeoIP JSON (`ipwho.is`), Docker Engine API HTTP endpoints (`mt5-xau`, `mt5-ustec` list/inspect/stats/logs/start/stop/restart), asset logo SVG/PNG upstream responses, and Google Gemini `generateContent` JSON while recording incoming requests for assertion.
     - **Ephemeral TCP RESP Redis Server (`127.0.0.1:<port>`)**: speaks Redis RESP2 wire protocol supporting `PING`, `AUTH`, `SELECT`, `SET`/`GET`/`DEL`/`EXPIRE`/`TTL`/`SETEX`/`INCR` (WebAuthn challenges & market cache) and `SUBSCRIBE`/`UNSUBSCRIBE`/`PUBLISH` (`terminal:live` Pub/Sub fan-out).
     - **Real `server_telegram_bot` Webhook Subprocess (`127.0.0.1:<port>`)**: runs the real `server_telegram_bot` trading webhook handler with `TRADING_WEBHOOK_SECRET` and exposes recorded `[TRADING]` alert deliveries for verification.
     - **Real `huseynovlar-terminal` FastAPI Subprocess (`127.0.0.1:<port>`)**: runs `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/uvicorn app.main:app` with `PYTHONDONTWRITEBYTECODE=1`, isolated temp SQLite database (`sqlite+aiosqlite:///.../e2e.db`), isolated temp `INTEGRATIONS_ENV_FILE` (`integrations.env` simulating `/etc/huseynovlar-terminal/integrations.env`), and temp `CONFIG_DIR` copy rewriting external feed/provider URLs to the ephemeral local mock upstream server.
2. **Clean Teardown Guarantees**:
   - Every subprocess is launched in its own process group (`start_new_session=True`) and terminated (`SIGTERM` -> bounded wait -> `SIGKILL`) in `finally` / `atexit` hooks.
   - `e2e/run_e2e.sh` creates an isolated `mktemp -d` workspace (`chmod 700`) for `TMPDIR` and `--basetemp`, guaranteed to be removed via `trap cleanup EXIT INT TERM`.

---

## 3. Suite File Layout (`<= 10` Clean Files in `e2e/`)

```text
e2e/
├── pytest.ini                      # Pytest config & tier1..tier4 + harness_selftest markers
├── run_e2e.sh                      # Executable deterministic runner (--tier 1..4, --collect-only, --harness-check, --help)
├── conftest.py                     # Ephemeral mock upstreams, RESP Redis, Telegram bot subprocess, FastAPI subprocess & opaque clients
├── test_harness_selftest.py        # Harness lifecycle, teardown & manifest count self-tests (--harness-check)
├── tier1/
│   ├── test_tier1_f01_f18.py       # Tier 1 Happy-Path tests for F01–F18 (>= 5 per feature, >= 90 tests)
│   └── test_tier1_f19_f36.py       # Tier 1 Happy-Path tests for F19–F36 (>= 5 per feature, >= 90 tests)
├── tier2/
│   ├── test_tier2_f01_f18.py       # Tier 2 Boundary, Corner & Negative tests for F01–F18 (>= 5 per feature, >= 90 tests)
│   └── test_tier2_f19_f36.py       # Tier 2 Boundary, Corner & Negative tests for F19–F36 (>= 5 per feature, >= 90 tests)
├── tier3/
│   └── test_tier3_pairwise.py      # Tier 3 Cross-Feature Pairwise Integration tests (>= 36 tests)
└── tier4/
    └── test_tier4_journeys.py      # Tier 4 Multi-Step Trader & Admin End-to-End Workflows (>= 18 tests)
```

---

## 4. Runner Commands & Usage

```bash
# Show runner options
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --help

# Fast syntax, import & manifest collection check (< 5s, >= 414 tests)
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --collect-only

# Verify ephemeral harness servers, Redis Pub/Sub, Telegram webhook & zero-orphan teardown
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --harness-check

# Run individual tiers
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --tier 1
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --tier 2
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --tier 3
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh --tier 4

# Run full 4-tier progression sequentially (Tier 1 -> Tier 2 -> Tier 3 -> Tier 4)
/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh
```

---

## 5. Complete 36-Feature Traceability Matrix (`F01`–`F36`)

| Feature ID | Feature Name | Verification Channels | Tier 1 (`>=5` Happy) | Tier 2 (`>=5` Neg/Edge) | Tier 3 Pairwise | Tier 4 E2E Journey |
|---|---|---|---|---|---|---|
| `F01` | WebAuthn Passkey Registration & Login (`Uint8Array` + Redis challenges + `sign_count`) | HTTP + Virtual FIDO2 + Frontend Source | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F02` | Full `RU / EN / AZ` Interface Localization & Server Sync | HTTP `/profile/preferences` + Frontend i18n | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F03` | Bloomberg-Only Compact Density (`comfortable` removed) | HTTP Preferences + Frontend Source | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F04` | Real Economic & PnL Calendar + Event Detail View | HTTP `/intelligence/calendar*` + Mock FF + Routes | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F05` | Real Live Market Treemap (`0` fake `hash()`/`PREVIEW_TREEMAP`) & Working Filters | HTTP `/intelligence/treemap*` + Mock Yahoo + Routes | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F06` | Left-to-Right Shimmer `<Skeleton>` & `<AsyncButton>` Loaders | Frontend UI Components & Route Wiring | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F07` | Right-Side Rich Toast Notifications | Frontend `<Toaster>` & Mutation Toast Wiring | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F08` | Dotted MT5 WebRequest URL (`ingest.terminal.local`) & Error `4014` Fix | Compose + `ExnessPanelBridge.mq5` + `.set` HTTP | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F09` | Seamless Auth Cookies (`ht_access_token`), `?dl_token=`, Downloads & Incognito | HTTP Cookies/Query + `.set`/`.xlsx`/`.csv`/`.mq5` | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F10` | Default `tangerine` Theme + `floating` Sidebar + `/dashboard/preferences` | HTTP Preferences + Frontend `preferences-config.ts` | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F11` | Redesigned Header (`1s` Clock by Profile, No Currency/TZ Toggle, Clean Sidebar, Lock Screen) | Frontend Header/Sidebar/Lock Screen Artifacts | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F12` | Real MT5 Docker Containers (`mt5-xau`, `mt5-ustec`) Ops & CRUD+View | HTTP `/ops/containers*` + `/ops/kill-switch/*` + Mock Docker | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F13` | Acoustic Sound Preview Chime & Cross-UI Behavioral Parity | Frontend Store/Sound Engine & Preferences Page | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F14` | Trading Accounts & Exness Profiles Full CRUD+View & `htk_...` Key Clarity | HTTP `/profiles*`, `/accounts*`, `.set` Decryption | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F15` | Redis Pub/Sub WebSocket Live Hub (`WS /api/v1/ws/live`) & Real-Time UI | Live WebSocket Client + Redis Pub/Sub + Header Pill | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F16` | Dedicated Multi-Page Architecture (`22` Modules, Full CRUD+View) | Frontend Route Hierarchy + Hotkeys/Sidebar Sync | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F17` | Users Management RBAC (`ADMIN`/`OPERATOR`/`VIEWER`) CRUD + Detail View | HTTP `/users*` + Last-Admin/Self-Delete Guards | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F18` | `/etc` Secrets Loader (`integrations.env`) & `server_telegram_bot` Webhook Fix | HTTP `/ops/integrations/*`, `/ops/alerts/test` + Live Bot Subprocess | `test_tier1_f01_f18.py` | `test_tier2_f01_f18.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F19` | Dynamic Asset/Search-Driven World News Wire & Story Detail View | HTTP `/intelligence/news*` + Mock RSS + Routes | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F20` | Dedicated Google AI (Gemini) Co-Pilot Page & Briefing History CRUD | HTTP `/intelligence/ai/*` + Mock Gemini + Routes | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F21` | Database-Backed Verified Sources Registry CRUD + Feed Test & SSRF Guard | HTTP `/intelligence/sources*` + SSRF Negative Probes | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F22` | Asset Hubs CRUD + Detail View (with News Digest) & Asset Explorer (Auto/Manual News) | HTTP `/assets*`, `/charts/explore`, `/intelligence/news/explore` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F23` | Unified Trading Journal (Deals/Positions/Notes) & Treasury CRUD + `.xlsx`/`.csv` | HTTP `/journal/*`, `/treasury/*`, `/analytics/statement.*` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F24` | Standalone Trading Robots CRUD+View, `1s` Clock & `.mq5`/`.mqh`/`.set` Downloads | HTTP `/robots*`, `/accounts/robots*`, `/ops/downloads/*` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F25` | Dual-EA MT5 Workflow & `ExnessPanelHook.mqh` IPC Bridge + Auto-Discovery | MQL5 Artifacts + HTTP `/ingest/snapshot` `robot_states` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F26` | Universal Server-Side Persistence (`chart_states` Drawings/Indicators & Preferences) | HTTP `GET/PUT /charts/state/{symbol}` + Preferences | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F27` | Flagship Institutional Home Command Center (`/dashboard/home`) | HTTP `/analytics/home-summary` + `/charts/macro` + Routes | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F28` | Universal Same-Origin Asset, Index, Equity, FX & Crypto Logos (`/assets/logo/{symbol}`) | HTTP `/assets/logo/*` (`image/svg+xml`/`image/png`) + `<AssetLogo>` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F29` | Deep Analytics & Risk Lab (8 Parameterized Charts + `USC / 100` Divisor Fix) | HTTP `/analytics/overview` with `USC` Cent Deals & Filters | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F30` | Institutional Asset-Agnostic Login Screen Right Panel (`RU/EN/AZ`) | Frontend `/auth/v2/*` Copy & Localization Checks | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F31` | Dedicated Security Page (Password Change, 2FA SVG QR + Backup Codes, Passkeys) | HTTP `/auth/change-password`, `/auth/2fa/*` + Routes | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F32` | Dedicated Active Sessions, Login History & Audit Views + Real NetBird IP Geo | HTTP `/auth/sessions*`, `/auth/login-history*`, `/audit*`, `X-Forwarded-For` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F33` | Studio Admin Demo Purge (`26` Routes Removed), Markdown Wiki CRUD & Backup Script | HTTP `/wiki*` + `deploy/scripts/backup-db.sh` + Demo Route Absence | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F34` | Zero Native Browser Dialogs (`0` `confirm`/`prompt`/`alert`; shadcn `AlertDialog`/`Dialog`) | Static/AST Scan of `frontend/src/**` + Modal Component Wiring | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F35` | Reliable `UserSession` Deletion/Revocation on `/auth/logout` (Bearer `sid` + Refresh Cookie) | HTTP `/auth/logout` (Bearer-only, Cookie-only, Both) + `/auth/sessions` | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
| `F36` | `120m` Access Token TTL + Silent Single-Flight `401` Refresh + Instant `/auth/v2/login` Redirect | JWT `exp - iat == 7200` + `/auth/refresh` Rotation + `api-client.ts` Contract | `test_tier1_f19_f36.py` | `test_tier2_f19_f36.py` | `test_tier3_pairwise.py` | `test_tier4_journeys.py` |
