# BRIEFING — 2026-11-24T20:45:00Z

## Mission
Comprehensive frontend architecture, pages, UI/UX, state, i18n, WebSockets, and dead-button/fake-data survey of `/home/antigravity/Huseynovlar/huseynovlar-terminal`.

## 🔒 My Identity
- Archetype: Explorer (`teamwork_preview_explorer`)
- Roles: Investigation, Synthesis (Survey Explorer 2)
- Working directory: `/home/antigravity` (Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal`)
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2`
- Original parent: `b5546ea1526f70a42ec92262cd4e980a`
- Milestone: Survey Phase

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify repository files
- NEVER put `.agents/` inside git repos
- Read `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim in full first
- Inspect `/home/antigravity/image.png` and `/home/antigravity/image_2.png`

## Current Parent
- Conversation ID: `b5546ea1526f70a42ec92262cd4e980a`
- Updated: 2026-11-24T20:45:00Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`, `image.png`, `image_2.png`, `docs/ROADMAP_TODO.md`, `docs/ARCHITECTURE.md`
  - `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/biome.json`, `frontend/Dockerfile`, `deploy/nginx/terminal.conf`, `deploy/docker-compose.yml`
  - All `frontend/src/framework/**` (`api-client.ts`, `terminal-store.ts`, `sound-engine.ts`, `use-live-socket.ts`, `pages.config.ts`, `TerminalPageShell.tsx`, `BloombergTickerTape.tsx`, `HotkeyEngine.tsx`, `LiveAssetChart.tsx`, `MarketTreemap.tsx`, `TerminalHeaderControls.tsx`)
  - All `frontend/src/lib/preferences/**`, `frontend/src/stores/preferences/**`, `frontend/src/scripts/theme-boot.tsx`, `frontend/src/server/server-actions.ts`, `frontend/src/styles/**`
  - All 41 route files in `frontend/src/routes/**` and all header/sidebar components
  - Key backend contracts (`backend/app/modules/auth/router.py`, `backend/app/core/deps.py`, `backend/app/core/config.py`, `backend/app/core/ws_hub.py`, `backend/app/modules/profile/router.py`, `backend/app/modules/accounts/router.py`, `backend/app/modules/intelligence/router.py`, `backend/app/modules/ops/router.py`, `backend/app/modules/charts/router.py`) & `mql5/*`
- **Key findings**:
  - Stack is TanStack Start (`@tanstack/react-start` 1.169.7) + Vite 8 + Nitro + React 19.3 + Tailwind v4 + `@base-ui/react` shadcn (`base-nova`), NOT Next.js. `tsc --noEmit` currently has 4 TS errors; `biome lint src` has 28 errors; 0 frontend tests exist.
  - Identified exact root causes for every bug in `ORIGINAL_REQUEST.md`: WebAuthn `TypeError` (raw JSON strings passed as `BufferSource`), `<a href>`/`window.open` `Authentication required` + `Invalid or expired token` (`sessionStorage`-only token, missing `ht_access_token` cookie, zero 401 refresh interceptor in `api-client.ts`), zero i18n dictionary (`language` read nowhere), `MarketTreemap` stuck on `PREVIEW_TREEMAP` fake NASDAQ-100 data + backend `CONFIG_DIR` `/config` bug, `/dashboard/calendar` running untouched Studio Admin demo FullCalendar, 5000ms interval clock jump on `/dashboard/default`, disconnected Sidebar Customizer & Hotkey Editor, missing sound preview in `roles/route.tsx`, zero `<Skeleton>` shimmer or `toast.add` usage in active pages, and passive WS without initial handshake/Redis bridge.
- **Unexplored areas**: None — all frontend routes, stores, components, and backend integration points inspected.

## Key Decisions Made
- Organize `handoff.md` with complete 5-component Handoff Protocol structure covering Stack/Build/Tests, Complete 41-Route & Component Audit + CRUD Matrix, All 7 Specific Bug Deep-Dives with exact file:line citations, and Actionable Architecture & Fix Blueprint.

## Artifact Index
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/DISPATCH.md` — Dispatch log
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/BRIEFING.md` — Persistent working memory
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/progress.md` — Liveness heartbeat
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/handoff.md` — Comprehensive Frontend Survey Handoff Report
