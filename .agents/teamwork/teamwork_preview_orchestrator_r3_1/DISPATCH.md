# Dispatch Log

## 2026-11-25T10:52:56Z
From: e183c8f215e7967e52c68423a58810e1 (Sentinel)

You are the Project Orchestrator (r3) for Huseynovlar Terminal.

## Identity & Paths
- Role: Project Orchestrator (r3)
- Primary working directory: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- Secondary alerts bot repo: `/home/antigravity/Huseynovlar/server_telegram_bot`
- Your state folder: `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r3_1` (write your `BRIEFING.md`, `progress.md`, `handoff.md` here)
- Original User Request (read-only): `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- Existing Complete 36-point Spec: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`

## STEP 0 — DO THIS FIRST BEFORE ANYTHING ELSE!
1. Dispatch a single worker to inspect `git status` in `/home/antigravity/Huseynovlar/huseynovlar-terminal` and `/home/antigravity/Huseynovlar/server_telegram_bot`, plus `/home/antigravity/.agents/teamwork/`.
2. Sync `/home/antigravity/.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/` (ensure no secrets and ensure `.gitignore` does not block it) alongside `PROJECT.md` (and any already-completed clean code changes from the previous interrupted Wave 1 run).
3. Commit and push `PROJECT.md` + `.agents/teamwork/` (and any verified clean changes) to `Huseynovlar/huseynovlar-terminal` `origin main` IMMEDIATELY so the user's teamwork state is safely backed up on GitHub right now! (Also push `server_telegram_bot` if it has clean changes.)
4. Immediately send a status message back to the Sentinel once STEP 0 is pushed (with commit SHA).

## CRITICAL QUOTA / RATE-LIMIT GUARD (MANDATORY!)
- Previous two runs hit `generic::resource_exhausted: Individual quota reached` because spawning 4+ concurrent sub-orchestrators + parallel workers spiked quota.
- **DO NOT re-audit or rewrite `PROJECT.md` or `SCOPE.md`** — `PROJECT.md` (`F01`–`F36`) and `.agents/teamwork/` are already complete on disk!
- **DO NOT spawn multiple sub-orchestrators or parallel explorers.** Keep concurrency to **MAX 1–2 workers at a time** (sequential per milestone is preferred!).
- Skip verbose intermediate markdowns and planning loops. Focus straight on **modifying the actual codebase files** in order: `M1` -> `M2` -> `M3` -> `M4` -> `M5` -> `M6`.
- After each milestone:
  - Verify with `ruff` + `pytest` (backend) and/or `npm run build` (frontend).
  - Sync `/home/antigravity/.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/`.
  - Commit and push working commits to `Huseynovlar/huseynovlar-terminal` `origin main` (and `server_telegram_bot` if modified).
  - Update your `progress.md` and notify the Sentinel with a brief summary.

## Full Scope Reference
Read `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` and the latest follow-ups in `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` (especially the 2026-11-24T21:04:35Z, 2026-11-25T05:48:27Z, and 2026-11-25T10:52:03Z entries). Ensure all 36 requirements + final Russian guide on keys and connecting 2 MT5 EAs (`mt5-xau`, `mt5-ustec`) are delivered and verified.

When all milestones (M1–M6) are complete, verified, and pushed, send your completion report to the Sentinel for the mandatory Victory Audit.
