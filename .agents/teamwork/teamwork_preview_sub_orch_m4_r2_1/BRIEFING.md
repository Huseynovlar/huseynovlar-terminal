# BRIEFING — Milestone 4 (`M4`) Frontend Core Framework, Shell, i18n, Demo Purge & System/Ops Pages

- **Current Phase**: Step `2B.a` — Fast Targeted Exploration
- **Milestone Status**: `IN_PROGRESS`
- **Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Owned Scope**: `frontend/**` ONLY

## Mission Summary
Deliver a Bloomberg × NYSE-grade frontend foundation and complete `Group 4` (Operations) + `Group 5` (System & Security) dedicated CRUD + Detail View pages in `frontend/`:
1. **Zero Native Dialogs (`F34`)**: Styled `@base-ui/react` shadcn `AlertDialog` / `ConfirmDialog` / `PromptDialog` / `Dialog` components replacing 100% of `window.confirm`, `window.prompt`, and `window.alert` / `alert()` across the entire `frontend/src` tree.
2. **Bulletproof `api-client.ts` (`F09`, `F35`, `F36`)**: Always sends `credentials: "include"` + `Authorization: Bearer <token>` (including on `POST /api/v1/auth/logout`), deduplicates `401 -> POST /api/v1/auth/refresh` single-flight retry, immediately clears client auth state and redirects via `window.location.replace("/auth/v2/login")` when refresh fails inside protected routes, and provides `apiDownload` + `getDirectDownloadUrl` (`?dl_token=`).
3. **WebAuthn Passkeys (`F01`)**: `webauthn.ts` binary `base64url <-> Uint8Array` converters & `serializeCredential` fixing `TypeError` on Registration, Login, and Lock Screen.
4. **Reactive `RU / EN / AZ` i18n (`F02`), `tangerine` + `floating` + Bloomberg-Only Density (`F03`, `F10`), Shimmer `<Skeleton>` (`F06`), `<AsyncButton>`, Right-Side Toasts (`F07`), Acoustic Sound Preview (`F13`), `LiveSocketProvider` (`F15`), `useUtcClock(1000)`, `<AssetLogo>` (`F28`)**, and 100% server-persisted preferences (`GET /api/v1/profile/me` + debounced `PATCH /api/v1/profile/preferences`).
5. **Studio Admin Demo Purge + Redesigned Header/Sidebar/Lock Screen/Login + All `Group 4` & `Group 5` Dedicated CRUD+View Routes**:
   - Purge all 26 demo routes & demo mock files; gate `<TanStackDevtools>` behind `import.meta.env.DEV`.
   - Dedicated CRUD+View pages for `profile`, `security`, `sessions`, `login-history`, `audit`, `users`, `preferences`, `hotkeys`, `containers`, `setup`, `wiki` + clean legacy redirects (`infrastructure` -> `containers`, `academy` -> `setup`, `roles` -> `preferences`), while keeping all M5 trading/intelligence routes compiling cleanly (with `1000ms` clock fix in `default/route.tsx`).
6. **Quality Gates**: Unit tests + `tsc --noEmit` (0 errors) + `biome check src` (0 errors) + `npm run build` (exit 0).
