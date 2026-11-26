from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import create_app


async def _bootstrap(client: AsyncClient) -> tuple[dict[str, str], str]:
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    assert boot.status_code == 201
    token = boot.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, token


async def test_profiles_accounts_fernet_key_and_robots_dual_routes(client: AsyncClient):
    h, _ = await _bootstrap(client)

    # 1. Exness Profile CRUD + Detail View
    p_res = await client.post(
        "/api/v1/profiles",
        headers=h,
        json={"name": "Exness Institutional", "notes": "Primary PA", "external_api_key": "ex_key_123"},
    )
    assert p_res.status_code == 201
    pid = p_res.json()["id"]
    assert p_res.json()["has_external_api"] is True

    p_patch = await client.patch(f"/api/v1/profiles/{pid}", headers=h, json={"notes": "Updated PA notes"})
    assert p_patch.status_code == 200
    assert p_patch.json()["notes"] == "Updated PA notes"

    # 2. Trading Account CRUD + Fernet api_key_enc verified via bridge.set
    a_res = await client.post(
        "/api/v1/accounts",
        headers=h,
        json={
            "profile_id": pid,
            "name": "USTEC Cent",
            "mt5_login": "253752700",
            "mt5_server": "Exness-MT5Real10",
            "account_type": "STANDARD_CENT",
            "currency": "USC",
            "platform": "MT5",
        },
    )
    assert a_res.status_code == 201
    acc = a_res.json()
    assert acc["api_key"].startswith("htk_")
    assert acc["has_encrypted_key"] is True
    assert acc["currency_divisor"] == 100.0

    # Lookup account by mt5_login & verify bridge.set pre-fills real decrypted htk_ key
    acc_by_login = await client.get("/api/v1/accounts/253752700", headers=h)
    assert acc_by_login.status_code == 200
    assert acc_by_login.json()["id"] == acc["id"]
    assert acc_by_login.json()["profile_name"] == "Exness Institutional"

    bset = await client.get("/api/v1/ops/setup-wizard/253752700/bridge.set", headers=h)
    assert bset.status_code == 200
    assert f"AccountApiKey={acc['api_key']}" in bset.text

    # Rotate key by login and confirm new encrypted key propagates to bridge.set
    rot = await client.post("/api/v1/accounts/253752700/rotate-key", headers=h)
    assert rot.status_code == 200
    new_key = rot.json()["api_key"]
    assert new_key != acc["api_key"]
    bset2 = await client.get("/api/v1/ops/setup-wizard/253752700/bridge.set", headers=h)
    assert f"AccountApiKey={new_key}" in bset2.text

    # Patch account currency USD -> divisor 1.0
    a_patch = await client.patch("/api/v1/accounts/253752700", headers=h, json={"name": "USTEC Pro", "currency": "USD"})
    assert a_patch.status_code == 200
    assert a_patch.json()["currency_divisor"] == 1.0

    # 3. Robots dual routes: /api/v1/robots AND /api/v1/accounts/robots
    r_res = await client.post(
        "/api/v1/accounts/robots",
        headers=h,
        json={
            "account_id": acc["id"],
            "magic_number": 301001,
            "name": "NasdaqPulse v3.01",
            "symbol": "USTEC",
            "program_name": "NasdaqPulse.mq5",
            "version": "3.01",
        },
    )
    assert r_res.status_code == 201
    rid = r_res.json()["id"]

    list_a = await client.get("/api/v1/robots", headers=h)
    list_b = await client.get("/api/v1/accounts/robots", headers=h)
    assert list_a.status_code == 200 and list_b.status_code == 200
    assert len(list_a.json()) == 1 and list_a.json()[0]["id"] == list_b.json()[0]["id"] == rid

    r_detail = await client.get(f"/api/v1/accounts/robots/{rid}", headers=h)
    assert r_detail.status_code == 200
    assert "live_state_json" in r_detail.json()
    assert "stats" in r_detail.json()

    r_upd = await client.patch(f"/api/v1/robots/{rid}", headers=h, json={"version": "3.02", "live_status": "SCANNING"})
    assert r_upd.status_code == 200
    assert r_upd.json()["version"] == "3.02"

    # Profile detail includes linked accounts
    p_detail = await client.get(f"/api/v1/profiles/{pid}", headers=h)
    assert p_detail.status_code == 200
    assert len(p_detail.json()["accounts"]) == 1

    # Delete robot, account, profile
    assert (await client.delete(f"/api/v1/accounts/robots/{rid}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/v1/accounts/{acc['id']}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/v1/profiles/{pid}", headers=h)).status_code == 204


async def test_ingest_auto_robot_discovery_and_sibling_ea_telemetry(client: AsyncClient):
    h, _ = await _bootstrap(client)
    acc = (
        await client.post(
            "/api/v1/accounts",
            headers=h,
            json={
                "name": "USTEC Live",
                "mt5_login": "88001",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USD",
            },
        )
    ).json()
    mt5_h = {"X-Account-Api-Key": acc["api_key"]}

    # Send snapshot with unknown MagicNumbers in robot_states and sibling_eas -> auto-discovered!
    snap = await client.post(
        "/api/v1/ingest/snapshot",
        headers=mt5_h,
        json={
            "balance": 10000.0,
            "equity": 10125.0,
            "floating_pnl": 125.0,
            "margin_level": 1200.0,
            "algo_trading_enabled": True,
            "symbol": "USTECc",
            "robot_states": [
                {
                    "magic_number": 900301,
                    "ea_name": "NasdaqPulse v3.01",
                    "symbol": "USTECc",
                    "status": "RUNNING",
                    "execution_ms": 14,
                    "state_json": {"bias": "BULLISH", "regime": "TREND", "spread_pts": 18},
                }
            ],
            "sibling_eas": [
                {
                    "chart_id": 1337,
                    "symbol": "XAUUSDc",
                    "timeframe": "M5",
                    "ea_name": "GoldBreaker",
                    "magic_number": 900401,
                    "status": "ATTACHED",
                }
            ],
        },
    )
    assert snap.status_code == 200
    assert snap.json()["robots_updated"] == 2

    robots = (await client.get("/api/v1/robots", headers=h)).json()
    by_magic = {r["magic_number"]: r for r in robots}
    assert 900301 in by_magic
    assert by_magic[900301]["name"] == "NasdaqPulse v3.01"
    assert by_magic[900301]["live_state_json"]["bias"] == "BULLISH"
    assert by_magic[900301]["is_online"] is True
    assert 900401 in by_magic
    assert by_magic[900401]["name"] == "GoldBreaker"


async def test_asset_hub_detail_news_digest_and_same_origin_logo_proxy(client: AsyncClient):
    h, _ = await _bootstrap(client)
    await client.post("/api/v1/assets/seed-defaults", headers=h)

    # Same-origin logo proxy works for every category with 200 OK & Cache-Control
    for sym in ("XAUUSD", "USTEC", "SPX", "EURUSD", "BTCUSD", "NVDA", "CUSTOMXYZ99"):
        resp = await client.get(f"/api/v1/assets/logo/{sym}")
        assert resp.status_code == 200
        ct = resp.headers["content-type"]
        assert any(m in ct for m in ("image/svg+xml", "image/png", "image/webp", "image/jpeg"))
        assert "max-age=" in resp.headers["cache-control"]
        assert len(resp.content) > 60

    # Asset Detail View returns multi-account stats + real news_digest
    detail = await client.get("/api/v1/assets/XAUUSD", headers=h)
    assert detail.status_code == 200
    body = detail.json()
    assert body["code"] == "XAUUSD"
    assert body["logo_url"] == "/api/v1/assets/logo/XAUUSD"
    assert "stats" in body
    assert "news_digest" in body
    assert "sentiment_breakdown" in body["news_digest"]
    assert isinstance(body["recent_news"], list)


async def test_asset_hub_broker_symbol_alias_recognition(client: AsyncClient):
    """Verify XAUUSDc / USTECm MT5 accounts, robots, deals, and bars automatically attach to XAUUSD / USTEC hubs."""
    h, _ = await _bootstrap(client)
    await client.post("/api/v1/assets", headers=h, json={"code": "XAUUSD", "name": "Gold Spot", "group": "metals"})

    # Create account WITHOUT primary_asset_id (simulating standard user setup)
    acc = (
        await client.post(
            "/api/v1/accounts",
            headers=h,
            json={
                "name": "Exness Cent Gold",
                "mt5_login": "991002",
                "mt5_server": "Exness-MT5Real15",
                "currency": "USD",
            },
        )
    ).json()
    mt5_h = {"X-Account-Api-Key": acc["api_key"]}

    now_sec = int(datetime.now(UTC).timestamp())
    await client.post(
        "/api/v1/ingest/snapshot",
        headers=mt5_h,
        json={
            "balance": 2500.0,
            "equity": 2545.5,
            "floating_pnl": 45.5,
            "symbol": "XAUUSDc",
            "bid": 3320.1,
            "ask": 3320.3,
            "robot_states": [
                {
                    "magic_number": 810001,
                    "ea_name": "GoldPulseReversion v8.1.0",
                    "symbol": "XAUUSDc",
                    "status": "RUNNING",
                    "execution_ms": 4,
                    "state_json": {
                        "regime": "MEAN_REVERSION",
                        "bb_upper": 3330.0,
                        "vwap": 3321.0,
                        "bb_lower": 3310.0,
                    },
                }
            ],
        },
    )
    await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 70001,
            "position_id": 50001,
            "magic_number": 810001,
            "symbol": "XAUUSDc",
            "deal_type": 0,
            "entry_type": 1,
            "volume": 0.1,
            "price": 3322.5,
            "profit": 38.0,
            "time_msc": now_sec * 1000,
        },
    )
    await client.post(
        "/api/v1/ingest/bars",
        headers=mt5_h,
        json={
            "symbol": "XAUUSDc",
            "timeframe": "M5",
            "bars": [
                {
                    "time": (now_sec // 300) * 300,
                    "open": 3318.0,
                    "high": 3325.0,
                    "low": 3317.0,
                    "close": 3322.0,
                }
            ],
        },
    )

    hub = (await client.get("/api/v1/assets/XAUUSD", headers=h)).json()
    assert hub["stats"]["accounts_count"] == 1
    assert hub["stats"]["robots_count"] == 1
    assert hub["stats"]["total_equity_usd"] == 2545.5
    assert hub["stats"]["pnl_24h_usd"] == 38.0
    assert hub["stats"]["net_pnl_usd"] == 38.0
    assert len(hub["robots"]) == 1
    assert hub["robots"][0]["live_state_json"]["bb_upper"] == 3330.0

    deals = (await client.get("/api/v1/journal/deals?symbol=XAUUSD", headers=h)).json()
    assert len(deals) == 1
    assert deals[0]["symbol"] == "XAUUSDC"


async def test_chart_state_persistence_and_macro_search(client: AsyncClient):
    h, _ = await _bootstrap(client)

    # Default state before saving
    st0 = await client.get("/api/v1/charts/state/XAUUSD", headers=h)
    assert st0.status_code == 200
    assert st0.json()["timeframe"] == "H1"
    assert st0.json()["drawings_json"] == []

    # Save drawings, indicators, and filters to PostgreSQL/SQLite chart_states
    put = await client.put(
        "/api/v1/charts/state/XAUUSD",
        headers=h,
        json={
            "timeframe": "M15",
            "indicators_json": {"ema20": True, "ema50": True, "rsi": True},
            "drawings_json": [{"type": "hline", "price": 2650.5, "label": "Key Support"}],
            "filters_json": {"show_deals": True, "show_positions": True},
        },
    )
    assert put.status_code == 200
    assert put.json()["timeframe"] == "M15"
    assert len(put.json()["drawings_json"]) == 1

    # Re-fetch confirms server persistence
    st1 = await client.get("/api/v1/charts/state/XAUUSD", headers=h)
    assert st1.status_code == 200
    assert st1.json()["indicators_json"]["ema20"] is True
    assert st1.json()["drawings_json"][0]["price"] == 2650.5

    # Search works locally even if Yahoo is mocked/offline
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"quotes": [{"symbol": "NVDA", "shortname": "NVIDIA Corp", "exchDisp": "NASDAQ"}]}
    mock_http = AsyncMock()
    mock_http.__aenter__.return_value = mock_http
    mock_http.get = AsyncMock(return_value=mock_resp)
    with patch("app.modules.charts.router.httpx.AsyncClient", return_value=mock_http):
        sr = await client.get("/api/v1/charts/search?q=NVDA", headers=h)
    assert sr.status_code == 200
    assert any(item["symbol"] == "NVDA" for item in sr.json())


def test_websocket_live_auth_welcome_and_ping_pong():
    """Verify WS /api/v1/ws/live rejects unauthenticated clients and emits welcome + pong when authenticated."""
    import asyncio

    test_settings = Settings(
        ENVIRONMENT="test",
        TERMINAL_DOMAIN="terminal.huseynovlar.org",
        TERMINAL_ORIGIN="https://terminal.huseynovlar.org",
        WEBAUTHN_RP_ID="terminal.huseynovlar.org",
        JWT_SECRET_KEY="test-jwt-secret-key-at-least-32-bytes-long",
        VAULT_MASTER_KEY="test-vault-master-key-at-least-32-bytes",
        COOKIE_SECURE=False,
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    app = create_app()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: test_settings

    with patch("app.main.get_settings", return_value=test_settings), TestClient(app) as tc:
        # 1. Unauthenticated WS rejected
        try:
            with tc.websocket_connect("/api/v1/ws/live"):
                raise AssertionError("Expected unauthenticated WS to be closed")
        except Exception:
            pass

        # 2. Bootstrap user & connect with ?token=<jwt>
        boot = tc.post(
            "/api/v1/auth/bootstrap",
            json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
        )
        assert boot.status_code == 201
        token = boot.json()["access_token"]

        with tc.websocket_connect(f"/api/v1/ws/live?token={token}") as ws:
            welcome = ws.receive_json()
            assert welcome["type"] == "welcome"
            assert "server_time_msc" in welcome
            assert "portfolio" in welcome
            assert welcome["portfolio"]["accounts_count"] == 0

            # Client ping -> server pong with client_ts echoed for RTT calculation
            now_ms = int(datetime.now(UTC).timestamp() * 1000)
            ws.send_json({"type": "ping", "ts": now_ms})
            pong = ws.receive_json()
            assert pong["type"] == "pong"
            assert pong["client_ts"] == now_ms

            # Multiplexed WebSocket RPC -> executes internal API route with zero HTTP fetch
            ws.send_json({"type": "rpc", "id": "rpc_test_1", "method": "GET", "path": "/profile/me"})
            rpc_me = ws.receive_json()
            assert rpc_me["type"] == "rpc_response"
            assert rpc_me["id"] == "rpc_test_1"
            assert rpc_me["ok"] is True
            assert rpc_me["status"] == 200
            assert rpc_me["data"]["username"] == "owner"

            ws.send_json(
                {"type": "rpc", "id": "rpc_test_2", "method": "GET", "path": "/assets/tickers?limit=5&offset=0"}
            )
            rpc_tk = ws.receive_json()
            assert rpc_tk["type"] == "rpc_response"
            assert rpc_tk["ok"] is True
            assert int(rpc_tk["headers"]["x-total-count"]) > 0
            assert len(rpc_tk["data"]) == 5

    asyncio.run(engine.dispose())
