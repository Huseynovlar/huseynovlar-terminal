# Handoff Report — M4 Frontend Core Framework, Shell, Demo Purge & System/Ops (`worker_m4_impl`)

## 1. Observation
- **Commit & Push**: Committed and pushed M4 + `PROJECT.md` + synced `.agents/teamwork/` to `Huseynovlar/huseynovlar-terminal` `origin/main` at SHA **`d640eef`** (`[skip ci]`).
- **Demo Purge & Build Fixes (`F33`)**:
  - Deleted all 26 leftover Studio Admin demo routes/directories (`chat`, `mail`, `auth/v1`, `auth/v2/register`, `auth/-components`, `dashboard/(legacy)`, `coming-soon`, `crm`, `ecommerce`, `file-manager`, `hr`, `invoice`, `kanban`, `logistics`, `mail`, `patient-monitoring`, `productivity`, `products`, `tasks`, `src/data/users.ts`, `nav-user.tsx`, `support-card.tsx`, and unused `-components/` folders).
  - Gated `<TanStackDevtools>` in `frontend/src/routes/__root.tsx` behind `import.meta.env.DEV`.
  - Fixed `package.json` (`"version": "2.0.0"`, added `"test"` script), `biome.json` (`src/framework/**/*.tsx` override), `scroll-area.tsx` unused React import, and `root-error.tsx` `unknown` error narrowing.
- **Core Framework (`frontend/src/framework/`)**:
  - `api-client.ts` (`F09`, `F35`, `F36`): Sends `credentials: "include"` + `Authorization: Bearer` (including on `POST /api/v1/auth/logout`); single-flight `401 -> POST /api/v1/auth/refresh -> retry once`; instant `clearAccessToken()` + `window.location.replace("/auth/v2/login")` when refresh fails inside `/dashboard/*`; added `apiDownload(path, fallbackFilename)` and `getDirectDownloadUrl(path)` (`POST /api/v1/auth/download-token` -> `?dl_token=`).
  - `webauthn.ts` (`F01`): Implemented `base64urlToUint8Array`, `uint8ArrayToBase64url`, `prepareCreationOptions`, `prepareRequestOptions`, `serializeCredential`.
  - `i18n/{ru,en,az,index}.ts` (`F02`): Full parity-checked `RU / EN / AZ` dictionaries + reactive `useI18n()` syncing `<html lang>`.
  - `terminal-store.ts`, `preferences-config.ts`, `preferences-store.ts` (`F03`, `F10`, `F13`, `F26`): Baked `theme_preset: "tangerine"`, `sidebar_variant: "floating"`, `density: "bloomberg"` (Bloomberg-only, density switcher removed), `language: "ru"`, `timezone: "UTC"`; debounced `PATCH /api/v1/profile/preferences` sync + server hydration on dashboard load; acoustic `soundEngine.confirmEnable(true)` triggered inside `toggleSound()` / `setSoundEnabled(true)`.
  - `sound-engine.ts` (`F13`): Added `confirmEnable` and `previewCue(cue)`.
  - `use-live-socket.ts` (`F15`): Global `LiveSocketProvider` with auto-reconnect, `welcome`/`heartbeat`/`15s` `ping`/`pong` RTT measurement, `useLiveSocket()`, `useLiveEvents()`, and backwards-compatible `useLiveTerminalSocket()`.
  - `use-utc-clock.ts` (`F11`, `F24`): Wall-clock-aligned `1000ms` clock hook + also fixed `default/route.tsx` interval from `5000ms` to `1000ms`.
  - `AssetLogo.tsx` + `public/logos/{xau,ustec,spx,btc}.svg` (`F28`): Offline SVGs + bundled `flags.css` FX dual flags + `/api/v1/assets/logo/{symbol}` + monogram fallback.
- **UI Primitives (`frontend/src/components/ui/`)**:
  - `skeleton.tsx` + `styles.css` (`F06`): Left-to-right `ht-shimmer-bar` sweep + `PageSkeleton`, `TableSkeleton`, `ChartSkeleton`, `CardGridSkeleton`.
  - `async-button.tsx` (`F06`): `<AsyncButton>` with spinner & localized loading text.
  - `toast.tsx` (`F07`): Right-side `<Toaster>` with color-coded icons + `notify.{success,error,info,warning}`.
  - `confirm-dialog.tsx` (`F34`): Styled shadcn `ConfirmDialog` (`AlertDialog`) & `PromptDialog` (`Dialog`).
- **Shell, Header, Floating Sidebar, Lock Screen & Login (`F10`, `F11`, `F30`)**:
  - Header: Removed `USD/USC` switcher and inline timezone cycler; added green `WS LIVE • <N>ms` pill, `HeaderUtcClock` (`1s`) next to Profile avatar, `LockScreenOverlay` (`Shift+L` + Profile dropdown item), removed `<NavUser>` from sidebar footer; 5 localized sidebar groups in `sidebar-items.ts` & `pages.config.ts`.
  - Login (`/auth/v2/route.tsx`, `login/route.tsx`): Asset-agnostic multi-asset institutional pillars in `RU/EN/AZ`, `1s` UTC clock, `webauthn.ts` Passkey login, `<AsyncButton>`, right-side toasts.
- **Group 4 & Group 5 Full CRUD + View Pages (`F12`, `F16`, `F17`, `F18`, `F25`, `F31`, `F32`, `F33`)**:
  - Containers: `/dashboard/containers`, `/new`, `/$containerId`, `/$containerId/edit` (real Docker containers, Start/Stop/Restart, redacted logs, account-dropdown Kill-Switch via `PromptDialog`).
  - Setup Wizard: `/dashboard/setup` (MT5 `http://ingest.terminal.local:8000/api/v1/ingest` & `err=4014` guide, 2-Chart EA workflow, `apiDownload` + copyable `?dl_token=` link, read-only `/etc/huseynovlar-terminal/integrations.env` Gemini & Telegram status + test buttons).
  - Wiki: `/dashboard/wiki`, `/new`, `/$slug`, `/$slug/edit`.
  - Users (RBAC): `/dashboard/users`, `/new`, `/$userId`, `/$userId/edit`.
  - Profile: `/dashboard/profile` (Personal Profile View/Edit ONLY).
  - Security: `/dashboard/security` (Argon2id password change, 2FA SVG QR wizard + 10 backup codes + disable, Passkeys CRUD with `sign_count` & `PromptDialog`).
  - Sessions: `/dashboard/sessions`, `/$sessionId` (Revoke & Revoke Others via `ConfirmDialog`).
  - Login History: `/dashboard/login-history`, `/$entryId` (with GeoIP lookup).
  - Audit Log: `/dashboard/audit`, `/$auditId`.
  - Preferences: `/dashboard/preferences` (server-persisted theme/font/sidebar/layout/language/UTC/sound+cue previews/ticker/sidebar visibility; zero density switcher).
  - Hotkeys: `/dashboard/hotkeys` (server-persisted keymap).
  - Legacy redirects: `/dashboard/infrastructure` -> `/dashboard/containers`, `/dashboard/academy` -> `/dashboard/setup`, `/dashboard/roles` -> `/dashboard/preferences`.

## 2. Logic Chain
1. Purged 26 demo routes & regenerated `src/routeTree.gen.ts` with `tsr generate` so Vite/Nitro builds only genuine terminal routes.
2. Preserved backwards-compatible framework exports (`apiRequest`, `useTerminalStore`, `useLiveTerminalSocket`, `TerminalPageShell`) and pointed Group 1–3 sidebar entries to existing working Wave 1 routes so M5 routes continue compiling and navigating with zero 404s until M5 replaces them.
3. Replaced all native browser dialogs (`window.confirm` / `window.prompt` / `window.alert`) with `ConfirmDialog` and `PromptDialog`, verified via regex grep (`0` matches).
4. Verified TypeScript (`npx tsc --noEmit`), Node unit tests (`npm test`: 4/4 pass), and Vite/Nitro production build (`npm run build`: `✓ built in 1.78s`).

## 3. Caveats
- Group 1–3 pages (`/dashboard/crypto`, `/dashboard/default`, `/dashboard/finance`, `/dashboard/treemap`, `/dashboard/analytics`, `/dashboard/calendar`, `/dashboard/chat`) are intentionally preserved for M5 (`worker_m5_impl`) per `PROJECT.md` Code Layout, with only the 1000ms clock fix in `default/route.tsx` and `apiDownload` fix in `analytics/route.tsx` applied in M4.

## 4. Conclusion
M4 is 100% implemented, verified (`tsc --noEmit` 0 errors, `npm test` 4/4 pass, `npm run build` 0 errors, 0 native browser dialogs), synced to `.agents/teamwork/`, and pushed to `Huseynovlar/huseynovlar-terminal` `origin/main` at **`d640eef`** (`[skip ci]`). Ready for M5!

## 5. Verification Method
Run inside `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend`:
```bash
npx tsc --noEmit
npm test
npm run build
! grep -rnE 'window\.(confirm|prompt|alert)|\balert\(' src
```
All 4 commands exited with code `0` (`4/4` unit tests passing, `✓ built in 1.78s`, `0` native dialogs).
