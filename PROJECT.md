# Project: Huseynovlar Institutional Multi-Asset Trading & Risk Terminal

## Architecture

### System Overview
Huseynovlar Terminal is a private, self-hosted, zero-trust Bloomberg × NYSE-grade institutional multi-asset trading, telemetry, market intelligence, and risk analytics platform operating across two repositories:
1. **Primary Monorepo (`/home/antigravity/Huseynovlar/huseynovlar-terminal`)**:
   - **`frontend/`**: TanStack Start (`@tanstack/react-start` + TanStack Router + React 19 + Vite 8 + Nitro SSR + Tailwind v4 + `@base-ui/react` shadcn `base-nova` + Zustand + Lightweight Charts v5 + Recharts v3) behind unprivileged Nginx (`:8080`). Default theme preset **`tangerine`**, **`floating`** sidebar, **Bloomberg-only** compact density, full reactive **`RU / EN / AZ`** localization, left-to-right animated shimmer skeletons, `<AsyncButton>` progress states, right-side toast notifications, unified sound preview synthesis, same-origin `<AssetLogo>`, `1000ms` synchronized clocks, global `LiveSocketProvider`, and 100% server-persisted preferences & chart workspaces.
   - **`backend/`**: FastAPI (`Python 3.12`, SQLAlchemy 2 Async, PostgreSQL 16 + SQLite test compatibility, Redis 7, Argon2id, TOTP + Backup Codes, FIDO2/WebAuthn, Fernet Vault) serving `/api/v1/*` and Redis-backed `WS /api/v1/ws/live`, with idempotent startup schema reconciliation (`pg_advisory_xact_lock` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + Alembic baseline) so upgrades on persistent VPS `terminal_pgdata` never fail.
   - **`worker/`**: Asynchronous background collector continuously syncing RSS + custom Verified News Sources, ForexFactory/RSS Economic Calendar, real Yahoo Finance Market Treemap & Macro Quotes, and Alert Rules (`alerts.default.yaml`), publishing live updates over Redis Pub/Sub channel `terminal:live` and routing alerts to `server_telegram_bot`.
   - **`mql5/`**: `ExnessPanelBridge.mq5` (running on a dedicated second MT5 chart tab with zero latency impact on trading EAs, communicating via dotted internal Docker alias `http://ingest.terminal.local:8000/api/v1/ingest` or `https://terminal.huseynovlar.org/api/v1/ingest`, auto-discovering sibling-chart EAs such as `NasdaqPulse v3.01` AND reading `ep_ipc` telemetry from `ExnessPanelHook.mqh`).
   - **`deploy/` & `config/`**: Hardened Docker Compose (`panel_internal`, `panel_egress` + `dns: [1.1.1.1, 9.9.9.9]`, `exness_mt5_ingest` with `ingest.terminal.local` alias, `panel_docker_proxy`), YAML seed catalogs (`CONFIG_DIR=/app/config`), `/opt/huseynovlar-terminal/.env` host secret loader (with `.env` fallback), deploy/backup scripts.
2. **Secondary Alerts Bot Repo (`/home/antigravity/Huseynovlar/server_telegram_bot`)**:
   - `huseynovlar-core` exposes `POST /internal/webhooks/trading` authenticated by `TRADING_WEBHOOK_SECRET` (`X-Trading-Webhook-Secret` / `X-Webhook-Secret`), fanning out `[TRADING]` alerts to subscribed Telegram users without needing `telegram_bot_token` or `telegram_chat_id` inside `huseynovlar-terminal`.

### Non-Negotiable Guardrails & Git Discipline
- **Zero Fake/Demo Data & Zero Stubs**: Delete all hardcoded fake fallbacks (`PREVIEW_TREEMAP`, `hash()` treemap numbers, `demoEvents` calendar, fake `LiveAssetChart` DOM numbers, and all 26 leftover Studio Admin demo routes). Every page, button, filter, chart, download, and WebSocket event must operate on real data and real backend state.
- **Deploy-Safe Docker Compose**: `deploy/docker-compose.yml` MUST pass `docker compose config --quiet` and `up -d` cleanly on the unmodified VPS immediately on `git push` (never hard-require uncreated external networks or uncreated `/etc` files — load `/opt/huseynovlar-terminal/.env` optionally when present and fall back to `.env`).
- **Git, Wave Checkpoints & Teamwork State Persistence on GitHub (`ORIGINAL_REQUEST.md:223-232`)**:
  - **Pre-Overhaul Base Commit SHAs (for Reviewers, Challengers, Forensic Auditors & Victory Auditor)**:
    - `huseynovlar-terminal`: **`eae5685`** (auditors MUST inspect `git diff eae5685` to cover both wave checkpoint commits and uncommitted working-tree edits).
    - `server_telegram_bot`: **`19a9ed7`** (auditors MUST inspect `git diff 19a9ed7`).
  - **Active Coordination Workspace vs GitHub Mirror**:
    - Live coordination state is maintained in `/home/antigravity/.agents/teamwork/` (metadata `.md` files ONLY — NEVER place source code, probes, secrets, or files named `AGENTS.md` / `GEMINI.md` there).
    - Per user mandate (`2026-11-25T05:57:20Z`), `/home/antigravity/.agents/teamwork/` is mirrored into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/` (NOT ignored in `.gitignore`) and committed & pushed alongside `PROJECT.md` to `Huseynovlar/huseynovlar-terminal` (`origin/main`) at **4 deterministic checkpoints** orchestrated by the Project Orchestrator ONLY:
      1. **Checkpoint 0 (Immediate)**: `PROJECT.md` + `.agents/teamwork/` pushed with `[skip ci]`.
      2. **Checkpoint 1 (Post-Wave 1 Gate Pass)**: Verified Wave 1 (`M1`+`M2`+`M4`+`E2E`) + synced `.agents/teamwork/` pushed with `[skip ci]`.
      3. **Checkpoint 2 (Post-Wave 2 Gate Pass)**: Verified Wave 2 (`M3`+`M5`) + synced `.agents/teamwork/` pushed with `[skip ci]`.
      4. **Checkpoint 3 (`M6` Phase 3 Final Production Push)**: Full verified codebase + `docs/` + `PROJECT.md` + `TEST_INFRA.md` + `TEST_READY.md` + `.agents/teamwork/` pushed **WITHOUT `[skip ci]`** to trigger `.github/workflows/deploy-production.yml` to `https://terminal.huseynovlar.org` (and `server_telegram_bot` pushed to `origin/main`).
  - Individual Milestone Workers (`M1`–`M5`, `E2E`, `M6` Phases 1–2) MUST **NOT** run `git commit` or `git push` themselves — only the Project Orchestrator's dedicated Checkpoint / Release workers execute git commits and pushes.

---

## Code Layout

Exclusive file write-ownership per Milestone (concurrent Workers MUST NOT write outside their owned paths):

```text
/home/antigravity/Huseynovlar/server_telegram_bot/          [Owned exclusively by M1]
├── app/common/web.py                                       # Add /internal/webhooks/trading to DEFAULT_AUTH_SKIP_PATHS
├── app/core/main.py                                        # Trading webhook handler verification
├── deploy/docker-compose.yml & scripts/server/deploy.sh    # Sync compose / webhook env safely
└── tests/                                                  # Bot unit & webhook auth tests

/home/antigravity/Huseynovlar/huseynovlar-terminal/
├── deploy/                                                 [Owned exclusively by M1]
│   ├── docker-compose.yml                                  # backend panel_egress+dns, CONFIG_DIR, ingest.terminal.local alias
│   ├── scripts/deploy.sh                                   # Zero-downtime deploy script
│   ├── scripts/backup-db.sh                                # Daily pg_dump + restic-ready retention
│   └── scripts/setup-vps-integrations.sh                   # /opt/huseynovlar-terminal/.env + webhook bridge helper
├── config/                                                 [Owned exclusively by M1]
│   ├── news_sources.yaml                                   # Seeded verified institutional RSS feeds & calendar URLs
│   ├── treemap.yaml                                        # Universes: sp500_top, nasdaq100, global_leaders, gold_commodities, crypto_majors, forex_majors
│   ├── assets.default.yaml                                 # Default multi-asset hubs (XAUUSD, USTEC, EURUSD, SPX, BTCUSD)
│   ├── alerts.default.yaml                                 # Trading & infrastructure alert thresholds
│   └── providers.yaml                                      # External market/calendar/GeoIP/logo endpoints
├── mql5/                                                   [Owned exclusively by M1]
│   ├── ExnessPanelBridge.mq5                               # Dotted URL default, 4014 diagnostics, sibling-chart EA discovery + ep_ipc reader
│   └── ExnessPanelHook.mqh                                 # Lock-safe JSONL IPC writer
├── .env.example & .github/workflows/                       [Owned exclusively by M1]
├── backend/Dockerfile                                      [Owned exclusively by M1]
│
├── backend/                                                [Owned by M2 in Wave 1, then M3 in Wave 2]
│   ├── requirements.txt, pyproject.toml, alembic/          [M2; M3 may add openpyxl/feed deps if not added in M2]
│   ├── app/main.py                                         [M2; M3 registers any additional router prefixes cleanly]
│   ├── app/core/ (config.py, security.py, deps.py, ws_hub.py, ip_utils.py)  [M2]
│   ├── app/db/ (models.py, session.py, schema_sync.py)     [M2 defines ALL schema tables upfront; M3 consumes/extends if needed]
│   ├── app/modules/auth/                                   [M2: cookies, refresh, dl_token, WebAuthn Redis, password, 2FA QR+backup, sessions, login-history, GeoIP]
│   ├── app/modules/users/                                  [M2: RBAC Users CRUD + View]
│   ├── app/modules/profile/                                [M2: profile CRUD + full server preferences sync]
│   ├── app/modules/ops/                                    [M2: containers CRUD+stats+logs, .set/.mq5/.mqh downloads, kill-switch, /etc status & test]
│   ├── app/modules/audit/                                  [M2: filtered audit log + detail view]
│   ├── app/modules/wiki/                                   [M2: Markdown Wiki/Playbooks CRUD + auto-seed]
│   ├── app/modules/accounts/                               [M3: Exness Profiles CRUD+View, Trading Accounts CRUD+View+api_key_enc, Robots CRUD+View]
│   ├── app/modules/ingest/                                 [M3: MT5 bootstrap/snapshot/trade-event/bars + auto-robot discovery + Redis WS publish]
│   ├── app/modules/assets/                                 [M3: Asset Hubs CRUD+Detail bundle + same-origin /assets/logo/{symbol} SVG/cache proxy]
│   ├── app/modules/charts/                                 [M3: explore, search, macro ribbon, server chart_states PUT/GET, Redis WS /ws/live]
│   ├── app/modules/analytics/                              [M3: home-summary, 8-chart overview with USC divisor fix, journal deals/positions, treasury CRUD, .csv/.xlsx]
│   ├── app/modules/intelligence/                           [M3: real Yahoo treemap, real calendar collector, DB news_sources CRUD+test, news wire+explore, Gemini AI briefings]
│   └── tests/                                              [M2 writes test_m2_*.py; M3 writes test_m3_*.py]
├── worker/                                                 [Owned exclusively by M3 in Wave 2]
│   └── main.py                                             # Unified async loop: News, Calendar, Treemap, Macro Quotes, Alerts -> Redis Pub/Sub & Webhook
│
├── frontend/                                               [Owned by M4 in Wave 1, then M5 in Wave 2]
│   ├── package.json, tsconfig.json, biome.json, vite.config.ts
│   ├── public/logos/                                       # Crisp offline SVG badges for indices/metals/commodities
│   └── src/
│       ├── framework/                                      # api-client, webauthn, i18n (ru/en/az), preferences sync, LiveSocketProvider, useUtcClock, AssetLogo, sound-engine
│       ├── components/ui/                                  # Left-to-right shimmer Skeleton, AsyncButton, right-side Toaster
│       ├── routes/                                         # M4 purges 26 demo routes + builds Shell/Auth/Lock/System/Ops/Wiki; M5 builds Home/Desk/Hubs/Explorer/Treemap/Analytics/Calendar/News/Sources/AI
│       └── __tests__/                                      # Vitest frontend unit & component tests
│
├── e2e/                                                    [Owned exclusively by E2E Testing Track]
│   └── ...                                                 # Opaque-box requirement-driven E2E test runner & Tiers 1–4 (+ Tier 5 in M6)
├── docs/                                                   [Updated in M6]
│   ├── ARCHITECTURE.md
│   └── ROADMAP_TODO.md
├── TEST_INFRA.md & TEST_READY.md                           [Owned exclusively by E2E Testing Track]
└── PROJECT.md                                              [Owned by Project Orchestrator]
```

---

## Feature Inventory

Every Survey feature (`REQ-01`–`REQ-33` across `ORIGINAL_REQUEST.md` and `docs/ROADMAP_TODO.md`) is assigned a concrete Milestone (zero unassigned features):

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | F01: WebAuthn Passkey Registration & Login | Fix `TypeError` via `base64url <-> Uint8Array` helpers & `serializeCredential`, Redis-backed challenges (`TTL=300s`), `sign_count` in passkey list, right-side toasts | M2, M4 | `ORIGINAL_REQUEST.md:4,152` |
| 2 | F02: Full `RU / EN / AZ` Localization | Reactive `useI18n()` dictionaries (`ru`, `en`, `az`) translating 100% of sidebar, header, login/lock, pages, buttons, tables, empty states, and toasts, synced to server preferences | M4, M5 | `ORIGINAL_REQUEST.md:6,157` |
| 3 | F03: Bloomberg-Only Compact Density | Remove `Apple (Comfortable)` mode and density switcher; enforce crisp Bloomberg compact density (`tabular-nums`, dense institutional spacing) everywhere | M4, M5 | `ORIGINAL_REQUEST.md:8` |
| 4 | F04: Real Economic & PnL Calendar + Event View | Populate `economic_events` from ForexFactory JSON / macro RSS in `worker` + `/intelligence/calendar` + `/calendar/{id}` + `/calendar/refresh`; replace demo FullCalendar with real Macro & Daily PnL Calendar + Event Detail View | M3, M5 | `ORIGINAL_REQUEST.md:10` |
| 5 | F05: Real Live Market Treemap & 100% Working Buttons | Fix `CONFIG_DIR=/app/config`, purge `hash()` & `PREVIEW_TREEMAP`, fetch real Yahoo Finance quotes/caps across `S&P 500`, `NASDAQ-100`, `Global`, `Gold & Commodities`, `Crypto`, `Forex` (`1D/1W/1M/3M/YTD`), build full-page proportional 2D squarified treemap with logos, filters & detail drawer | M1, M3, M5 | `ORIGINAL_REQUEST.md:12,112` |
| 6 | F06: Left-to-Right Shimmer Skeletons & `<AsyncButton>` Loaders | Animated left-to-right gradient sweep `<Skeleton>` variants on every loading view/session guard + `<AsyncButton>` spinner & localized progress text (`"Идёт загрузка..."` / `"Сохранение..."` / `"Авторизация..."`) on all actions | M4, M5 | `ORIGINAL_REQUEST.md:14,120` |
| 7 | F07: Right-Side Rich Toast Notifications | Polished right-side toast notifications on every save, create, edit, delete, copy, download, login, container command, and API error | M4, M5 | `ORIGINAL_REQUEST.md:16` |
| 8 | F08: Dotted MT5 WebRequest URL & Error 4014 Fix | Add `ingest.terminal.local` network alias to `backend` on `exness_mt5_ingest` (`http://ingest.terminal.local:8000/api/v1/ingest` + `https://terminal.huseynovlar.org/api/v1/ingest`), update `ExnessPanelBridge.mq5` default & `4014` log guidance, and update Setup Wizard | M1, M2, M4 | `ORIGINAL_REQUEST.md:18,89-91,154` |
| 9 | F09: Seamless Auth Cookies, Token Refresh, Downloads & Incognito | Set `HttpOnly; SameSite=Lax; Path=/` `ht_access_token` cookie + `/auth/download-token` (`?dl_token=`) + single-flight `401 -> /auth/refresh` interceptor + `apiDownload()` blob helper + lookup `bridge.set` by UUID OR `mt5_login` (`253752700`) + real `.xlsx`/`.csv`/`.mq5`/`.mqh` downloads | M2, M3, M4, M5 | `ORIGINAL_REQUEST.md:20,153` |
| 10 | F10: Default `tangerine` Theme + `floating` Sidebar + Preferences Page | Bake `theme_preset="tangerine"` and `sidebar_variant="floating"` into system defaults; build dedicated `/dashboard/preferences` exposing Theme Preset, Theme Mode, Font, Sidebar Style/Collapse, Layout, Navbar, Language, UTC Timezone, Sound & Ticker, 100% persisted on server | M2, M4 | `ORIGINAL_REQUEST.md:22,37,98` |
| 11 | F11: Redesigned Header, `1s` Clock Next to Profile, Clean Sidebar & Lock Screen | Remove header `USD/USC` switcher and inline timezone cycler; place read-only `1s` clock right next to Profile avatar; remove `<NavUser>` from left sidebar footer; add **Lock Screen (`Заблокировать экран`)** inside top-right Profile dropdown with Passkey/Password unlock | M4 | `ORIGINAL_REQUEST.md:24,37-43,122` |
| 12 | F12: Real MT5 Docker Containers (`mt5-xau`, `mt5-ustec`) Ops & CRUD+View | Fix token expiry & allowlist check (`ALLOWED_MT5_CONTAINERS` + label + `docker_containers` DB table); provide `/dashboard/containers` List, Register, Detail View (live inspect/stats/redacted logs/linked accounts), Edit, Delete, Start/Stop/Restart & Account-dropdown Kill-Switch | M1, M2, M4 | `ORIGINAL_REQUEST.md:26,148-149` |
| 13 | F13: Acoustic Sound Preview & Cross-UI Behavioral Parity | Trigger acoustic confirmation chime inside store whenever Sound is toggled ON from Header, Settings, or Hotkey + add individual sound cue preview buttons in Settings | M4 | `ORIGINAL_REQUEST.md:28` |
| 14 | F14: Trading Accounts & Exness Profiles Full CRUD + View & Key Clarity | Dedicated `/dashboard/accounts` & `/dashboard/profiles` (`List + Create + Detail View + Edit + Delete + Rotate Key`), encrypt `api_key_enc` so `.set` pre-fills `AccountApiKey=htk_...`, and clearly explain `htk_...` vs optional Exness Personal Area API keys | M3, M5 | `ORIGINAL_REQUEST.md:30,59-85,96` |
| 15 | F15: Redis Pub/Sub WebSocket Live Hub & Real-Time UI | Bridge `worker` & `backend` via Redis Pub/Sub `terminal:live` in `ws_hub.py`, authenticate WS, emit immediate `welcome` + `10s` `heartbeat` + `ping/pong` RTT, render green `WS LIVE • <N>ms` pill in Header, and live-update Balances, Equity, Positions, Robots, Charts, Ticker & News | M2, M3, M4, M5 | `ORIGINAL_REQUEST.md:35,120` |
| 16 | F16: Dedicated Multi-Page Architecture (Zero Cramming / Full CRUD+View) | Separate every domain onto its own purpose-built route hierarchy with dedicated List, Create, Detail View, Edit, and Delete views (`22` clean modules) and working Sidebar/Hotkey customization | M2, M3, M4, M5 | `ORIGINAL_REQUEST.md:45,49,96,110` |
| 17 | F17: Users Management RBAC CRUD + Detail View | Backend `/api/v1/users` (`ADMIN / OPERATOR / VIEWER`) + frontend `/dashboard/users`, `/new`, `/$userId`, `/$userId/edit` with last-admin & self-delete protection | M2, M4 | `ORIGINAL_REQUEST.md:45,96` |
| 18 | F18: `/etc` Server Secrets Loader & `server_telegram_bot` Webhook Fix | Load `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET` from `/opt/huseynovlar-terminal/.env` (with `.env` fallback); remove `bot_token`/`chat_id` from UI; fix `server_telegram_bot` `DEFAULT_AUTH_SKIP_PATHS` (`401` bug on `/internal/webhooks/trading`); expose read-only Integrations Status & Test buttons on `/dashboard/setup` | M1, M2, M4 | `ORIGINAL_REQUEST.md:47,141` |
| 19 | F19: Dynamic Asset/Search-Driven World News Wire & Story View | Fix `/app/config` path & `backend` `panel_egress`; filter `/dashboard/news` dynamically by user's DB Asset Hubs/Watchlist + free-text search + source/sentiment/verified badges; add Story Detail View `/dashboard/news/$newsId` | M1, M3, M5 | `ORIGINAL_REQUEST.md:51,118` |
| 20 | F20: Dedicated Google AI (Gemini) Co-Pilot Page & Briefing History | Standalone `/dashboard/ai` & `/dashboard/ai/$briefingId` workspace with Morning Briefing, Risk Audit, Asset Deep-Dive, Post-Mortem, custom prompt with live portfolio context, model selector, saved briefings list/view/delete | M3, M5 | `ORIGINAL_REQUEST.md:52` |
| 21 | F21: Database-Backed Verified Sources Registry CRUD + View | Seed `config/news_sources.yaml` into PostgreSQL `news_sources` table; build `/dashboard/news/sources`, `/new`, `/$sourceId`, `/$sourceId/edit` with feed test & SSRF protection | M2, M3, M5 | `ORIGINAL_REQUEST.md:53,96` |
| 22 | F22: Asset Hubs CRUD + Hub Detail View (with News Summary) & Asset Explorer | `/dashboard/hubs` (`CRUD + Detail View` with live chart, multi-account stats, **real News Digest summary** & live news wire) + dedicated `/dashboard/explorer` (global symbol search + chart + same-window Auto/Manual filtered live news + 1-click add to Hubs) | M3, M5 | `ORIGINAL_REQUEST.md:55,96,104` |
| 23 | F23: Unified Trading Journal & Treasury/Transfers CRUD + Detail Views | `/dashboard/journal` (Closed Deals, Open Positions, Balance/Transfer History, deal notes/tags CRUD, `/deals/$dealId` Detail View with chart & MAE/MFE, `.xlsx`/`.csv` export) + `/dashboard/treasury` (`CRUD + Detail View` for transfer/Vault reconciliation & server-saved Vault target) | M3, M5 | `ORIGINAL_REQUEST.md:45,57,96` |
| 24 | F24: Standalone Trading Robots CRUD + View, `1s` Clock & MQL5 Downloads | Dedicated `/dashboard/robots`, `/new`, `/$robotId`, `/$robotId/edit` with smooth `1000ms` uptime/UTC clock, rich `NasdaqPulse`-compatible telemetry, auto-discovery by `MagicNumber`, and 1-click `.mq5`/`.mqh`/`.set` downloads | M2, M3, M5 | `ORIGINAL_REQUEST.md:94,108` |
| 25 | F25: Dual-EA MT5 Workflow & `ExnessPanelHook.mqh` IPC Bridge | Upgrade `ExnessPanelBridge.mq5` to discover sibling-chart EAs (`ChartFirst/ChartNext`) AND read `ep_ipc\events_<login>.jsonl` safely; document 2-Chart MT5 workflow + optional `.mqh` hook in Setup Wizard & final guide | M1, M4 | `ORIGINAL_REQUEST.md:89,100,154` |
| 26 | F26: Universal Server-Side Persistence (Charts, Drawings & UI State) | Persist all Lightweight Charts drawings (`hline`, `trendline`, `fib`), indicators (`EMA20/50/200`, `BB`, `RSI`, `VWAP`), timeframes, and filter states in PostgreSQL (`chart_states` & `users.preferences`) | M2, M3, M4, M5 | `ORIGINAL_REQUEST.md:37,98` |
| 27 | F27: Flagship Institutional Home Command Center (`/dashboard/home`) | Dedicated executive Home Dashboard (`/dashboard` -> `/dashboard/home`) with live WS Portfolio KPIs, Equity Curve, Accounts/Robots pulse, `1s` Market Sessions, Macro Ribbon with logos, Mini Sector Pulse, Breaking News & Next Macro Event countdown | M3, M5 | `ORIGINAL_REQUEST.md:102,106,126` |
| 28 | F28: Universal Same-Origin Asset, Index, Equity, FX & Crypto Logos | Same-origin `/api/v1/assets/logo/{symbol}` caching/SVG proxy + `<AssetLogo>` component using `flags.css` + crisp market SVGs + cached stock/crypto logos + monogram fallback (100% CSP-safe, zero broken images) | M3, M4, M5 | `ORIGINAL_REQUEST.md:114` |
| 29 | F29: Deep Analytics & Risk Lab (8 Parameterized Charts + USC Fix) | Fix `USC / 100` commission/swap divisor bug; build 8 interactive charts (Equity, Drawdown, Daily PnL Calendar, Hourly Session TCA, Symbol Attribution, Robot Attribution, Long/Short Payoff, MAE/MFE & Rolling Win-Rate) with working server-saved filters | M3, M5 | `ORIGINAL_REQUEST.md:116` |
| 30 | F30: Institutional Asset-Agnostic Login Screen Right Panel | Replace `XAUUSD & USTEC` / `Asia/Baku` copy on `/auth/v2/login` with asset-agnostic institutional multi-asset trading, risk analytics & zero-trust architecture pillars in `RU/EN/AZ` | M4 | `ORIGINAL_REQUEST.md:128` |
| 31 | F31: Dedicated Security Page (Password Change, 2FA QR Wizard & Passkeys) | `/dashboard/security` with Argon2id Password Change, scannable SVG QR 2FA TOTP setup + 10 backup recovery codes + 2FA disable, and Passkeys management | M2, M4 | `ORIGINAL_REQUEST.md:49,87`, `ROADMAP_TODO.md:23` |
| 32 | F32: Dedicated Active Sessions, Login History & Audit Views + Real IP Geo | Extract real NetBird/client IP via `--forwarded-allow-ips=*` & `X-Forwarded-For`; build separate `/dashboard/sessions`, `/dashboard/login-history`, and `/dashboard/audit` pages with Detail Views & interactive IP Geolocation Map | M1, M2, M4 | `ORIGINAL_REQUEST.md:45,49`, `ROADMAP_TODO.md:22` |
| 33 | F33: Template Demo Purge, Markdown Wiki CRUD, Backup Script & Final Russian Guide | Purge all 26 Studio Admin demo routes & fake data, fix all TS/Biome errors, add `/dashboard/wiki` CRUD+View, update `docs/ROADMAP_TODO.md` & `docs/ARCHITECTURE.md`, pass 100% Tiers 1–5 E2E & Adversarial verification, and deliver complete Russian setup/keys guide + `sudo bash` VPS script | M1, M2, M4, M5, M6 | `ORIGINAL_REQUEST.md:84-87,124`, `ROADMAP_TODO.md:24-32` |
| 34 | F34: Zero Native Browser Dialogs (Styled shadcn `AlertDialog` / `Dialog` Everywhere) | Replace ALL `window.confirm`, `window.prompt`, and `window.alert` / `alert()` calls across the entire frontend with styled shadcn `AlertDialog` / `Dialog` modals (`0` native browser dialogs anywhere in `frontend/src`) | M4, M5 | `ORIGINAL_REQUEST.md:164` |
| 35 | F35: Reliable `UserSession` Deletion/Revocation on `/auth/logout` | Embed `sid` (`UserSession.id`) in JWT access token claims; standardize `ht_access_token` (`Path="/"`) & `ht_refresh_token` (`Path="/"`, clearing legacy `/api/v1/auth` & `/api/v1` too); on `POST /api/v1/auth/logout`, revoke/delete `UserSession` matching BOTH Bearer/cookie access token `sid` AND `ht_refresh_token` hash so the logged-out session immediately disappears from Active Sessions | M2, M4 | `ORIGINAL_REQUEST.md:165` |
| 36 | F36: Extended Access Token Lifetime + Silent `401` Auto-Refresh + Instant Redirect to `/auth/v2/login` | Increase default `access_token_expire_minutes` to `120` min on backend; in `frontend/src/framework/api-client.ts`, silently call `POST /api/v1/auth/refresh` (single-flight deduplicated) on `401 Unauthorized` and seamlessly retry the request; if refresh fails (`401`/`403`), immediately clear client auth state and redirect via `window.location.replace("/auth/v2/login")` from anywhere inside `/dashboard/*` | M2, M4, M5 | `ORIGINAL_REQUEST.md:166-168` |
| 37 | F37: GitHub Persistence of All Teamwork State & Planning Files | Mirror `/home/antigravity/.agents/teamwork/**` (scrubbed of secrets, zero `AGENTS.md`/`GEMINI.md`) + `PROJECT.md` into `Huseynovlar/huseynovlar-terminal` and commit & push to `origin/main` immediately (`[skip ci]`), after Wave 1 (`[skip ci]`), after Wave 2 (`[skip ci]`), and on `M6` Phase 3 production push so any future session cloning GitHub has 100% continuity | Orchestrator, M6 | `ORIGINAL_REQUEST.md:223-232` |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 (`M1`) | Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot` | Fix `server_telegram_bot` `/internal/webhooks/trading` auth skip + tests; fix `deploy/docker-compose.yml` (`backend` `panel_egress`+`dns`, `CONFIG_DIR=/app/config`, `--forwarded-allow-ips=*`, `ingest.terminal.local` alias, `docker-proxy` `INFO: 1`); add `setup-vps-integrations.sh` & `backup-db.sh`; expand `config/*.yaml`; upgrade `ExnessPanelBridge.mq5` (`ingest.terminal.local`, `4014` hint, sibling-chart EA discovery + `ep_ipc` reader) | none | `DONE` (`d9038a4` / `3b1a9a6`) |
| 2 (`M2`) | Backend Core, DB Schema Reconciliation, Auth/Passkeys/Cookies/RBAC, Redis WS Hub & Ops/Wiki APIs | Define complete SQLAlchemy schema (`models.py` for all M2+M3 entities) + idempotent PostgreSQL column/table migration runner (`schema_sync.py` + Alembic baseline); fix `CONFIG_DIR` resolution + `/opt/huseynovlar-terminal/.env` loader; dual `ht_access_token` (`Path="/"`, `120m` TTL, `sid` claim) + `ht_refresh_token` (`Path="/"`) + reliable `/auth/logout` session deletion + `?dl_token=` (`900s` TTL) + Redis WebAuthn + Password/2FA QR+backup/Sessions/LoginHistory/Real-IP/GeoIP; Users RBAC CRUD; Profile & Preferences sync; Redis Pub/Sub `ws_hub.py`; Ops Containers CRUD+stats+logs, `.set` (UUID or `mt5_login` with `api_key_enc`), `.mq5`/`.mqh` downloads, `/etc` status/test; Audit & Wiki CRUD | none | `DONE` (`f0478ce`) |
| 3 (`M3`) | Backend Trading Desk, Real Market Intelligence, Logo Proxy, Analytics & Worker Engine | Exness Profiles, Trading Accounts (`api_key_enc` Fernet), and Robots (`live_state_json`, `/robots` + `/accounts/robots` routes) Full CRUD+View; MT5 `ingest` auto-robot discovery + live WS broadcasts; Asset Hubs CRUD+Detail bundle + same-origin `/assets/logo/{symbol}` SVG/cache proxy; Charts (`explore`, `search`, `macro`, server `chart_states` PUT/GET, `WS /ws/live` welcome+10s heartbeat); Analytics (`home-summary`, 8-chart `overview` with `USC` divisor fix, Journal deals/positions + notes CRUD, Treasury CRUD, `.csv` & `.xlsx` exports); Intelligence (real Yahoo `treemap`, real ForexFactory/RSS `calendar`, DB `news_sources` CRUD+SSRF guard, dynamic `news`+`explore`, Gemini `ai/briefings` CRUD); full `worker/main.py` collector loop | M2 | `DONE` (`eb0dc2e`) |
| 4 (`M4`) | Frontend Core Framework, `tangerine`+`floating` Shell, `RU/EN/AZ` i18n, Demo Purge & System/Ops Pages | Purge all 26 Studio Admin demo routes & `<TanStackDevtools>` prod leak; fix all TS & Biome errors; ZERO native `confirm`/`prompt`/`alert` (shadcn `AlertDialog`/`Dialog` everywhere); build `api-client.ts` (silent single-flight 401 `/auth/refresh` retry + instant `/auth/v2/login` redirect on refresh failure + Bearer+cookie `/auth/logout` + `apiDownload`), `webauthn.ts`, `i18n` (`ru/en/az`), server-synced Preferences (`tangerine`, `floating`, Bloomberg-only density, `UTC`), left-to-right shimmer `<Skeleton>`, `<AsyncButton>`, right-side `<Toaster>`, unified Sound preview, `LiveSocketProvider` (`WS LIVE` header pill), `useUtcClock(1000)`, `<AssetLogo>`, redesigned Header/Sidebar/Lock Screen & Login page; implement full CRUD+View pages for Profile, Security/2FA/Passkeys, Sessions, Login History, Audit, Users, Preferences, Hotkeys, Containers, Setup Wizard & Wiki | none | `DONE` (`d640eef`) |
| 5 (`M5`) | Frontend Home Command Center, Trading Desk, Hubs/Explorer, Treemap, Analytics, Calendar, News & AI Pages | Build all 12 dedicated Trading & Market Intelligence pages with full CRUD + Detail Views, `RU/EN/AZ` i18n, shimmer skeletons, `<AsyncButton>`, right-side toasts, shadcn `AlertDialog`/`Dialog` modals, `<AssetLogo>`, server-saved chart drawings/filters, and live WS updates: `/dashboard/home`, `/charts`, `/accounts` & `/profiles`, `/robots`, `/journal`, `/treasury`, `/hubs`, `/explorer`, `/treemap`, `/analytics` (8 charts), `/calendar`, `/news` & `/news/sources`, `/ai`, plus clean legacy redirects & Vitest component/unit tests | M3, M4 | `DONE` (`832b30c`) |
| 6 (`M6`) | Final Milestone: Phase 1 E2E Pass (100% Tiers 1–4), Phase 2 Adversarial Hardening (Tier 5), Phase 3 Docs & Prod Push | Phase 1: Run & pass 100% of `TEST_READY.md` E2E test suite sequentially across Tiers 1 → 2 → 3 → 4, fixing all integration bugs. Phase 2: Tier 5 white-box adversarial coverage hardening (Challengers → Worker → Reviewers + whole-project Forensic Auditor loop until 0 gaps remain). Phase 3: Update `docs/ROADMAP_TODO.md` & `docs/ARCHITECTURE.md`, mirror final `.agents/teamwork/**`, run final CI checks, `git commit` & `git push origin main` in `server_telegram_bot` & `huseynovlar-terminal` (without `[skip ci]` to trigger auto-deploy), and verify GitHub Actions auto-deploy (`gh run list` / `gh run view`) | M1, M2, M3, M4, M5, E2E | `DONE` (Forensic Audit `CLEAN`, releasing to prod) |
| `E2E` | E2E Testing Track (Opaque-Box Requirement-Driven Test Suite) | Author `TEST_INFRA.md`; build standalone requirement-driven opaque-box E2E test harness & suite in `e2e/` covering all 36 product features (`F01`–`F36`: Tier 1 `>=180`, Tier 2 `>=180`, Tier 3 `>=36`, Tier 4 `>=18`, Total `>=414` tests); publish `TEST_READY.md` | none (uses Interface Contracts) | `IN_PROGRESS` (`ee44b731d7e26a070c89d0798fdec0f6`) |

---

## Interface Contracts

### 1. Database Schema & Startup Reconciliation (`M2` ↔ `M3`)
`M2` defines ALL SQLAlchemy models in `backend/app/db/models.py` AND implements `backend/app/db/schema_sync.py` invoked inside `app/main.py` `_lifespan` (under `pg_advisory_xact_lock(884210)` on PostgreSQL, no-op lock on SQLite):
- Existing tables safely extended via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
  - `trading_accounts`: `platform VARCHAR(32) DEFAULT 'MT5'`, `api_key_enc TEXT NULL`
  - `assets`: `logo_url TEXT NULL`, `category VARCHAR(32) DEFAULT 'macro'`
  - `deals`: `notes TEXT DEFAULT ''`, `tags JSON DEFAULT '[]'`
  - `balance_operations`: `is_manual BOOLEAN DEFAULT FALSE`, `notes TEXT DEFAULT ''`
  - `users`: `totp_backup_hashes JSON DEFAULT '[]'`
- New tables created via `Base.metadata.create_all`:
  - `news_sources`: `id` (UUID/slug PK), `name`, `url`, `category`, `trust_tier` (`tier_1|tier_2|custom`), `is_verified` (`bool`), `is_enabled` (`bool`), `asset_tags` (JSON), `poll_interval_sec` (`int`), `last_polled_at`, `last_error`, `article_count` (`int`), `created_at`
  - `chart_states`: `id`, `user_id` (FK `users.id`), `symbol` (`VARCHAR(64)`), `timeframe` (`VARCHAR(16)`), `indicators_json` (JSON), `drawings_json` (JSON), `filters_json` (JSON), `updated_at` (Unique `(user_id, symbol)`)
  - `wiki_pages`: `id`, `slug` (Unique `VARCHAR(120)`), `title`, `category`, `content_md` (`TEXT`), `is_pinned` (`bool`), `updated_by`, `created_at`, `updated_at`
  - `market_cache`: `cache_key` (PK `VARCHAR(128)`), `payload_json` (JSON), `updated_at` (shared cache across `worker` and `backend` in addition to Redis!)

### 2. Auth, Cookies, Reliable Logout, Token Refresh, Signed Downloads & WebAuthn (`M2` ↔ `M4` / `M5` / `E2E`)
- **Token Lifetimes & JWT Claims**:
  - Increase default `access_token_expire_minutes = 120` (2 hours) in `backend/app/core/config.py`; `refresh_token_expire_days = 14`.
  - `_issue_session_tokens` MUST embed `"sid": session.id` inside the JWT access token payload AND validate in `deps.py:get_current_user` (if `sid` is present) that the `UserSession` exists, is NOT revoked/deleted, and is not expired!
- **Cookies issued on `/api/v1/auth/bootstrap`, `/login`, `/refresh`, `/webauthn/login/verify`**:
  - `ht_access_token`: JWT (`HttpOnly=True`, `Secure=settings.cookie_secure`, `SameSite="lax"`, `Path="/"`, `max_age=access_token_expire_minutes * 60`).
  - `ht_refresh_token`: opaque token (`HttpOnly=True`, `Secure=settings.cookie_secure`, `SameSite="lax"`, `Path="/"`, `max_age=refresh_token_expire_days * 86400`).
- **Reliable Session Deletion on `POST /api/v1/auth/logout`**:
  - Match and revoke/delete `UserSession` in DB using **BOTH**:
    1. `ht_refresh_token` cookie (matching `refresh_token_hash`), AND
    2. `Authorization: Bearer <jwt>` or `ht_access_token` cookie `sid` claim (`UserSession.id == sid`)!
  - Delete `ht_access_token` and `ht_refresh_token` cookies across `path="/"`, `path="/api/v1"`, and legacy `path="/api/v1/auth"` so no stale cookie survives and the logged-out session disappears from `GET /api/v1/auth/sessions` immediately!
- **Token extraction order in `deps.py:get_current_user`**:
  1. `Authorization: Bearer <token>`
  2. `request.cookies.get("ht_access_token")`
  3. `request.query_params.get("dl_token")` (validated JWT with `"purpose": "download"`, 15-minute TTL issued by `POST /api/v1/auth/download-token` -> `{"dl_token": "...", "expires_in": 900}`).
- **Frontend `api-client.ts`**:
  - Always sends `credentials: "include"` + `Authorization: Bearer` (when present) — including on `POST /api/v1/auth/logout`!
  - On `401` (except `/auth/login`, `/auth/bootstrap`, `/auth/refresh`, `/auth/webauthn/login/*`), awaits a shared single-flight `POST /api/v1/auth/refresh`, updates in-memory/sessionStorage token + cookies, and seamlessly retries the original request once without interrupting the user.
  - **Instant Clean Redirect on Refresh Failure**: if `POST /api/v1/auth/refresh` fails (`401`/`403` or missing/revoked session), IMMEDIATELY clear client auth state (`sessionStorage`, memory) and redirect cleanly via `window.location.replace("/auth/v2/login")` when on any protected route so buttons NEVER fail with `Invalid or expired token`!
  - `apiDownload(path, fallbackFilename)`: fetches via authenticated `apiRequestRaw` (with 401 retry + redirect fallback) -> `Blob` -> triggers `<a download>` click; also exposes `getDirectDownloadUrl(path)` appending `?dl_token=...` for copyable/Incognito links.
- **Security & RBAC Endpoints**:
  - `POST /api/v1/auth/change-password` (`{current_password, new_password, revoke_other_sessions?: bool}`)
  - `POST /api/v1/auth/2fa/setup` -> `{secret, provisioning_uri, qr_svg}`
  - `POST /api/v1/auth/2fa/verify` (`{code}`) -> `{ok: true, totp_enabled: true, backup_codes: string[]}`
  - `POST /api/v1/auth/2fa/disable` (`{password, code}`) -> `{ok: true, totp_enabled: false}`
  - `GET /api/v1/auth/webauthn/credentials` (includes `sign_count`, `device_name`, `transports`, `created_at`, `last_used_at`)
  - `GET /api/v1/auth/sessions`, `GET /api/v1/auth/sessions/{id}`, `DELETE /api/v1/auth/sessions/{id}`, `POST /api/v1/auth/sessions/revoke-others`
  - `GET /api/v1/auth/login-history?action=&ip=&limit=`, `GET /api/v1/auth/login-history/{id}`, `GET /api/v1/auth/ip-lookup/{ip}`
  - `GET /api/v1/users`, `POST /api/v1/users`, `GET /api/v1/users/{id}`, `PATCH /api/v1/users/{id}`, `DELETE /api/v1/users/{id}`
  - `GET /api/v1/audit?action=&resource_type=&user_id=&limit=`, `GET /api/v1/audit/{id}`

### 3. Profile, Server-Persisted Preferences & Chart Workspaces (`M2` / `M3` ↔ `M4` / `M5`)
- `GET /api/v1/profile/me` & `PATCH /api/v1/profile/me` (`{display_name, email, bio, avatar_url, social_links}`)
- `GET /api/v1/profile/preferences` & `PATCH /api/v1/profile/preferences` -> deep-merges preferences JSON (`theme_preset: "tangerine"`, `theme_mode: "dark"`, `font: "geist"`, `sidebar_variant: "floating"`, `sidebar_collapsible: "icon"`, `content_layout: "full-width"`, `navbar_style: "sticky"`, `density: "bloomberg"`, `language: "ru"|"en"|"az"`, `timezone: "UTC"`, `privacy_mode`, `sound_enabled`, `ticker_enabled`, `ticker_speed`, `hidden_page_ids`, `sidebar_order`, `pinned_asset_codes`, `custom_hotkeys`, `vault_target_usd`, `analytics_filters`, `treemap_filters`).
- `GET /api/v1/charts/state/{symbol}` & `PUT /api/v1/charts/state/{symbol}` -> `{symbol, timeframe, indicators_json, drawings_json, filters_json, updated_at}`.

### 4. Ops, MQL5 Downloads, `/etc` Integrations, Wiki & Telegram Webhook (`M1` ↔ `M2` ↔ `M4`)
- `backend/app/core/config.py`:
  - `config_dir` resolves to `Path(os.environ["CONFIG_DIR"])` if set, else `Path("/app/config")` if `/app/config` exists, else repo `<root>/config`.
  - Loads `/opt/huseynovlar-terminal/.env` (if file exists and is readable) to populate/override `google_ai_api_key` (`GEMINI_API_KEY` or `GOOGLE_AI_API_KEY`), `google_ai_default_model` (`GEMINI_DEFAULT_MODEL` or `GOOGLE_AI_DEFAULT_MODEL`, default `"gemini-2.5-flash"`), `alerts_bot_webhook_url` (`TELEGRAM_WEBHOOK_URL` or `ALERTS_BOT_WEBHOOK_URL`), `alerts_bot_webhook_secret` (`TELEGRAM_WEBHOOK_SECRET` or `ALERTS_BOT_WEBHOOK_SECRET`), and `ip_geo_api_url` (`IP_GEO_API_URL`).
- Ops Endpoints (`/api/v1/ops`):
  - `GET /ops/containers`, `POST /ops/containers`, `GET /ops/containers/{id_or_name}`, `PATCH /ops/containers/{id_or_name}`, `DELETE /ops/containers/{id_or_name}`
  - `POST /ops/containers/{name}/{start|stop|restart}`, `GET /ops/containers/{name}/logs?tail=200`
  - `POST /ops/kill-switch/{account_id_or_login}` (accepts UUID or `mt5_login`)
  - `GET /ops/setup-wizard/{account_id_or_login}/bridge.set?url_mode=internal|external` (accepts UUID or `mt5_login`; decrypts `api_key_enc` to emit real `AccountApiKey=htk_...`; defaults `ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest`)
  - `GET /ops/downloads/ExnessPanelBridge.mq5` & `GET /ops/downloads/ExnessPanelHook.mqh`
  - `GET /ops/integrations/status`, `POST /ops/alerts/test`, `POST /ops/integrations/gemini-test`
- Wiki Endpoints (`/api/v1/wiki`):
  - `GET /wiki`, `POST /wiki`, `GET /wiki/{slug_or_id}`, `PATCH /wiki/{slug_or_id}`, `DELETE /wiki/{slug_or_id}`
- `server_telegram_bot` Webhook Contract:
  - `POST http://huseynovlar-core:8080/internal/webhooks/trading` with header `X-Trading-Webhook-Secret: <secret>` and JSON `{title, message, severity: "info"|"warning"|"critical", source: "huseynovlar-terminal", symbol?, account_login?, metadata?}` -> returns `200 {"ok": true, ...}` (added to `DEFAULT_AUTH_SKIP_PATHS` in `app/common/web.py`).

### 5. Trading Desk, Assets, Logos, Analytics, Intelligence & WebSocket Stream (`M3` ↔ `M5` / `E2E`)
- **Exness Profiles & Trading Accounts & Robots**:
  - `GET/POST /api/v1/profiles`, `GET/PATCH/DELETE /api/v1/profiles/{id}`
  - `GET/POST /api/v1/accounts`, `GET/PATCH/DELETE /api/v1/accounts/{id_or_login}`, `POST /api/v1/accounts/{id_or_login}/rotate-key`
  - `GET/POST /api/v1/robots` AND `/api/v1/accounts/robots` (both paths mounted!), `GET/PATCH/DELETE /api/v1/robots/{id}` AND `/api/v1/accounts/robots/{id}`
- **Assets, Hubs, Logos & Charts**:
  - `GET/POST /api/v1/assets`, `GET/PATCH/DELETE /api/v1/assets/{id_or_code}`, `POST /api/v1/assets/seed-defaults`
  - `GET /api/v1/assets/logo/{symbol}` (returns `image/svg+xml` or cached `image/png` with `200 OK` guaranteed for every symbol)
  - `GET /api/v1/charts/macro`, `GET /api/v1/charts/search?q=`, `GET /api/v1/charts/explore?symbol=&timeframe=`, `GET /api/v1/charts/{symbol}?timeframe=`
- **Journal, Treasury & Analytics**:
  - `GET /api/v1/analytics/home-summary`
  - `GET /api/v1/analytics/overview?days=&from=&to=&account_id=&symbol=&magic_number=&side=` (returns KPIs + `equity_curve`, `drawdown_curve`, `daily_pnl`, `hourly_pnl`, `by_symbol`, `by_account`, `by_robot`, `long_short_breakdown`, `mae_mfe_scatter`, `rolling_win_rate`)
  - `GET /api/v1/journal/deals`, `GET /api/v1/journal/deals/{id}`, `PATCH /api/v1/journal/deals/{id}`, `GET /api/v1/journal/positions`
  - `GET /api/v1/analytics/treasury`, `GET/POST /api/v1/treasury/operations`, `GET/PATCH/DELETE /api/v1/treasury/operations/{id}`
  - `GET /api/v1/analytics/statement.csv`, `GET /api/v1/analytics/statement.xlsx`
- **Market Intelligence & Gemini AI**:
  - `GET /api/v1/intelligence/treemap?universe=&period=&sector=&size_by=&q=`, `POST /api/v1/intelligence/treemap/refresh`
  - `GET /api/v1/intelligence/calendar?impact=&currency=&asset=&from=&to=`, `GET /api/v1/intelligence/calendar/{id}`, `POST /api/v1/intelligence/calendar/refresh`
  - `GET/POST /api/v1/intelligence/sources`, `GET/PATCH/DELETE /api/v1/intelligence/sources/{id}`, `POST /api/v1/intelligence/sources/{id}/test`
  - `GET /api/v1/intelligence/news?q=&asset=&source_id=&verified_only=&sentiment=&limit=`, `GET /api/v1/intelligence/news/explore?symbol=&q=&verified_only=`, `GET /api/v1/intelligence/news/{id}`, `POST /api/v1/intelligence/news/refresh`
  - `POST /api/v1/intelligence/ai/analyze`, `GET /api/v1/intelligence/ai/briefings`, `GET/DELETE /api/v1/intelligence/ai/briefings/{id}`
- **Live WebSocket (`WS /api/v1/ws/live`)**:
  - Authenticated via `ht_access_token` cookie or `?token=<jwt>`.
  - Emits immediate `{"type": "welcome", "ts": "...", "server_time_msc": ..., "portfolio": {...}}` on connect, `{"type": "heartbeat", "ts": "...", "server_time_msc": ...}` every `10s`, `{"type": "pong", ...}` on client `ping`, and Redis Pub/Sub events (`snapshot`, `trade_event`, `bar_update`, `robot_state`, `breaking_news`, `calendar_alert`, `container_event`, `macro_quotes`).

### 6. Target Frontend Route Map (`M4` + `M5`)
- **Auth & Lock**: `/auth/v2/login` (+ zero-trust Lock Screen overlay triggered from Profile dropdown)
- **Group 1 — Desk (`Терминал / Desk / Terminal`)** [`M5`]:
  - `/dashboard` -> redirects to `/dashboard/home`
  - `/dashboard/home` (Institutional Home Command Center)
  - `/dashboard/charts`, `/dashboard/charts/$symbol` (Live Trading Desk & Server-Saved Charts)
  - `/dashboard/accounts`, `/dashboard/accounts/new`, `/dashboard/accounts/$accountId`, `/dashboard/accounts/$accountId/edit`, `/dashboard/profiles`, `/dashboard/profiles/$profileId`
  - `/dashboard/robots`, `/dashboard/robots/new`, `/dashboard/robots/$robotId`, `/dashboard/robots/$robotId/edit`
  - `/dashboard/journal`, `/dashboard/journal/deals/$dealId`
  - `/dashboard/treasury`, `/dashboard/treasury/new`, `/dashboard/treasury/$opId`, `/dashboard/treasury/$opId/edit`
- **Group 2 — Markets & Analytics (`Активы и Рынок / Markets / Bazarlar`)** [`M5`]:
  - `/dashboard/hubs`, `/dashboard/hubs/new`, `/dashboard/hubs/$code`, `/dashboard/hubs/$code/edit`
  - `/dashboard/explorer` (Global Asset Search + Same-Screen Auto/Manual Filtered News)
  - `/dashboard/treemap` (Full-Page Proportional 2D Market Treemap with Logos & Filters)
  - `/dashboard/analytics` (Deep Analytics & Risk Lab — 8 Parameterized Charts)
  - `/dashboard/calendar`, `/dashboard/calendar/$eventId` (Real Macro & Daily PnL Calendar)
- **Group 3 — Intelligence & AI (`Новости и ИИ / Intelligence / Xəbərlər və Sİ`)** [`M5`]:
  - `/dashboard/news`, `/dashboard/news/$newsId`
  - `/dashboard/news/sources`, `/dashboard/news/sources/new`, `/dashboard/news/sources/$sourceId`, `/dashboard/news/sources/$sourceId/edit`
  - `/dashboard/ai`, `/dashboard/ai/$briefingId` (Standalone Google Gemini Co-Pilot)
- **Group 4 — Operations (`Инфраструктура / Operations / İnfrastruktur`)** [`M4`]:
  - `/dashboard/containers`, `/dashboard/containers/new`, `/dashboard/containers/$containerId`, `/dashboard/containers/$containerId/edit`
  - `/dashboard/setup` (Interactive MT5 & `/etc` Setup Wizard + Downloads + Integrations Test)
  - `/dashboard/wiki`, `/dashboard/wiki/new`, `/dashboard/wiki/$slug`, `/dashboard/wiki/$slug/edit`
- **Group 5 — System & Security (`Система и Доступ / System / Sistem`)** [`M4`]:
  - `/dashboard/users`, `/dashboard/users/new`, `/dashboard/users/$userId`, `/dashboard/users/$userId/edit`
  - `/dashboard/profile` (Personal Profile View/Edit ONLY)
  - `/dashboard/security` (Password Change, 2FA QR Wizard + Backup Codes, Passkeys)
  - `/dashboard/sessions`, `/dashboard/sessions/$sessionId`
  - `/dashboard/login-history`, `/dashboard/login-history/$entryId`
  - `/dashboard/audit`, `/dashboard/audit/$auditId`
  - `/dashboard/preferences` (Theme `tangerine`, Sidebar `floating`, Font, Layout, Language `RU/EN/AZ`, Timezone `UTC`, Sound with Previews, Ticker)
  - `/dashboard/hotkeys` (Working F13–F24 Hotkey Editor & Sidebar Customizer)
