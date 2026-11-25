# Scope — E2E Testing Track (`teamwork_preview_sub_orch_e2e_r2_1`)

- **Status**: `IN_PROGRESS`
- **Track**: E2E Testing Track (Opaque-Box, Requirement-Driven 4-Tier Suite — `N = 36` Features `F01`–`F36`)
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repo**: `/home/antigravity/Huseynovlar/server_telegram_bot`

## Exclusive Write-Owned Paths (STRICT)
1. `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_INFRA.md`
2. `/home/antigravity/Huseynovlar/huseynovlar-terminal/TEST_READY.md`
3. `/home/antigravity/Huseynovlar/huseynovlar-terminal/e2e/**`

## Forbidden Actions & Paths (NON-NEGOTIABLE)
- **NEVER** create, modify, or delete ANY file in `backend/**`, `frontend/**`, `worker/**`, `deploy/**`, `mql5/**`, `config/**`, `docs/**`, `PROJECT.md`, `huseynovlar-terminal/.agents/**`, or `/home/antigravity/Huseynovlar/server_telegram_bot/**`.
- **Important Repo Mirror Note**: `huseynovlar-terminal/.agents/teamwork/` is intentionally mirrored into `huseynovlar-terminal` by the Project Orchestrator at wave checkpoints per user request (`ORIGINAL_REQUEST.md:223-231`, containing NO secrets and NO `AGENTS.md`/`GEMINI.md`). E2E tests and verifiers MUST treat `huseynovlar-terminal/.agents/teamwork/` as valid mirrored documentation/state markdowns (never flag its presence as a repo cleanliness error!). Pre-overhaul base SHAs are `eae5685` (`huseynovlar-terminal`) and `19a9ed7` (`server_telegram_bot`); E2E Reviewers/Auditor inspect `git diff eae5685 -- TEST_INFRA.md TEST_READY.md e2e/` plus untracked files in `e2e/` (`TEST_INFRA.md`, `TEST_READY.md`).
- **NEVER** import internal application helper modules directly (`from app....` or `from backend....`) inside `e2e/**` — tests MUST interact strictly as an opaque-box external caller via HTTP/REST, Cookies (`ht_access_token`, `ht_refresh_token`), `Authorization: Bearer`, `?dl_token=`, `X-Account-Api-Key`, WebSockets (`WS /api/v1/ws/live`), subprocess/CLI, YAML/Compose/MQL5 file artifacts, and Frontend source/route/SSR/bundle artifacts!
- **NEVER** use `pytest.mark.skip`, `pytest.mark.xfail`, `pytest.skip()`, `pytest.xfail()`, `try: ... except: pass`, vacuous `assert status in (200, 404, 500)`, or dummy `assert True`! Unimplemented endpoints MUST fail genuinely when `--tier K` is run while Wave 1 / Wave 2 milestones are still building!
- **NEVER** run `git commit` or `git push`.

## File Layout Constraint (`<= 10` Clean Files inside `e2e/`)
1. `e2e/pytest.ini` — Pytest configuration, markers (`tier1`, `tier2`, `tier3`, `tier4`, `harness_selftest`), `testpaths`, `norecursedirs`.
2. `e2e/run_e2e.sh` — Executable (`chmod +x`) bash runner using `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/pytest` with `PYTHONDONTWRITEBYTECODE=1` and isolated `mktemp -d` `TMPDIR`/`--basetemp` cleaned up via `trap`. Supports `--tier 1`, `--tier 2`, `--tier 3`, `--tier 4`, `--collect-only`, `--harness-check`, `--help`, and default (runs Tiers `1 -> 2 -> 3 -> 4` sequentially).
3. `e2e/conftest.py` — Self-contained opaque-box harness (lazy session fixtures that NEVER start servers during `--collect-only`):
   - Ephemeral local mock upstream HTTP server (`127.0.0.1:<free_port>`) serving deterministic RSS/Atom XML feeds, ForexFactory JSON calendar events, Yahoo Finance v8/v7 quote/chart/search JSON, GeoIP JSON, Docker Engine API HTTP endpoints (`mt5-xau`, `mt5-ustec`, inspect, stats, logs, start/stop/restart), logo SVG/PNG responses, and Google Gemini API (`generateContent`) JSON with request capture.
   - Ephemeral local TCP Redis wire-protocol responder (or local Redis instance on free port) supporting `PING`, `SET`/`GET`/`DEL`/`EXPIRE` (for WebAuthn challenges & cache) and `SUBSCRIBE`/`PUBLISH` (`terminal:live` Pub/Sub) with zero external daemon dependencies!
   - Real `server_telegram_bot` webhook server (`POST /internal/webhooks/trading` via subprocess on free port) recording delivered `[TRADING]` alerts.
   - Real `huseynovlar-terminal` FastAPI `uvicorn` server on a free port (`127.0.0.1:<free_port>`) with isolated temp SQLite DB, temp `INTEGRATIONS_ENV_FILE` (`/etc`-style secrets file), and `CONFIG_DIR` wired cleanly so all upstream URLs hit the local deterministic mock server in `< 60s` with zero internet dependency.
   - Genuine opaque-box client helpers: HTTP client (Bearer, `ht_access_token` / `ht_refresh_token` cookies, `?dl_token=`, `X-Account-Api-Key`), virtual FIDO2/WebAuthn authenticator (generating genuine CBOR `attestationObject`, `clientDataJSON`, `authenticatorData`, ECDSA P-256 signatures via `cryptography` in `.venv`), TOTP code generator (`pyotp`), WebSocket `/api/v1/ws/live` client, and Frontend/Compose/MQL5 artifact contract inspector.
4. `e2e/tier1/test_tier1_f01_f18.py` — Tier 1 Happy-Path tests for `F01`–`F18` (`>= 5` tests per feature, `>= 90` tests).
5. `e2e/tier1/test_tier1_f19_f36.py` — Tier 1 Happy-Path tests for `F19`–`F36` (`>= 5` tests per feature, `>= 90` tests).
6. `e2e/tier2/test_tier2_f01_f18.py` — Tier 2 Boundary, Corner & Negative tests for `F01`–`F18` (`>= 5` tests per feature, `>= 90` tests).
7. `e2e/tier2/test_tier2_f19_f36.py` — Tier 2 Boundary, Corner & Negative tests for `F19`–`F36` (`>= 5` tests per feature, `>= 90` tests).
8. `e2e/tier3/test_tier3_pairwise.py` — Tier 3 Cross-Feature Pairwise Integration tests (`>= 36` genuine tests).
9. `e2e/tier4/test_tier4_journeys.py` — Tier 4 Multi-Step Quantitative Trader & Institutional Admin End-to-End Journeys (`>= 18` genuine tests).
10. `e2e/test_harness_selftest.py` — Isolated harness self-test suite invoked via `e2e/run_e2e.sh --harness-check` (excluded from default `--tier 1..4` and `--collect-only` tier counts so Tier 1–4 counts reflect 100% genuine product requirement tests) verifying mock upstream endpoints, ephemeral Redis Pub/Sub + KV, subprocess teardown, zero orphan processes, and exact `F01`–`F36` coverage counts (`>= 5` per feature in Tier 1 & Tier 2, `>= 36` in Tier 3, `>= 18` in Tier 4, total `>= 414`).

## Quantitative Coverage Matrix (`36` Features `F01`–`F36`)
- **Tier 1 (`e2e/tier1/`, `>= 180` tests)**: `>= 5` happy-path tests × 36 features (`F01`–`F36`), explicitly tagged/named by feature ID (`f01`..`f36`).
- **Tier 2 (`e2e/tier2/`, `>= 180` tests)**: `>= 5` boundary, corner & negative tests × 36 features (`F01`–`F36`), explicitly tagged/named by feature ID (`f01`..`f36`).
- **Tier 3 (`e2e/tier3/`, `>= 36` tests)**: Cross-feature pairwise integration tests:
  - Auth cookies/`sid`/logout (`F09`/`F35`/`F36`) × Incognito `.set`/`.xlsx`/`.csv`/`.mq5`/`.mqh` downloads (`F08`/`F14`/`F23`/`F24`);
  - MT5 `USTECc` cent ingest + `ep_ipc` (`F08`/`F24`/`F25`) × WS live stream (`F15`) × `USC/100` analytics (`F29`) × Hub detail news digest (`F22`);
  - Custom Verified RSS (`F21`) × News corroboration cross-check (`F19`) × Explorer Auto/Manual filter (`F22`) × Gemini AI briefing (`F20`);
  - Server Preferences `tangerine`+`floating`+`bloomberg`+`RU/EN/AZ`+`UTC` (`F02`/`F03`/`F10`) × Chart drawings & indicators persistence (`F26`);
  - `/etc` Integrations & Alerts (`F18`) × `server_telegram_bot` `POST /internal/webhooks/trading` delivery + container ops (`F12`);
  - RBAC Users (`F17`) × Security 2FA/Passkeys (`F01`/`F31`) × Active Sessions & Real NetBird IP Geo (`F32`/`F35`).
- **Tier 4 (`e2e/tier4/`, `>= 18` tests)**: Realistic multi-step end-to-end quantitative trader & institutional admin workflows from bootstrap to audit/logout.
- **Total Requirement-Driven Tests**: `>= 414` genuine opaque-box tests (`--collect-only` completes in `< 5s` with `0` errors).
- **Mandatory Coverage of `F34`–`F36`**:
  - `F34`: Zero native `window.confirm`, `window.prompt`, `window.alert`, or bare `confirm(`/`prompt(`/`alert(` across `frontend/src/**` + presence & wiring of styled shadcn `AlertDialog` / `Dialog` components.
  - `F35`: `POST /api/v1/auth/logout` revokes/deletes `UserSession` via BOTH `Authorization: Bearer` (`sid` claim) AND `ht_refresh_token` cookie (`Path="/"`), clears cookies across `/`, `/api/v1`, `/api/v1/auth`, immediately removes the session from `GET /api/v1/auth/sessions`, and rejects reuse of both the revoked JWT (`sid`) and refresh token.
  - `F36`: Backend default `access_token_expire_minutes == 120` (`2h` JWT `exp - iat == 7200s`), frontend `api-client.ts` single-flight `401 -> POST /api/v1/auth/refresh -> retry` contract, and immediate clean redirect to `/auth/v2/login` when refresh fails (`401`/`403`) without leaving stale `Invalid or expired token` state.

## Concurrency & Gate Verification Note
Because Wave 1 (`M1`, `M2`, `M4`) and Wave 2 (`M3`, `M5`) are concurrently implementing application changes, during the E2E Track Verification Gate:
- `e2e/run_e2e.sh --help` MUST exit `0`.
- `e2e/run_e2e.sh --collect-only` MUST exit `0` in `< 5s` collecting `>= 414` tests (`>= 180` Tier 1, `>= 180` Tier 2, `>= 36` Tier 3, `>= 18` Tier 4, `>= 5` per `F01`–`F36` in both Tier 1 and Tier 2).
- `e2e/run_e2e.sh --harness-check` MUST exit `0` verifying live startup/teardown of mock upstreams, ephemeral Redis, `server_telegram_bot` webhook server, and FastAPI `uvicorn` server with zero leaked processes or stray files.
- Running `e2e/run_e2e.sh --tier 1` against the uncompleted repo MUST execute real assertions against the live FastAPI server and frontend artifacts (passing already-implemented contracts and genuinely failing unimplemented contracts — NEVER passing vacuously!).
