# BRIEFING — 2026-11-24T20:44:00Z

## Mission
Mine all authoritative documentation, user requirements (`ORIGINAL_REQUEST.md`), roadmap/architecture docs, screenshots, and deployment/integration contracts across `huseynovlar-terminal` and `server_telegram_bot` to produce a Zero-Gap Specification Document in `handoff.md`.

## 🔒 My Identity
- Archetype: Specification Miner (`teamwork_preview_spec_miner`)
- Roles: Survey Spec Miner 3 — Exhaustive Specification Matrix, Roadmap/Docs Audit & Deployment/Integration Contract Mining
- Working directory: `/home/antigravity`
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3`
- Original parent: `b5546ea1526f70a42ec92262cd4e980a`
- Milestone: Survey & Specification Mining

## 🔒 Key Constraints
- Read-only specification miner: NEVER write code or modify repository files; NEVER put `.agents/` inside git repos.
- Write `DISPATCH.md`, `BRIEFING.md`, `progress.md`, and `handoff.md` ONLY inside `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3`.
- Read `ORIGINAL_REQUEST.md` line-by-line (lines 4–158) and map every single requirement + every uncompleted item in `docs/ROADMAP_TODO.md`.
- Inspect `docs/ROADMAP_TODO.md`, `docs/ARCHITECTURE.md`, `README.md`, `.env.example`, deploy/workflow files in both repos, prior brain artifacts, and screenshots (`/home/antigravity/image.png`, `/home/antigravity/image_2.png`, etc.).
- Produce a Zero-Gap Specification Document with Traceability Matrix, Target Information Architecture & Page Inventory, Deployment & Git Contract, and Specification Miner Feature/Edge Case tables, formatted per the 5-Component Handoff Protocol.

## Current Parent
- Conversation ID: `b5546ea1526f70a42ec92262cd4e980a`
- Updated: 2026-11-24T20:44:00Z

## Loaded Skills
- None loaded from dispatch (no Antigravity skill paths specified in dispatch).

## Task Summary
- **What to build**: Zero-Gap Specification Document (`handoff.md`) covering 100% of user requirements, roadmap TODOs, target IA/routes, and deployment/integration contracts.
- **Success criteria**: Zero unmapped user lines or roadmap items; exact file/line observations from repos, workflows, deploy scripts, Telegram bot webhook, MQL5 files, and attached screenshots.
- **Interface contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/docs/ARCHITECTURE.md`, `/home/antigravity/Huseynovlar/huseynovlar-terminal/docs/ROADMAP_TODO.md`
- **Code layout**: `/home/antigravity/Huseynovlar/huseynovlar-terminal` and `/home/antigravity/Huseynovlar/server_telegram_bot`

## Key Decisions Made
- Read `ORIGINAL_REQUEST.md` verbatim (lines 1–158) before any repository inspection.
- Inspected all 4 uploaded screenshots (`image.png`, `image_2.png`, `image_3.png`, `image_4.png`), uncovering `NasdaqPulse v3.01 ALL-WEATHER USTECc` cent account EA and MT5 WebRequest dotted-URL dialog.
- Identified critical production root causes across config, auth, Docker networking, migrations, WebSocket, and MQL5:
  1. `backend/app/core/config.py:37` `Path(__file__).resolve().parents[3] / "config"` resolves to `/config` instead of `/app/config` inside Docker, causing `load_yaml_config` to return `{}` in production (breaking Verified Sources, News refresh, Treemap universes, and Default Assets seed).
  2. `backend/app/modules/auth/router.py:127` never sets `ht_access_token` cookie while `core/deps.py:26` expects it, breaking all direct downloads (`bridge.set`, `statement.csv`) and Incognito; `api-client.ts` has no 401 -> `/auth/refresh` interceptor, causing `Invalid or expired token` after 30 minutes.
  3. `backend/alembic/versions/` is empty and `main.py:31` only runs `Base.metadata.create_all` (no column migrations on existing PostgreSQL tables).
  4. `deploy/docker-compose.yml` omits `panel_egress` and third-party env vars on `backend`, and `ALERTS_BOT_WEBHOOK_URL=http://127.0.0.1:18080/...` points to container loopback instead of `huseynovlar-core:8080`.
  5. `ws_hub.py` is process-local in-memory without Redis Pub/Sub or heartbeat frames.
  6. `mql5/ExnessPanelBridge.mq5` does not yet read `MQL5/Files/ep_ipc/events_<login>.jsonl` written by `ExnessPanelHook.mqh`, and uses undotted `http://terminal-backend:8000` rejected by MT5 WebRequest UI (`err=4014`).

## Artifact Index
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/DISPATCH.md` — Dispatch log
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/BRIEFING.md` — Persistent working memory
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/progress.md` — Liveness heartbeat
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/handoff.md` — Zero-Gap Specification Document & 5-Component Handoff Report
