# BRIEFING — 2026-11-24T20:35:40Z

## Mission
Orchestrate the complete institutional-grade overhaul, bug remediation, full CRUD+View page architecture, server-side persistence, live WebSockets/feeds/Docker/MT5/WebAuthn/i18n/theme overhaul, and E2E verification of Huseynovlar Terminal (`/home/antigravity/Huseynovlar/huseynovlar-terminal`) and its Telegram alerts integration (`/home/antigravity/Huseynovlar/server_telegram_bot`) per `ORIGINAL_REQUEST.md`.

## 🔒 My Identity
- Archetype: `teamwork_preview_orchestrator`
- Level: Project Orchestrator (top-level orchestrator under Sentinel)
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: `/home/antigravity` (Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal`, Secondary repo: `/home/antigravity/Huseynovlar/server_telegram_bot`)
- State folder: `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r1_1`
- Original parent: Sentinel (`sentinel_r1_1`)
- Original parent conversation ID: `17a8e9284bebf698232991625a3d67de`
- Scope: All milestones across Implementation Track + E2E Testing Track + Documentation & Final User Instructions (`ORIGINAL_REQUEST.md` + `docs/ROADMAP_TODO.md`)

## 🔒 My Workflow
- **Pattern**: Project Pattern (Dual Track: Implementation Track + E2E Testing Track)
- **Scope document**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (to be created right after Step 0 Survey completes; must check gitignore/repo cleanliness rule before committing)
1. **Decompose**: Step 0 Survey (2 Explorers + 1 Spec Miner in parallel) -> Merge into `PROJECT.md § Feature Inventory` -> Decompose by module boundary into 3–7 milestones + E2E Testing Track + Final Milestone (Phase 1 Tiers 1–4 E2E pass + Phase 2 Tier 5 Adversarial Coverage Hardening).
2. **Dispatch & Execute**:
   - **Delegate (sub-orchestrator)**: Spawn sub-orchestrators per milestone (respecting cross-module interface contracts and file write-ownership) + E2E Testing Orchestrator in parallel. Each sub-orchestrator runs the Project Pattern Iteration Loop (3 Explorers/Spec Miners -> 1 Worker -> parallel verification wave: 2 Reviewers + 2 Challengers + 1 Forensic Auditor -> Gate).
3. **On failure** (in this order):
   - Retry: nudge stuck agent or re-send task
   - Replace: spawn fresh agent with partial progress
   - Skip: proceed without (only if non-critical; Auditor is NEVER skippable)
   - Redistribute: split stuck agent's remaining work
   - Redesign: re-partition decomposition (Project Orchestrator cannot escalate to Sentinel; must redesign)
4. **Succession**: Self-succeed at 20 cumulative spawns once active non-orchestrator subagents complete: write soft `handoff.md`, update `BRIEFING.md` & `progress.md`, kill active cron timers, create `_gen2` state folder, copy living files, spawn successor passing Sentinel `17a8e9284bebf698232991625a3d67de` as parent, and notify running sub-orchestrators of new parent ID.
- **Work items**:
  1. Step 0 Survey (Backend/Infra, Frontend/UX, Requirements/Docs Spec Mining) [in-progress]
  2. Step 2A Architecture, Interface Contracts & Milestone Decomposition (`PROJECT.md`) [pending]
  3. Dual-Track Execution (Implementation Milestones + E2E Testing Track) [pending]
  4. Final Milestone Phase 1 (100% E2E Tiers 1–4 Pass) & Phase 2 (Tier 5 Adversarial Hardening) [pending]
  5. Documentation Update, Final Russian Instructions & Sentinel Handoff [pending]
- **Current phase**: Phase 1 (Step 0: Survey)
- **Current focus**: Waiting for 3 parallel Survey subagents to deliver `handoff.md` reports
- **Decomposition Recorded (2026-11-24T21:01:45Z)**: 33 features (`F01`–`F33`) mapped across 6 Implementation Milestones (`M1`[in-progress], `M2`[in-progress], `M3`[planned: depends on M2], `M4`[in-progress], `M5`[planned: depends on M3+M4], `M6`[planned: Final Milestone E2E Tiers 1–4 + Tier 5 Adversarial]) + `E2E` Testing Track (`in-progress`). Verification counts per sub-orchestrator gate: 3 Explorers, 1 Worker, 2 Reviewers, 2 Challengers, 1 Forensic Auditor.

## 🔒 Key Constraints
- DISPATCH-ONLY orchestrator: NEVER write/modify source code or run build/test commands directly; edit ONLY `.md` state files in state folder, shared `PROJECT.md`/`TEST_INFRA.md`/`TEST_READY.md`, and `[successor_state_dir]` on succession.
- Never commit `.agents/` into git repositories.
- Zero fake/mock/placeholder data, zero stubs, zero dead buttons.
- BINARY VETO on Forensic Auditor `INTEGRITY VIOLATION`.
- Include `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` path verbatim in every subagent dispatch.
- Never reuse a subagent after it has delivered its handoff — always spawn fresh.

## Current Parent
- Conversation ID: `17a8e9284bebf698232991625a3d67de`
- Updated: 2026-11-24T20:35:40Z

## Key Decisions Made
- Completed Step 0 Survey across all 3 parallel agents (`495bd39352469c0c0301f5253d57a13d`, `4f8573f1d88cdd9e53224eeb51bf7a14`, `6f71d548cdf881feb31fe271a9396b54`), uncovering all root causes (`/config` vs `/app/config`, missing `panel_egress`, missing `ht_access_token` cookie & 401 refresh, WebAuthn `Uint8Array` `TypeError`, dotless MT5 URL `err=4014`, `server_telegram_bot` `DEFAULT_AUTH_SKIP_PATHS` 401, fake `hash()`/`PREVIEW_TREEMAP`, demo FullCalendar, 26 leftover Studio Admin routes, `5000ms` clock jump, zero i18n dictionary).
- Authored `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` with 33-row Feature Inventory (zero unassigned), disjoint file write-ownership, and 6 cross-module Interface Contracts.
- Defined `teamwork_preview_orchestrator` and dispatched Wave 1 concurrently: `M1` (`05ce22c1bfb43ec87652b8725ddd204c`), `M2` (`b62d8e92dcc2e5d0c43e84f7e6ddaf1c`), `M4` (`c48beb23bc2d710cd94e04a68ab250d1`), and `E2E` (`cbc4efcf3a24108f157ffbba2d6d4b64`).

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| `teamwork_preview_explorer_survey_1` | `teamwork_preview_explorer` | Step 0 Survey: Backend, Worker, DB, Auth/WebAuthn/Cookies, WS, Docker, MQL5 & `server_telegram_bot` + screenshots | completed | `495bd39352469c0c0301f5253d57a13d` |
| `teamwork_preview_explorer_survey_2` | `teamwork_preview_explorer` | Step 0 Survey: Frontend pages, UI/UX, CRUD/View gaps, `api-client`, i18n, theme, skeletons, toasts, sound & WS | completed | `4f8573f1d88cdd9e53224eeb51bf7a14` |
| `teamwork_preview_spec_miner_survey_3` | `teamwork_preview_spec_miner` | Step 0 Survey: `ORIGINAL_REQUEST.md` + `ROADMAP_TODO.md` + `ARCHITECTURE.md` zero-gap spec matrix & sitemap | completed | `6f71d548cdf881feb31fe271a9396b54` |
| `teamwork_preview_sub_orch_m1_1` | `teamwork_preview_orchestrator` | Milestone M1: Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot` | in-progress | `05ce22c1bfb43ec87652b8725ddd204c` |
| `teamwork_preview_sub_orch_m2_1` | `teamwork_preview_orchestrator` | Milestone M2: Backend Core, DB Schema Sync, Auth/Passkeys/Cookies/RBAC, Redis WS Hub & Ops/Wiki | in-progress | `b62d8e92dcc2e5d0c43e84f7e6ddaf1c` |
| `teamwork_preview_sub_orch_m4_1` | `teamwork_preview_orchestrator` | Milestone M4: Frontend Core Framework, `tangerine`+`floating` Shell, `RU/EN/AZ` i18n, Demo Purge & System/Ops Pages | in-progress | `c48beb23bc2d710cd94e04a68ab250d1` |
| `teamwork_preview_sub_orch_e2e_1` | `teamwork_preview_orchestrator` | E2E Testing Track: `TEST_INFRA.md`, `e2e/` Tiers 1–4 (`>=382` opaque-box tests), `TEST_READY.md` | in-progress | `cbc4efcf3a24108f157ffbba2d6d4b64` |

## Succession Status
- Succession required: no
- Spawn count: 7 / 20
- Pending subagents: `05ce22c1bfb43ec87652b8725ddd204c`, `b62d8e92dcc2e5d0c43e84f7e6ddaf1c`, `c48beb23bc2d710cd94e04a68ab250d1`, `cbc4efcf3a24108f157ffbba2d6d4b64`
- Predecessor: none
- Successor spawned: not yet spawned
- Successor generation: none
- Successor state folder: none

## Active Timers
- Heartbeat cron: `b5546ea1526f70a42ec92262cd4e980a/task-9` (`*/20 * * * *`)
- Safety timer: none
- On succession: kill all timers before spawning successor
- On context truncation: handle timers as step 4 of the State Recovery section of your prompt says

## Artifact Index
- `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` — Immutable verbatim user request & context
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` — Master Project Scope, 33-row Feature Inventory, Milestones & Interface Contracts
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md` — Backend/Infra/MQL5/Bot Survey
- `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_2/handoff.md` — Frontend/UX/Routes Survey
- `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/handoff.md` — Zero-Gap Requirements Matrix & Sitemap
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r1_1/DISPATCH.md` — Dispatch log from Sentinel
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r1_1/BRIEFING.md` — Persistent orchestrator working memory
- `/home/antigravity/.agents/teamwork/teamwork_preview_orchestrator_r1_1/progress.md` — Liveness heartbeat & execution checklist
