# Briefing — Milestone 2 (`M2`) Sub-Orchestrator (`r2_1`)

## Mission
Deliver 100% of Milestone 2 (`M2`) in `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/` per `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` and `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` (`§ Interface Contracts 1–4`, including mandatory `F35`, `F36`, `F09` contracts).

## Key Non-Negotiable Contracts
1. **Extended Access Token TTL & `sid` Claim (`F35`, `F36`)**:
   - `access_token_expire_minutes: int = 120` (2 hours), `refresh_token_expire_days: int = 14`.
   - `_issue_session_tokens` embeds `"sid": session.id` inside JWT access token claims.
   - `deps.py:get_current_user` verifies `UserSession` (`id == sid`, `revoked == False`, `expires_at > now`) whenever `"sid"` is present in decoded claims (while gracefully supporting legacy test-minted tokens without `"sid"`).
2. **Unified Cookie `Path="/"` & Bulletproof Logout (`F35`)**:
   - Both `ht_access_token` and `ht_refresh_token` set with `HttpOnly=True`, `Secure=settings.cookie_secure`, `SameSite="lax"`, `Path="/"`.
   - `POST /api/v1/auth/logout` revokes/deletes `UserSession` rows matching BOTH `ht_refresh_token` hash AND Bearer/`ht_access_token` `sid` claim, and clears both cookies across `path="/"`, `path="/api/v1"`, and `path="/api/v1/auth"`.
   - `GET /api/v1/auth/sessions` returns ONLY active (`revoked == False` and `expires_at > now`) sessions sorted newest first with accurate `is_current`, so logged-out sessions disappear immediately.
3. **Signed Download Token (`F09`)**:
   - `POST /api/v1/auth/download-token` returns `{"dl_token": "...", "expires_in": 900}` (15-min JWT with `"purpose": "download"`).
   - `deps.py:get_current_user` checks `Authorization: Bearer` (rejects `purpose=="download"`), then `ht_access_token` cookie (rejects `purpose=="download"`), then `?dl_token=` query param (requires `purpose=="download"`).
4. **Complete DB Schema (`models.py` + `schema_sync.py` + Alembic), Core (`config.py`, `ip_utils.py`, `ws_hub.py`), Auth/2FA/WebAuthn/Users/Profile/Ops/Audit/Wiki APIs, `segno` & `openpyxl` installed in `.venv` & `requirements.txt`**.
5. **Strict Ownership & Git Cleanliness**:
   - Touch ONLY M2 owned paths. NEVER run `git commit` or `git push`. Always use `PYTHONDONTWRITEBYTECODE=1` and isolated `/tmp` `--basetemp` for `pytest`.

## Current Status
- Phase: Step 2B.a — Launching 3 parallel Explorers (`m2_explorer_r2_1..3`).
