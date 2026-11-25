# BRIEFING — 2026-11-25T10:53:00Z

## Mission
Execute STEP 0 backup/push and implement, verify, and push milestones M1–M6 (F01–F36 + Russian MT5 EA & keys guide) for Huseynovlar Terminal under strict low-concurrency quota guard (max 1–2 workers at a time).

## 🔒 My Identity
- Archetype: Project Orchestrator (r3)
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: `/home/antigravity/Huseynovlar/huseynovlar-terminal` (secondary: `/home/antigravity/Huseynovlar/server_telegram_bot`)
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r3_1`
- Original parent: Sentinel
- Original parent conversation ID: `e183c8f215e7967e52c68423a58810e1`
- Level: Project Orchestrator
- Scope: Full 36-point spec (`M1`–`M6`) in `PROJECT.md`

## 🔒 My Workflow
- **Pattern**: Project (low-concurrency sequential execution per Sentinel quota guard)
- **Scope document**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`
1. **STEP 0**: Single worker inspects git status, syncs `.agents/teamwork/` into repo, commits & pushes `PROJECT.md` + `.agents/teamwork/` + any verified clean Wave 1 work, notifies Sentinel with SHA.
2. **Dispatch & Execute (Direct sequential per milestone)**:
   - Execute `M1` -> `M2` -> `M3` -> `M4` -> `M5` -> `M6` sequentially (MAX 1–2 workers at a time; NO parallel sub-orchestrators or explorers).
   - After each milestone: verify (`ruff` + `pytest` and/or `npm run build`), run independent review/audit where appropriate within quota guard, sync `.agents/teamwork/`, commit & push to `origin main`, update `progress.md`, notify Sentinel.
3. **On failure**: Retry -> Replace -> Redistribute -> Redesign.
4. **Succession**: Self-succeed at 20 spawns if needed.
- **Work items**:
  1. STEP 0: Sync & backup `.agents/teamwork/` + `PROJECT.md` [in-progress]
  2. M1 [pending]
  3. M2 [pending]
  4. M3 [pending]
  5. M4 [pending]
  6. M5 [pending]
  7. M6 [pending]
- **Current phase**: STEP 0
- **Current focus**: STEP 0 git sync & backup

## 🔒 Key Constraints
- DISPATCH-ONLY orchestrator: never edit source code or run build/test commands directly.
- CRITICAL QUOTA GUARD: MAX 1–2 workers at a time; do NOT rewrite PROJECT.md/SCOPE.md; do NOT spawn multiple sub-orchestrators or parallel explorers.
- Never reuse a subagent after it has delivered its handoff — always spawn fresh.
- Always pass `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim to every subagent.
- Always include verbatim MANDATORY INTEGRITY WARNING in Worker dispatches.

## Current Parent
- Conversation ID: `e183c8f215e7967e52c68423a58810e1`
- Updated: 2026-11-25T10:53:00Z

## Key Decisions Made
- Dispatched single STEP 0 worker (`worker_step0_sync`) immediately to inspect repos, sync `.agents/teamwork/`, and push to GitHub.

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| worker_step0_sync | teamwork_preview_worker | STEP 0 git sync & backup | completed | a3b9f15ff1fa8d41b4a65a7db4fecbac |
| worker_m1_impl | teamwork_preview_worker | M1 infra, config, MQL5 & bot | completed | e761dd74decd53ff1f146e5303a6be0d |
| worker_m2_impl | teamwork_preview_worker | M2 backend core, auth, ops, wiki | completed | f556b8fe67a275115ea23e732831b332 |
| worker_m3_impl | teamwork_preview_worker | M3 backend trading, intel, worker | completed | 98e2992f6c0342445df8bfe273713326 |
| worker_m4_impl | teamwork_preview_worker | M4 frontend core, shell, ops/sys | completed | db8b006ade6f80350549c4c88ef5db0a |
| worker_m5_impl | teamwork_preview_worker | M5 frontend trading, intel, AI | completed | 628ecc7e4e2f4d194a32ed9069c660f8 |
| worker_m6_verify_docs | teamwork_preview_worker | M6 E2E verify & docs/RU guide | completed | a95fa89c39ffda7fa34db7185a6280de |
| auditor_m6_final | teamwork_preview_auditor | M6 whole-project forensic audit | completed (CLEAN) | a5a14ad6b19747ab26ec1e859625c5b9 |
| worker_m6_release | teamwork_preview_worker | M6 final sync, release & prod push | in-progress | 5e503bd7546e5d0f47c9b9f2c78feb96 |

## Succession Status
- Succession required: no
- Spawn count: 9 / 20
- Pending subagents: 5e503bd7546e5d0f47c9b9f2c78feb96
- Predecessor: none
- Successor spawned: not yet spawned
- Successor generation: none
- Successor state folder: none

## Active Timers
- Heartbeat cron: not started
- Safety timer: none

## Artifact Index
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` — 36-point spec & milestones M1–M6
- `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` — immutable user request log
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r3_1/progress.md` — liveness & milestone tracking
