# DISPATCH — Milestone 4 (`M4`) Sub-Orchestrator

- **Sender / Parent Conversation ID**: `b5546ea1526f70a42ec92262cd4e980a`
- **Timestamp**: `2026-11-24T21:01:40Z`
- **Assigned Role**: Milestone 4 (`M4`) Sub-Orchestrator (`teamwork_preview_orchestrator`)
- **State Directory**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_m4_1`
- **Primary Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Exclusive Write Ownership**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/**` (STRICT — NEVER write outside `frontend/**`, NEVER touch `backend/`, `deploy/`, `mql5/`, `config/`, or `e2e/`, NEVER run `git commit` or `git push`)

## Mandatory First Reads
1. `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
2. `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (especially `§ Interface Contracts 2, 3, 4, 6`)
3. `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/handoff.md`
4. `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/handoff.md`

## Assigned Deliverables Summary
1. **Purge All 26 Studio Admin Demo Routes & Fix All TS / Biome Diagnostics** (+ gate `<TanStackDevtools>` behind `import.meta.env.DEV`, import `src/styles/flag-icons/flags.css`, keep existing M5-target pages `/dashboard/default`, `/dashboard/crypto`, `/dashboard/finance`, `/dashboard/treemap`, `/dashboard/analytics`, `/dashboard/calendar`, `/dashboard/chat` compiling cleanly for Wave 2).
2. **Core Frontend Infrastructure**:
   - `api-client.ts` (`credentials: "include"` + `Authorization: Bearer`, single-flight `401 -> POST /api/v1/auth/refresh`, `apiDownload`, `getDirectDownloadUrl` via `/api/v1/auth/download-token`).
   - `webauthn.ts` (`base64urlToUint8Array`, `uint8ArrayToBase64url`, `prepareCreationOptions`, `prepareRequestOptions`, `serializeCredential`).
   - Full Reactive `RU / EN / AZ` Localization (`src/framework/i18n/` + dynamic `<html lang={language}>`).
   - Unified Server-Persisted Preferences (`tangerine` default, `floating` sidebar default, **Bloomberg-only** density with density toggle removed, hydrated from `GET /api/v1/profile/me` and persisted via debounced `PATCH /api/v1/profile/preferences`).
   - Left-to-Right Animated Shimmer `<Skeleton>` (`@keyframes ht-shimmer` + `<PageSkeleton>`, `<TableSkeleton>`, `<ChartSkeleton>`, `<CardGridSkeleton>`), `<AsyncButton>`, right-side `<Toaster>`, unified Sound preview in store (`setSoundEnabled(next)` + preview buttons in `/dashboard/preferences`).
   - `LiveSocketProvider` (`/api/v1/ws/live` with `ping/pong` RTT, `WS LIVE • <N>ms` header pill & popover), `useUtcClock(1000)` (plus fixing `5000ms` jump in `default/route.tsx:94`), `<AssetLogo>` + `public/logos/` SVGs + `flags.css` + `/api/v1/assets/logo/{symbol}` + monogram fallback.
3. **Redesigned Header, Clean Floating Sidebar, Lock Screen & Institutional Login Page**:
   - Remove `USD/USC` and inline timezone cycler from Header; read-only `1s` clock immediately left of `AccountSwitcher`; `SearchDialog` `Mod+K` + i18n; `Заблокировать экран` inside `AccountSwitcher` + Zero-Trust Lock Screen overlay (Passkey / Password+2FA); remove `<NavUser>` from Sidebar footer; unify `TERMINAL_PAGES` registry driving `AppSidebar` & `HotkeyEngine`; asset-agnostic institutional Login page (`/auth/v2/login` + `/auth/v2/route.tsx`) in `RU/EN/AZ`.
4. **All System & Operations CRUD + Detail View Pages (`Group 4` & `Group 5`)**:
   - `/dashboard/profile`
   - `/dashboard/security`
   - `/dashboard/sessions` & `/dashboard/sessions/$sessionId`
   - `/dashboard/login-history` & `/dashboard/login-history/$entryId` + `/dashboard/audit` & `/dashboard/audit/$auditId`
   - `/dashboard/users`, `/dashboard/users/new`, `/dashboard/users/$userId`, `/dashboard/users/$userId/edit`
   - `/dashboard/preferences` & `/dashboard/hotkeys`
   - `/dashboard/containers`, `/dashboard/containers/new`, `/dashboard/containers/$containerId`, `/dashboard/containers/$containerId/edit`
   - `/dashboard/setup` & `/dashboard/wiki`, `/dashboard/wiki/new`, `/dashboard/wiki/$slug`, `/dashboard/wiki/$slug/edit`
5. **Frontend Automated Verification**:
   - Unit tests for `webauthn.ts`, `api-client.ts`, `i18n`, preferences store, `<AssetLogo>` logic (`vitest` or `node --test` / `tsx`) AND zero errors on `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/biome check src` (or `biome lint src`), and `npm run build`.
