# Briefing — E2E Testing Track (`teamwork_preview_sub_orch_e2e_r2_1`)

## Mission
Build the complete, standalone, deterministic opaque-box E2E test infrastructure and 4-tier requirement-driven test suite (`>= 414` genuine tests across `<= 10` clean files in `e2e/`) covering all **36** features (`F01`–`F36`) defined in `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` and `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`, author `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md`, pass the full 5-verifier E2E Track Gate (`2` Reviewers + `2` Challengers + `1` Forensic Auditor `intermediate track audit`), and publish `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`.

## Execution Strategy (Single-Cycle `2B` Loop)
1. **Step 2B.a — Fast Targeted Spec Mining (`3` read-only Explorers/Spec Miners in parallel)**:
   - `e2e_spec_miner_r2_1`: Inspect `backend/.venv` packages, `backend/app/main.py` & `backend/app/core/config.py` startup env vars, and `server_telegram_bot/app/core/main.py` CLI/entrypoint to produce exact subprocess startup, mock upstream HTTP server (`aiohttp`), WebAuthn virtual authenticator, and teardown blueprint (`<= 150` lines).
   - `e2e_spec_miner_r2_2`: Inspect `config/*.yaml`, `deploy/docker-compose.yml`, and `mql5/*` public entrypoints/contracts to produce exact contract assertions for `F01`–`F18` (`<= 150` lines).
   - `e2e_spec_miner_r2_3`: Inspect `frontend/package.json`, `frontend/src/routes`, `frontend/src/framework` public route/source/bundle structure and `PROJECT.md` contracts for `F19`–`F36` + Tiers 3 & 4 workflows (`<= 150` lines).
2. **Step 2B.b — Implementation (`1` `teamwork_preview_test_writer` Worker)**:
   - Author `TEST_INFRA.md` and `e2e/` (`<= 10` files, `>= 414` genuine opaque-box tests across Tiers 1–4, zero `xfail`/`skip`/dummy `assert True`, zero internal app helper imports).
   - Verify `e2e/run_e2e.sh --help`, `e2e/run_e2e.sh --collect-only` (`< 5s`, `0` errors, `>= 414` tests), `ruff check e2e`, and harness lifecycle self-tests (`--harness-check`), leaving zero orphan processes or temp files and zero edits outside owned paths.
3. **Step 2B.c/d/e — Parallel Verification Wave (`5` Verifiers)**:
   - `2` `teamwork_preview_reviewer` + `2` `teamwork_preview_challenger` + `1` `teamwork_preview_auditor` (`intermediate track audit` on `TEST_INFRA.md` & `e2e/**`).
4. **Step 2B.f — Gate & `TEST_READY.md` Publication**:
   - Evaluate Auditor first (binary veto), then Reviewers & Challengers. Once `APPROVE` + `CLEAN`, publish `TEST_READY.md` and hand off to Parent Orchestrator.
