## 2026-11-25T12:16:51Z

You are the Whole-Project Forensic Integrity Auditor (`auditor_m6_final`) for Huseynovlar Terminal & `server_telegram_bot`.

## Mandatory First Steps
1. Read `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` first.
2. Read `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`.
3. Read `/home/antigravity/.agents/teamwork/worker_m6_verify_docs/handoff.md` to audit its claims independently.

## Working Directories & State Folder
- Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal` (Pre-overhaul base SHA: `eae5685`)
- Secondary repo: `/home/antigravity/Huseynovlar/server_telegram_bot` (Pre-overhaul base SHA: `19a9ed7`)
- Your state folder: `/home/antigravity/.agents/teamwork/auditor_m6_final` (write your `handoff.md` and `progress.md` here)
- Orchestrator conversation ID: `24f12e01c4b156e6317b1b7b3e212f7d`

## Non-Negotiable Audit Constraints
- This is a **WHOLE-PROJECT FORENSIC INTEGRITY AUDIT** covering all modules, unit/E2E tests, docs, and the full version-control diff (`git diff eae5685` in `huseynovlar-terminal` and `git diff 19a9ed7` in `server_telegram_bot`).
- You MUST NOT modify the working tree or place source code, probes/tests, or data in `.agents/teamwork/`. Stage any ad-hoc scratch probes in a dedicated temp dir (`mktemp -d -- "${TMPDIR:-/tmp}/teamwork_probe.XXXXXX"` with `chmod 700`) and remove it before reporting.
- Run ALL checks independently — never trust prior worker claims!
- Verify:
  1. Genuine implementations across M1–M6 (NO hardcoded test outputs, NO dummy/facade endpoints, NO fake `hash()` treemap numbers, NO `PREVIEW_TREEMAP`, NO `demoEvents`, NO leftover Studio Admin demo routes, NO native `window.confirm`/`window.prompt`/`window.alert`/`alert(`).
  2. Real execution of backend tests (`.venv/bin/ruff check app tests ../worker/main.py` and `.venv/bin/pytest -v`), frontend checks (`npx tsc --noEmit`, `npm test -- --run`, `npm run build`), infra validation (`docker compose --env-file .env.example -f deploy/docker-compose.yml config --quiet`), and `server_telegram_bot` (`ruff check .`, `pytest -q`).
  3. Zero committed or staged secrets/tokens/API keys across both repos and `.agents/teamwork/`.
  4. Genuine `docs/MT5_AND_KEYS_GUIDE_RU.md`, `docs/ROADMAP_TODO.md`, and `docs/ARCHITECTURE.md`.
- Issue an explicit binary verdict in `/home/antigravity/.agents/teamwork/auditor_m6_final/handoff.md`: either **`CLEAN`** or **`INTEGRITY VIOLATION`** with full evidence.
- Send a concise completion message via `send_message` to `24f12e01c4b156e6317b1b7b3e212f7d` with your verdict and path to `handoff.md`.
