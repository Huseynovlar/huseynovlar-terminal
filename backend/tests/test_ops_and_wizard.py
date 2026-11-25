from __future__ import annotations

from httpx import AsyncClient


async def test_container_allowlist_kill_switch_and_mt5_set_generator(client: AsyncClient):
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    h = {"Authorization": f"Bearer {boot.json()['access_token']}"}

    # 1. Non-allowlisted container MUST be rejected with 403
    bad_restart = await client.post("/api/v1/ops/containers/some-random-db/restart", headers=h)
    assert bad_restart.status_code == 403

    bad_logs = await client.get("/api/v1/ops/containers/some-random-db/logs", headers=h)
    assert bad_logs.status_code == 403

    # 2. Create account & test Kill-Switch confirmation guard + queuing + consumption by Bridge snapshot
    prof = (await client.post("/api/v1/profiles", headers=h, json={"name": "Exness Main"})).json()
    acc = (
        await client.post(
            "/api/v1/accounts",
            headers=h,
            json={
                "profile_id": prof["id"],
                "name": "XAUUSD Pro USD",
                "mt5_login": "999001",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USD",
            },
        )
    ).json()

    wrong_confirm = await client.post(f"/api/v1/ops/kill-switch/{acc['id']}", headers=h, json={"confirm_text": "yes"})
    assert wrong_confirm.status_code == 400

    ok_ks = await client.post(f"/api/v1/ops/kill-switch/{acc['id']}", headers=h, json={"confirm_text": "CLOSE ALL"})
    assert ok_ks.status_code == 200 and ok_ks.json()["status"] == "queued"

    # MT5 Bridge heartbeat receives pending CLOSE_ALL command once
    snap1 = await client.post(
        "/api/v1/ingest/snapshot",
        headers={"X-Account-Api-Key": acc["api_key"]},
        json={"balance": 5000.0, "equity": 4950.0, "floating_pnl": -50.0},
    )
    assert snap1.status_code == 200
    assert len(snap1.json()["pending_commands"]) == 1
    assert snap1.json()["pending_commands"][0]["command"] == "CLOSE_ALL"

    # Next heartbeat sees empty commands
    snap2 = await client.post(
        "/api/v1/ingest/snapshot",
        headers={"X-Account-Api-Key": acc["api_key"]},
        json={"balance": 5000.0, "equity": 5000.0, "floating_pnl": 0.0},
    )
    assert snap2.json()["pending_commands"] == []

    # 3. MT5 .set preset file generator
    preset = await client.get(f"/api/v1/ops/setup-wizard/{acc['id']}/bridge.set", headers=h)
    assert preset.status_code == 200
    assert "ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest" in preset.text
    assert "AllowRemoteClose=false" in preset.text
