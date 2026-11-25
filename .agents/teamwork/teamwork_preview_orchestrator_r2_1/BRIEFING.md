# BRIEFING — 2026-11-25T06:01:30Z

## Mission
Resume and complete the full institutional-grade overhaul, verification, E2E + adversarial hardening, GitHub teamwork state persistence, production `git push origin main` auto-deploy, and Russian operational documentation for Huseynovlar Terminal (`/home/antigravity/Huseynovlar/huseynovlar-terminal`) and `server_telegram_bot` (`/home/antigravity/Huseynovlar/server_telegram_bot`), conserving quota by reusing the completed Step 0 Survey (`survey_1`, `survey_2`, `survey_3`) and `PROJECT.md` (`F01`–`F37`).

## 🔒 My Identity
- Archetype: `teamwork_preview_orchestrator`
- Level: Project Orchestrator (top-level orchestrator under Sentinel)
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: `/home/antigravity` (Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal`, Secondary repo: `/home/antigravity/Huseynovlar/server_telegram_bot`)
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r2_1`
- Original parent: Project Sentinel (`sentinel_r2_1`)
- Original parent conversation ID: `16cf05aa5bbeedd90d158c15f92d08be`
- Scope: All milestones across Implementation Track (`M1`–`M6`) + E2E Testing Track (`E2E`) + GitHub Teamwork Checkpoints + Production Push & Russian Guide (`ORIGINAL_REQUEST.md` + `PROJECT.md`)

## 🔒 My Workflow
- **Pattern**: Project Pattern (Dual Track: Implementation Track + E2E Testing Track)
- **Scope document**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`
1. **Decompose**: Reused completed Step 0 Survey (`survey_1`, `survey_2`, `survey_3`) and verified 37-feature inventory (`F01`–`F37`) in `PROJECT.md` across 6 Implementation Milestones (`M1`, `M2`, `M3`, `M4`, `M5`, `M6`) + `E2E` Testing Track, with disjoint file ownership and 6 cross-module Interface Contracts.
2. **Dispatch & Execute**:
   - **Delegate (sub-orchestrator)**: Spawn sub-orchestrators per milestone via `teamwork_preview_orchestrator` (Wave 1 in parallel: `M1`, `M2`, `M4`, `E2E`; Wave 2 as prerequisites complete: `M3` after `M2`, `M5` after `M3`+`M4`; Wave 3: `M6` Final Milestone Phase 1 Tiers 1–4 E2E Pass, Phase 2 Tier 5 Adversarial Hardening + Whole-Project Forensic Audit, Phase 3 Docs + `.agents/teamwork/` mirror + `git commit` & `git push origin main` + GitHub Actions deploy verification). Each single-cycle sub-orchestrator runs 3 Explorers/Spec Miners (fast targeted pass reusing Survey reports) -> 1 Worker -> parallel verification wave (2 Reviewers + 2 Challengers + 1 Forensic Auditor) -> Gate.
3. **On failure** (in this order):
   - Retry: nudge stuck agent or re-send task
   - Replace: spawn fresh agent with partial progress
   - Skip: proceed without (only if non-critical; Auditor is NEVER skippable)
   - Redistribute: split stuck agent's remaining work
   - Redesign: re-partition decomposition (Project Orchestrator cannot escalate to Sentinel; must redesign)
4. **Succession**: Self-succeed at 20 cumulative spawns once active non-orchestrator subagents complete: write soft `handoff.md`, update `BRIEFING.md` & `progress.md`, kill active cron timers, create `_gen2` state folder, copy living files, spawn successor passing Sentinel `16cf05aa5bbeedd90d158c15f92d08be` as parent, and notify running sub-orchestrators of new parent ID.
- **Work items**:
  1. Step 0 Survey & `PROJECT.md` (`F01`–`F37`) Verification [done — reused from disk + updated for `r2_1`]
  2. Wave 1 Parallel Execution: `M1` (Infra/Docker/MQL5/Bot), `M2` (Backend Core/Auth/DB/Ops/Wiki), `M4` (Frontend Core/Shell/i18n/Dialogs/System/Ops), `E2E` (4-Tier Opaque-Box Test Suite `>=414` tests) + Checkpoint 0 GitHub Sync [in-progress]
  3. Wave 2 Execution: `M3` (Backend Trading/Intelligence/Worker — after `M2`) & `M5` (Frontend Trading/Markets/Intelligence/AI — after `M3`+`M4`) + Checkpoint 1/2 GitHub Sync [pending]
  4. Wave 3 Final Milestone `M6`: Phase 1 (100% E2E Tiers 1–4 Pass), Phase 2 (Tier 5 Adversarial Hardening + Whole-Project Audit), Phase 3 (Docs, `.agents/teamwork/` sync, `git commit` & `git push origin main`, GitHub Actions verification) [pending]
  5. Final `handoff.md` + Comprehensive Russian Instructions & Sentinel Notification [pending]
- **Current phase**: Phase 2 (Wave 1 Sub-Orchestrators Running + Checkpoint 0 GitHub Sync)
- **Current focus**: Monitoring Wave 1 (`M1`, `M2`, `M4`, `E2E`) and completing Checkpoint 0 GitHub teamwork state backup

## 🔒 Key Constraints
- DISPATCH-ONLY orchestrator: NEVER write/modify source code or run build/test commands directly; edit ONLY `.md` state files in state folder, shared `PROJECT.md`/`TEST_INFRA.md`/`TEST_READY.md`, and `[successor_state_dir]` on succession.
- Conserve user quota strictly: reuse existing Survey handoffs and `SCOPE.md` blueprints; run `E2E` as a streamlined single-cycle sub-orchestrator rather than nested sub-sub-orchestrators.
- Persist all `.agents/teamwork/**` (scrubbed of secrets, zero `AGENTS.md`/`GEMINI.md`) + `PROJECT.md` into `Huseynovlar/huseynovlar-terminal` on GitHub at Checkpoint 0, Post-Wave 1, Post-Wave 2, and Final `M6` Push (`ORIGINAL_REQUEST.md:223-232`). Pre-overhaul base SHAs: `eae5685` (`huseynovlar-terminal`), `19a9ed7` (`server_telegram_bot`).
- Zero fake/mock/placeholder data, zero stubs, zero dead buttons, ZERO native `window.confirm` / `window.prompt` / `alert`.
- BINARY VETO on Forensic Auditor `INTEGRITY VIOLATION`.
- Include `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` path verbatim in every subagent dispatch.
- Never reuse a subagent after it has delivered its handoff — always spawn fresh.

## Current Parent
- Conversation ID: `16cf05aa5bbeedd90d158c15f92d08be`
- Updated: 2026-11-25T06:01:30Z

## Key Decisions Made
- Dispatched Wave 1 (`M1`, `M2`, `M4`, `E2E`) concurrently after updating `PROJECT.md` with `F01`–`F37` contracts.
- Incorporated urgent user directive (`2026-11-25T05:57:20Z`) to mirror `/home/antigravity/.agents/teamwork/` into `huseynovlar-terminal/.agents/teamwork/` and push checkpoints to GitHub (`origin/main`), notifying all 4 active Wave 1 sub-orchestrators of the `.gitignore` rule and `eae5685` / `19a9ed7` auditor base SHAs.

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| `teamwork_preview_sub_orch_m1_r2_1` | `teamwork_preview_orchestrator` | Milestone M1: Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot` | in-progress | `44e6fe3d5c0288fb9653a8b58624e732` |
| `teamwork_preview_sub_orch_m2_r2_1` | `teamwork_preview_orchestrator` | Milestone M2: Backend Core, DB Schema Sync, Auth/Passkeys/Cookies/Logout/RBAC, Redis WS Hub & Ops/Wiki | in-progress | `b323eec972b4d79a0e7f6fddb529251f` |
| `teamwork_preview_sub_orch_m4_r2_1` | `teamwork_preview_orchestrator` | Milestone M4: Frontend Core, `tangerine`+`floating`, `RU/EN/AZ` i18n, shadcn Dialogs, Demo Purge & System/Ops | in-progress | `f3656dde55325b1406d06045aa8c52df` |
| `teamwork_preview_sub_orch_e2e_r2_1` | `teamwork_preview_orchestrator` | E2E Testing Track: `TEST_INFRA.md`, `e2e/` Tiers 1–4 (`>=414` tests across `F01`–`F36`), `TEST_READY.md` | in-progress | `ee44b731d7e26a070c89d0798fdec0f6` |
| `checkpoint_sync_w0_r2_1` | `teamwork_preview_worker` | Checkpoint 0: Mirror `.agents/teamwork/` & `PROJECT.md` into `huseynovlar-terminal` and push `[skip ci]` to GitHub | in-progress | `93e666ec2f94849f7ca46be1ecd8e55e` |

## Succession Status
- Succession required: no
- Spawn count: 5 / 20
- Pending subagents: `44e6fe3d5c0288fb9653a8b58624e732`, `b323eec972b4d79a0e7f6fddb529251f`, `f3656dde55325b1406d06045aa8c52df`, `ee44b731d7e26a070c89d0798fdec0f6`, `93e666ec2f94849f7ca46be1ecd8e55e`
- Predecessor: `teamwork_preview_orchestrator_r1_1`
- Successor spawned: not yet spawned
- Successor generation: none
- Successor state folder: none

## Active Timers
- Heartbeat cron: `2204160cc16357fec5819197f8ae7177/task-31` (`*/20 * * * *`)
- Safety timer: none
- On succession: kill all timers before spawning successor
- On context truncation: handle timers as step 4 of the State Recovery section of your prompt says

## Artifact Index
- `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` — Verbatim user requests & follow-ups
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` — Master Architecture, 37-Feature Inventory, Milestones & Interface Contracts
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md` — Backend/Infra/MQL5/Bot Survey
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/handoff.md` — Frontend/UX/Routes Survey
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/handoff.md` — Requirements Matrix & Sitemap
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r2_1/DISPATCH.md` — Dispatch log from Sentinel (`r2_1`)
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r2_1/BRIEFING.md` — Persistent orchestrator working memory
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r2_1/progress.md` — Liveness heartbeat & checklist
