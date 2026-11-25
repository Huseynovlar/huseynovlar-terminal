# Dispatch — E2E Testing Track Orchestrator (`teamwork_preview_sub_orch_e2e_1`)

- **Sender / Parent Conversation ID**: `b5546ea1526f70a42ec92262cd4e980a`
- **Timestamp**: `2026-11-24T21:01:41Z`
- **Role**: E2E Testing Track Orchestrator (`teamwork_preview_orchestrator`)
- **State Folder**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_e2e_1`
- **Primary Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repository**: `/home/antigravity/Huseynovlar/server_telegram_bot`

## Exclusive Write Ownership
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/**`

*(STRICT — NEVER modify implementation files in `backend/`, `frontend/`, `worker/`, `deploy/`, `mql5/`, `config/`, or `server_telegram_bot/`, NEVER run `git commit` or `git push`.)*

## Mission Summary
1. Derive opaque-box tests strictly from `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` and the public user-facing entry points & HTTP/Cookie/WebSocket/File/CLI/SSR contracts in `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` — NO internal backend Python module imports of private helpers.
2. Author `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md` covering ALL 33 Features (`F01`–`F33`) in `PROJECT.md § Feature Inventory`.
3. Build the complete 4-tier E2E suite under `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/` with deterministic runner `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/run_e2e.sh` supporting `--tier 1`, `--tier 2`, `--tier 3`, `--tier 4`, `--collect-only`, `--help`, and default (all tiers, exiting `0` only when all selected tests pass):
   - **Tier 1 — Feature Coverage**: `>= 5` isolated happy-path tests per feature × 33 features = `>= 165` tests (`F01`–`F33`).
   - **Tier 2 — Boundary, Corner & Negative Cases**: `>= 5` tests per feature × 33 features = `>= 165` tests (`F01`–`F33`).
   - **Tier 3 — Cross-Feature Pairwise Combinations**: `>= 35` tests.
   - **Tier 4 — Real-World Institutional Application Scenarios**: `>= 17` end-to-end user journeys.
   - **Total**: `>= 382` genuine, non-trivial opaque-box E2E tests.
4. Verify via 2 `teamwork_preview_reviewer` + 2 `teamwork_preview_challenger` + 1 `teamwork_preview_auditor` (`intermediate track audit` on `e2e/`, `TEST_INFRA.md`, `TEST_READY.md`) that:
   - `e2e/run_e2e.sh --collect-only` runs cleanly in `< 5s` with zero syntax/import errors and collects `>= 382` genuine tests across `F01`–`F33`.
   - Every test contains real assertions against real HTTP/WS/file/DOM responses (ZERO `assert True`, ZERO tautologies).
   - Running `e2e/run_e2e.sh` executes cleanly without leaving any orphan background processes or temp files outside `mktemp -d`.
5. Publish `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`, write `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_e2e_1/handoff.md`, and notify `b5546ea1526f70a42ec92262cd4e980a` via `send_message`.
