# BRIEFING — 2026-11-25T06:04:10Z

## Mission
Mirror `.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/`, verify safety/secrets/gitignore, and commit+push ONLY `PROJECT.md` and `.agents/teamwork` to `origin/main` without affecting concurrent Wave 1 workers.

## 🔒 My Identity
- Archetype: Worker
- Roles: implementer, qa, specialist
- Working directory: /home/antigravity/Huseynovlar/huseynovlar-terminal
- State folder: /home/antigravity/.agents/teamwork/checkpoint_sync_w0_r2_1
- Original parent: 2204160cc16357fec5819197f8ae7177
- Milestone: Checkpoint 0 GitHub State Sync

## 🔒 Key Constraints
- Wave 1 workers (`M1`, `M2`, `M4`, `E2E`) are concurrently editing `deploy/`, `backend/`, `frontend/`, `e2e/`, etc.
- NEVER touch, stage, reset, stash, or modify ANY file in `/home/antigravity/Huseynovlar/huseynovlar-terminal` OTHER THAN `.agents/teamwork/**` (and reading/staging `PROJECT.md`).
- Zero files named `AGENTS.md` or `GEMINI.md` inside `.agents/teamwork`.
- Confirm no real secrets exist in `PROJECT.md` or `.agents/teamwork/`.
- Commit strictly with `git commit --only ... -- PROJECT.md .agents/teamwork` and `[skip ci]`.

## Current Parent
- Conversation ID: 2204160cc16357fec5819197f8ae7177
- Updated: 2026-11-25T06:04:10Z

## Task Summary
- **What to build**: Checkpoint 0 state sync commit on `origin/main` (`PROJECT.md` + `.agents/teamwork/**`).
- **Success criteria**: `origin/main` updated with commit touching ONLY `PROJECT.md` and `.agents/teamwork/**`, zero secrets/AGENTS.md/GEMINI.md, Wave 1 working tree untouched.
- **Interface contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`
- **Code layout**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` § Code Layout

## Key Decisions Made
- Use `rsync -a --delete --exclude='AGENTS.md' --exclude='GEMINI.md'` and pathspec-restricted `git add --` + `git commit --only --` to guarantee isolation from concurrent Wave 1 workers.

## Change Tracker
- **Files modified**: None yet
- **Build status**: N/A (state sync task)
- **Pending issues**: Mirror, verify, commit, push

## Quality Status
- **Build/test result**: Pending verification
- **Lint status**: Clean
- **Tests added/modified**: N/A (repository state sync)

## Loaded Skills
- None

## Artifact Index
- `/home/antigravity/.agents/teamwork/checkpoint_sync_w0_r2_1/DISPATCH.md` — Dispatch message
- `/home/antigravity/.agents/teamwork/checkpoint_sync_w0_r2_1/BRIEFING.md` — Agent working memory
