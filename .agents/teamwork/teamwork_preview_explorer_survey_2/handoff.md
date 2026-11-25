# Survey Explorer 2 — Frontend Architecture, Pages, UI/UX, State, i18n, WebSockets & Dead-Button/Fake-Data Audit

**Core Summary:** The frontend in `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend` is a **TanStack Start (`@tanstack/react-start` 1.169.7) + React 19.3 + Vite 8 + Nitro SSR + Tailwind v4 + `@base-ui/react` (`shadcn` base-nova)** application built over the Studio Admin template — **not Next.js**. Every user-reported symptom in `ORIGINAL_REQUEST.md` traces to a deterministic root cause: raw JSON string WebAuthn buffers causing `TypeError`, `sessionStorage`-only JWTs without an `ht_access_token` cookie or 401 refresh interceptor causing `Authentication required` / `Invalid or expired token`, zero i18n translation dictionary, `MarketTreemap` silently falling back to hardcoded `PREVIEW_TREEMAP` NASDAQ-100 tiles (compounded by a backend `/config` vs `/app/config` path bug and missing `panel_egress`), `/dashboard/calendar` rendering untouched Studio Admin demo FullCalendar events, a `5000ms` interval causing 5-second clock jumps on `/dashboard/default`, disconnected Sidebar/Hotkey customizers, zero shimmer `<Skeleton>` or `toast.add` usage across active pages, and 22 leftover Studio Admin demo routes still compiled into the router.

---

## 1. Observation

### 1.1 Attached Screenshots (`image.png` & `image_2.png`)
- **`/home/antigravity/image.png`**: Shows MetaTrader 5's `Tools -> Options -> Expert Advisors` dialog with `[x] Разрешить WebRequest для следующих URL:` checked and the input row highlighted: `+ добавить URL в формате 'https://www.mql5.com'`. The list is empty because MT5's built-in URL validator rejects dotless Docker hostnames such as `http://terminal-backend:8000` (currently instructed in `frontend/src/routes/(main)/dashboard/academy/route.tsx:53,74`), causing MQL5 `WebRequest` to return `-1` with `ERR_FUNCTION_NOT_ALLOWED (4014)`.
- **`/home/antigravity/image_2.png`**: Shows the user's live MT5 chart `USTECc, M5: US Tech 100 Index` (Exness Cent account `¢2600`) running custom trading EA **`NasdaqPulse v3.01 ALL-WEATHER USTECc`** (`ALGO: ON`, `MKT: OPEN`, `STATE: OFF_SESSION (19:22:15)`, `Trend: H4+H1 BEAR | RSI: 41.1 | ER: 0.23`, `Risk: TURBO | P-KELLY (0.00L) | Sp: 1.12pt`, `Bal: ¢2600 | Work: ¢2600`, buttons `PAUSE` and `CLOSE ALL`). Because MT5 allows only **1 Expert Advisor per chart tab**, attaching `ExnessPanelBridge.mq5` onto the same chart replaces `NasdaqPulse` unless the user opens a second chart tab in MT5 (e.g., `USTECc`) dedicated to `ExnessPanelBridge.mq5` (and optionally `#include <ExnessPanelHook.mqh>` inside `NasdaqPulse` for sub-0.05ms IPC state/execution telemetry).

---

### 1.2 Frontend Stack, Build, Lint, Typecheck & Tests (`frontend/package.json`, `vite.config.ts`, `Dockerfile`)
- **Framework & Runtime** (`frontend/package.json:1-84`, `frontend/vite.config.ts:1-28`):
  - **NOT Next.js.** Uses **TanStack Start** (`@tanstack/react-start: ^1.169.7`) + **TanStack Router** (`@tanstack/react-router: latest`, `@tanstack/router-plugin: ^1.132.0`, file-based routes in `src/routes/`, generated tree in `src/routeTree.gen.ts`) + **React `^19.3.1`** + **Vite `^8.3.8`** + **Nitro `^3.0.260903-beta`** + **TypeScript `^6.0.3`**.
  - Path aliases (`frontend/tsconfig.json:7-10`): `#/*` and `@/*` both resolve to `./src/*`.
  - Production container (`frontend/Dockerfile:1-24`, `deploy/nginx/terminal.conf:1-74`): Multi-stage `node:22-alpine` build (`npm run build` -> `/app/.output`), running Nitro SSR (`PORT=3000 HOST=127.0.0.1 node /app/.output/server/index.mjs &`) behind unprivileged `nginx` on `:8080` (`USER node` / `1000:1000`), which proxies `/api/v1/ws/` (WebSocket upgrade) and `/api/` to `http://backend:8000`, `/assets/` from `/app/.output/public/assets/`, and `/` to `http://127.0.0.1:3000`.
  - Devtools leak in production (`frontend/src/routes/__root.tsx:109-119`): `<TanStackDevtools>` and `<TanStackRouterDevtoolsPanel />` are rendered unconditionally in `RootDocument`.
- **UI, Styling, Icons, Charts & State Libraries** (`frontend/package.json:25-66`, `frontend/components.json:1-26`):
  - Primitives: **`@base-ui/react` (`^1.9.0`)** + **`@shadcn/react` (`^0.3.1`)** + **`shadcn` (`^4.23.0`, style `"base-nova"`)** (note: Base UI uses `render={<Link ... />}` prop instead of Radix `asChild`).
  - Styling: **Tailwind CSS v4** (`tailwindcss: ^4.1.18`, `@tailwindcss/vite: ^4.3.5`, `tw-animate-css: ^1.4.0`, `class-variance-authority: ^0.7.1`, `cn: ^0.5.2`).
  - Icons & Flags: **`lucide-react` (`^1.77.0`)**, **`simple-icons` (`^16.38.1`, `src/components/simple-icon.tsx`)**, and **`src/styles/flag-icons/flags.css`** (203 KB embedded SVG country flags `.flag\:US`, `.flag\:EU`, `.flag\:AZ`, `.flag\:GB`, `.flag\:JP`, etc. — **not imported in `styles.css` yet!**).
  - Charts & Data Visualization: **`lightweight-charts` (`^5.3.0`)** for OHLCV candlesticks/markers/price lines, **`recharts` (`^3.8.0`)** for Area/Bar analytics charts, **`d3-geo` (`^3.1.2`) + `topojson-client` (`^3.1.0`)** (installed, unused in terminal pages — `profile/route.tsx:372` uses an `<iframe>` to `openstreetmap.org` instead), **`@tanstack/react-table` (`^9.3.1`)**, **`@dnd-kit/react` (`^0.5.3`)**, **`@fullcalendar/react` (`^7.1.5`)**.
  - State Management: **`zustand` (`^5.1.0`)** split across two separate stores:
    1. `src/framework/terminal-store.ts` (`useTerminalStore`, `persist` to `localStorage` key `"huseynovlar-terminal-prefs-v1"`).
    2. `src/stores/preferences/preferences-store.ts` (`PreferencesStoreProvider`, persisted to browser cookies via `src/lib/preferences/preferences-storage.ts`).
  - Toast Library: **`@base-ui/react/toast`** wrapped in `src/components/ui/toast.tsx:10` (`export const toast = ToastPrimitive.createToastManager()`), with `<Toaster />` mounted in `src/routes/__root.tsx:106`.
  - i18n Library: **None installed** (zero `i18next` / `useTranslation` / dictionary files).
- **Build, Lint, Typecheck & Test Status (Verified Read-Only)**:
  - `npm run build` (`vite build`): Runs in `.github/workflows/ci.yml:49` (only check in CI).
  - `./node_modules/.bin/tsc --noEmit` (not in `package.json` scripts or CI): **FAILS with exit code 2 (4 TypeScript errors)**:
    1. `src/components/ui/scroll-area.tsx(1,1): error TS6133: 'React' is declared but its value is never read.`
    2. `src/config/app-config.ts(9,24): error TS2339: Property 'version' does not exist on type ...` (`frontend/package.json` has no `"version"` field).
    3. `src/routes/(main)/chat/-components/chat-sidebar.tsx(40,9): error TS6133: '_isCollapsed' is declared but its value is never read.`
    4. `src/routes/-components/root-error.tsx(13,73): error TS18046: 'error' is of type 'unknown'.`
  - `./node_modules/.bin/biome lint src` (`npm run lint`, Biome `2.6.8`): **FAILS with 28 errors, 15 warnings, 56 infos** (including `useFilenamingConvention` on PascalCase files in `src/framework/components/*.tsx`, `noFloatingPromises` in `HotkeyEngine.tsx:90`, `useNullishCoalescing` in `api-client.ts:67`, `noNestedTernary` in `BloombergTickerTape.tsx:51` & `LiveAssetChart.tsx:457,574`, and `useTailwindSortedClasses`).
  - **Frontend Tests**: **Zero test runner or test files** exist (`vitest`, `@testing-library/react`, `playwright` are all absent).

---

### 1.3 Directory Layout & Shared Layout Components
- `frontend/src/routes/__root.tsx` (`lines 81-124`): Root HTML shell (`lang="en"` hardcoded at `line 87`), injects `<ThemeBootScript />`, wraps children in `<TooltipProvider>` and `<PreferencesStoreProvider initialValues={PREFERENCE_DEFAULTS}>`, mounts `<Toaster />` and `<TanStackDevtools>`.
- `frontend/src/routes/(main)/dashboard/route.tsx` (`lines 25-131`): Protected dashboard layout:
  - Runs client-side `useEffect` session guard (`lines 29-67`): only calls `POST /auth/refresh` when `!getAccessToken()`, then calls `GET /profile/me`; on error clears token and redirects via `window.location.replace("/auth/v2/login")`. While awaiting `currentUser`, renders plain text `"Проверка доступа (Zero-Trust Session Guard)..."` (`line 72`, no shimmer skeleton).
  - Renders `<HotkeyEngine />`, `<AppSidebar />`, `<BloombergTickerTape />`, top `<header>` (`SidebarTrigger`, `SearchDialog` bound to `⌘J` instead of `⌘K` at `search-dialog.tsx:85,141` with English text `"Search dashboards, users, and more…"`, `TerminalHeaderControls`, `ThemeSwitcher`, `AccountSwitcher`), and `<Outlet />`.
  - Note: `LayoutControls` (`src/routes/(main)/dashboard/-components/header/layout-controls.tsx:14-252`, containing Theme Preset, Fonts, Theme Mode, Page Layout, Navbar Behavior, Sidebar Style, Sidebar Collapse Mode) is **dead/unmounted** — never imported in `dashboard/route.tsx`.
- **Dual Disconnected Page Registries**:
  - `src/navigation/sidebar/sidebar-items.ts:57-148` defines 11 static Russian sidebar items actually rendered by `AppSidebar` (`app-sidebar.tsx:58`) and `SearchDialog` (`search-dialog.tsx:19`).
  - `src/framework/registries/pages.config.ts:46-178` defines 12 `TERMINAL_PAGES` entries (with stale routes like `market_heatmap -> /dashboard/analytics`, `overview / asset_xauusd / asset_ustec -> /dashboard/crypto`) read **only** by the Sidebar Customizer card in `roles/route.tsx:149`.

---

### 1.4 Complete Route, Component, Fake-Data, Dead-Button & CRUD Audit (All 41 Route Files)

#### A. Active Terminal Routes (15 files: 2 redirects + 2 auth + 1 dashboard layout + 10 sidebar pages + 1 demo calendar in sidebar)

| URL Route & File | Sidebar Label | What Works | Fake / Hardcoded / Mock Data | Broken / Non-Functional Buttons & Flows | CRUD / View Gaps |
|---|---|---|---|---|---|
| `/` (`src/routes/(external)/index.tsx:1-8`) & `/dashboard` (`src/routes/(main)/dashboard/index.tsx:1-8`) | *(Redirects)* | Redirects to `/dashboard/default` | N/A | User requested a dedicated **Home Overview Dashboard** (`ORIGINAL_REQUEST.md:102`), not a redirect into Accounts & Robots | Missing dedicated Home Dashboard page |
| `/auth/v2` + `/auth/v2/login` (`src/routes/(main)/auth/v2/route.tsx:1-60`, `login/route.tsx:1-189`) | *(Login / Bootstrap)* | Password login, owner bootstrap, conditional 2FA TOTP input | Right hero panel hardcodes `XAUUSD & USTEC (USD / USC)` (`auth/v2/route.tsx:40`) & footer hardcodes `Asia/Baku • NetBird` (`login/route.tsx:183`) | **"Войти по Passkey" (`login/route.tsx:58-77`) throws `TypeError`** (`options.challenge` & `allowCredentials[].id` are strings, not `Uint8Array`); submit button lacks spinner (`"Проверка..."` text only) | Missing Lock Screen mode (`ORIGINAL_REQUEST.md:43`) |
| `/dashboard/crypto` (`crypto/route.tsx:1-21` -> `LiveAssetChart.tsx:1-897`) | **Терминал и Графики** | Candlestick chart (`M1`–`W1`), `EMA20/50/200` & `BB(20,2)`, `localStorage` drawings (`hline`, `trendline`, `fib`), click position/deal row to focus chart | **100% fake spread & DOM panel** (`LiveAssetChart.tsx:484` `spread = asset === "USTEC" ? 1.2 : 0.22`; `lines 722-767` hardcoded `lvl * 14.5 lots`, `lvl * 16.2 lots`, `Buy Pressure: 62% / Sell: 38%`); hardcoded asset buttons `["XAUUSD", "USTEC"]` (`line 509`); misleading banner `"предпросмотр на демо-свечах"` (`line 889`) | Symbol search `/charts/explore` fails in prod because `backend` container has no `panel_egress` internet access (`deploy/docker-compose.yml:65`); drawings/indicators not saved to server; zero live WS tick/candle/position updates; unused crypto template files in `crypto/-components/*` | Crammed single widget; missing **Asset Hubs CRUD + Detail View** (with real news summary & calendar per asset, `ORIGINAL_REQUEST.md:55`) and **Asset Explorer** page (`ORIGINAL_REQUEST.md:104`) |
| `/dashboard/default` (`default/route.tsx:1-435`) | **Счета и роботы** | Lists accounts & robots from `/accounts` & `/accounts/robots`, aggregates Total Balance/Equity/Floating, creates account (`POST /accounts`), rotates account API key (`POST /accounts/{id}/rotate-key`) | Hardcoded default `Exness-MT5Real10` (`line 74`); unused template files in `default/-components/*` | **UTC clock jumps every 5 seconds** (`setInterval(..., 5000)` at `line 94` while rendering `HH:MM:SS` at `line 262`); zero live WS updates for Balance/Equity/Floating/Ping/Robots; plain `"Загрузка счетов..."` (`line 284`), no button loader or toast on create/rotate | Crammed Accounts + Robots on one page; **Accounts missing Detail View, Edit (`PATCH`), Delete (`DELETE`)**; **Robots missing dedicated page, Create form (despite `POST /robots` existing in `accounts/router.py:282`), Detail View, Edit, Delete, and `.mq5`/`.mqh`/`.set` downloads** (`ORIGINAL_REQUEST.md:61,94-96`) |
| `/dashboard/finance` (`finance/route.tsx:1-209`) | **Казначейство и Хранилище** | Displays `/analytics/treasury` KPIs and filters `DEAL_TYPE_BALANCE` ledger by kind (`ALL`, `EXNESS_VAULT`, `DEPOSIT`, `WITHDRAWAL`, `INTERNAL_TRANSFER`) | Hardcoded `vault_target_usd: 500.0` in `EMPTY_TREASURY` (`line 49`); unused template files in `finance/-components/*` | No loading skeleton, no empty-state message when `filteredOps.length === 0` (renders blank table body), vault target threshold cannot be edited or saved on server, no WS live updates | Read-only table only; **missing Transfer/Operation Detail View, manual treasury note/reconciliation CRUD, and full Deals/Orders History Journal + Detail View** (`ORIGINAL_REQUEST.md:45,57,96`) |
| `/dashboard/treemap` (`treemap/route.tsx:1-21` -> `MarketTreemap.tsx:1-170`) | **Карта рынка (Treemap)** | Renders colored flex tiles by sector | **`PREVIEW_TREEMAP` (`MarketTreemap.tsx:29-67`) is 100% hardcoded fake NASDAQ-100 data** (`NVDA +3.42%`, `AVGO +1.85%`, `AAPL +0.78%`, etc.) | **Clicking `"S&P 500 / Мир"`, `"Gold & Сырьё (XAUUSD)"`, `"1W"`, `"1M"`, `"YTD"` (`lines 108-135`) has ZERO visual effect** because `/intelligence/treemap` returns `sectors: []` (due to `config.py:37` `/config` bug) and `if (res.sectors && res.sectors.length > 0)` (`line 87`) keeps stale `PREVIEW_TREEMAP`! Tiles have **no `onClick`**, no logos, no search/sector/cap filters, and use small flex boxes instead of a large Finviz/StockCharts proportional treemap (`ORIGINAL_REQUEST.md:12,112,114`) | Missing Ticker/Company Detail drawer/page on tile click |
| `/dashboard/analytics` (`analytics/route.tsx:1-315`) | **Аналитика и Risk Lab** | Fetches `/analytics/overview?days=90`, renders KPI cards, Equity & Drawdown `AreaChart`, Hourly `BarChart`, Daily PnL grid, Symbol & Account breakdown tables | Duplicates `<MarketTreemap />` (`line 155`) with its fake `PREVIEW_TREEMAP`; unused template files in `analytics/-components/*` | **`Exness Statement (CSV / Excel)` (`window.open("/api/v1/analytics/statement.csv")`, `line 119`) fails with `401 {"detail":"Authentication required"}`**; hardcoded `days=90` (`line 91`) — **zero filter controls** (date range, account, symbol, robot/MagicNumber); `useLiveTerminalSocket()` (`line 87`) never refreshes data on trade events; chart settings not persisted on server | Missing Analytics Detail Views (per-day/per-symbol/per-account/per-robot drilldown, MAE/MFE & Execution TCA views, `ORIGINAL_REQUEST.md:45,116`) |
| `/dashboard/calendar` (`calendar/route.tsx:1-12` -> `calendar/-components/calendar.tsx:1-144`, `events-data.ts:1-23`) | **Календарь и PnL** | Renders FullCalendar UI shell only | **100% untouched Studio Admin fake demo data** (`events-data.ts:8-22`: `"Monthly planning"`, `"Design review"`, `"Arham Khan Birthday"`, filter dropdown `"Work / Personal / Team / Focus time"`) | **Completely disconnected from trading/economic calendar** (`ORIGINAL_REQUEST.md:10` `"календарь не работает"`): `"Add event"` button (`calendar.tsx:113`) has **no `onClick` handler**; calendar selector (`line 61`) doesn't even filter `demoEvents`; zero API calls to `/intelligence/...` or PnL endpoints | Needs real **Economic Macro Calendar (ForexFactory/RSS high-impact events + countdown + impact/currency/asset filters + Event Detail View) & PnL Calendar** |
| `/dashboard/chat` (`dashboard/chat/route.tsx:1-348`) | **Новости и Gemini AI** | Renders News list, Gemini Co-Pilot prompt card, and Verified Sources card | Hardcoded filter pills `["ALL", "XAUUSD", "USTEC", "EURUSD", "BTCUSD"]` (`line 152`) instead of user's DB assets + search | **News feed is empty & Verified Sources Registry is stuck on `"Загрузка реестра источников..."` / `0 VERIFIED`** (`lines 307,313`) because `backend/app/core/config.py:37` resolves `config_dir` to `/config` instead of `/app/config` AND `backend` lacks `panel_egress` (`deploy/docker-compose.yml:65`), so `/intelligence/sources`, `/intelligence/news/refresh`, and Gemini `/intelligence/ai/analyze` all fail or return `[]`! `handleRefreshFeeds` swallows all errors (`catch {}` at `line 91`) | Crammed News + Sources + Gemini AI onto one page; **user requested Gemini AI Co-Pilot on a separate page (`ORIGINAL_REQUEST.md:52`), dynamic/search news filtering (`line 51`), News Detail View (`ROADMAP_TODO.md:22`), and Custom News Sources CRUD** |
| `/dashboard/infrastructure` (`infrastructure/route.tsx:1-276`) | **Контейнеры MT5 / ОС** | Lists `/ops/containers` (`mt5-xau`, `mt5-ustec` are real VPS containers), registers container (`POST /ops/containers`), queues Kill-Switch (`POST /ops/kill-switch/{id}`) | Unused template files in `infrastructure/-components/*`; Kill-Switch requires pasting raw Account UUID (`line 256`) | **`Restart`, `Start`, `Stop`, and `Логи` buttons fail with `"Invalid or expired token"`** (`ORIGINAL_REQUEST.md:26`) after 30 min because `api-client.ts` has no 401 token refresh; plus backend `ops/router.py:171-187,222` rejects DB-registered containers not in `.env` `ALLOWED_MT5_CONTAINERS`! `Start` and `Stop` buttons don't even check `disabled={busy === ...}` (`lines 203-220`) | Missing **Container Detail View** (live stats/mounts/networks/full logs/linked accounts), **Edit**, and **Delete (`DELETE /ops/containers/{id}`)** (`ORIGINAL_REQUEST.md:26,96`) |
| `/dashboard/academy` (`academy/route.tsx:1-108`) | **Инструкции и Setup Wizard** | Static 2-card page with copyable Docker snippet | Instructs invalid dotless URL `http://terminal-backend:8000` (`lines 53,74`) and hardcoded container name `mt5-xauusd-usd` (`line 19`); unused template files in `academy/-components/*` | **`Скачать .set` (`window.open("/api/v1/ops/setup-wizard/.../bridge.set")`, `line 66`) fails with `401 {"detail":"Authentication required"}`** (`ORIGINAL_REQUEST.md:20`); requires manually pasting Account UUID instead of account selector; no `.mq5` / `.mqh` download buttons | Missing **Editable Knowledge Base / Markdown Wiki CRUD** and complete **API Keys & Dual-EA Setup Guide** (`ORIGINAL_REQUEST.md:84,89,100`) |
| `/dashboard/profile` (`profile/route.tsx:1-552`) | **Профиль и Безопасность** | Loads `/profile/me`, `/profile/vault`, `/auth/sessions`, `/auth/login-history`, `/auth/webauthn/credentials`; revokes non-current session; saves profile & vault secrets | Initial state defaults `@huseynovlar` / `Exness MT5 Algo Desk — XAUUSD & USTEC` (`lines 79-82`) flash before fetch; unused template files in `profile/-components/*` | **`Добавить ключ` (`registerPasskey`, `lines 214-235`) throws `TypeError`**; IP lookup & Test Telegram Alert fail in prod because `backend` lacks `panel_egress`; uses `window.prompt` (`line 166`) and `window.confirm` (`line 154`) instead of shadcn dialogs; exposes redundant `telegram_bot_token` / `telegram_chat_id` / `alerts_bot_webhook_secret` inputs (`ORIGINAL_REQUEST.md:47`) | Crammed 6 modules onto 1 page! **User requested separate pages (`ORIGINAL_REQUEST.md:45,49`): (1) Profile View/Edit, (2) Security (Password Change + 2FA TOTP QR Wizard + Passkeys), (3) Active Sessions + Detail View, (4) Login & Audit History + IP Geo Map + Detail View, (5) Users Management CRUD** |
| `/dashboard/roles` (`roles/route.tsx:1-206`) | **Настройки и Хоткеи** | Exports `customHotkeys` JSON file locally | Unused template files in `roles/-components/*` | **1) Density toggle** still shows `Apple (Comfortable)` (`lines 66-73`); **2) Language `RU/EN/AZ` buttons** (`lines 88-99`) do not change UI language; **3) Sound toggle** (`line 136`) plays no preview sound; **4) Sidebar Customizer** (`lines 149-166`) edits `hiddenPageIds` on `TERMINAL_PAGES`, which `AppSidebar` never reads (zero effect!); **5) Hotkey Editor** (`lines 190-200`) edits `customHotkeys`, which `HotkeyEngine` never reads (zero effect!); **6) Zero server persistence** (`PATCH /profile/preferences` never called); **7) Theme Preset (`tangerine`), Font, Sidebar Style (`floating`), Layout preferences missing** | Needs unified server-persisted Preferences & Layout Customizer (`tangerine` + `floating` defaults + `bloomberg` only density) |

#### B. Leftover Unmodified Studio Admin Demo Routes Still Compiled in `src/routeTree.gen.ts` (26 files!)
1. **Unprotected routes outside `/dashboard` Auth Guard** (security & UX hazard — accessible without login!):
   - `/chat` (`src/routes/(main)/chat/route.tsx` + `-components/*`) — Studio Admin demo messenger with fake users.
   - `/mail` (`src/routes/(main)/mail/route.tsx` + `-components/*`) — Studio Admin demo email client with fake inbox (`mails`).
   - `/auth/v1/login` (`src/routes/(main)/auth/v1/login/route.tsx`) — Demo login form (`toast.add("You submitted the following values")`, fake Google button).
   - `/auth/v1/register` (`src/routes/(main)/auth/v1/register/route.tsx`) — Demo registration form.
   - `/auth/v2/register` (`src/routes/(main)/auth/v2/register/route.tsx`) — Demo `"Create your account"` with fake Google OAuth button.
   - `/unauthorized` (`src/routes/(main)/unauthorized.tsx`) — Hardcoded English template page.
2. **Unused Studio Admin demo routes under `/dashboard/*`** (bloat bundle size, contain fake `Arham Khan` / `Ammar Khan` data in `src/data/users.ts` and per-route `data.ts`/`data.json`):
   - `/dashboard/crm`, `/dashboard/ecommerce`, `/dashboard/file-manager`, `/dashboard/hr`, `/dashboard/invoice`, `/dashboard/kanban`, `/dashboard/logistics`, `/dashboard/mail`, `/dashboard/patient-monitoring`, `/dashboard/productivity`, `/dashboard/products`, `/dashboard/tasks`, `/dashboard/users` (currently demo table — should be replaced by real Terminal **Users Management CRUD**!), `/dashboard/coming-soon`, `/dashboard/default-v1`, `/dashboard/crm-v1`, `/dashboard/finance-v1`, `/dashboard/analytics-v1`, plus English catch-all `/dashboard/$` (`src/routes/(main)/dashboard/$.tsx`).

---

### 1.5 Deep-Dive Findings on All 7 Specific Bug Categories from `ORIGINAL_REQUEST.md`

#### Bug 3.1 — WebAuthn Passkey `TypeError` (Registration & Login)
- **Exact Files & Lines**:
  - Registration: `frontend/src/routes/(main)/dashboard/profile/route.tsx:220-229`:
    ```tsx
    const options = await apiRequest<PublicKeyCredentialCreationOptions>("/auth/webauthn/register/options", {
      method: "POST",
    });
    const cred = await navigator.credentials.create({ publicKey: options });
    if (!cred) throw new Error("Регистрация Passkey отменена");
    await apiRequest("/auth/webauthn/register/verify", {
      method: "POST",
      body: JSON.stringify({ device_name: navigator.platform || "My Device", credential: cred }),
    });
    ```
  - Login: `frontend/src/routes/(main)/auth/v2/login/route.tsx:66-70` & `frontend/src/framework/api-client.ts:64-73`:
    ```tsx
    const { challenge_key, options } = await authApi.webauthnLoginOptions(username || undefined);
    const cred = await navigator.credentials.get({ publicKey: options });
    ...
    const res = await authApi.webauthnLoginVerify(challenge_key, cred);
    ```
- **Exact Root Causes (Two Sequential Bugs)**:
  1. **Input `BufferSource` `TypeError`**: Backend `py_webauthn` `options_to_json(options)` (`backend/app/modules/auth/router.py:340,412`) serializes binary fields (`options.challenge`, `options.user.id`, `options.excludeCredentials[].id`, `options.allowCredentials[].id`) as **base64url strings**. Browser WebAuthn `navigator.credentials.create` and `navigator.credentials.get` strictly require `BufferSource` (`Uint8Array` / `ArrayBuffer`) and immediately throw `TypeError` when given strings.
  2. **Output `PublicKeyCredential` Serialization Bug**: Even after `create()`/`get()` succeeds, `JSON.stringify({ credential: cred })` fails on standard DOM `PublicKeyCredential` instances unless serialized via `(cred as PublicKeyCredential & { toJSON?: () => unknown }).toJSON?.()` or an explicit `ArrayBuffer -> base64url` serializer (`{ id, rawId, type, authenticatorAttachment, response: { clientDataJSON, attestationObject / authenticatorData, signature, userHandle, transports } }`).
  3. **Bonus Backend Note**: `_webauthn_challenges` (`backend/app/modules/auth/router.py:47`) is an in-memory Python `dict` — fine for 1 worker, but storing challenges in Redis (`TTL=300s`) makes it restart- and multi-worker-safe.

#### Bug 3.2 — Direct Downloads (`Authentication required`), Incognito, & `Invalid or expired token` (`api-client.ts`)
- **Exact Files & Lines**:
  - `frontend/src/framework/api-client.ts:3-45` (`accessToken` stored only in `window.sessionStorage.getItem("ht_access_token")`, sent only via `Authorization: Bearer ${accessToken}`, **no 401 refresh retry**).
  - `frontend/src/routes/(main)/dashboard/route.tsx:33-38` (`verifySession` only calls `/auth/refresh` when `!getAccessToken()`).
  - `frontend/src/routes/(main)/dashboard/academy/route.tsx:66` (`window.open('/api/v1/ops/setup-wizard/${accountId.trim()}/bridge.set', '_blank')`).
  - `frontend/src/routes/(main)/dashboard/analytics/route.tsx:119` (`window.open('/api/v1/analytics/statement.csv', '_blank')`).
  - `backend/app/modules/auth/router.py:127-135` & `backend/app/core/deps.py:24-36`.
- **Exact Root Causes**:
  1. **Why `<a href>` / `window.open` / direct URLs fail with `{"detail":"Authentication required"}` (including in Incognito)**:
     - `window.open(...)` / direct browser URL navigation never attaches `Authorization: Bearer` headers; browsers only send cookies matching the request path.
     - `backend/app/core/deps.py:26` already checks `elif "ht_access_token" in request.cookies:`, **but `backend/app/modules/auth/router.py:127-135` never sets an `ht_access_token` cookie** — it only sets `ht_refresh_token` restricted to `path="/api/v1/auth"`! Furthermore, in a new tab (or direct link), `window.sessionStorage` is isolated per tab.
  2. **Why clicking buttons on `mt5-xau` / `mt5-ustec` (or any form) throws `Invalid or expired token`**:
     - `access_token_expire_minutes = 30` (`backend/app/core/config.py:31`). After 30 minutes, `sessionStorage.getItem("ht_access_token")` is still non-null (so `dashboard/route.tsx:33` skips `/auth/refresh`), `apiRequest` sends the expired JWT, `deps.py:35` returns `401 {"detail": "Invalid or expired token"}`, and `api-client.ts:33-42` **immediately throws without calling `POST /api/v1/auth/refresh` and retrying**!

#### Bug 3.3 — i18n (`RU / EN / AZ`) Not Changing Interface Language
- **Exact Files & Lines**:
  - State: `frontend/src/framework/terminal-store.ts:6,14,52,60,78-83` (`language: "ru" | "en" | "az"`).
  - Switchers: `frontend/src/framework/components/TerminalHeaderControls.tsx:12,19,70-79` and `frontend/src/routes/(main)/dashboard/roles/route.tsx:19,27,85-100`.
  - Root `<html lang="en">` hardcoded in `frontend/src/routes/__root.tsx:87`.
- **Exact Root Cause**:
  - Confirmed via repo-wide `grep`: **zero components or routes in the entire codebase subscribe to `language` to translate text**, and **zero translation dictionaries exist**.
  - **100% of UI strings are hardcoded**: active terminal routes (`default`, `crypto`, `finance`, `treemap`, `analytics`, `chat`, `infrastructure`, `academy`, `profile`, `roles`, `auth/v2/*`, `sidebar-items.ts`, `HotkeyEngine.tsx`, `LiveAssetChart.tsx`, `MarketTreemap.tsx`) are hardcoded in Russian, while `SearchDialog` (`search-dialog.tsx:139,146,148`), `LayoutControls` (`layout-controls.tsx:70-245`), `ThemeSwitcher` (`theme-switcher.tsx:25`), `NotFound`, `RootError`, `unauthorized.tsx`, and `dashboard/$.tsx` are hardcoded in English. `pages.config.ts:23-26` only has `titleRu`/`titleEn` (missing `titleAz`) and is never read by `AppSidebar`.

#### Bug 3.4 — Theme (`tangerine`), Sidebar (`floating`), Density (`bloomberg` only), & Server Persistence
- **Theme Preset & Sidebar Style (`tangerine` + `floating`)**:
  - `src/styles/styles.css:8` already imports `./presets/tangerine.css` (`[data-theme-preset="tangerine"]`), and `src/lib/preferences/theme.ts:39-45` & `layout.ts:5` already define `"tangerine"` and `"floating"`.
  - However, `src/lib/preferences/preferences-config.ts:65` sets `theme_preset.defaultValue: "default"` and `line 93` sets `sidebar_variant.defaultValue: "sidebar"`.
  - And `LayoutControls` (`src/routes/(main)/dashboard/-components/header/layout-controls.tsx`) is **not rendered anywhere** — neither in the header nor in the Settings page (`roles/route.tsx`)!
- **Interface Density (`bloomberg` only)**:
  - Defined in `src/framework/terminal-store.ts:7,15,61,84` (`export type DensityMode = "comfortable" | "compact"`, default `"comfortable"`), consumed in `src/framework/templates/TerminalPageShell.tsx:19-20` (`density === "compact" ? "space-y-3" : "space-y-5"`), and toggled in `src/routes/(main)/dashboard/roles/route.tsx:63-83` (`Apple (Comfortable)` vs `Bloomberg (Compact)`).
  - Also seeded in `backend/app/modules/auth/router.py:173` (`"density": "comfortable"`).
- **Zero Server Persistence**:
  - Backend **already provides** `GET /api/v1/profile/me` (`preferences` JSONB field, `profile/router.py:55`) and `PATCH /api/v1/profile/preferences` (`profile/router.py:88-97`).
  - Frontend **never reads `profile.preferences` on session load** (`dashboard/route.tsx:39-55` ignores `preferences`!) and **never calls `PATCH /profile/preferences`** when changing theme, font, sidebar style/order/visibility, language, UTC timezone, ticker tape, sound, hotkeys, or chart indicators/drawings (`LiveAssetChart.tsx:157,173` uses `localStorage` `ht_drawings_${asset}` only; `analytics/route.tsx` & `treemap` filters are ephemeral React state).

#### Bug 3.5 — Header, Sidebar Footer, Lock Screen & Login Right-Hand Panel
- **Header (`dashboard/route.tsx:99-124` + `TerminalHeaderControls.tsx:23-91`)**:
  - Currency button `USD`/`USC` (`TerminalHeaderControls.tsx:25-33`) + `Shift+C` (`HotkeyEngine.tsx:11,53-57`): user explicitly requested removing currency selector from header (`ORIGINAL_REQUEST.md:122`).
  - Timezone button (`TerminalHeaderControls.tsx:59-68`) + `Shift+T` (`HotkeyEngine.tsx:12,58-62`): cycles `UTC -> Asia/Baku -> Exness` inline in header; user requested **removing inline timezone switching from header** (timezone configured only in Settings and saved on server) and **placing the live UTC clock right next to the user profile avatar in the header** (`ORIGINAL_REQUEST.md:37-39`), instead of inside `BloombergTickerTape.tsx:57-62`.
  - `SearchDialog` (`search-dialog.tsx:85,139-141`): uses `⌘J` instead of `⌘K` (conflicting with `DEFAULT_HOTKEYS["command.palette"] = "Mod+K"` in `terminal-store.ts:38`!) and hardcoded English text.
- **Duplicate User Menu in Sidebar Footer**:
  - `AppSidebar` (`src/routes/(main)/dashboard/-components/sidebar/app-sidebar.tsx:60-62`) renders `<SidebarFooter><NavUser user={currentUser} /></SidebarFooter>` (`nav-user.tsx:1-98`), duplicating `AccountSwitcher` (`account-switcher.tsx:1-66`) in the top-right header (`ORIGINAL_REQUEST.md:41`).
- **Lock Screen / Login Screen Menu Item**:
  - Earlier `sidebar-items.ts` had `"Экран входа (Passkey)"` in the left sidebar; user requested moving **Lock Screen (`Блокировка экрана`)** into the **top-right Profile dropdown (`AccountSwitcher`)** (`ORIGINAL_REQUEST.md:43`) so the owner can lock the terminal in 1 click (requiring Passkey / Password+2FA to unlock) without cluttering the sidebar.
- **Login Right-Hand Panel Copy (`src/routes/(main)/auth/v2/route.tsx:16-52`)**:
  - Line 40 hardcodes `"XAUUSD & USTEC (USD / USC) в реальном времени без влияния на скорость роботов"` and `login/route.tsx:183` hardcodes `"Asia/Baku • NetBird"`. Must be replaced with asset-agnostic, institutional multi-asset desk copy (`ORIGINAL_REQUEST.md:128`).

#### Bug 3.6 — Skeletons, Loading States, Toasts & Sound Synthesis
- **Skeletons (`src/components/ui/skeleton.tsx:1-14`)**:
  - Currently just `className={cn("animate-pulse rounded-md bg-muted", className)}` (static opacity pulse, **not** a left-to-right animated shimmer sweep) and **never used on any terminal page** (`grep <Skeleton` matched only `src/components/ui/sidebar.tsx:618,623`).
- **Button Loading States**:
  - Forms across `default/route.tsx:249`, `profile/route.tsx:238,507,540`, `infrastructure/route.tsx:167,267`, `academy/route.tsx:64`, `LiveAssetChart.tsx:533` have **no spinner + `"Идёт загрузка..."` / `"Сохранение..."` disabled state** during async mutations (`ORIGINAL_REQUEST.md:14`).
- **Toast Notifications (`src/components/ui/toast.tsx:1-235`)**:
  - `<Toaster />` (`@base-ui/react/toast`) is already mounted in `__root.tsx:106` with viewport `bottom-4 sm:right-4` (`toast.tsx:25`), **but `toast.add(...)` is called 0 times across all active terminal pages**! Pages either render plain inline divs (`notice`, `statusMsg`, `formError`) or silently swallow errors (`catch(() => {})`). User requested polished right-side toast notifications on every save/action/error (`ORIGINAL_REQUEST.md:16`).
- **Sound Toggle & Audio Consistency (`src/framework/sound-engine.ts:1-68`)**:
  - `TerminalHeaderControls.tsx:49-53` manually ran `if (next) soundEngine.tradeOpen(true);`, whereas `roles/route.tsx:136` called `onClick={toggleSound}` directly on `useTerminalStore`, which only flipped `soundEnabled` (`terminal-store.ts:72`) with **zero sound preview** (`ORIGINAL_REQUEST.md:28`)! Furthermore, saves/notifications/errors across pages don't trigger consistent subtle audio cues when `soundEnabled` is ON.

#### Bug 3.7 — WebSockets, 1-Second Clock & Asset/Market/Index Logos
- **Why `WebSocket Connection Established 1795546543.078971` Appears & Unclear Status (`ORIGINAL_REQUEST.md:35`)**:
  - That exact tab-separated line (`WebSocket Connection Established\t1795546543.078971`) is Chrome DevTools' Network -> WS frame log when `/api/v1/ws/live` (`backend/app/modules/charts/router.py:245-253` + `backend/app/core/ws_hub.py:16-20`) accepts the socket and **never sends an initial welcome/snapshot frame or periodic server heartbeat**!
  - Furthermore:
    1. `useLiveTerminalSocket` (`src/framework/use-live-socket.ts:11-77`) is **only mounted on `/dashboard/analytics`** (`analytics/route.tsx:87`) — **not** at the `DashboardLayout` level (`dashboard/route.tsx`), **not** on `/dashboard/default` (balances/equities/robots), **not** on `/dashboard/crypto` (`LiveAssetChart`), and **not** on `/dashboard/chat` (news) or `BloombergTickerTape`!
    2. Even on `/dashboard/analytics`, `useLiveTerminalSocket()` is called with **no `onEvent` handler**, so incoming WS messages update nothing in the UI!
    3. Backend `ws_hub.py` is an in-process `set[WebSocket]` with **no Redis Pub/Sub subscriber**, so events produced in `terminal-worker` (breaking news, treemap updates, alerts) never reach browser WebSocket clients connected to `terminal-backend`, and `/api/v1/ws/live` has no cookie/token auth check!
- **Why Seconds Jump on Robots/Accounts Page (`ORIGINAL_REQUEST.md:108`)**:
  - `frontend/src/routes/(main)/dashboard/default/route.tsx:93-96`:
    ```tsx
    useEffect(() => {
      const id = setInterval(() => setNowUtc(new Date()), 5000);
      return () => clearInterval(id);
    }, []);
    ```
    Line 262 formats `nowUtc.toISOString().slice(11, 19)` (`HH:MM:SS`), so seconds jump in 5-second leaps instead of ticking every `1000ms` aligned to wall-clock second boundaries!
- **Reliable Asset, Market, Index, FX, Crypto, Commodity & Equity Logos (`ORIGINAL_REQUEST.md:114`)**:
  - Currently zero asset/company logos are rendered anywhere (only generic Lucide icons `Coins`/`Cpu`/`Bot`).
  - **Already in repo**: `src/styles/flag-icons/flags.css` (203 KB offline inline-SVG ISO flags for every country/currency `US`, `EU`, `GB`, `JP`, `CH`, `AU`, `CA`, `NZ`, `AZ`, `CN`, etc.) + `simple-icons` (`^16.38.1`)!
  - **Best Zero-Failure Multi-Tier Logo Architecture** (`<AssetLogo symbol={...} category={...} />` component with automatic fallback):
    1. **FX Pairs (`EURUSD`, `GBPUSD`, `USDJPY`, `USDRUB`, `USDCHF`, etc.)**: Dual overlapping circular SVG flags directly from bundled `flags.css` (`EUR`->`EU`, `USD`->`US`, `GBP`->`GB`, `JPY`->`JP`, `AUD`->`AU`, `CAD`->`CA`, `CHF`->`CH`, `NZD`->`NZ`, `AZN`->`AZ`) — **100% offline, 0ms latency, never fails**.
    2. **Precious Metals, Commodities & Major Indices (`XAUUSD`, `XAGUSD`, `USOIL`/`CL=F`, `UKOIL`/`BZ=F`, `NG=F`, `USTEC`/`NDX`/`NASDAQ-100`, `SPX`/`US500`/`S&P 500`, `US30`/`DJI`, `DE40`/`DAX`, `DXY`, `VIX`, `US10Y`)**: Curated crisp local SVG badge set in `public/logos/markets/` (Au 999.9 Gold bar badge, Ag Silver badge, Brent/WTI barrel, S&P 500 `500`, NASDAQ `100`, Dow `30`, DXY `$`, VIX) — **100% offline, institutional look**.
    3. **Cryptocurrencies (`BTC`, `ETH`, `SOL`, `XRP`, `BNB`, `USDT`, etc.)**: `@bitgo-forks/cryptocurrency-icons` / `cryptocurrency-icons` SVGs (or jsDelivr/self-hosted SVG pack).
    4. **Global Equities & ETFs (S&P 500 / NASDAQ-100: `NVDA`, `AAPL`, `MSFT`, `AMZN`, `GOOGL`, `META`, `TSLA`, `BRK-B`, `JPM`, `LLY`, `XOM`, `GDX`, `NEM`, etc.)**:
       - Primary: Self-proxied/cached endpoint `GET /api/v1/assets/logo/{symbol}` (or direct `<img loading="lazy">`) backed by **Elbstream Free Stock/ETF Logo CDN** (`https://api.elbstream.com/logos/symbol/{TICKER}?format=svg`) / **FinancialModelingPrep image CDN** (`https://financialmodelingprep.com/image-stock/{TICKER}.png`) / **TickerLogos CDN** (`https://cdn.tickerlogos.com/{domain}`).
       - Automatic `onError` fallback: deterministic colored monogram avatar (`NV`, `AA`, `MS`) matching sector palette so **zero broken image icons ever appear**.

---

## 2. Logic Chain

1. **Why multiple pages appear "fake" or "empty" simultaneously** (`MarketTreemap.tsx:29-90`, `chat/route.tsx:312`, `backend/app/core/config.py:37`, `deploy/docker-compose.yml:65`):
   - In Docker (`backend/Dockerfile:14,18`), `config.py` lives at `/app/app/core/config.py` (`parents[3]` = `/`), so `config_dir` defaults to `/config` while YAML configs are at `/app/config`. Every call to `load_yaml_config(...)` returns `{}`.
   - Simultaneously, `terminal-backend` (`deploy/docker-compose.yml:65`) is attached only to `internal: true` networks (`panel_internal`, `exness_mt5_ingest`, `panel_docker_proxy`) without `panel_egress`, so on-demand backend requests to RSS feeds (`/intelligence/news/refresh`), Yahoo Finance (`/charts/explore`), Gemini API (`/intelligence/ai/analyze`), GeoIP (`/auth/ip-lookup`), and Telegram (`/ops/alerts/test`) cannot reach the internet.
   - On the frontend, `MarketTreemap.tsx:82-89` masks the empty response by initializing state with `PREVIEW_TREEMAP` and ignoring empty `sectors: []`, making S&P 500 / Gold / `1W` / `1M` / `YTD` buttons appear completely dead while displaying fake NASDAQ-100 numbers; meanwhile `chat/route.tsx:312-314` renders `"Загрузка реестра источников..."` whenever `sources.length === 0`, making Verified Sources look perpetually stuck loading.
2. **Why auth breaks across downloads, incognito, and container actions** (`api-client.ts:3-45`, `auth/router.py:127-135`, `deps.py:24-36`):
   - Storing `accessToken` solely in `sessionStorage` breaks cross-tab links and browser downloads (`window.open`), which rely on cookies; not setting `ht_access_token` HttpOnly cookie (despite `deps.py:26` checking for it!) causes `401 Authentication required` on `bridge.set` and `statement.csv`.
   - Omitting a `401` refresh-and-retry interceptor in `api-client.ts` guarantees that every user session starts throwing `Invalid or expired token` on button clicks (`mt5-xau` / `mt5-ustec` Restart/Start/Stop, etc.) 30 minutes after login.
3. **Why UI customization feels broken** (`terminal-store.ts`, `preferences-config.ts`, `roles/route.tsx`, `app-sidebar.tsx`, `HotkeyEngine.tsx`):
   - Three separate state silos exist (`useTerminalStore` in `localStorage`, `PreferencesStore` in cookies, and `user.preferences` in PostgreSQL), none of which sync to `/profile/preferences`, and two UI editors (`Sidebar Customizer` and `Hotkey Editor`) write to store fields (`hiddenPageIds`, `customHotkeys`) that the rendering/listener components (`AppSidebar`, `HotkeyEngine`) never read.

---

## 3. Caveats

- **Read-Only Scope**: Per explorer constraints, no files in `/home/antigravity/Huseynovlar/huseynovlar-terminal` were modified; TypeScript (`tsc --noEmit`) and Biome (`biome lint src`) checks were executed strictly read-only.
- **Backend Overlap**: While Survey Explorer 2 focused on the frontend, critical backend contract boundaries (`auth/router.py`, `deps.py`, `config.py`, `ws_hub.py`, `ops/router.py`, `deploy/docker-compose.yml`) were inspected read-only wherever necessary to prove the exact end-to-end root cause of frontend symptoms (Passkey `TypeError`, cookie downloads, empty news/sources, `mt5-xau`/`mt5-ustec` actions, and WebSocket silence). Coordinate backend changes with the backend explorer/implementer.

---

## 4. Conclusion — Actionable Frontend Fix & Redesign Blueprint

### 4.1 Core Infrastructure (`src/framework/`)
1. **`api-client.ts` — Bulletproof Auth, Auto-Refresh & Downloads (Works in Incognito too)**:
   - Have backend `_issue_session_tokens` (`auth/router.py:127`) also set an `HttpOnly; Secure; SameSite=Lax; Path=/api/v1` cookie `ht_access_token` (and `Path=/api/v1/auth` `ht_refresh_token` with `SameSite=Lax` so top-level navigations work cleanly).
   - Add a single-flight **401 Refresh Interceptor** in `apiRequest`: on `res.status === 401` (for non-auth endpoints), await a shared `refreshPromise` calling `POST /api/v1/auth/refresh` (`credentials: "include"`), update `accessToken`, and transparently retry the original `fetch` once; only redirect to `/auth/v2/login` if refresh itself returns `401`.
   - Add `apiDownload(path: string, fallbackFilename: string)` helper using authenticated `fetch` (with `Authorization: Bearer` + `credentials: "include"` + 401 retry) -> `res.blob()` -> temporary `<a download>` click + `URL.revokeObjectURL`. Use this for `bridge.set`, `ExnessPanelBridge.mq5`, `ExnessPanelHook.mqh`, CSV/Excel statement exports, and JSON exports — **works 100% in Incognito even if third-party cookies are restricted, while `ht_access_token` cookie also makes direct URLs work in the browser bar!**
2. **WebAuthn Binary/JSON Helpers (`src/framework/webauthn.ts`)**:
   - Implement `base64urlToUint8Array(str)` and `uint8ArrayToBase64url(buf)`.
   - `prepareCreationOptions(json)`: convert `challenge`, `user.id`, and `excludeCredentials[].id` to `Uint8Array` before `navigator.credentials.create({ publicKey })`.
   - `prepareRequestOptions(json)`: convert `challenge` and `allowCredentials[].id` to `Uint8Array` before `navigator.credentials.get({ publicKey })`.
   - `serializeCredential(cred)`: use `cred.toJSON()` if supported by browser, with explicit fallback encoding `rawId`, `response.clientDataJSON`, `attestationObject` / `authenticatorData`, `signature`, `userHandle`, and `getTransports?.()` to base64url strings.
3. **Full `RU / EN / AZ` i18n System (`src/framework/i18n/`)**:
   - Create typed dictionaries `ru.ts`, `en.ts`, `az.ts` + `useI18n()` hook (`const { t, lang, setLanguage } = useI18n()`) wired to unified server-persisted preferences, updating `<html lang={lang}>` dynamically, translating **100% of sidebar labels, headers, buttons, tables, dialogs, toasts, empty states, and login/lock screens**.
4. **Unified Server-Persisted Preferences (`tangerine` + `floating` + `bloomberg`-only density)**:
   - In `src/lib/preferences/preferences-config.ts`: change `theme_preset.defaultValue = "tangerine"` (`line 65`) and `sidebar_variant.defaultValue = "floating"` (`line 93`).
   - Remove `Apple (Comfortable)` density everywhere: lock layout spacing to compact **Bloomberg** density (`space-y-3`, compact tables/headers) and delete the density toggle from `roles/route.tsx:63-83` and `terminal-store.ts`.
   - Merge/bridge `PreferencesStore` (`theme_preset`, `theme_mode`, `font`, `sidebar_variant`, `sidebar_collapsible`, `content_layout`, `navbar_style`) + `useTerminalStore` (`language`, `timezone` defaulting to `UTC`, `privacyMode`, `tickerEnabled`, `tickerSpeed`, `soundEnabled`, `hiddenPageIds`, `sidebarOrder`, `customHotkeys`, `chartPrefs`, `drawings`, `analyticsFilters`, `treemapFilters`) with **debounced `PATCH /api/v1/profile/preferences`** + hydration from `GET /api/v1/profile/me` in `DashboardLayout`!
5. **Global Shimmer `<Skeleton>`, `<SubmitButton>`, Right-Side Toasts & Unified Sound**:
   - Upgrade `src/components/ui/skeleton.tsx` to a crisp **left-to-right animated shimmer** (`relative overflow-hidden bg-muted/60 before:absolute before:inset-0 before:-translate-x-full before:animate-[ht-shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-foreground/10 before:to-transparent`) and add reusable `<PageSkeleton>`, `<TableSkeleton>`, `<ChartSkeleton>`, and `<CardGridSkeleton>` used on every page and in `DashboardLayout` session check.
   - Add `loading?: boolean` + `loadingText?: string` (localized `"Идёт загрузка..."` / `"Loading..."` / `"Yüklənir..."` + `<Loader2 className="size-3.5 animate-spin" />`) to `Button` / `<AsyncButton>` and wire to **every** save, auth, refresh, and container action.
   - Standardize right-side toast notifications (`toast.add({ title, description, type: "success" | "error" | "info" })`, positioned top-right or bottom-right cleanly) on every save, create, edit, delete, copy, download, and error.
   - Move preview chime (`soundEngine.uiConfirm()` / `soundEngine.tradeOpen(true)`) inside the store's `setSoundEnabled(next)` action itself so toggling sound ON from **either** Header or Settings plays the exact same confirmation sound (`ORIGINAL_REQUEST.md:28`).
6. **Global Real-Time WebSocket Provider (`LiveSocketProvider` in `DashboardLayout`) & 1-Second Clock**:
   - Mount a single authenticated WebSocket connection (`/api/v1/ws/live`) at `DashboardLayout` level with `15s` ping/pong keepalive, server `welcome` + initial portfolio summary frame on connect (eliminating mysterious empty `WebSocket Connection Established` DevTools logs!), Redis Pub/Sub bridge on backend so `worker` events stream live, and an interactive WS status pill (`LIVE • 12ms` / `RECONNECTING`) in the header.
   - Broadcast and apply live updates to **Total & Account Balances/Equity/Floating PnL, Robot states, Open Positions & Live Chart ticks/candles, Breaking News wire & Ticker Tape, and Container states**.
   - Replace `setInterval(..., 5000)` (`default/route.tsx:94`) with a shared **`useUtcClock(1000)`** hook ticking smoothly every **1000ms**!
7. **Header, Sidebar, Lock Screen & Login Hero Cleanup**:
   - **Header (`dashboard/route.tsx` + `TerminalHeaderControls.tsx`)**:
     - Remove `USD/USC` currency button (`TerminalHeaderControls.tsx:25-33`).
     - Remove clickable timezone cycler (`TerminalHeaderControls.tsx:59-68`); render a read-only live 1-second clock (`19:42:08 UTC`) **immediately to the left of `AccountSwitcher` (profile avatar)** (`ORIGINAL_REQUEST.md:37-39`).
     - Keep clean quick-toggles: `Cmd+K` Command Palette (`SearchDialog` fixed to `Mod+K` + i18n + asset/account/page search), `WS Live` status badge, `Privacy Mode (Shift+M)`, `Sound`, `Ticker Tape`, `Language (RU/EN/AZ)`, `Theme Mode`, `Clock (UTC)`, and `Profile Dropdown` (`AccountSwitcher`).
   - **Sidebar (`app-sidebar.tsx`)**:
     - Remove `<SidebarFooter><NavUser /></SidebarFooter>` (`ORIGINAL_REQUEST.md:41`).
     - Wire `AppSidebar` & `HotkeyEngine` directly to the single unified `TERMINAL_PAGES` registry + `hiddenPageIds` + `customHotkeys` so Sidebar Customizer and Hotkey Editor actually work!
   - **Lock Screen**:
     - Add **"Заблокировать экран" (Lock Screen)** inside `AccountSwitcher` (`account-switcher.tsx`) (`ORIGINAL_REQUEST.md:43`) + optional hotkey `Shift+L`, locking the UI behind a Passkey / Password+2FA unlock screen without destroying server preferences.
   - **Login Right Panel (`auth/v2/route.tsx:16-52`)**:
     - Replace `XAUUSD & USTEC` / `Exness`-narrow text with institutional multi-asset quantitative trading, risk analytics, global market intelligence, AI co-pilot, and zero-trust infrastructure copy (`ORIGINAL_REQUEST.md:128`).

### 4.2 Clean Multi-Page Information Architecture & Full CRUD + Detail Views (Purging All 26 Demo Template Routes)
Delete all 26 unused Studio Admin demo routes (`crm`, `ecommerce`, `file-manager`, `hr`, `invoice`, `kanban`, `logistics`, `mail`, `patient-monitoring`, `productivity`, `products`, `tasks`, `coming-soon`, `(legacy)/*`, `auth/v1/*`, `auth/v2/register`, standalone `/chat` & `/mail`, `src/data/users.ts`, and orphan `-components/*` in repurposed folders) and organize clean, dedicated routes where **every entity has List + Create + Detail View + Edit + Delete** without cramming unrelated modules onto one page (`ORIGINAL_REQUEST.md:45,49,94-96,102-117`):

| Nav Group | Clean Dedicated Route(s) | Purpose & Full CRUD / View Scope |
|---|---|---|
| **1. Терминал (Desk)** | `/dashboard` (Home Overview) | Institutional **Home Page**: live WS aggregated Balance/Equity/Floating PnL, Global Market Sessions (`1s` clock), Active Accounts summary, Active Robots pulse, Top Breaking News, Upcoming High-Impact Calendar countdown, Mini Market Heatmap |
| | `/dashboard/terminal` (Live Charts & Trading Desk) | Full TradingView Lightweight Charts (`M1`–`W1`), **real** MT5 Bid/Ask/Spread (no fake DOM numbers!), server-persisted drawings & indicators, multi-account/robot filter, click-to-focus Open Positions & Deals |
| | `/dashboard/assets` & `/dashboard/assets/$assetCode` | **Asset Hubs & Global Asset Explorer**: CRUD for tracked assets/watchlist with **Asset Logos** (`<AssetLogo>`), instant search of any global symbol, and **Asset Hub Detail View** combining live chart, account/robot stats, **real filtered news summary & feed**, and upcoming macro events on the same hub (`ORIGINAL_REQUEST.md:55,104`) |
| | `/dashboard/accounts` & `/dashboard/accounts/$accountId` | **Trading Accounts & Exness Profiles**: List + Create + **Account Detail View** (equity curve, open positions, deals, linked robots, `.set` download, API key rotation, connection status) + **Edit** + **Delete**, with clear UI explanation of Terminal `X-Account-Api-Key` (`htk_...`) vs optional Exness Personal Area API key |
| | `/dashboard/robots` & `/dashboard/robots/$robotId` | **Dedicated Trading Robots Page**: List (with smooth **1-second** live uptime/telemetry clock) + **Create** + **Robot Detail View** (live IPC state from `ExnessPanelHook.mqh`, performance metrics, deal history, magic number) + **Edit** + **Delete** + one-click authenticated **`.mq5` (`ExnessPanelBridge.mq5`), `.mqh` (`ExnessPanelHook.mqh`), and `.set` downloads** (`ORIGINAL_REQUEST.md:94,108`) |
| | `/dashboard/journal` & `/dashboard/journal/$entryId` | **Deals, Orders & Treasury/Transfer Journal**: Unified filterable ledger of all closed deals, open orders, and `DEAL_TYPE_BALANCE` operations (Deposits, Withdrawals, Internal Transfers, Exness Vault) + server-saved Vault Target + manual notes CRUD + **Detail View** per deal/transfer + authenticated CSV/Excel/PDF statement export (`ORIGINAL_REQUEST.md:57`) |
| **2. Рынок и ИИ (Market & AI)** | `/dashboard/treemap` | **Full-Size Global Market Treemap**: Large viewport proportional Finviz/StockCharts treemap with **real live/cached market data** (**delete `PREVIEW_TREEMAP` fake fallback**), working filters (Universe: S&P 500, NASDAQ-100, Dow 30, Global ETFs, Forex, Crypto, Gold & Commodities; Period: `1D/1W/1M/3M/YTD`; Sector filter; Size metric; Ticker search), **Company/Asset Logos**, and **click-tile Detail Drawer/View** (mini chart + live news) (`ORIGINAL_REQUEST.md:12,112,114`) |
| | `/dashboard/analytics` | **Deep Analytics & Risk Lab**: Working filter bar (**Date Range, Account, Asset, Robot/MagicNumber, Currency** — persisted on server) + Equity/Drawdown, Hourly/Session TCA, Symbol/Account/Robot matrices, Correlation/Risk metrics, and **Drilldown Detail Views** (`ORIGINAL_REQUEST.md:98,116`) |
| | `/dashboard/calendar` | **Real Economic & PnL Calendar**: Replace demo FullCalendar with **real Economic Calendar** (`/intelligence/calendar`: High/Medium/Low impact filter, Country flag from `flags.css`, Asset filter, live countdown, Actual/Forecast/Previous, **Event Detail View**) + toggleable **Daily PnL Calendar View** (`ORIGINAL_REQUEST.md:10`) |
| | `/dashboard/news` & `/dashboard/news/$newsId` | **World News Wire & Verified Sources Registry**: Dynamic filter by **user's added DB assets + Watchlist + free-text search** (`ORIGINAL_REQUEST.md:51`), Verified `✓` filter, cross-source corroboration badges, **News Article Detail View**, and **Verified/Custom RSS Sources Registry CRUD** (no Gemini crammed here) |
| | `/dashboard/ai` | **Dedicated Google AI (Gemini) Co-Pilot Page** (`ORIGINAL_REQUEST.md:52`): Separate page with Morning Briefing, Risk Audit, Post-Mortem, Saved Briefings History + Detail View, model selector, and clear link/instructions if Gemini API key is not configured |
| **3. Инфраструктура (Operations)** | `/dashboard/containers` & `/dashboard/containers/$name` | **MT5 / OS Docker Containers & Kill-Switch**: Real containers (`mt5-xau`, `mt5-ustec`), working Restart/Start/Stop/Logs (with 401 refresh + DB-registered container allowlist support), **Container Detail View**, Edit, Delete, and Account-dropdown Kill-Switch (`ORIGINAL_REQUEST.md:26`) |
| | `/dashboard/setup` (Instructions & Wiki) | **Setup Wizard, Downloads & Editable Wiki**: Account dropdown (not raw UUID!) for 1-click `.set` + `.mq5` + `.mqh` downloads, **valid dotted WebRequest URL** (`https://terminal.huseynovlar.org` or `http://ingest.terminal.local:8000` Docker network alias so MT5 accepts it without `err=4014`!), step-by-step Dual-EA guide (Chart 1 = `NasdaqPulse`, Chart 2 = `ExnessPanelBridge`, plus optional `ExnessPanelHook.mqh`), complete API keys guide (Exness Personal Area vs Terminal `htk_...`, Gemini key, Webhook in `.env`), and **Editable Markdown Wiki CRUD** (`ORIGINAL_REQUEST.md:18,47,84,89,100`) |
| **4. Система (System)** | `/dashboard/profile` | **Personal Profile**: Dedicated Profile View & Edit page (avatar, display name, bio, contacts/links) (`ORIGINAL_REQUEST.md:49`) |
| | `/dashboard/security` | **Security, 2FA & Passkeys**: Dedicated page for Password Change, full **2FA TOTP Setup/Verify/Disable QR Wizard**, FIDO2 **WebAuthn Passkeys** (with fixed `BufferSource` serialization), and streamlined Secret Vault (only Gemini API key / optional Telegram endpoint, keeping internal secrets in `.env` per `ORIGINAL_REQUEST.md:47`) |
| | `/dashboard/sessions` | **Active Sessions & Login/Audit History**: Dedicated page (or sub-tabs/routes `/dashboard/sessions` & `/dashboard/audit`) with **Session Detail View**, **Login History & Audit Log Detail View**, filters, and interactive **IP Geolocation Map** (`ORIGINAL_REQUEST.md:45,49`) |
| | `/dashboard/users` | **Users Management CRUD**: Replace Studio Admin fake `Arham Khan` table with real Terminal Users List, Create (`ADMIN` / `VIEWER`), Detail View, Edit Role/Active Status, Reset Password/Sessions, and Delete (`ORIGINAL_REQUEST.md:45`) |
| | `/dashboard/settings` | **System Preferences, Theme (`tangerine` + `floating`), Sidebar & Hotkeys**: Unified server-persisted Preferences page combining Theme Preset (`tangerine` default), Font, Theme Mode, Sidebar Variant (`floating` default), Sidebar Collapse Mode, Page Layout, Navbar Style, Language (`RU/EN/AZ`), Timezone (`UTC` default), Ticker Tape, Sound (with preview chime!), working Sidebar Customizer, and working F13–F24 Hotkey Editor (`ORIGINAL_REQUEST.md:8,22,28,37,98`) |

---

## 5. Verification Method

Any agent can independently verify every observation in this report using the following read-only commands in `/home/antigravity/Huseynovlar/huseynovlar-terminal`:

1. **Verify Stack, TypeScript Errors & Biome Lint Diagnostics**:
   ```bash
   ./node_modules/.bin/tsc --noEmit
   ./node_modules/.bin/biome lint src
   ```
   *(Run with `Cwd=/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend` — confirms TanStack Start + Vite 8 stack, 4 TS errors, and 28 Biome errors.)*

2. **Verify Zero i18n Dictionary, Single-Page WS Usage, Zero Skeletons & Zero Active Toasts**:
   ```bash
   grep -rn 'language\|useLiveTerminalSocket\|toast\.\|<Skeleton' '/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/src'
   ```

3. **Verify Specific Bug Locations by File & Line**:
   - WebAuthn `TypeError`: inspect `frontend/src/routes/(main)/dashboard/profile/route.tsx:214-235` and `frontend/src/routes/(main)/auth/v2/login/route.tsx:58-77`.
   - `sessionStorage`-only token & missing 401 refresh: inspect `frontend/src/framework/api-client.ts:1-46`, `backend/app/modules/auth/router.py:127-135`, and `backend/app/core/deps.py:24-36`.
   - Fake `PREVIEW_TREEMAP` & dead S&P 500 buttons: inspect `frontend/src/framework/components/MarketTreemap.tsx:29-90` and `backend/app/core/config.py:37` vs `backend/Dockerfile:14,18`.
   - Untouched demo Calendar: inspect `frontend/src/routes/(main)/dashboard/calendar/-components/calendar.tsx:17,113,125` and `events-data.ts:8-22`.
   - 5-second clock jump on Accounts & Robots page: inspect `frontend/src/routes/(main)/dashboard/default/route.tsx:93-96,262`.
   - Sound toggle inconsistency & disconnected Sidebar/Hotkey editors: inspect `frontend/src/routes/(main)/dashboard/roles/route.tsx:136,148-167,190-200` vs `TerminalHeaderControls.tsx:49-53`, `app-sidebar.tsx:58`, and `HotkeyEngine.tsx:46-93`.
   - Post-implementation invalidation condition: once fixed, `npm run generate-routes && npx tsc --noEmit && npm run check && npm run build` in `frontend/` and `ruff check app tests && pytest -v` in `backend/` must all exit `0`, with zero `PREVIEW_*` / `demoEvents` / `src/data/users.ts` mock symbols remaining in `frontend/src`.
