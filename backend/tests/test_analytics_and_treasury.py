from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient


async def test_institutional_analytics_treasury_and_csv_statement(client: AsyncClient):
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    auth_h = {"Authorization": f"Bearer {boot.json()['access_token']}"}
    prof = (await client.post("/api/v1/profiles", headers=auth_h, json={"name": "Exness PA"})).json()

    acc_usd = (
        await client.post(
            "/api/v1/accounts",
            headers=auth_h,
            json={
                "profile_id": prof["id"],
                "name": "XAUUSD Pro USD",
                "mt5_login": "70001",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USD",
            },
        )
    ).json()
    acc_usc = (
        await client.post(
            "/api/v1/accounts",
            headers=auth_h,
            json={
                "profile_id": prof["id"],
                "name": "USTEC Cent USC",
                "mt5_login": "70002",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USC",
            },
        )
    ).json()

    now_msc = int(datetime.now(UTC).timestamp() * 1000)

    # Deposit + Vault transfer on USD account
    await client.post(
        "/api/v1/ingest/trade-event",
        headers={"X-Account-Api-Key": acc_usd["api_key"]},
        json={
            "mt5_deal_ticket": 1,
            "deal_type": 2,
            "profit": 2000.0,
            "comment": "Initial Deposit",
            "time_msc": now_msc - 500000,
        },
    )
    await client.post(
        "/api/v1/ingest/trade-event",
        headers={"X-Account-Api-Key": acc_usd["api_key"]},
        json={
            "mt5_deal_ticket": 2,
            "deal_type": 2,
            "profit": -300.0,
            "comment": "Transfer to Exness Vault",
            "time_msc": now_msc - 100000,
        },
    )

    # 3 closed deals: +400 USD (XAUUSD), -100 USD (XAUUSD), +20000 USC (= +200 USD on USTEC)
    await client.post(
        "/api/v1/ingest/trade-event",
        headers={"X-Account-Api-Key": acc_usd["api_key"]},
        json={
            "mt5_deal_ticket": 10,
            "magic_number": 101,
            "symbol": "XAUUSD",
            "deal_type": 0,
            "entry_type": 1,
            "volume": 0.5,
            "price": 2650.0,
            "profit": 400.0,
            "time_msc": now_msc - 300000,
        },
    )
    await client.post(
        "/api/v1/ingest/trade-event",
        headers={"X-Account-Api-Key": acc_usd["api_key"]},
        json={
            "mt5_deal_ticket": 11,
            "magic_number": 101,
            "symbol": "XAUUSD",
            "deal_type": 1,
            "entry_type": 1,
            "volume": 0.5,
            "price": 2642.0,
            "profit": -100.0,
            "time_msc": now_msc - 200000,
        },
    )
    await client.post(
        "/api/v1/ingest/trade-event",
        headers={"X-Account-Api-Key": acc_usc["api_key"]},
        json={
            "mt5_deal_ticket": 20,
            "magic_number": 202,
            "symbol": "USTEC",
            "deal_type": 0,
            "entry_type": 1,
            "volume": 1.0,
            "price": 20850.0,
            "profit": 20000.0,  # 20000 USC = $200 USD
            "time_msc": now_msc - 150000,
        },
    )

    # Verify institutional metrics
    ov = await client.get("/api/v1/analytics/overview", headers=auth_h)
    assert ov.status_code == 200
    m = ov.json()["metrics"]
    assert m["total_trades"] == 3
    assert m["wins"] == 2 and m["losses"] == 1
    assert m["net_pnl_usd"] == 500.0
    assert m["gross_profit_usd"] == 600.0
    assert m["gross_loss_usd"] == 100.0
    assert m["profit_factor"] == 6.0
    assert m["max_drawdown_usd"] == 100.0
    assert len(ov.json()["by_symbol"]) == 2
    assert len(ov.json()["by_account"]) == 2

    # Verify Treasury & Exness Vault separation
    tr = await client.get("/api/v1/analytics/treasury", headers=auth_h)
    assert tr.status_code == 200
    s = tr.json()["summary"]
    assert s["total_deposited_usd"] == 2000.0
    assert s["total_vault_usd"] == 300.0
    assert s["realized_trading_profit_usd"] == 500.0
    assert s["profit_ready_for_vault_usd"] == 200.0

    # Verify full Exness CSV statement download
    csv_res = await client.get("/api/v1/analytics/statement.csv", headers=auth_h)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "XAUUSD" in csv_res.text and "USTEC" in csv_res.text
