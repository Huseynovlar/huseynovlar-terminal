from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jwt
import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings, load_integrations_env
from app.core.ws_hub import LiveWebSocketHub
from app.db.schema_sync import reconcile_schema


async def _bootstrap_admin(client: AsyncClient, xff: str = "100.104.10.22") -> dict[str, Any]:
    resp = await client.post(
        "/api/v1/auth/bootstrap",
        headers={"X-Forwarded-For": xff, "User-Agent": "TestSuite/2.0"},
        json={
            "username": "owner",
            "email": "owner@huseynovlar.org",
            "password": "VeryStrongPassword!2026",
            "display_name": "Owner",
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_schema_sync_idempotent_on_legacy_sqlite() -> None:
    """reconcile_schema adds missing columns to legacy tables and is idempotent on repeat runs."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    try:
        async with engine.begin() as conn:
            # Simulate a legacy pre-M2 users table missing totp_backup_hashes
            await conn.execute(
                text(
                    "CREATE TABLE users ("
                    "id VARCHAR(36) PRIMARY KEY, "
                    "username VARCHAR(64) UNIQUE NOT NULL, "
                    "email VARCHAR(255) UNIQUE NOT NULL, "
                    "password_hash VARCHAR(255) NOT NULL, "
                    "role VARCHAR(24) NOT NULL DEFAULT 'ADMIN', "
                    "is_active BOOLEAN NOT NULL DEFAULT 1, "
                    "display_name VARCHAR(120) NOT NULL DEFAULT 'Owner', "
                    "bio TEXT NOT NULL DEFAULT '', "
                    "avatar_url TEXT NOT NULL DEFAULT '', "
                    "social_links JSON NOT NULL DEFAULT '{}', "
                    "totp_secret_enc TEXT NULL, "
                    "totp_enabled BOOLEAN NOT NULL DEFAULT 0, "
                    "preferences JSON NOT NULL DEFAULT '{}', "
                    "created_at DATETIME NOT NULL, "
                    "updated_at DATETIME NOT NULL)"
                )
            )

        await reconcile_schema(engine)
        # Second run must be a clean no-op
        await reconcile_schema(engine)

        async with engine.connect() as conn:
            tables = {
                row[0]
                for row in (await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))).fetchall()
            }
            for expected_table in ("news_sources", "chart_states", "wiki_pages", "market_cache", "docker_containers"):
                assert expected_table in tables

            user_cols = {row[1] for row in (await conn.execute(text("PRAGMA table_info(users)"))).fetchall()}
            assert "totp_backup_hashes" in user_cols

            acc_cols = {row[1] for row in (await conn.execute(text("PRAGMA table_info(trading_accounts)"))).fetchall()}
            assert {"platform", "api_key_enc"}.issubset(acc_cols)

            asset_cols = {row[1] for row in (await conn.execute(text("PRAGMA table_info(assets)"))).fetchall()}
            assert {"logo_url", "category"}.issubset(asset_cols)

            deal_cols = {row[1] for row in (await conn.execute(text("PRAGMA table_info(deals)"))).fetchall()}
            assert {"notes", "tags"}.issubset(deal_cols)

            bal_rows = (await conn.execute(text("PRAGMA table_info(balance_operations)"))).fetchall()
            bal_cols = {row[1] for row in bal_rows}
            assert {"is_manual", "notes"}.issubset(bal_cols)
    finally:
        await engine.dispose()


def test_config_defaults_and_etc_integrations_loader(tmp_path: Path) -> None:
    env_file = tmp_path / "integrations.env"
    env_file.write_text(
        "\n".join(
            [
                "# Comment line",
                'GEMINI_API_KEY="AIzaTestKeyFromEtc"',
                "GEMINI_DEFAULT_MODEL=gemini-2.5-pro",
                "export TELEGRAM_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading",
                "TELEGRAM_WEBHOOK_SECRET='super-secret-wh'",
                "IP_GEO_API_URL=https://geo.example.org/{ip}",
            ]
        ),
        encoding="utf-8",
    )

    parsed = load_integrations_env(env_file)
    assert parsed["GEMINI_API_KEY"] == "AIzaTestKeyFromEtc"
    assert parsed["TELEGRAM_WEBHOOK_SECRET"] == "super-secret-wh"

    cfg = Settings(ENVIRONMENT="test", INTEGRATIONS_ENV_PATH=str(env_file))
    assert cfg.access_token_expire_minutes == 120
    assert cfg.refresh_token_expire_days == 14
    assert cfg.google_ai_api_key == "AIzaTestKeyFromEtc"
    assert cfg.google_ai_default_model == "gemini-2.5-pro"
    assert cfg.alerts_bot_webhook_url == "http://huseynovlar-core:8080/internal/webhooks/trading"
    assert cfg.alerts_bot_webhook_secret == "super-secret-wh"
    assert cfg.ip_geo_api_url == "https://geo.example.org/{ip}"


@pytest.mark.asyncio
async def test_cookies_sid_reliable_logout_and_refresh(client: AsyncClient, test_settings: Settings) -> None:
    boot = await _bootstrap_admin(client)
    access_token = boot["access_token"]
    payload = jwt.decode(access_token, test_settings.jwt_secret_key, algorithms=[test_settings.jwt_algorithm])
    assert "sid" in payload and payload["sid"]

    # Both cookies must be present with Path=/
    assert client.cookies.get("ht_access_token") == access_token
    assert client.cookies.get("ht_refresh_token")

    # Cookie-only auth (no Authorization header) works
    me_cookie = await client.get("/api/v1/profile/me")
    assert me_cookie.status_code == 200
    assert me_cookie.json()["username"] == "owner"

    # Refresh rotates session and issues fresh cookies
    refreshed = await client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    new_token = refreshed.json()["access_token"]
    assert new_token != access_token

    # Old access token (whose session was rotated/deleted) must be rejected immediately
    old_me = await client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {access_token}"})
    assert old_me.status_code == 401

    # Login a second session so we can verify active sessions list after logout
    login2 = await client.post(
        "/api/v1/auth/login",
        headers={"X-Forwarded-For": "100.104.55.99", "User-Agent": "SecondDevice/1.0"},
        json={"username": "owner", "password": "VeryStrongPassword!2026"},
    )
    assert login2.status_code == 200
    token2 = login2.json()["access_token"]

    sessions_before = (await client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token2}"})).json()
    assert len(sessions_before) == 2

    # Logout using Bearer token2 ONLY (simulating cookie-less logout) -> session2 deleted immediately
    client.cookies.clear()
    out = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token2}"})
    assert out.status_code == 200
    assert out.json()["sessions_removed"] == 1

    # Token2 is now immediately rejected
    assert (await client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {token2}"})).status_code == 401

    # Remaining session1 sees only 1 active session (session2 vanished!)
    res_after = await client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {new_token}"})
    sessions_after = res_after.json()
    assert len(sessions_after) == 1
    assert sessions_after[0]["is_current"] is True


@pytest.mark.asyncio
async def test_2fa_qr_backup_codes_disable_and_change_password(client: AsyncClient) -> None:
    boot = await _bootstrap_admin(client)
    h = {"Authorization": f"Bearer {boot['access_token']}"}

    # 2FA setup returns real inline SVG QR
    setup = await client.post("/api/v1/auth/2fa/setup", headers=h)
    assert setup.status_code == 200
    data = setup.json()
    assert "<svg" in data["qr_svg"]
    assert data["provisioning_uri"].startswith("otpauth://totp/")

    # 2FA verify returns 10 backup codes
    secret = data["secret"]
    verify = await client.post("/api/v1/auth/2fa/verify", headers=h, json={"code": pyotp.TOTP(secret).now()})
    assert verify.status_code == 200
    vjson = verify.json()
    assert vjson["ok"] is True and vjson["totp_enabled"] is True
    backup_codes = vjson["backup_codes"]
    assert len(backup_codes) == 10

    # Login using a single-use backup code succeeds once, fails second time
    code0 = backup_codes[0]
    ok_backup = await client.post(
        "/api/v1/auth/login",
        json={"username": "owner", "password": "VeryStrongPassword!2026", "totp_code": code0},
    )
    assert ok_backup.status_code == 200
    reuse_backup = await client.post(
        "/api/v1/auth/login",
        json={"username": "owner", "password": "VeryStrongPassword!2026", "totp_code": code0},
    )
    assert reuse_backup.status_code == 401

    # Disable 2FA
    dis = await client.post(
        "/api/v1/auth/2fa/disable",
        headers=h,
        json={"password": "VeryStrongPassword!2026", "code": pyotp.TOTP(secret).now()},
    )
    assert dis.status_code == 200 and dis.json()["totp_enabled"] is False

    # Change password + revoke other sessions
    cp = await client.post(
        "/api/v1/auth/change-password",
        headers=h,
        json={
            "current_password": "VeryStrongPassword!2026",
            "new_password": "BrandNewPassword!2027",
            "revoke_other_sessions": True,
        },
    )
    assert cp.status_code == 200
    assert cp.json()["ok"] is True
    assert cp.json()["revoked_sessions"] >= 1

    # Old password fails, new password works
    assert (
        await client.post("/api/v1/auth/login", json={"username": "owner", "password": "VeryStrongPassword!2026"})
    ).status_code == 401
    assert (
        await client.post("/api/v1/auth/login", json={"username": "owner", "password": "BrandNewPassword!2027"})
    ).status_code == 200


@pytest.mark.asyncio
async def test_sessions_login_history_ip_lookup_and_webauthn_fields(client: AsyncClient) -> None:
    boot = await _bootstrap_admin(client, xff="100.104.22.33, 10.0.0.1")
    h = {"Authorization": f"Bearer {boot['access_token']}"}

    # Second login
    login2 = await client.post(
        "/api/v1/auth/login",
        headers={"X-Real-IP": "100.104.99.88"},
        json={"username": "owner", "password": "VeryStrongPassword!2026"},
    )
    assert login2.status_code == 200

    sessions = (await client.get("/api/v1/auth/sessions", headers=h)).json()
    assert len(sessions) == 2
    current = next(s for s in sessions if s["is_current"])
    other = next(s for s in sessions if not s["is_current"])
    assert current["ip_address"] == "100.104.22.33"

    # Detail view
    det = await client.get(f"/api/v1/auth/sessions/{other['id']}", headers=h)
    assert det.status_code == 200
    assert det.json()["ip_address"] == "100.104.99.88"

    # Cannot delete current session
    assert (await client.delete(f"/api/v1/auth/sessions/{current['id']}", headers=h)).status_code == 400

    # Revoke others
    rev = await client.post("/api/v1/auth/sessions/revoke-others", headers=h)
    assert rev.status_code == 200 and rev.json()["revoked_count"] == 1

    # Login history list + detail
    hist = (await client.get("/api/v1/auth/login-history?ip=100.104.22.33", headers=h)).json()
    assert len(hist) >= 1
    hdet = await client.get(f"/api/v1/auth/login-history/{hist[0]['id']}", headers=h)
    assert hdet.status_code == 200
    assert hdet.json()["ip_address"] == "100.104.22.33"

    # IP lookup (NetBird + invalid IP)
    nb = await client.get("/api/v1/auth/ip-lookup/100.104.116.58", headers=h)
    assert nb.status_code == 200 and nb.json()["is_netbird"] is True
    bad_ip = await client.get("/api/v1/auth/ip-lookup/not-an-ip", headers=h)
    assert bad_ip.status_code == 400

    # WebAuthn credentials list returns empty list cleanly
    creds = await client.get("/api/v1/auth/webauthn/credentials", headers=h)
    assert creds.status_code == 200 and creds.json() == []


@pytest.mark.asyncio
async def test_users_rbac_profile_preferences_and_audit_detail(client: AsyncClient) -> None:
    boot = await _bootstrap_admin(client)
    admin_h = {"Authorization": f"Bearer {boot['access_token']}"}
    admin_id = boot["user_id"]

    # Default preferences match tangerine + floating + bloomberg + ru + UTC
    prefs_get = await client.get("/api/v1/profile/preferences", headers=admin_h)
    assert prefs_get.status_code == 200
    p = prefs_get.json()["preferences"]
    assert p["theme_preset"] == "tangerine"
    assert p["sidebar_variant"] == "floating"
    assert p["density"] == "bloomberg"
    assert p["language"] == "ru"
    assert p["timezone"] == "UTC"

    # Deep merge preserves nested keys
    await client.patch(
        "/api/v1/profile/preferences",
        headers=admin_h,
        json={"preferences": {"custom_hotkeys": {"buy": "KeyB"}}},
    )
    merged = (
        await client.patch(
            "/api/v1/profile/preferences",
            headers=admin_h,
            json={"preferences": {"custom_hotkeys": {"sell": "KeyS"}}},
        )
    ).json()["preferences"]
    assert merged["custom_hotkeys"] == {"buy": "KeyB", "sell": "KeyS"}

    # Vault upsert + delete
    await client.put("/api/v1/profile/vault/finnhub_api_key", headers=admin_h, json={"value": "fh_123"})
    del_v = await client.delete("/api/v1/profile/vault/finnhub_api_key", headers=admin_h)
    assert del_v.status_code == 204

    # Self-delete & last-admin guards
    assert (await client.delete(f"/api/v1/users/{admin_id}", headers=admin_h)).status_code == 400
    demote_r = await client.patch(f"/api/v1/users/{admin_id}", headers=admin_h, json={"role": "VIEWER"})
    assert demote_r.status_code == 400
    disable_r = await client.patch(f"/api/v1/users/{admin_id}", headers=admin_h, json={"is_active": False})
    assert disable_r.status_code == 400

    # Create VIEWER & OPERATOR
    viewer = (
        await client.post(
            "/api/v1/users",
            headers=admin_h,
            json={
                "username": "analyst",
                "email": "analyst@huseynovlar.org",
                "password": "ViewerPassword!2026",
                "role": "VIEWER",
            },
        )
    ).json()
    assert viewer["role"] == "VIEWER"

    # Viewer login cannot access /users
    v_login = await client.post("/api/v1/auth/login", json={"username": "analyst", "password": "ViewerPassword!2026"})
    v_h = {"Authorization": f"Bearer {v_login.json()['access_token']}"}
    assert (await client.get("/api/v1/users", headers=v_h)).status_code == 403

    # Admin can view, update, and delete viewer
    assert (await client.get(f"/api/v1/users/{viewer['id']}", headers=admin_h)).status_code == 200
    upd = await client.patch(f"/api/v1/users/{viewer['id']}", headers=admin_h, json={"role": "OPERATOR"})
    assert upd.status_code == 200 and upd.json()["role"] == "OPERATOR"
    assert (await client.delete(f"/api/v1/users/{viewer['id']}", headers=admin_h)).status_code == 204

    # Audit log filters & detail view
    audits = (await client.get("/api/v1/audit?action=users.", headers=admin_h)).json()
    assert len(audits) >= 3
    assert audits[0]["username"] == "owner"
    adet = await client.get(f"/api/v1/audit/{audits[0]['id']}", headers=admin_h)
    assert adet.status_code == 200 and adet.json()["id"] == audits[0]["id"]


@pytest.mark.asyncio
async def test_ws_hub_local_broadcast_welcome_heartbeat_and_ping_pong() -> None:
    hub = LiveWebSocketHub()
    sent: list[dict[str, Any]] = []

    class FakeWS:
        async def accept(self) -> None:
            return None

        async def send_json(self, payload: dict[str, Any]) -> None:
            sent.append(payload)

    ws = FakeWS()
    await hub.connect(ws)  # type: ignore[arg-type]
    assert sent[0]["type"] == "welcome"
    assert "server_time_msc" in sent[0]

    await hub.handle_client_message(ws, json.dumps({"type": "ping", "ts": 12345}))  # type: ignore[arg-type]
    assert sent[-1]["type"] == "pong"
    assert sent[-1]["client_ts"] == 12345

    ok = await hub.send_heartbeat(ws)  # type: ignore[arg-type]
    assert ok is True and sent[-1]["type"] == "heartbeat"

    await hub.broadcast("snapshot", {"balance": 1000.0})
    assert sent[-1] == {"type": "snapshot", "data": {"balance": 1000.0}}

    await hub.disconnect(ws)  # type: ignore[arg-type]
    assert hub.connection_count == 0
    _ = ASGITransport  # keep import clean
