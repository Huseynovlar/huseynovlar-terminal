# Scope — E2E Testing Track (`teamwork_preview_sub_orch_e2e_1`)

- **Status**: `IN_PROGRESS`
- **Track**: E2E Testing Track (Opaque-Box, Requirement-Driven 4-Tier Suite)
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repo**: `/home/antigravity/Huseynovlar/server_telegram_bot`

## Owned Paths (Exclusive Write Ownership)
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/**`

## Forbidden Paths (Read-Only for Public Entrypoint Discovery ONLY — NEVER Edit, NEVER Import Internal Helpers)
- `backend/**`, `frontend/**`, `worker/**`, `deploy/**`, `mql5/**`, `config/**`, `docs/**`, `/home/antigravity/Huseynovlar/server_telegram_bot/**`

## Deliverables & Acceptance Criteria
1. **`TEST_INFRA.md`**: Author `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md` covering all 33 features (`F01`–`F33`), progressive verification channels (HTTP/Cookie/Bearer/`?dl_token=`, WebSocket `/api/v1/ws/live`, File/MQL5/Docker-Compose contract checks, SSR/Frontend bundle/DOM/Playwright checks, `server_telegram_bot` webhook contract), ephemeral isolated test harness design, and runner usage.
2. **Deterministic Runner (`e2e/run_e2e.sh`)**:
   - Supports `--tier 1`, `--tier 2`, `--tier 3`, `--tier 4`, `--collect-only`, `--help`, and default (all 4 tiers sequentially `1 -> 2 -> 3 -> 4`).
   - Exits `0` ONLY when all selected tests pass (and `0` on `--collect-only` / `--help` when collection & manifest checks pass).
   - `--collect-only` completes in `< 5s` with zero syntax/import errors and collects `>= 382` genuine tests across `F01`–`F33`.
   - Zero orphan background processes (`uvicorn`, `redis`, headless browser, mock upstream HTTP servers) or stray temp files outside `mktemp -d`.
   - Sets `PYTHONDONTWRITEBYTECODE=1` on spawned target servers so `backend/` and `server_telegram_bot/` working trees remain 100% clean.
3. **4-Tier Opaque-Box Test Suite (`>= 382` genuine tests)**:
   - **Tier 1 (`e2e/tier1/`, `>= 165` tests)**: `>= 5` isolated happy-path tests per feature × 33 features (`F01`–`F33`).
   - **Tier 2 (`e2e/tier2/`, `>= 165` tests)**: `>= 5` boundary, corner & negative tests per feature × 33 features (`F01`–`F33`).
   - **Tier 3 (`e2e/tier3/`, `>= 35` tests)**: Cross-feature pairwise combinations (Auth cookies × downloads, MT5 `USTECc` cent ingest + `ep_ipc` × WS broadcast × `USC / 100` analytics × Hub detail news summary, Custom Verified RSS × News Cross-Check × Explorer Auto/Manual filter, Server Preferences `tangerine`+`floating`+`RU/EN/AZ`+`UTC` × Chart Drawings persistence across sessions, Alerts Rule × `server_telegram_bot` `/internal/webhooks/trading`, etc.).
   - **Tier 4 (`e2e/tier4/`, `>= 17` tests)**: Complete multi-step real-world quantitative trader & institutional admin journeys.
4. **Sub-Milestone Partitioning**:
   - **`E2E-M1` (`e2e_sub_orch_1`)**: Shared harness (`e2e/run_e2e.sh`, `e2e/conftest.py`, `e2e/pytest.ini`, `e2e/harness/**`) + Features `F01`–`F11` Tier 1 (`>= 55`) & Tier 2 (`>= 55`) = `>= 110` tests.
   - **`E2E-M2` (`e2e_sub_orch_2`)**: Features `F12`–`F22` Tier 1 (`>= 55`) & Tier 2 (`>= 55`) = `>= 110` tests (`e2e/tier1/test_f12_*.py`..`test_f22_*.py`, `e2e/tier2/test_f12_*.py`..`test_f22_*.py`).
   - **`E2E-M3` (`e2e_sub_orch_3`)**: Features `F23`–`F33` Tier 1 (`>= 55`) & Tier 2 (`>= 55`) + Tier 3 (`>= 35` in `e2e/tier3/**`) + Tier 4 (`>= 17` in `e2e/tier4/**`) = `>= 162` tests.
   - **`E2E-Gate`**: Unified Track Verification Wave (`2` Reviewers + `2` Challengers + `1` Auditor `intermediate track audit`) across all `>= 382` tests, `TEST_INFRA.md`, and `TEST_READY.md`.
5. **`TEST_READY.md`**: Publish `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md` once the unified E2E Track Verification Gate passes.
