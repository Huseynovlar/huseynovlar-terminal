# BRIEFING — 2026-11-25T11:35:00Z

## Mission
Implement M4 (Frontend Core Framework, Tangerine + Floating Bloomberg Shell, RU/EN/AZ i18n, Demo Purge, UI Primitives, Zero Native Dialogs, and Group 4/5 System & Ops Full CRUD + View Pages), verify build/tests/zero native dialogs, sync `.agents/teamwork/`, and commit & push with `[skip ci]`.

## 🔒 My Identity
- Archetype: implementer / qa
- Roles: implementer, qa, specialist
- Working directory: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- State folder: `/home/antigravity/.agents/teamwork/worker_m4_impl`
- Original parent: `24f12e01c4b156e6317b1b7b3e212f7d`
- Milestone: M4

## 🔒 Key Constraints
- Exclusive write ownership: `frontend/` ONLY. Do NOT edit `backend/`, `worker/`, `deploy/`, `config/`, or `mql5/`.
- ZERO fake/demo data (delete all 26 Studio Admin demo routes/data & prod `<TanStackDevtools>`).
- ZERO native dialogs (`window.confirm`, `window.prompt`, `window.alert`, `alert(`) anywhere in `frontend/src/`.
- Preserve existing M5 routes (`default`, `crypto`, `finance`, `treemap`, `analytics`, `calendar`, `dashboard/chat`) and backwards-compatible framework exports so build passes with 0 errors.
- Sync `.agents/teamwork/` -> repo `.agents/teamwork/`, commit & push M4 + `PROJECT.md` + `.agents/teamwork/` to `origin main` with `[skip ci]`.

## Current Parent
- Conversation ID: `24f12e01c4b156e6317b1b7b3e212f7d`
- Updated: 2026-11-25T11:35:00Z

## Task Summary
- **What to build**: M4 Frontend Core Framework, Shell, UI Primitives, Demo Purge, Auth/Lock/Login, and Group 4 (Operations: Containers, Setup, Wiki) & Group 5 (System & Security: Users, Profile, Security, Sessions, Login History, Audit, Preferences, Hotkeys) Full CRUD + View pages.
- **Success criteria**: `npm run build` 0 errors, `npx tsc --noEmit` 0 errors, unit tests pass, 0 native dialogs in `frontend/src`, clean git commit & push with `[skip ci]`.
- **Interface contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` §2–§4, §6
- **Code layout**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` § Code Layout

## Key Decisions Made
- Following M4 Explorer blueprints (`m4_explorer_r2_1`, `m4_explorer_r2_2`, `m4_explorer_r2_3`).

## Change Tracker
- **Files modified**: (in progress)
- **Build status**: pending
- **Pending issues**: none

## Quality Status
- **Build/test result**: pending
- **Lint status**: pending
- **Tests added/modified**: pending

## Artifact Index
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` — architecture & contracts
- `/home/antigravity/.agents/teamwork/m4_explorer_r2_1/handoff.md` — build/UI/purge blueprint
- `/home/antigravity/.agents/teamwork/m4_explorer_r2_2/handoff.md` — core framework/shell blueprint
- `/home/antigravity/.agents/teamwork/m4_explorer_r2_3/handoff.md` — Group 4/5 routes & API contract blueprint
