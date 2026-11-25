# BRIEFING — 2026-11-24T20:43:30Z

## Mission
Comprehensive read-only survey of backend, worker, infra, Docker networking, Auth/WebAuthn/cookies, DB models/APIs, WebSockets, MQL5/MT5 bridge, screenshots, VM tools, and `server_telegram_bot` integration.

## 🔒 My Identity
- Archetype: teamwork_preview_explorer (Survey Explorer 1)
- Roles: Explorer, Synthesizer
- Working directory: `/home/antigravity`
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1`
- Original parent: `b5546ea1526f70a42ec92262cd4e980a`
- Milestone: Initial Architecture & Bug Survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify repository files
- Write ONLY to `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1`
- NEVER put `.agents/` inside git repos
- Read `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim in full first

## Current Parent
- Conversation ID: `b5546ea1526f70a42ec92262cd4e980a`
- Updated: 2026-11-24T20:43:30Z

## Investigation State
- **Explored paths**: `/home/antigravity/image*.png`, `huseynovlar-terminal` (`backend/`, `worker/`, `mql5/`, `config/`, `deploy/`, `.github/workflows/`, `docs/`, key `frontend/src/framework/*` & route callers), `server_telegram_bot` (`app/core/main.py`, `app/common/web.py`, `app/core/services/notification_service.py`, `deploy/docker-compose.yml`, `scripts/server/deploy.sh`, `.github/workflows/`).
- **Key findings**:
  1. `backend/app/core/config.py:37` `parents[3] / "config"` resolves to `/config` instead of `/app/config` inside Docker, breaking all YAML configs (`news_sources.yaml`, `treemap.yaml`, `assets.default.yaml`, `alerts.default.yaml`).
  2. `deploy/docker-compose.yml:65` omits `panel_egress` and `dns` on `terminal-backend`, blocking all outbound calls (Yahoo Finance, RSS refresh, Gemini, GeoIP, Telegram); `uvicorn` lacks `--forwarded-allow-ips=*`.
  3. `auth/router.py:127-135` never sets `ht_access_token` cookie (breaking all direct/incognito downloads), `api-client.ts` lacks 401 refresh interceptor (causing `Invalid or expired token` after 30 min on `mt5-xau`/`mt5-ustec`), and WebAuthn passes raw base64url strings instead of `Uint8Array`/`ArrayBuffer` (`TypeError`).
  4. `intelligence/router.py` returns `hash()` fake data for `/treemap`, never populates `EconomicEvent` (`/calendar` always empty), `default/route.tsx:84` calls `/accounts/robots` (404 vs `/robots`), `accounts/router.py:251` omits `live_status`/`live_state_json`, `ws_hub.py` is in-memory only (no Redis Pub/Sub, no heartbeat/auth), `alembic/versions/` is empty (`create_all` won't alter existing tables).
  5. `mql5/ExnessPanelBridge.mq5` uses dotless `http://terminal-backend:8000` (rejected by MT5 UI -> `err=4014`) and never reads `ep_ipc` written by `ExnessPanelHook.mqh`; user's robot in `image_2.png` is `NasdaqPulse v3.01 ALL-WEATHER` on `USTECc, M5` (`¢2600` USC Cent account).
  6. `server_telegram_bot/app/common/web.py:18-23` omits `"/internal/webhooks/trading"` from `DEFAULT_AUTH_SKIP_PATHS` (rejects webhook with 401!), its `deploy-production.yml` doesn't sync `docker-compose.yml`, and `127.0.0.1:18080` is unreachable from inside `terminal-backend`/`terminal-worker` containers.
- **Unexplored areas**: None within backend/infra/MQL5/auth/WS/bot scope.

## Key Decisions Made
- Verified backend test suite in existing `backend/.venv` using scratch `TMPDIR` (9/9 passed, scratch cleaned).
- Synthesizing complete 5-component `handoff.md` and notifying parent orchestrator.

## Artifact Index
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/DISPATCH.md` — Dispatch log
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/BRIEFING.md` — Working memory
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/progress.md` — Liveness heartbeat
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md` — Complete 5-component survey report
