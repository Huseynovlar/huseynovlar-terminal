# Dispatch — Milestone 1 (`M1`) Sub-Orchestrator (`teamwork_preview_sub_orch_m1_r2_1`)

- **Parent Orchestrator ID**: `2204160cc16357fec5819197f8ae7177`
- **State Folder**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_m1_r2_1`
- **Mandatory Input**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Architecture & Contracts**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`
- **Baseline Scope Reference**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_m1_1/SCOPE.md`
- **Survey Handoffs Reused**:
  - `/home/antigravity/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md`
  - `/home/antigravity/.agents/teamwork/teamwork_preview_spec_miner_survey_3/handoff.md`

## Execution Plan (Single-Cycle `2B` Loop)
1. **Step 2B.a — Fast Targeted Exploration (3 Explorers in parallel)**:
   - `m1_explorer_r2_1`: Inspect `server_telegram_bot` (`app/common/web.py`, `app/core/main.py`, `deploy/docker-compose.yml`, `scripts/server/deploy.sh`, `.github/workflows/`, `tests/`, `.gitignore`).
   - `m1_explorer_r2_2`: Inspect `huseynovlar-terminal` Docker, deploy scripts, CI workflows, `.env.example`, `.gitignore`, `backend/Dockerfile`, and existing `config/*.yaml` + consumer schemas in `backend/app/modules/intelligence/router.py` & `assets/router.py` (read-only).
   - `m1_explorer_r2_3`: Inspect `huseynovlar-terminal/mql5/ExnessPanelBridge.mq5`, `mql5/ExnessPanelHook.mqh`, and read-only consumer contract in `backend/app/modules/ingest/router.py` & `backend/app/modules/ops/router.py`.
2. **Step 2B.b — Implementation (1 Worker)**:
   - `m1_worker_r2_1`: Implement all M1 deliverables strictly within M1's exclusive write-owned paths and run all verification checks.
3. **Step 2B.c/d/e — Parallel Verification Wave (5 Verifiers in parallel)**:
   - `m1_reviewer_r2_1`: Primary full-suite lint/config/test verification across `server_telegram_bot` & `huseynovlar-terminal` M1 targets.
   - `m1_reviewer_r2_2`: Exhaustive line-by-line spec/contract/edge-case review across all owned files (`server_telegram_bot`, `deploy/`, `config/`, `mql5/`, `Dockerfile`, `.env.example`, `.github/workflows/`, `.gitignore`).
   - `m1_challenger_r2_1`: Adversarial empirical probes on `server_telegram_bot` auth middleware/webhook, `backup-db.sh`, `setup-vps-integrations.sh`, and `docker-compose.yml` deploy safety (isolated temp dir).
   - `m1_challenger_r2_2`: Adversarial empirical probes on `config/*.yaml` schema/symbol validity + MQL5 `ExnessPanelBridge.mq5` / `ExnessPanelHook.mqh` syntax, JSON serialization, `ep_ipc` parsing, `4014` URL origin extraction, and sibling-chart scraping logic (isolated temp dir).
   - `m1_auditor_r2_1`: Forensic Integrity Auditor (**intermediate milestone audit** on M1 owned paths).
4. **Step 2B.f — Gate Evaluation & Handoff**:
   - Evaluate Auditor verdict first (binary veto), then Reviewers & Challengers, record in `GATE_STATUS.md`, and hand off to `2204160cc16357fec5819197f8ae7177`.
