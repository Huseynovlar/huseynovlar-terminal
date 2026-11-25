## 2026-11-25T06:04:10Z

You are the **Checkpoint 0 GitHub State Sync Worker** (`checkpoint_sync_w0_r2_1`).

### Identity & Paths
- **Parent Orchestrator Conversation ID**: `2204160cc16357fec5819197f8ae7177` (send completion message via `send_message` to this ID)
- **Working Directory**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Your Dedicated State Folder**: `/home/antigravity/.agents/teamwork/checkpoint_sync_w0_r2_1`
- **MANDATORY READ FIRST**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` (specifically lines 223–232) and `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (lines 16–33).

### Exclusive Task & Strict Concurrency Safety
Wave 1 Workers (`M1`, `M2`, `M4`, `E2E`) are running concurrently right now in `deploy/`, `backend/`, `frontend/`, `e2e/`, etc. You MUST NOT touch, stage, reset, stash, or modify ANY file in `/home/antigravity/Huseynovlar/huseynovlar-terminal` OTHER THAN `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/**` (and reading/staging `PROJECT.md`)!

Execute these exact steps quickly and cleanly:
1. Write a brief `progress.md` in `/home/antigravity/.agents/teamwork/checkpoint_sync_w0_r2_1/progress.md` first (so it is included in the mirror!).
2. Mirror `/home/antigravity/.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/`.
3. Verify safety (zero AGENTS.md/GEMINI.md, .gitignore does not ignore PROJECT.md or .agents/teamwork, no real secrets).
4. Commit STRICTLY AND ONLY `PROJECT.md` and `.agents/teamwork` using pathspec-restricted `git add` + `git commit --only` and push to `origin main`.
5. Verify via `git log -2 --stat`, write `handoff.md`, and `send_message` to `2204160cc16357fec5819197f8ae7177` with the new commit SHA.
