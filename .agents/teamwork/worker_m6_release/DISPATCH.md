## 2026-11-25T12:20:38Z
You are the M6 Final Release & Production Push Worker (`worker_m6_release`) for Huseynovlar Terminal.

## Mandatory First Step
Read `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` first.

## Working Directories & State Folder
- Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- Secondary repo: `/home/antigravity/Huseynovlar/server_telegram_bot`
- Your state folder: `/home/antigravity/.agents/teamwork/worker_m6_release` (write your `handoff.md` and `progress.md` here)
- Orchestrator conversation ID: `24f12e01c4b156e6317b1b7b3e212f7d`

## Mandatory Integrity Warning
DO NOT CHEAT. Verify every git command, secret scan, and GitHub Actions check authentically.

## Objectives (M6-C: Final Sync, Secret Scan, Production Push WITHOUT `[skip ci]`, and CI Check)
1. Sync `/home/antigravity/.agents/teamwork/` -> `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/` (`rsync -a --delete`).
2. Run a secret scan across staged/synced `.agents/teamwork/` and all modified files to guarantee ZERO secrets, tokens, API keys, or `AGENTS.md`/`GEMINI.md` files.
3. In `/home/antigravity/Huseynovlar/huseynovlar-terminal`:
   - Stage `backend/tests/test_e2e_full_journey.py`, `docs/ROADMAP_TODO.md`, `docs/ARCHITECTURE.md`, `docs/MT5_AND_KEYS_GUIDE_RU.md`, `PROJECT.md`, and `.agents/teamwork/` (and any other clean M6 files).
   - Commit with a clear production release message **WITHOUT `[skip ci]`** (e.g., `feat(release): complete institutional terminal overhaul (F01-F36), E2E suite, docs & RU MT5 guide`) and push to `origin main` so GitHub Actions CI & `.github/workflows/deploy-production.yml` trigger automatically!
4. Verify `/home/antigravity/Huseynovlar/server_telegram_bot` is clean and up-to-date with `origin/main` (report its HEAD SHA).
5. Wait ~10–15 seconds after push, then check GitHub Actions runs using `gh run list --repo Huseynovlar/huseynovlar-terminal --limit 5` (if `gh` is available and authenticated) to confirm the CI and production deploy workflows triggered cleanly. Record the run IDs, workflow names, statuses, and URLs.
6. Write `handoff.md` in `/home/antigravity/.agents/teamwork/worker_m6_release/handoff.md` with exact commit SHAs, push output, secret scan result, and GitHub Actions run status.
7. Send a concise completion message via `send_message` to `24f12e01c4b156e6317b1b7b3e212f7d`.
