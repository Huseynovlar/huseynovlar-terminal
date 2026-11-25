# M2 Partition 2 Explorer Handoff (`auth`, `profile`, `users`)

## 1. Backward-Compatibility Test Assertions Observed
- `POST /api/v1/auth/bootstrap` with `{"username", "email", "password"}` MUST continue returning `200` with `{"access_token": ...}` usable immediately in `Authorization: Bearer <token>` (`test_intelligence_and_ai.py:25-29`, `test_ops_and_wizard.py:7-11`).
- Note in `test_intelligence_and_ai.py:48-49`: unconfigured Gemini fallback asserts `configured is False` and `"google_ai_api_key" in response_md` — preserve vault/env key lookup backward compatibility while adding `/etc/huseynovlar-terminal/integrations.env` fallback.
- Note in `test_ops_and_wizard.py:61-64`: `GET /api/v1/ops/setup-wizard/{acc_id}/bridge.set` works with `Authorization: Bearer` header (and must also accept `ht_access_token` cookie + `?dl_token=` per F09).

## 2. Auth Router (`backend/app/modules/auth/router.py`) Blueprint
- **Session-bound JWT (`sid`) & Cookies (`F35`, `F36`)**:
  - Embed `sid: str(user_session.id)` inside access tokens issued on `/bootstrap`, `/login`, `/2fa/login`, `/webauthn/login/*`, and `/refresh`.
  - Set both `ht_access_token` (`Path="/"`, `HttpOnly`, `SameSite="lax"`) and `ht_refresh_token` (`Path="/"`, `HttpOnly`, `SameSite="lax"`), plus clear legacy `Path="/api/v1/auth"` cookie on `/logout` so old browser cookies cannot linger.
  - `POST /auth/logout`: revoke/mark `revoked_at = utcnow()` (or delete) `UserSession` resolved from BOTH `ht_refresh_token` hash AND optional Bearer/cookie `access_token` `sid` claim; never fail if one is missing/expired.
  - `GET /auth/sessions`: filter strictly `revoked_at IS NULL AND expires_at > now()`, marking `is_current = (session.id == current_sid)`.
  - Add `DELETE /auth/sessions/{id}` and `POST /auth/sessions/revoke-others` (keep `current_sid`, revoke all other active sessions for `current_user`).
- **Signed Download Token (`F09`)**:
  - `POST /auth/download-token`: authenticated endpoint returning short-lived (`900s` TTL) signed JWT (`type="download"`, `sub=str(user.id)`, `sid`) for incognito/direct `<a href>` `.set`/`.csv`/`.mq5` downloads.
- **WebAuthn Passkeys, 2FA, Password & Login History (`F01`, `F31`)**:
  - Store WebAuthn registration/authentication challenges in Redis/TTL store keyed by `challenge` (extracted from decoded `clientDataJSON.challenge`) so concurrent/multi-worker requests succeed; persist & verify `sign_count`.
  - Ensure base64url strings (`challenge`, `user.id`, `credential.id`) are clean standard WebAuthn JSON shapes matching client `ArrayBuffer` helpers.
  - `POST /auth/change-password`: verify `current_password`, hash `new_password`, optionally revoke other sessions.
  - `POST /auth/2fa/setup`: return TOTP secret, `otpauth://` URI, and inline `<svg` QR generated via `segno`; `POST /auth/2fa/verify`: enable 2FA & generate/hash 10 single-use backup codes (consumable at login); `POST /auth/2fa/disable`: verify password/code & clear 2FA.
  - `GET /auth/login-history` (pagination + status/IP filters), `GET /auth/login-history/{id}`, and `GET /auth/ip-lookup/{ip}` (GeoIP/external fallback).

## 3. Users RBAC Router (`backend/app/modules/users/router.py`) (`F17`)
- Create `app/modules/users/router.py` (register in API v1 router under `/users`, `ADMIN` role required):
  - `GET /users`, `POST /users`, `GET /users/{id}`, `PATCH /users/{id}`, `DELETE /users/{id}`.
  - Enforce **self-delete guard** (`target.id == current_user.id -> 400`) and **last-active-ADMIN guard** (prevent deleting/demoting/disabling the last active `ADMIN` user -> `400`).

## 4. Profile & Preferences Router (`backend/app/modules/profile/router.py`) (`F32`)
- `GET /profile/preferences` & `PATCH /profile/preferences`: server-persisted JSONB with deep-merge update and institutional defaults (`theme_preset="tangerine"`, `sidebar_style="floating"`, `density="bloomberg"`, `locale="ru"`, `timezone="UTC"`, `sound_enabled`, `chart_preferences`).
- `GET/PUT /profile` (display name, email, avatar/bio) + Vault cleanup (`DELETE /profile/vault/{key}`, remove obsolete `telegram_bot_token`/`telegram_chat_id` requirements in favor of `/etc/huseynovlar-terminal/integrations.env` + vault override).
