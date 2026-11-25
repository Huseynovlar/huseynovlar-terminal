# SCOPE — Milestone 4 (`M4`): Frontend Core Framework, Shell, i18n, Demo Purge & System/Ops Pages

- **Status**: `IN_PROGRESS`
- **Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Exclusive Write Ownership**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/**`
  - **FORBIDDEN**: Writing outside `frontend/**` (`backend/`, `deploy/`, `mql5/`, `config/`, `e2e/`), placing code/tests in `.agents/teamwork/`, or running `git commit` / `git push`.

## Stack & Architectural Context
- **TanStack Start** (`@tanstack/react-start` + TanStack Router file-based routing in `src/routes/` -> `src/routeTree.gen.ts` + React 19 + Vite 8 + Nitro SSR + Tailwind CSS v4 + `@base-ui/react` shadcn `base-nova` + Zustand + Lucide + `flags.css`) — **NOT Next.js**.

## Acceptance Criteria & Deliverables

### 1. Studio Admin Demo Purge & Zero TS / Biome Diagnostics
- Delete all unused Studio Admin demo routes, mock data, and leftover components:
  - `src/routes/(main)/chat/`, `src/routes/(main)/mail/`, `src/routes/(main)/auth/v1/`, `src/routes/(main)/auth/v2/register/`, `src/routes/(main)/unauthorized.tsx` (or localize cleanly if referenced, purge demo content)
  - `src/routes/(main)/dashboard/(legacy)/`, `crm`, `ecommerce`, `file-manager`, `hr`, `invoice`, `kanban`, `logistics`, `mail`, `patient-monitoring`, `productivity`, `products`, `tasks`, `coming-soon`
  - Replace demo `src/routes/(main)/dashboard/users/` with real RBAC Users Management CRUD + Detail View, and purge old `infrastructure/` / `academy/` / `roles/` once replaced (or redirect cleanly to `/dashboard/containers`, `/dashboard/setup`, `/dashboard/preferences` so legacy bookmarks never 404!).
  - Delete `src/data/users.ts`, `support-card.tsx`, `nav-user.tsx`, and unused `-components/*` template leftovers.
- Gate `<TanStackDevtools>` in `src/routes/__root.tsx` behind `import.meta.env.DEV`.
- Import `src/styles/flag-icons/flags.css` cleanly in `src/styles/styles.css`.
- Keep existing `/dashboard/default`, `/dashboard/crypto`, `/dashboard/finance`, `/dashboard/treemap`, `/dashboard/analytics`, `/dashboard/calendar`, `/dashboard/chat` compiling cleanly for Wave 2 (`M5`), while fixing the `5000ms` clock jump in `default/route.tsx:94` immediately using `useUtcClock(1000)`.
- Fix 100% of TypeScript (`./node_modules/.bin/tsc --noEmit`) and Biome (`./node_modules/.bin/biome check src` / `npm run lint`) diagnostics.

### 2. Core Frontend Infrastructure (`src/framework/`, `src/components/ui/`, `src/lib/preferences/`)
- **`api-client.ts`**:
  - Always attach `credentials: "include"` + `Authorization: Bearer <token>` (when available).
  - Single-flight `401 -> POST /api/v1/auth/refresh` automatic retry (except `/auth/login`, `/auth/bootstrap`, `/auth/refresh`) updating token + cookies and retrying once transparently.
  - `apiDownload(path, fallbackFilename)` via authenticated fetch (`apiRequestRaw` with 401 retry) -> `Blob` -> `<a download>`.
  - `getDirectDownloadUrl(path)` calling `POST /api/v1/auth/download-token` -> appending `?dl_token=...` for copyable/Incognito direct links.
- **`webauthn.ts`**:
  - `base64urlToUint8Array`, `uint8ArrayToBase64url`, `prepareCreationOptions`, `prepareRequestOptions`, `serializeCredential` (handling both `cred.toJSON()` and explicit `ArrayBuffer -> base64url` serialization including `transports`).
- **Full Reactive `RU / EN / AZ` Localization (`src/framework/i18n/`)**:
  - Typed dictionaries `ru.ts`, `en.ts`, `az.ts` + `useI18n()` (`t(key, vars?)`, `language`, `setLanguage`), dynamically updating `<html lang={language}>`, translating 100% of sidebar groups/items, header, search palette, login/lock screens, shared components, toast messages, loading states, error states, and all M4 pages (extensible for M5).
- **Unified Server-Persisted Preferences**:
  - `theme_preset` default `"tangerine"` and `sidebar_variant` default `"floating"` in `preferences-config.ts` and `ThemeBootScript`.
  - **Bloomberg-only** compact density (`tabular-nums`, crisp dense spacing); completely remove `Apple (Comfortable)` mode and any density toggle.
  - Hydrate all preferences (`theme_preset`, `theme_mode`, `font`, `sidebar_variant`, `sidebar_collapsible`, `content_layout`, `navbar_style`, `language`, `timezone` default `"UTC"`, `privacy_mode`, `sound_enabled`, `ticker_enabled`, `ticker_speed`, `hidden_page_ids`, `sidebar_order`, `pinned_asset_codes`, `custom_hotkeys`, `vault_target_usd`, `analytics_filters`, `treemap_filters`) from `GET /api/v1/profile/me` in `DashboardLayout` and persist every change via debounced `PATCH /api/v1/profile/preferences`.
- **Shimmer `<Skeleton>`, `<AsyncButton>`, Right-Side Toasts & Unified Sound**:
  - Left-to-right gradient sweep `@keyframes ht-shimmer` in `skeleton.tsx` + `<PageSkeleton>`, `<TableSkeleton>`, `<ChartSkeleton>`, `<CardGridSkeleton>` used in `DashboardLayout` session guard and every M4 page.
  - `<AsyncButton>` (`loading`, `loadingText` localized + spinning `Loader2`, `disabled`) used on EVERY submit/action button.
  - Right-side toast notifications (`top-right` / right viewport, crisp Bloomberg styling) triggered on every save, create, edit, delete, copy, download, login, container command, and error.
  - Acoustic preview chime wired inside `setSoundEnabled(next)` in the store itself (`if (next) soundEngine.tradeOpen(true)`) + individual sound preview buttons in `/dashboard/preferences`.
- **`LiveSocketProvider`, `useUtcClock(1000)` & `<AssetLogo>`**:
  - `LiveSocketProvider` mounted in `DashboardLayout` (`/api/v1/ws/live`, `ping/pong` RTT measurement, auto-reconnect, event bus for portfolio/container/news/heartbeat) + clickable green **`WS LIVE • <N>ms`** header badge & diagnostic popover.
  - `useUtcClock(1000)` wall-clock aligned `1000ms` ticker supporting user's server-saved timezone (`UTC` default).
  - `<AssetLogo symbol={...} size={...} />` + crisp offline SVGs in `public/logos/` + dual-flag FX badges from `flags.css` + `/api/v1/assets/logo/{symbol}` + deterministic monogram `onError` fallback.

### 3. Shell, Header, Floating Sidebar, Lock Screen & Institutional Login Page
- **Header**: Remove `USD/USC` switcher and clickable timezone cycler; place read-only `1s` clock immediately left of `AccountSwitcher`; fix `SearchDialog` to `Mod+K` with `RU/EN/AZ` i18n; add `Заблокировать экран` (Lock Screen) inside `AccountSwitcher` dropdown (`Профиль`, `Безопасность и Passkeys`, `Активные сессии`, `История входов`, `Настройки интерфейса`, `Заблокировать экран`, `Выйти`).
- **Lock Screen Overlay**: Full-screen zero-trust lock overlay unlocking via Passkey (`webauthn.ts`) or Password (+2FA if enabled) without losing server preferences.
- **Sidebar**: Remove `<SidebarFooter><NavUser /></SidebarFooter>`; drive `AppSidebar` & `HotkeyEngine` from unified `TERMINAL_PAGES` registry respecting `hidden_page_ids`, `sidebar_order`, and `custom_hotkeys`.
- **Login Screen (`/auth/v2/login` + `/auth/v2/route.tsx`)**: Asset-agnostic institutional multi-asset quantitative trading, risk analytics, market intelligence & zero-trust pillars in `RU/EN/AZ`, `1s` UTC clock, language switcher, `<AsyncButton>` loaders, and fixed WebAuthn Passkey login.

### 4. System & Operations CRUD + Detail View Pages (`Group 4` & `Group 5`)
- `/dashboard/profile` — Personal Profile View & Edit ONLY (avatar preview, display name, email, bio, social links).
- `/dashboard/security` — Argon2id Password Change, Full 2FA TOTP Wizard (`qr_svg`, manual secret, verify, 10 backup codes display/copy, Disable 2FA dialog), FIDO2 Passkeys list (`sign_count`, `last_used_at`), register (`webauthn.ts`), delete (shadcn Dialogs — ZERO `window.prompt` or `window.confirm`).
- `/dashboard/sessions` & `/dashboard/sessions/$sessionId` — Active Sessions list, revoke-others, individual revoke, Session Detail View with parsed OS/Browser & IP Geo card.
- `/dashboard/login-history` & `/dashboard/login-history/$entryId` + `/dashboard/audit` & `/dashboard/audit/$auditId` — Login History & System Audit Log with filters, interactive GeoIP / OpenStreetMap visualization (`NetBird 100.104.x.x` + public IP), and Detail Views.
- `/dashboard/users`, `/dashboard/users/new`, `/dashboard/users/$userId`, `/dashboard/users/$userId/edit` — Users Management RBAC CRUD + Detail View (`ADMIN`, `OPERATOR`, `VIEWER`).
- `/dashboard/preferences` & `/dashboard/hotkeys` — Dedicated Interface Preferences + F13–F24 Hotkey Editor & Sidebar Customizer, 100% persisted on server.
- `/dashboard/containers`, `/dashboard/containers/new`, `/dashboard/containers/$containerId`, `/dashboard/containers/$containerId/edit` — Docker Containers Ops CRUD + Detail View (`mt5-xau`, `mt5-ustec`, live status/stats, Start/Stop/Restart with `<AsyncButton>` + toasts, tail/filter Logs viewer, Account-selector dropdown Kill-Switch).
- `/dashboard/setup` & `/dashboard/wiki`, `/dashboard/wiki/new`, `/dashboard/wiki/$slug`, `/dashboard/wiki/$slug/edit` — Interactive MT5 & `/etc` Setup Wizard (Account dropdown `.set` + `.mq5` + `.mqh` downloads + Incognito direct download URL, selectable `http://ingest.terminal.local:8000` vs `https://terminal.huseynovlar.org`, illustrated 2-Chart MT5 `NasdaqPulse` + `ExnessPanelBridge` guide, API keys explanation, read-only `/etc/huseynovlar-terminal/integrations.env` health status + Test Telegram & Test Gemini buttons — zero `bot_token`/`chat_id` inputs) + Markdown Knowledge Wiki Full CRUD + Detail View.

### 5. Automated Verification Gates
- Unit tests (`vitest` or `node --test` / `tsx`) covering `webauthn.ts`, `api-client.ts` (401 refresh + download URLs), `i18n` (`ru/en/az` completeness), preferences store sync, and `<AssetLogo>` resolution.
- `./node_modules/.bin/tsc --noEmit` exits `0`.
- `./node_modules/.bin/biome check src` (and `npm run lint`) exits `0`.
- `npm run build` exits `0`.
