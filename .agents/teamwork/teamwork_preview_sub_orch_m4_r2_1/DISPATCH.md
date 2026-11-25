# DISPATCH — Milestone 4 (`M4`) Sub-Orchestrator (`teamwork_preview_sub_orch_m4_r2_1`)

- **Orchestrator ID**: `teamwork_preview_sub_orch_m4_r2_1`
- **Parent Orchestrator Conversation ID**: `2204160cc16357fec5819197f8ae7177`
- **Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Exclusive Write-Owned Path**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/frontend/**`
- **Mandatory Verbatim Input**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Architecture & Contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`

## Execution Plan (Single-Cycle `2B` Loop)
1. **Step 2B.a — Fast Targeted Exploration (3 Explorers in parallel)**:
   - `m4_explorer_r2_1`: Build/TS/Biome config (`package.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`), root & shell (`__root.tsx`, `dashboard/route.tsx`, `auth/v2/*`), UI primitives (`components/ui/*` for `AlertDialog`/`Dialog`/`Skeleton`/`Button`/`Toast`), `styles.css`, and exact inventory of all `window.confirm`/`window.prompt`/`alert` calls + all 26 demo routes to purge.
   - `m4_explorer_r2_2`: Core framework (`src/framework/*`, `src/lib/preferences/*`, `src/stores/preferences/*`, `src/navigation/sidebar/*`) — `api-client.ts`, `terminal-store.ts`, `sound-engine.ts`, `use-live-socket.ts`, `HotkeyEngine.tsx`, `TerminalHeaderControls.tsx`, `BloombergTickerTape.tsx`, `app-sidebar.tsx`, `account-switcher.tsx`, `search-dialog.tsx`, `layout-controls.tsx`, `pages.config.ts`.
   - `m4_explorer_r2_3`: Existing System/Ops/Trading routes (`profile/route.tsx`, `roles/route.tsx`, `infrastructure/route.tsx`, `academy/route.tsx`, `users/*`, `default/route.tsx`, `crypto/route.tsx`, `LiveAssetChart.tsx`) to ensure clean M4 page split (`profile`, `security`, `sessions`, `login-history`, `audit`, `users`, `preferences`, `hotkeys`, `containers`, `setup`, `wiki`), legacy redirects (`infrastructure`, `academy`, `roles`), and zero broken imports in M5 routes.
2. **Step 2B.b — Implementation (1 Worker)**:
   - `m4_worker_r2_1`: Implements 100% of `SCOPE.md` exclusively inside `frontend/**`, adds frontend unit tests (`vitest` or `node --test` via `tsx`), and passes `tsc --noEmit`, `biome check src`, unit tests, and `npm run build`.
3. **Step 2B.c/d/e — Parallel Verification Wave (5 Verifiers)**:
   - `m4_reviewer_r2_1`: Full-suite frontend build, TypeScript, Biome lint/check, unit tests, route generation, and demo-purge / zero-native-dialog verification.
   - `m4_reviewer_r2_2`: Exhaustive line-by-line spec/contract/edge-case review across `F01–F03`, `F06–F13`, `F15–F18`, `F25–F26`, `F28`, `F30–F36` + target-scoped unit tests.
   - `m4_challenger_r2_1`: Adversarial edge-case probing on `api-client.ts` (concurrent 401 single-flight refresh, refresh failure instant `/auth/v2/login` redirect, logout Bearer+cookie clearing, `apiDownload` + `getDirectDownloadUrl`), `webauthn.ts` binary/JSON roundtrips, and Preferences/Sound/Hotkey store parity.
   - `m4_challenger_r2_2`: Adversarial probing on `RU/EN/AZ` i18n dictionary parity/interpolation, `<AssetLogo>` fallback resilience, route tree integrity (Group 4 & Group 5 CRUD+View routes + legacy redirects + M5 route survival), and zero native dialogs / zero demo leaks.
   - `m4_auditor_r2_1`: Forensic Integrity Auditor (**intermediate milestone audit** scoped to `frontend/**`).
4. **Step 2B.f — Gate Evaluation & Handoff**.
