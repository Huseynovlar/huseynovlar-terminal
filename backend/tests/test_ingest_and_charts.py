from __future__ import annotations

from httpx import AsyncClient


async def test_ingest_idempotency_usc_normalization_balance_separation_and_chart_bundle(client: AsyncClient):
    # Bootstrap owner & seed XAUUSD asset
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    auth_h = {"Authorization": f"Bearer {boot.json()['access_token']}"}
    await client.post("/api/v1/assets/seed-defaults", headers=auth_h)
    assets = (await client.get("/api/v1/assets", headers=auth_h)).json()
    xau_id = next(a["id"] for a in assets if a["code"] == "XAUUSD")

    prof = (await client.post("/api/v1/profiles", headers=auth_h, json={"name": "Exness Main"})).json()
    acc_usc = (
        await client.post(
            "/api/v1/accounts",
            headers=auth_h,
            json={
                "profile_id": prof["id"],
                "primary_asset_id": xau_id,
                "name": "XAUUSD Cent",
                "mt5_login": "555001",
                "mt5_server": "Exness-MT5Real10",
                "account_type": "STANDARD_CENT",
                "currency": "USC",
            },
        )
    ).json()
    api_key = acc_usc["api_key"]
    mt5_h = {"X-Account-Api-Key": api_key}

    # 1. Fail-closed check on missing / wrong API key
    assert (await client.post("/api/v1/ingest/bootstrap", json={})).status_code == 401
    assert (
        await client.post("/api/v1/ingest/bootstrap", headers={"X-Account-Api-Key": "htk_wrong"}, json={})
    ).status_code == 403

    # 2. Bootstrap handshake
    bs = await client.post(
        "/api/v1/ingest/bootstrap",
        headers=mt5_h,
        json={"balance": 50000.0, "equity": 50250.0, "algo_trading_enabled": True},
    )
    assert bs.status_code == 200
    assert bs.json()["currency_divisor"] == 100.0
    assert bs.json()["last_synced_deal_ticket"] == 0

    # 3. Balance operation (Exness Vault withdrawal in USC: -10000 USC = -$100 USD) separated from trading deals
    bal = await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 1001,
            "deal_type": 2,  # DEAL_TYPE_BALANCE
            "profit": -10000.0,
            "comment": "Transfer to Exness Vault",
            "time_msc": 1732400000000,
        },
    )
    assert bal.status_code == 200
    assert bal.json()["kind"] == "balance_operation"
    assert bal.json()["op_kind"] == "EXNESS_VAULT"

    # 4. Trading deal in USC (+2500 USC gross - 100 USC comm = +2400 USC = +$24.00 USD) + idempotency check
    deal_payload = {
        "mt5_deal_ticket": 1002,
        "order_ticket": 5002,
        "position_id": 9001,
        "magic_number": 77701,
        "symbol": "XAUUSDm",
        "deal_type": 0,
        "entry_type": 1,
        "volume": 0.50,
        "price": 2645.20,
        "commission": -100.0,
        "swap": 0.0,
        "profit": 2500.0,
        "fee": 0.0,
        "time_msc": 1732400300000,
    }
    d1 = await client.post("/api/v1/ingest/trade-event", headers=mt5_h, json=deal_payload)
    assert d1.status_code == 200
    assert d1.json()["kind"] == "deal"
    assert d1.json()["net_profit_usd"] == 24.0

    d2 = await client.post("/api/v1/ingest/trade-event", headers=mt5_h, json=deal_payload)
    assert d2.status_code == 200
    assert d2.json()["status"] == "duplicate"

    # 5. Live snapshot with open position (Entry/SL/TP + MAE/MFE) & OHLCV bars
    snap = await client.post(
        "/api/v1/ingest/snapshot",
        headers=mt5_h,
        json={
            "balance": 52400.0,
            "equity": 52900.0,
            "floating_pnl": 500.0,
            "margin_level": 1850.0,
            "algo_trading_enabled": True,
            "symbol": "XAUUSDm",
            "bid": 2648.10,
            "ask": 2648.35,
            "spread_pts": 25,
            "open_positions": [
                {
                    "position_ticket": 9002,
                    "magic_number": 77701,
                    "symbol": "XAUUSDm",
                    "side": "BUY",
                    "volume": 0.25,
                    "open_price": 2644.00,
                    "current_price": 2648.10,
                    "sl": 2638.00,
                    "tp": 2655.00,
                    "profit": 500.0,
                    "mae": -120.0,
                    "mfe": 640.0,
                    "open_time": 1732400400,
                }
            ],
        },
    )
    assert snap.status_code == 200

    bars = await client.post(
        "/api/v1/ingest/bars",
        headers=mt5_h,
        json={
            "symbol": "XAUUSDm",
            "timeframe": "M5",
            "bars": [
                {"time": 1732400100, "open": 2641.0, "high": 2646.0, "low": 2640.5, "close": 2645.2, "volume": 410},
                {"time": 1732400400, "open": 2645.2, "high": 2649.0, "low": 2643.8, "close": 2648.1, "volume": 520},
            ],
        },
    )
    assert bars.status_code == 200 and bars.json()["upserted"] == 2

    # 6. Fetch chart bundle for XAUUSD — resolves alias XAUUSDm, returns bars + open positions + deals
    chart = await client.get("/api/v1/charts/XAUUSD?timeframe=M5", headers=auth_h)
    assert chart.status_code == 200
    bundle = chart.json()
    assert len(bundle["bars"]) == 2
    assert len(bundle["open_positions"]) == 1
    assert bundle["open_positions"][0]["profit_usd"] == 5.0
    assert bundle["open_positions"][0]["mae_usd"] == -1.2
    assert len(bundle["deals"]) == 1
    assert bundle["deals"][0]["net_profit_usd"] == 24.0
