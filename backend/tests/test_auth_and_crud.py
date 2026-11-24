from __future__ import annotations

import pyotp
from httpx import AsyncClient


async def test_full_phase1_auth_profile_assets_multi_account_and_audit(client: AsyncClient):
    # 1. Health & uninitialized status
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/status")).json() == {"initialized": False}

    # 2. Bootstrap owner (succeeds once, second attempt fails with 409)
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "username": "owner",
            "email": "owner@huseynovlar.org",
            "password": "VeryStrongPassword!2026",
            "display_name": "Huseynov",
        },
    )
    assert boot.status_code == 201
    token = boot.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    dup_boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "username": "attacker",
            "email": "a@example.com",
            "password": "VeryStrongPassword!2026",
        },
    )
    assert dup_boot.status_code == 409

    # 3. Setup & enable TOTP 2FA, verify login enforces TOTP
    setup_2fa = await client.post("/api/v1/auth/2fa/setup", headers=headers)
    assert setup_2fa.status_code == 200
    totp_secret = setup_2fa.json()["secret"]
    code = pyotp.TOTP(totp_secret).now()
    en = await client.post("/api/v1/auth/2fa/verify", headers=headers, json={"code": code})
    assert en.status_code == 200 and en.json()["totp_enabled"] is True

    no_code_login = await client.post(
        "/api/v1/auth/login", json={"username": "owner", "password": "VeryStrongPassword!2026"}
    )
    assert no_code_login.status_code == 401

    ok_login = await client.post(
        "/api/v1/auth/login",
        json={"username": "owner", "password": "VeryStrongPassword!2026", "totp_code": pyotp.TOTP(totp_secret).now()},
    )
    assert ok_login.status_code == 200

    # 4. WebAuthn FIDO2 registration & login options generation
    reg_opts = await client.post("/api/v1/auth/webauthn/register/options", headers=headers)
    assert reg_opts.status_code == 200
    assert reg_opts.json()["rp"]["id"] == "terminal.huseynovlar.org"

    login_opts = await client.post("/api/v1/auth/webauthn/login/options", json={"username": "owner"})
    assert login_opts.status_code == 200
    assert login_opts.json()["options"]["rpId"] == "terminal.huseynovlar.org"

    # 5. Profile, social links, preferences, and encrypted secret vault
    prof = await client.patch(
        "/api/v1/profile/me",
        headers=headers,
        json={
            "bio": "Algo Trader — XAUUSD & USTEC",
            "avatar_url": "https://terminal.huseynovlar.org/avatar.png",
            "social_links": {"telegram": "@huseynovlar", "github": "Huseynovlar"},
        },
    )
    assert prof.status_code == 200
    assert prof.json()["social_links"]["telegram"] == "@huseynovlar"

    pref = await client.patch(
        "/api/v1/profile/preferences",
        headers=headers,
        json={"preferences": {"sidebar_order": ["overview", "xauusd", "ustec"], "density": "compact"}},
    )
    assert pref.status_code == 200
    assert pref.json()["preferences"]["density"] == "compact"

    vault_put = await client.put(
        "/api/v1/profile/vault/google_ai_api_key", headers=headers, json={"value": "AIzaSySecretKey"}
    )
    assert vault_put.status_code == 200
    vault_list = await client.get("/api/v1/profile/vault", headers=headers)
    assert any(item["key"] == "google_ai_api_key" and item["configured"] for item in vault_list.json())

    # 6. Seed default assets from config/assets.default.yaml (XAUUSD, USTEC, Watchlist)
    seeded = await client.post("/api/v1/assets/seed-defaults", headers=headers)
    assert seeded.status_code == 200
    assert "XAUUSD" in seeded.json()["seeded"]
    assert "USTEC" in seeded.json()["seeded"]

    assets = (await client.get("/api/v1/assets", headers=headers)).json()
    xau_id = next(a["id"] for a in assets if a["code"] == "XAUUSD")

    # 7. Multi-account USD + USC on the SAME asset (XAUUSD) inside ONE Exness Profile
    ex_prof = (await client.post("/api/v1/profiles", headers=headers, json={"name": "Main Exness PA"})).json()
    acc_usd = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "profile_id": ex_prof["id"],
            "primary_asset_id": xau_id,
            "name": "XAUUSD Pro USD",
            "mt5_login": "100200300",
            "mt5_server": "Exness-MT5Real10",
            "account_type": "PRO",
            "currency": "USD",
        },
    )
    assert acc_usd.status_code == 201
    assert acc_usd.json()["currency_divisor"] == 1.0
    assert acc_usd.json()["api_key"].startswith("htk_")

    acc_usc = await client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "profile_id": ex_prof["id"],
            "primary_asset_id": xau_id,
            "name": "XAUUSD Cent USC",
            "mt5_login": "100200301",
            "mt5_server": "Exness-MT5Real10",
            "account_type": "STANDARD_CENT",
            "currency": "USC",
        },
    )
    assert acc_usc.status_code == 201
    assert acc_usc.json()["currency_divisor"] == 100.0

    # Rotate API key
    rotated = await client.post(f"/api/v1/accounts/{acc_usd.json()['id']}/rotate-key", headers=headers)
    assert rotated.status_code == 200
    assert rotated.json()["api_key"] != acc_usd.json()["api_key"]

    # 8. Create robot on account & verify Audit Log recorded actions
    bot = await client.post(
        "/api/v1/robots",
        headers=headers,
        json={
            "account_id": acc_usd.json()["id"],
            "magic_number": 77701,
            "name": "Gold Scalper v2",
            "symbol": "XAUUSD",
            "program_name": "GoldScalper.mq5",
            "version": "2.1",
        },
    )
    assert bot.status_code == 201

    audits = (await client.get("/api/v1/audit", headers=headers)).json()
    actions = {a["action"] for a in audits}
    assert {
        "auth.bootstrap_owner",
        "auth.totp_enabled",
        "account.created",
        "account.api_key_rotated",
        "robot.created",
    }.issubset(actions)
