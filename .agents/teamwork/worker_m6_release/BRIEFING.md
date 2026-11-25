# BRIEFING — 2026-11-25T12:20:38Z

## Mission
Execute M6-C Final Release & Production Push for Huseynovlar Terminal: sync `.agents/teamwork/`, run secret/layout scans, commit and push WITHOUT `[skip ci]` to `origin main`, verify `server_telegram_bot` clean/up-to-date, verify GitHub Actions CI/CD runs, and hand off.

## 🔒 My Identity
- Archetype: worker_m6_release
- Roles: implementer, qa, specialist
- Working directory: /home/antigravity/Huseynovlar/huseynovlar-terminal
- State folder: /home/antigravity/.agents/teamwork/worker_m6_release
- Original parent: 24f12e01c4b156e6317b1b7b3e212f7d
- Milestone: M6-C (Final Release & Production Push)

## 🔒 Key Constraints
- DO NOT CHEAT. Verify every git command, secret scan, and GitHub Actions check authentically.
- Commit message MUST NOT contain `[skip ci]`.
- Guarantee ZERO secrets, tokens, API keys, or `AGENTS.md`/`GEMINI.md` files in synced `.agents/teamwork/` or staged files.
- `.agents/teamwork/` must contain only metadata (no source, tests, data, `AGENTS.md`, or `GEMINI.md`).

## Current Parent
- Conversation ID: 24f12e01c4b156e6317b1b7b3e212f7d
- Updated: not yet

## Task Summary
- **What to build**: Final M6 release commit & push to `origin main` triggering CI & deploy-production.yml.
- **Success criteria**:
  1. `.agents/teamwork/` synced cleanly via `rsync -a --delete`.
  2. Secret & forbidden filename scan passes with ZERO hits.
  3. Clean M6 files staged, committed without `[skip ci]`, and pushed to `origin main`.
  4. `server_telegram_bot` verified clean and up-to-date with `origin/main` (HEAD SHA recorded).
  5. GitHub Actions runs verified ~10-15s after push.
  6. `handoff.md` written and completion message sent to parent.
- **Interface contracts**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Code layout**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`

## Key Decisions Made
- Starting M6-C release verification and sync.

## Change Tracker
- **Files modified**: TBD
- **Build status**: TBD
- **Pending issues**: None

## Quality Status
- **Build/test result**: TBD
- **Lint status**: TBD
- **Tests added/modified**: None (release worker)

## Loaded Skills
- None

## Artifact Index
- `/home/antigravity/.agents/teamwork/worker_m6_release/DISPATCH.md` — Dispatch instructions
- `/home/antigravity/.agents/teamwork/worker_m6_release/BRIEFING.md` — Persistent working memory
- `/home/antigravity/.agents/teamwork/worker_m6_release/progress.md` — Heartbeat log
- `/home/antigravity/.agents/teamwork/worker_m6_release/handoff.md` — Final handoff report (pending)
