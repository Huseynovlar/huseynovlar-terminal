# Briefing — E2E Testing Track Orchestrator

- **Agent Folder**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_e2e_1`
- **Level**: Sub-Orchestrator (Track: `E2E` — Opaque-Box Requirement-Driven Test Suite)
- **Current Parent Conversation ID**: `b5546ea1526f70a42ec92262cd4e980a`
- **My Conversation ID**: `cbc4efcf3a24108f157ffbba2d6d4b64`
- **Spawn Count**: `0 / 20`
- **Active Timers**: None (`schedule` tool not exposed in runtime; reactive message wakeup active)

## Owned Paths
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/**`

## Execution Plan
1. **Wave 0 — Track Exploration (3 Explorers/Spec Miners)**:
   - `e2e_explorer_r1_1`: Inspect devbox runtime binaries/venvs (`python3`, `backend/.venv`, `server_telegram_bot`, `redis-server`, `postgresql`, `playwright`, `node`, `docker`, existing `e2e/`), startup mechanics for ephemeral `uvicorn` instances (`huseynovlar-terminal` + `server_telegram_bot`) and mock upstream providers on free localhost ports.
   - `e2e_explorer_r1_2`: Map exact opaque-box verification channels, Tier 1 (`>=5/feat`) and Tier 2 (`>=5/feat`) test specifications for Features `F01`–`F17` & `F30`–`F33`.
   - `e2e_spec_miner_r1_3`: Map exact opaque-box verification channels, Tier 1 (`>=5/feat`) and Tier 2 (`>=5/feat`) test specifications for Features `F18`–`F29`, plus Tier 3 (`>=35` pairwise combinations) and Tier 4 (`>=17` real-world journeys).
2. **Author `TEST_INFRA.md` & `SCOPE.md`**:
   - Write comprehensive `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md` covering all 33 features (`F01`–`F33`), harness design, directory layout, CLI contract (`e2e/run_e2e.sh`), and strict disjoint file ownership for sub-milestones.
3. **Sub-Milestones via Child Sub-Orchestrators**:
   - `e2e_sub_orch_1` (`E2E-M1`): Shared opaque-box E2E harness (`e2e/run_e2e.sh`, `e2e/conftest.py`, `e2e/harness/*`) + Features `F01`–`F11` Tier 1 (`>=55`) & Tier 2 (`>=55`) = `>=110` tests.
   - Parallel `e2e_sub_orch_2` (`E2E-M2`) & `e2e_sub_orch_3` (`E2E-M3`) (after `E2E-M1` completes shared harness):
     - `E2E-M2`: Features `F12`–`F22` Tier 1 (`>=55`) & Tier 2 (`>=55`) = `>=110` tests.
     - `E2E-M3`: Features `F23`–`F33` Tier 1 (`>=55`) & Tier 2 (`>=55`) + Tier 3 (`>=35` pairwise) + Tier 4 (`>=17` journeys) = `>=162` tests.
4. **Track-Wide Final Verification Wave (`E2E-Gate`)**:
   - Run 2 `teamwork_preview_reviewer` + 2 `teamwork_preview_challenger` + 1 `teamwork_preview_auditor` (`intermediate track audit` on `e2e/`, `TEST_INFRA.md`, `TEST_READY.md`) across the entire `>=382` test suite.
5. **Publish `TEST_READY.md` & `handoff.md`**, then report to `b5546ea1526f70a42ec92262cd4e980a`.

## Team Roster
*(Updated as subagents are spawned)*
