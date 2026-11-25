# Dispatch Record — Milestone 2 (`M2`) Sub-Orchestrator (`r2_1`)

- **Sub-Orchestrator ID**: `teamwork_preview_sub_orch_m2_r2_1`
- **Parent Orchestrator Conversation ID**: `2204160cc16357fec5819197f8ae7177`
- **Milestone**: `M2` — Backend Core, DB Schema Reconciliation, Auth/Passkeys/Cookies/RBAC, Redis WS Hub & Ops/Wiki APIs
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Dedicated State Folder**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_m2_r2_1`
- **Original Request**: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Architecture**: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`

## Subagent Dispatches (`r2`)

| Step | Subagent Role / Folder | Type | Target Partition / Assignment | Status |
|---|---|---|---|---|
| 2B.a | `m2_explorer_r2_1` | `teamwork_preview_explorer` | Partition 1: `requirements.txt`, `pyproject.toml`, `alembic/**`, `app/main.py`, `app/db/**`, `app/core/**` (`config.py`, `security.py`, `deps.py`, `ws_hub.py`, `ip_utils.py`), `tests/conftest.py` | PENDING |
| 2B.a | `m2_explorer_r2_2` | `teamwork_preview_explorer` | Partition 2: `app/modules/auth/**`, `app/modules/users/**`, `app/modules/profile/**`, and existing auth/security tests in `backend/tests/` | PENDING |
| 2B.a | `m2_explorer_r2_3` | `teamwork_preview_explorer` | Partition 3: `app/modules/ops/**`, `app/modules/audit/**`, `app/modules/wiki/**`, read-only inspection of `mql5/` & `config/` paths for Ops endpoints, and existing ops/api tests in `backend/tests/` | PENDING |
| 2B.b | `m2_worker_r2_1` | `teamwork_preview_worker` | Full M2 implementation + `test_m2_*.py` within exclusive M2 write-owned paths | PENDING |
| 2B.c | `m2_reviewer_r2_1` | `teamwork_preview_reviewer` | Primary full-suite backend lint (`ruff`) + full `pytest` verification | PENDING |
| 2B.c | `m2_reviewer_r2_2` | `teamwork_preview_reviewer` | Target-scoped `test_m2_*.py` + exhaustive line-by-line spec/contract/edge-case review (`PROJECT.md` §1–4, F35/F36/F09) | PENDING |
| 2B.d | `m2_challenger_r2_1` | `teamwork_preview_challenger` | Adversarial probe 1: Auth, JWT `sid` revocation, `/logout` session deletion, `Path="/"` cookies, `?dl_token=`, WebAuthn Redis/TTL, 2FA backup codes, RBAC last-ADMIN guards | PENDING |
| 2B.d | `m2_challenger_r2_2` | `teamwork_preview_challenger` | Adversarial probe 2: Idempotent `schema_sync.py` upgrade on pre-existing tables, `/etc` integrations loader, NetBird `extract_client_ip`, Redis/fallback `ws_hub`, Ops `.set` UUID+`mt5_login`+Fernet, Wiki/Audit | PENDING |
| 2B.e | `m2_auditor_r2_1` | `teamwork_preview_auditor` | Intermediate milestone forensic integrity audit on M2 owned paths | PENDING |
