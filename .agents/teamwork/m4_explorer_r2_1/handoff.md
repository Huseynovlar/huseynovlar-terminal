# M4 Explorer 1 (`m4_explorer_r2_1`) — Build, UI Primitives & Demo Purge Blueprint

## 1. Build, TS, Biome & Zero-Install Test Runner (`frontend/`)
- **Scripts & Runner**: `package.json` lacks `"version"` (causes `TS2339` in `src/config/app-config.ts:9` — add `"version": "2.0.0"` & `"test": "node --experimental-strip-types --test 'src/__tests__/**/*.test.ts'"` or `ts-node` — Node 22 supports `--experimental-strip-types --test` out of the box with zero npm installs; `tsr generate` is in `node_modules/.bin/tsr`).
- **4 Existing `tsc --noEmit` Errors**: (1) `src/components/ui/scroll-area.tsx:1` unused `React`; (2) `src/config/app-config.ts:9` missing `pkg.version`; (3) `src/routes/(main)/chat/-components/chat-sidebar.tsx:40` (deleted in purge); (4) `src/routes/-components/root-error.tsx:13` `error: unknown` -> narrow `error instanceof Error ? error.message : String(error)`.
- **Biome (`biome.json`)**: `src/components/ui` & `src/styles/styles.css` are already excluded in `files.includes` (`!src/components/ui`, `!**/src/styles/styles.css`, `!**/src/routeTree.gen.ts`). Add override for `src/framework/**/*.tsx` (`"useFilenamingConvention": "off"`) so PascalCase components (`AssetLogo.tsx`, `LiveAssetChart.tsx`, `HotkeyEngine.tsx`, `TerminalHeaderControls.tsx`, `BloombergTickerTape.tsx`) pass `./node_modules/.bin/biome check src`.
- **Root & CSS**: Gate `<TanStackDevtools>` in `src/routes/__root.tsx:109` behind `{import.meta.env.DEV ? <TanStackDevtools .../> : null}`; sync `<html lang={language}>`. In `src/styles/styles.css`: add `@import "./flag-icons/flags.css";` and `@keyframes ht-shimmer { 100% { transform: translateX(100%); } }`.

## 2. UI Primitives (`src/components/ui/` & `@base-ui/react` `^1.9.0`)
- **Already Present**: `dialog.tsx`, `alert-dialog.tsx`, `toast.tsx`, `skeleton.tsx`, `button.tsx`, `spinner.tsx` ALL exist in `src/components/ui/`!
- **`@base-ui/react` Exports Verified**: `@base-ui/react/dialog` -> `Dialog.{Root,Trigger,Portal,Backdrop,Viewport,Popup,Title,Description,Close,createHandle}`; `@base-ui/react/alert-dialog` -> `AlertDialog.{Root,Trigger,Portal,Backdrop,Viewport,Popup,Title,Description,Close,createHandle}` (uses `render={<Button />}` prop, NOT `asChild`).
- **Enhancements Needed**:
  1. Add `src/components/ui/confirm-dialog.tsx` (`ConfirmDialog` & `PromptDialog` built on `alert-dialog.tsx` / `dialog.tsx`).
  2. Add `src/components/ui/async-button.tsx` (`<AsyncButton loading loadingText ...>` wrapping `Button` + `Loader2`).
  3. Upgrade `src/components/ui/skeleton.tsx` to left-to-right `ht-shimmer` sweep + export `PageSkeleton`, `TableSkeleton`, `ChartSkeleton`, `CardGridSkeleton`.
  4. Update `src/components/ui/toast.tsx` viewport to top-right (`top-4 right-4`) + export `notify.{success,error,info,warning}` helper.

## 3. Native Browser Dialogs & `window.open` Audit (`0` Must Survive — `F34`)
- **Exact `confirm`/`prompt`/`alert` matches in `src/` (3 total)**:
  1. `src/routes/(main)/dashboard/infrastructure/route.tsx:76` (`window.confirm`) -> replace/redirect to `/dashboard/containers` with `AlertDialog`.
  2. `src/routes/(main)/dashboard/profile/route.tsx:154` (`window.confirm` session revoke) -> move to `/dashboard/sessions` with `AlertDialog`.
  3. `src/routes/(main)/dashboard/profile/route.tsx:166` (`window.prompt` 2FA code for passkey delete) -> move to `/dashboard/security` with `Dialog` input.
- **Authenticated `window.open` downloads to fix**: `academy/route.tsx:66` (`bridge.set` -> `/dashboard/setup` `apiDownload`) & `analytics/route.tsx:119` (`statement.csv` -> `apiDownload("/analytics/statement.csv", "statement.csv")`).

## 4. Exact Demo Purge List (Keep M5 Routes Intact!)
- **DELETE Directories/Files**:
  - Top-level unprotected demos: `src/routes/(main)/chat/`, `src/routes/(main)/mail/`, `src/routes/(main)/auth/v1/`, `src/routes/(main)/auth/v2/register/`, `src/routes/(main)/auth/-components/`.
  - Dashboard demos: `src/routes/(main)/dashboard/(legacy)/`, `coming-soon/`, `crm/`, `ecommerce/`, `file-manager/`, `hr/`, `invoice/`, `kanban/`, `logistics/`, `mail/`, `patient-monitoring/`, `productivity/`, `products/`, `tasks/`.
  - Mock data & unused shell components: `src/data/users.ts`, `src/routes/(main)/dashboard/-components/sidebar/nav-user.tsx` (and `support-card.tsx` if present), plus unused `-components/` inside `academy/`, `infrastructure/`, `profile/`, `roles/`, `users/`.
- **CONVERT to Clean Redirects**: `dashboard/infrastructure/route.tsx` -> `/dashboard/containers`, `dashboard/academy/route.tsx` -> `/dashboard/setup`, `dashboard/roles/route.tsx` -> `/dashboard/preferences`.
- **REPLACE in-place**: `dashboard/users/` -> RBAC Users CRUD (`index`, `new`, `$userId`, `$userId/edit`); localize `unauthorized.tsx`, `dashboard/$.tsx`, `not-found.tsx`, `root-error.tsx`.
- **PRESERVE for M5**: `dashboard/default` (only fix `setInterval(..., 5000)` -> `1000ms`), `crypto`, `finance`, `treemap`, `analytics` (swap `window.open` -> `apiDownload`), `calendar`, `dashboard/chat` — then run `./node_modules/.bin/tsr generate`.
