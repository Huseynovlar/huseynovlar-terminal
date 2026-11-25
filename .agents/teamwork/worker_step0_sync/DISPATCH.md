## 2026-11-25T10:53:43Z

You are the STEP 0 Git Sync & Backup Worker for Huseynovlar Terminal.

## Mandatory First Step
Read `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` first before doing anything else.

## Working Directories & State Folder
- Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- Secondary repo: `/home/antigravity/Huseynovlar/server_telegram_bot`
- Your state folder: `/home/antigravity/.agents/teamwork/worker_step0_sync` (write your `handoff.md` and `progress.md` here)
- Orchestrator conversation ID: `24f12e01c4b156e6317b1b7b3e212f7d`

## Objective (STEP 0 — Execute Immediately)
1. Inspect `git status`, `git diff --stat`, and `git log -n 5 --oneline` in both repos; list `/home/antigravity/.agents/teamwork/`.
2. Check for any already-completed code changes from previous interrupted Wave 1 run; verify clean/passing vs partial/broken.
3. Sync `/home/antigravity/.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/`, scan for secrets, check `.gitignore`.
4. Stage, commit, and push `PROJECT.md` + `.agents/teamwork/` (plus `.gitignore` if edited, plus verified clean code changes) to `Huseynovlar/huseynovlar-terminal` `origin main`.
5. If `server_telegram_bot` has verified clean changes, commit and push to its `origin main`.
6. Write `handoff.md` in `/home/antigravity/.agents/teamwork/worker_step0_sync/handoff.md`.
7. Send completion message via `send_message` to `24f12e01c4b156e6317b1b7b3e212f7d`.
