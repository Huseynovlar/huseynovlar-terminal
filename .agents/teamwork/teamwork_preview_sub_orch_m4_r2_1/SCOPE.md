# SCOPE — Milestone 4 (`M4`): Frontend Core Framework, Shell, i18n, Demo Purge & System/Ops Pages (`r2_1`)

- **Status**: `IN_PROGRESS`
- **Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Exclusive Write Ownership**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/**`
  - **STRICTLY FORBIDDEN**: Modifying/creating/deleting ANY file outside `frontend/**` (`backend/`, `deploy/`, `mql5/`, `config/`, `worker/`, `e2e/`, `docs/`, `PROJECT.md`), placing code/tests in `.agents/teamwork/`, or running `git commit` / `git push`.
  - **Verifier Diff Baseline**: Reviewers, Challengers, and Forensic Auditor MUST inspect `git diff eae5685 -- frontend/` (plus `git status -- frontend/` for untracked files) against pre-overhaul base SHA `eae5685` so wave checkpoint commits on `PROJECT.md`/`.agents/teamwork/` never obscure M4 frontend diffs.

## Stack & Architectural Context
- **TanStack Start** (`@tanstack/react-start` + TanStack Router file-based routing in `src/routes/` -> `src/routeTree.gen.ts` + React 19 + Vite 8 + Nitro SSR + Tailwind CSS v4 + `@base-ui/react` shadcn `base-nova` + Zustand + Lucide + `flags.css`) — **NOT Next.js**.
- Note on `@base-ui/react` (`^1.9.0`) shadcn `base-nova`: Base UI uses `render={<Component />}` composition instead of Radix `asChild`, and provides `@base-ui/react/dialog` and `@base-ui/react/alert-dialog` primitives.

## Mandatory Acceptance Criteria & Deliverables (`PROJECT.md` `F01–F36`)

### 1. ZERO Native Browser Dialogs (`F34` — NON-NEGOTIABLE)
- Build clean, reusable, Bloomberg-styled `@base-ui/react` shadcn modal components in `frontend/src/components/ui/` (`dialog.tsx`, `alert-dialog.tsx`, plus ergonomic imperative/declarative `ConfirmDialog` and `PromptDialog` helpers/provider if helpful).
- Replace **100% of `window.confirm`, `window.prompt`, and `window.alert` / `alert()`** calls across the ENTIRE `frontend/src` tree (both M4 pages AND any existing M5 route files in `frontend/src` if any exist!).
- Hard verification invariant: `grep -rn 'window\.\(confirm\|prompt\|alert\)\|\balert(' frontend/src` MUST return **0 matches**!

### 2. Studio Admin Demo Purge & Zero TS / Biome Diagnostics (`F33`)
- Delete all 26 Studio Admin demo routes, mock data, and leftover template components:
  - `src/routes/(main)/chat/` (top-level `/chat` demo messenger — NOT `/dashboard/chat` which M5 upgrades)
  - `src/routes/(main)/mail/` (top-level `/mail` demo client)
  - `src/routes/(main)/auth/v1/` (`login`, `register`)
  - `src/routes/(main)/auth/v2/register/`
  - Localize `src/routes/(main)/unauthorized.tsx`, `src/routes/(main)/dashboard/$.tsx`, `src/routes/-components/not-found.tsx`, and `src/routes/-components/root-error.tsx` cleanly using `useI18n()` (removing demo copy and fixing TS `error: unknown` typing).
  - Delete `src/routes/(main)/dashboard/(legacy)/`, `crm/`, `ecommerce/`, `file-manager/`, `hr/`, `invoice/`, `kanban/`, `logistics/`, `mail/`, `patient-monitoring/`, `productivity/`, `products/`, `tasks/`, `coming-soon/`.
  - Replace demo `src/routes/(main)/dashboard/users/` with real RBAC Users Management CRUD + Detail View (`/dashboard/users`, `/new`, `/$userId`, `/$userId/edit`).
  - Convert legacy `/dashboard/infrastructure`, `/dashboard/academy`, and `/dashboard/roles` into clean client/router redirects to `/dashboard/containers`, `/dashboard/setup`, and `/dashboard/preferences` respectively (deleting their unused `-components/*` template bloat) so old bookmarks never 404.
  - Delete `src/data/users.ts`, `support-card.tsx`, `nav-user.tsx`, and unused Studio Admin `-components/*` template files in repurposed M4 folders.
- Gate `<TanStackDevtools>` in `src/routes/__root.tsx` behind `import.meta.env.DEV`.
- Import `src/styles/flag-icons/flags.css` cleanly in `src/styles/styles.css`.
- Keep existing M5 routes (`/dashboard/default`, `/dashboard/crypto`, `/dashboard/finance`, `/dashboard/treemap`, `/dashboard/analytics`, `/dashboard/calendar`, `/dashboard/chat`) compiling cleanly for Wave 2 (`M5`), while immediately fixing `setInterval(..., 5000)` -> `useUtcClock(1000)` in `src/routes/(main)/dashboard/default/route.tsx`!
- Regenerate `src/routeTree.gen.ts` cleanly via TanStack Router CLI / Vite build so zero deleted routes remain referenced.
- Fix **100% of TypeScript (`./node_modules/.bin/tsc --noEmit`) and Biome (`./node_modules/.bin/biome check src`)** errors/warnings cleanly (configure `biome.json` appropriately for TanStack Router `$param` / component naming conventions without disabling genuine code quality/lint rules!).

### 3. Core Frontend Infrastructure (`src/framework/`, `src/components/ui/`, `src/lib/preferences/`)
- **Bulletproof `api-client.ts` (`F09`, `F35`, `F36`)**:
  - Always attach `credentials: "include"` AND `Authorization: Bearer <token>` (whenever in-memory or `sessionStorage` token is present) — **including on `POST /api/v1/auth/logout`**!
  - Single-flight `401 Unauthorized` refresh interceptor: on `401` for any endpoint EXCEPT `/auth/login`, `/auth/bootstrap`, `/auth/refresh`, `/auth/webauthn/login/*`, await a shared deduplicated `refreshAccessToken()` promise calling `POST /api/v1/auth/refresh` (`credentials: "include"`), update in-memory + `sessionStorage` `ht_access_token` (if `access_token` returned), and seamlessly retry the original request **once**.
  - **Instant Clean Redirect on Expired/Revoked Session (`F36`)**: If `POST /api/v1/auth/refresh` fails (`401`/`403`, invalid/revoked session, or unrecoverable auth failure), IMMEDIATELY clear client auth state (`clearAccessToken()` / memory / `sessionStorage`) and, when in browser inside `/dashboard` (or any non-`/auth/` route, unless Lock Screen overlay is actively handling unlock), call `window.location.replace("/auth/v2/login")` so buttons NEVER fail with `"Invalid or expired token"`!
  - `logout()` helper: calls `POST /api/v1/auth/logout` with BOTH `Authorization: Bearer <token>` and `credentials: "include"`, clears client auth state (`sessionStorage` + memory + lock state), and redirects to `/auth/v2/login`.
  - `apiDownload(path: string, fallbackFilename: string)`: performs authenticated fetch (with `credentials: "include"` + Bearer + 401 single-flight refresh retry + redirect fallback), extracts filename from `Content-Disposition` if present (else `fallbackFilename`), creates `Blob` object URL, triggers `<a download>` click, and revokes URL.
  - `getDirectDownloadUrl(path: string)`: calls `POST /api/v1/auth/download-token` -> `{ dl_token: string, expires_in: number }` and returns absolute URL with `?dl_token=<encodeURIComponent(dl_token)>` (or `&dl_token=...` if query params already exist) so direct copyable links work in Incognito / RDP browsers.
- **WebAuthn Passkey Binary/JSON Helpers (`src/framework/webauthn.ts` — `F01`)**:
  - `base64urlToUint8Array(base64url: string): Uint8Array<ArrayBuffer>` (handles URL-safe `-`/`_`, missing `=` padding, and returns a `Uint8Array` backed by a standard `ArrayBuffer` compatible with DOM `BufferSource` in TypeScript 6!).
  - `uint8ArrayToBase64url(bytes: ArrayBuffer | Uint8Array): string`.
  - `prepareCreationOptions(optionsJson: Record<string, unknown>): PublicKeyCredentialCreationOptions` — decodes `challenge`, `user.id`, and `excludeCredentials[].id` into `Uint8Array`.
  - `prepareRequestOptions(optionsJson: Record<string, unknown>): PublicKeyCredentialRequestOptions` — decodes `challenge` and `allowCredentials[].id` into `Uint8Array`.
  - `serializeCredential(cred: PublicKeyCredential): Record<string, unknown>` — safely serializes `id`, `rawId`, `type`, `authenticatorAttachment`, `clientExtensionResults`, and `response` (`clientDataJSON`, `attestationObject` + `getTransports?.()` for `AuthenticatorAttestationResponse`; `clientDataJSON`, `authenticatorData`, `signature`, `userHandle` for `AuthenticatorAssertionResponse`) into `base64url` strings (using `cred.toJSON()` if valid or explicit `ArrayBuffer -> base64url` encoding so all browsers/environments work identically).
- **Full Reactive `RU / EN / AZ` Localization (`src/framework/i18n/` — `F02`)**:
  - Complete, strictly parity-typed dictionaries `ru.ts`, `en.ts`, `az.ts` + `useI18n()` hook (`t(key, vars?)`, `language`, `setLanguage`), dynamically syncing `<html lang={language}>`.
  - 100% translation coverage across Sidebar groups/items, Header, `SearchDialog` (`Mod+K`), Login & Lock Screen, Toasts, `<AsyncButton>` default loading labels, empty/error states, and all M4 System & Operations pages (with shared common/domain keys ready for M5).
  - Never render raw translation keys; fallback to `ru` if any dynamic key is missing.
- **Unified Server-Persisted Preferences (`F03`, `F10`, `F26`)**:
  - Set `theme_preset` default to `"tangerine"` and `sidebar_variant` default to `"floating"` in `src/lib/preferences/preferences-config.ts` and `ThemeBootScript`.
  - Enforce **Bloomberg-only** compact institutional density (`density: "bloomberg"`, `tabular-nums`, crisp dense spacing); completely remove `Apple (Comfortable)` mode and any density switcher from stores and UI (normalize any legacy `"comfortable"`/`"compact"` server preference to `"bloomberg"`).
  - Unify/bridge `PreferencesStore` + `useTerminalStore` to hydrate ALL fields from `GET /api/v1/profile/me` (`preferences` JSON) on `DashboardLayout` mount and persist every preference mutation via debounced (`~300ms`, plus flush-friendly) `PATCH /api/v1/profile/preferences`:
    `theme_preset`, `theme_mode`, `font`, `sidebar_variant`, `sidebar_collapsible`, `content_layout`, `navbar_style`, `density: "bloomberg"`, `language` (`"ru"|"en"|"az"`), `timezone` (default `"UTC"`), `privacy_mode`, `sound_enabled`, `ticker_enabled`, `ticker_speed`, `hidden_page_ids`, `sidebar_order`, `pinned_asset_codes`, `custom_hotkeys`, `vault_target_usd`, `analytics_filters`, `treemap_filters`.
- **Shimmer `<Skeleton>`, `<AsyncButton>`, Right-Side Toasts & Unified Sound (`F06`, `F07`, `F13`)**:
  - Left-to-right animated shimmer sweep (`@keyframes ht-shimmer` in `styles.css` + `src/components/ui/skeleton.tsx`) + reusable `<PageSkeleton>`, `<TableSkeleton>`, `<ChartSkeleton>`, `<CardGridSkeleton>` used in `DashboardLayout` session guard and every M4 page while loading.
  - `<AsyncButton>` (`src/components/ui/async-button.tsx`) with `loading`, `loadingText` (defaulting to localized `"Идёт загрузка..."` / `"Loading..."` / `"Yüklənir..."`), spinning `<Loader2>`, and `disabled={disabled || loading}` preventing double-submit, used on every submit/mutation/action button across Auth, Lock Screen, and M4 pages.
  - Right-side rich toast notifications (`top-right` viewport in `src/components/ui/toast.tsx` + ergonomic `notify.success / error / info / warning` helper) triggered on every save, create, edit, delete, copy, download, login, passkey, 2FA, container action, test button, and API error.
  - **Unified Sound Preview (`F13`)**: Trigger acoustic confirmation chime inside `setSoundEnabled(next)` / `toggleSound()` in the store itself (`if (next) soundEngine.tradeOpen(true)`) so toggling sound ON from Header, `/dashboard/preferences`, or Hotkey ALWAYS plays the exact same confirmation sound; plus add individual sound cue preview buttons (`tradeOpen`, `profit`, `bigProfit`, `breakingNews`, `alert`) on `/dashboard/preferences`!
- **`LiveSocketProvider`, `useUtcClock(1000)` & `<AssetLogo>` (`F15`, `F28`)**:
  - `LiveSocketProvider` (`src/framework/live-socket-context.tsx` / `use-live-socket.ts`) mounted once in `DashboardLayout`: connects to `WS(S) /api/v1/ws/live` (with `?token=<jwt>` when available + cookies), handles `welcome`, `heartbeat`, `pong` (measuring live RTT `ms` via `15s` `ping` frames), `snapshot`, `trade_event`, `bar_update`, `robot_state`, `breaking_news`, `calendar_alert`, `container_event`, `macro_quotes`; auto-reconnects with exponential backoff; exposes live state & subscription hook for all pages + renders clickable green **`WS LIVE • <N>ms`** (or amber `RECONNECTING`) pill & diagnostic popover in Header!
  - `useUtcClock(intervalMs = 1000)` (`src/framework/use-utc-clock.ts`): wall-clock-boundary aligned `1000ms` ticker formatting time in user's server-saved `timezone` (`"UTC"` default).
  - `<AssetLogo symbol={...} size={...} />` (`src/framework/components/AssetLogo.tsx`) + crisp offline SVGs in `frontend/public/logos/` (`xauusd.svg`, `xagusd.svg`, `ustec.svg`, `spx.svg`, `us30.svg`, `de40.svg`, `usoil.svg`, `ukoil.svg`, `dxy.svg`, `vix.svg`, `btcusd.svg`, `ethusd.svg`, etc.) + dual-flag FX badges via `flags.css` (`EURUSD`, `GBPUSD`, `USDJPY`, `USDCHF`, `AUDUSD`, `USDCAD`, `NZDUSD`, `USDAZN`, `USDRUB`, etc.) + same-origin `/api/v1/assets/logo/{symbol}` `<img loading="lazy">` + deterministic colored monogram `onError` fallback (zero broken image icons ever!).

### 4. Redesigned Shell, Header, Floating Sidebar, Lock Screen & Institutional Login (`F11`, `F16`, `F30`)
- **Top Header (`dashboard/route.tsx` + `TerminalHeaderControls.tsx` + `account-switcher.tsx`)**:
  - Remove `USD/USC` currency switcher (`Shift+C` removed too) and remove clickable inline timezone cycler (`Shift+T` removed too).
  - Place smooth read-only `1s` clock (`HH:MM:SS UTC` / configured timezone) **immediately next to (left of) the Profile avatar (`AccountSwitcher`)**.
  - Render `Mod+K` localized `SearchDialog`, green `WS LIVE • <N>ms` diagnostic badge, Privacy Mode toggle (`Shift+M`), Sound toggle, Ticker Tape toggle, Language switcher (`RU / EN / AZ`), Theme Mode toggle, `1s` Clock, and Profile dropdown (`AccountSwitcher`).
  - Profile dropdown items (localized): `Профиль` (`/dashboard/profile`), `Безопасность и Passkeys` (`/dashboard/security`), `Активные сессии` (`/dashboard/sessions`), `История входов` (`/dashboard/login-history`), `Настройки интерфейса` (`/dashboard/preferences`), **`Заблокировать экран` (Lock Screen)**, and `Выйти` (calling `logout()` with Bearer + cookie).
- **Zero-Trust Lock Screen Overlay**:
  - Triggered from Profile dropdown (`Заблокировать экран`) or hotkey (`Shift+L`), persisted in `sessionStorage` so page refresh doesn't bypass lock; unlocks via WebAuthn Passkey (`webauthn.ts`) or Password (+ 2FA code if enabled) with `<AsyncButton>` and right-side toasts, preserving all server preferences.
- **Floating Sidebar & Unified Page Registry (`pages.config.ts`, `app-sidebar.tsx`, `HotkeyEngine.tsx`)**:
  - Remove `<SidebarFooter><NavUser /></SidebarFooter>` completely.
  - Unify `TERMINAL_PAGES` (`ru`/`en`/`az` titles, groups `Desk`, `Markets & Analytics`, `Intelligence & AI`, `Operations`, `System & Security`, icons, routes, default hotkeys) so `AppSidebar`, `SearchDialog`, `HotkeyEngine`, Sidebar Customizer (`hidden_page_ids`, `sidebar_order`), and Hotkey Editor (`custom_hotkeys`) ALL read/write the exact same source of truth!
  - Note on Wave 1 vs Wave 2 links: ensure every sidebar link resolves to a working route in Wave 1 (for Group 4 & Group 5, point to the new dedicated routes; for Group 1–3 routes not yet split until M5, ensure either lightweight alias/forwarding routes or existing working routes exist so clicking ANY sidebar item in M4 never 404s!).
- **Login Screen (`/auth/v2/route.tsx` + `/auth/v2/login/route.tsx` — `F30`)**:
  - Replace `XAUUSD & USTEC (USD / USC)` and `Asia/Baku` copy with asset-agnostic institutional multi-asset quantitative execution, real-time risk analytics, global market intelligence, and zero-trust security pillars in `RU / EN / AZ`.
  - Include top-right `RU / EN / AZ` language switcher, `1s` UTC clock, `<AsyncButton>` spinners on Password/Bootstrap & Passkey login, right-side toasts, and working `webauthn.ts` Passkey authentication.

### 5. Dedicated `Group 4` (Operations) & `Group 5` (System & Security) CRUD + Detail View Pages
Every page MUST use `useI18n()`, left-to-right shimmer `<Skeleton>` while loading, `<AsyncButton>` on mutations, right-side toasts, Bloomberg compact `tabular-nums` styling, and styled shadcn `AlertDialog`/`Dialog` modals (ZERO native dialogs):

1. **`/dashboard/profile`** — Personal Profile View & Edit ONLY (`GET /api/v1/profile/me`, `PATCH /api/v1/profile/me`: avatar preview/URL, username/role badge, display name, email, bio, social/contact links). Zero security/sessions/vault clutter here.
2. **`/dashboard/security`** (`F01`, `F31`) — Dedicated Security Center:
   - Argon2id Password Change (`POST /api/v1/auth/change-password` with `revoke_other_sessions` checkbox).
   - Full 2FA TOTP Wizard: `POST /api/v1/auth/2fa/setup` rendering scannable `qr_svg` + copyable secret, `POST /api/v1/auth/2fa/verify` (`{code}`) displaying & copying/downloading the 10 `backup_codes`, and Disable 2FA modal (`POST /api/v1/auth/2fa/disable` `{password, code}`).
   - FIDO2 WebAuthn Passkeys CRUD: `GET /api/v1/auth/webauthn/credentials` (`device_name`, `sign_count`, `transports`, `created_at`, `last_used_at`), Register Passkey modal (shadcn `Dialog` for device name -> `prepareCreationOptions` -> `navigator.credentials.create` -> `serializeCredential` -> `POST /api/v1/auth/webauthn/register/verify`), and Delete Passkey modal (shadcn `AlertDialog` / `Dialog` with optional TOTP code if 2FA enabled -> `DELETE /api/v1/auth/webauthn/credentials/{id}`).
3. **`/dashboard/sessions` & `/dashboard/sessions/$sessionId`** (`F32`, `F35`):
   - Active Sessions list (`GET /api/v1/auth/sessions`), current-session badge, `Revoke All Others` (`POST /api/v1/auth/sessions/revoke-others`) with shadcn `AlertDialog`, individual `Revoke` (`DELETE /api/v1/auth/sessions/{id}`), and Session Detail View (`/dashboard/sessions/$sessionId` via `GET /api/v1/auth/sessions/{id}` + `GET /api/v1/auth/ip-lookup/{ip}` with parsed OS/Browser, timestamps, NetBird/public IP & Geo card).
4. **`/dashboard/login-history` & `/dashboard/login-history/$entryId`** + **`/dashboard/audit` & `/dashboard/audit/$auditId`** (`F32`):
   - Filterable Login History (`GET /api/v1/auth/login-history?action=&ip=&limit=`) & Detail View (`GET /api/v1/auth/login-history/{id}`) + System Audit Log (`GET /api/v1/audit?action=&resource_type=&user_id=&limit=`) & Detail View (`GET /api/v1/audit/{id}`), including IP Geolocation lookup (`GET /api/v1/auth/ip-lookup/{ip}`) and interactive Geo visualization (SVG/d3-geo or OpenStreetMap embed + NetBird `100.104.x.x` VPN badge).
5. **`/dashboard/users`, `/dashboard/users/new`, `/dashboard/users/$userId`, `/dashboard/users/$userId/edit`** (`F17`):
   - RBAC Users Management CRUD + Detail View (`GET/POST /api/v1/users`, `GET/PATCH/DELETE /api/v1/users/{id}`) supporting `ADMIN`, `OPERATOR`, `VIEWER`, active/inactive toggle, password set/reset, last-admin & self-delete UI guard, and shadcn `AlertDialog` delete confirmation.
6. **`/dashboard/preferences` & `/dashboard/hotkeys`** (`F03`, `F10`, `F13`, `F16`):
   - `/dashboard/preferences`: Theme Preset (`tangerine` default + all presets with visual swatches), Theme Mode (`dark`/`light`/`system`), Font selector, Sidebar Style (`floating` default, `inset`, `sidebar`), Sidebar Collapse Mode (`icon`, `offcanvas`), Content Layout (`full-width`, `centered`), Navbar Behavior (`sticky`, `scroll`), Language (`RU / EN / AZ`), Timezone (`UTC` default + major financial zones), Privacy Mode, Ticker Tape enable & speed, and Sound toggle (playing preview chime!) + individual Sound Cue Test buttons (`tradeOpen`, `profit`, `bigProfit`, `breakingNews`, `alert`) — 100% persisted to server `PATCH /api/v1/profile/preferences`.
   - `/dashboard/hotkeys`: Interactive F13–F24 / keyboard Hotkey Editor (`key-capture` modal/input, conflict warning, reset defaults, JSON export/import via `apiDownload`/file) + Sidebar Customizer (visibility toggles `hidden_page_ids` & up/down/drag `sidebar_order` reordering) wired directly to `AppSidebar` & `HotkeyEngine` and saved to server!
7. **`/dashboard/containers`, `/dashboard/containers/new`, `/dashboard/containers/$containerId`, `/dashboard/containers/$containerId/edit`** (`F12`):
   - MT5 / OS Docker Containers CRUD + Detail View (`GET/POST /api/v1/ops/containers`, `GET/PATCH/DELETE /api/v1/ops/containers/{id_or_name}`), live container status/CPU/RAM/uptime (`mt5-xau`, `mt5-ustec`), `Start` / `Stop` / `Restart` (`POST /api/v1/ops/containers/{name}/{action}`) with `<AsyncButton>` & toasts, redacted Logs viewer (`GET /api/v1/ops/containers/{name}/logs?tail=200` with tail selector & text filter), and Emergency Kill-Switch (`POST /api/v1/ops/kill-switch/{account_id_or_login}`) using a real **Trading Account selector dropdown** (`GET /api/v1/accounts`) + shadcn `AlertDialog` confirmation!
8. **`/dashboard/setup`** (`F08`, `F09`, `F18`, `F25`):
   - Interactive MT5 & `/etc` Setup Wizard:
     - Trading Account dropdown (`GET /api/v1/accounts`) + URL Mode selector (`Internal Docker Network: http://ingest.terminal.local:8000/api/v1/ingest` vs `External NetBird HTTPS: https://terminal.huseynovlar.org/api/v1/ingest`).
     - 1-click authenticated downloads via `apiDownload`: `.set` (`GET /api/v1/ops/setup-wizard/{account}/bridge.set?url_mode=...`), `ExnessPanelBridge.mq5` (`GET /api/v1/ops/downloads/ExnessPanelBridge.mq5`), and `ExnessPanelHook.mqh` (`GET /api/v1/ops/downloads/ExnessPanelHook.mqh`), PLUS `"Скопировать прямую ссылку (Incognito / RDP)"` button using `getDirectDownloadUrl(...)`!
     - Clear visual & step-by-step guide solving `ERR_FUNCTION_NOT_ALLOWED (4014)` (whitelisting exact base URL `http://ingest.terminal.local:8000` or `https://terminal.huseynovlar.org` in MT5 `Tools -> Options -> Expert Advisors -> Allow WebRequest`) and running **2 EAs in MT5** (Chart #1: `NasdaqPulse v3.01` untouched; Chart #2: `ExnessPanelBridge.mq5` auto-discovering sibling charts + optional `#include <ExnessPanelHook.mqh>` IPC).
     - Clear institutional explanation of `X-Account-Api-Key` (`htk_...` generated by Terminal for MT5 — no Exness Personal Area key required for MT5!) vs optional Exness Personal Area API scopes.
     - Read-only Server `/etc/huseynovlar-terminal/integrations.env` Health Status card (`GET /api/v1/ops/integrations/status`) + **`Test Telegram Alert`** (`POST /api/v1/ops/alerts/test`) and **`Test Gemini AI`** (`POST /api/v1/ops/integrations/gemini-test`) `<AsyncButton>`s — **ZERO `telegram_bot_token` or `telegram_chat_id` fields**!
9. **`/dashboard/wiki`, `/dashboard/wiki/new`, `/dashboard/wiki/$slug`, `/dashboard/wiki/$slug/edit`** (`F33`):
   - Institutional Playbooks & Markdown Knowledge Base Full CRUD + Detail View (`GET/POST /api/v1/wiki`, `GET/PATCH/DELETE /api/v1/wiki/{slug_or_id}`), category & search filter, pinned badges, clean Markdown rendering in Detail View, live split/preview editor in Create/Edit, and shadcn `AlertDialog` delete confirmation.

### 6. Automated Quality & Verification Gates
- Add comprehensive frontend unit tests (`vitest` or Node built-in `node --test` via `tsx`, runnable via `npm test`) in `frontend/src/__tests__/` covering:
  1. `webauthn.ts` (`base64url <-> Uint8Array` roundtrips, `prepareCreationOptions`, `prepareRequestOptions`, `serializeCredential` for attestation & assertion).
  2. `api-client.ts` (Bearer + `credentials: "include"`, concurrent 401 single-flight `/auth/refresh` deduplication & retry, instant `/auth/v2/login` redirect & state wipe when refresh fails, `logout()` sending Bearer + credentials, `apiDownload`, and `getDirectDownloadUrl` `?dl_token=`).
  3. `i18n` (`ru`, `en`, `az` 100% key parity, zero empty strings, variable interpolation, fallback).
  4. Unified Preferences & Sound store (`tangerine` + `floating` + `bloomberg`-only defaults, acoustic preview trigger on `setSoundEnabled(true)`, debounced `PATCH /api/v1/profile/preferences` payload).
  5. `<AssetLogo>` resolution logic (FX dual flags, offline market SVGs, `/api/v1/assets/logo/{symbol}` URL, monogram fallback).
- Zero native dialogs check: `grep -rn 'window\.\(confirm\|prompt\|alert\)\|\balert(' src` -> 0 matches.
- `./node_modules/.bin/tsc --noEmit` -> exits `0`.
- `./node_modules/.bin/biome check src` (and `npm run lint`) -> exits `0`.
- `npm test` -> 100% pass, exits `0`.
- `npm run build` -> exits `0`.
