from __future__ import annotations

import io
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.database import Base
from app.db.models import EconomicEvent, ExnessProfile, Robot, TradingAccount

# Make worker/main.py importable for unit testing
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


async def _bootstrap(client: AsyncClient) -> dict[str, str]:
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    assert boot.status_code == 201
    return {"Authorization": f"Bearer {boot.json()['access_token']}"}


async def test_analytics_usc_divisor_fix_8_charts_journal_treasury_and_xlsx(client: AsyncClient):
    h = await _bootstrap(client)
    acc_usc = (
        await client.post(
            "/api/v1/accounts",
            headers=h,
            json={
                "name": "XAUUSD Cent USC",
                "mt5_login": "60001",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USC",
            },
        )
    ).json()
    mt5_h = {"X-Account-Api-Key": acc_usc["api_key"]}
    now_msc = int(datetime.now(UTC).timestamp() * 1000)

    # USC deal: +20000 USC profit, -500 USC commission, -100 USC swap -> net = +19400 USC = +$194.00 USD
    # Commission USD MUST be -5.00 (NOT -500.00!) and Swap USD MUST be -1.00 (NOT -100.00!)
    d1 = await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 501,
            "magic_number": 777,
            "symbol": "XAUUSDc",
            "deal_type": 0,
            "entry_type": 1,
            "volume": 1.0,
            "price": 2650.0,
            "profit": 20000.0,
            "commission": -500.0,
            "swap": -100.0,
            "time_msc": now_msc - 120000,
        },
    )
    assert d1.status_code == 200 and d1.json()["net_profit_usd"] == 194.0

    # Second deal: short loss (-4000 USC = -$40.00 USD)
    await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 502,
            "magic_number": 777,
            "symbol": "XAUUSDc",
            "deal_type": 1,
            "entry_type": 1,
            "volume": 0.5,
            "price": 2655.0,
            "profit": -4000.0,
            "commission": -200.0,
            "swap": 0.0,
            "time_msc": now_msc - 60000,
        },
    )

    # 1. Analytics Overview: verify USC divisor fix + all 8 chart series
    ov = (await client.get("/api/v1/analytics/overview?magic_number=777", headers=h)).json()
    m = ov["metrics"]
    assert m["total_trades"] == 2
    assert m["total_commission_usd"] == -7.0  # (-500 + -200) / 100
    assert m["total_swap_usd"] == -1.0  # -100 / 100
    assert m["net_pnl_usd"] == 152.0  # 194.0 + (-42.0)
    for key in (
        "equity_curve",
        "drawdown_curve",
        "daily_pnl",
        "hourly_pnl",
        "by_symbol",
        "by_account",
        "by_robot",
        "long_short_breakdown",
        "mae_mfe_scatter",
        "rolling_win_rate",
    ):
        assert key in ov
    assert ov["long_short_breakdown"]["long"]["total_trades"] == 1
    assert ov["long_short_breakdown"]["short"]["total_trades"] == 1

    # 2. Home Summary
    home = await client.get("/api/v1/analytics/home-summary", headers=h)
    assert home.status_code == 200
    hb = home.json()
    assert "kpis" in hb and "market_sessions" in hb and len(hb["market_sessions"]) == 4

    # 3. Journal Deals & Notes/Tags CRUD
    deals_res = (await client.get("/api/v1/journal/deals?symbol=XAU", headers=h)).json()
    assert len(deals_res) == 2
    deal_id = deals_res[0]["id"]

    upd = await client.patch(
        f"/api/v1/journal/deals/{deal_id}",
        headers=h,
        json={"notes": "Clean London breakout entry", "tags": ["london", "A+"]},
    )
    assert upd.status_code == 200
    assert upd.json()["notes"] == "Clean London breakout entry"
    assert upd.json()["tags"] == ["london", "A+"]

    # 4. Treasury Operations Manual CRUD
    op_res = await client.post(
        "/api/v1/treasury/operations",
        headers=h,
        json={
            "account_id": acc_usc["id"],
            "op_kind": "EXNESS_VAULT",
            "amount": -5000.0,  # -5000 USC = -$50 USD
            "comment": "Manual Vault sweep",
            "notes": "Weekly profit lock",
        },
    )
    assert op_res.status_code == 201
    op_id = op_res.json()["id"]
    assert op_res.json()["amount_usd"] == -50.0
    assert op_res.json()["is_manual"] is True

    op_upd = await client.patch(
        f"/api/v1/treasury/operations/{op_id}",
        headers=h,
        json={"notes": "Confirmed in Exness PA"},
    )
    assert op_upd.status_code == 200
    assert op_upd.json()["notes"] == "Confirmed in Exness PA"

    # 5. XLSX Export via signed ?dl_token= (works even in incognito without Authorization header!)
    dl_tok = (await client.post("/api/v1/auth/download-token", headers=h)).json()["dl_token"]
    xlsx_res = await client.get(f"/api/v1/analytics/statement.xlsx?dl_token={dl_tok}")
    assert xlsx_res.status_code == 200
    assert "spreadsheetml.sheet" in xlsx_res.headers["content-type"]

    wb = load_workbook(io.BytesIO(xlsx_res.content))
    assert wb.sheetnames == ["Summary", "Deals", "Positions", "Treasury"]
    assert wb["Deals"].max_row == 3  # header + 2 deals
    assert wb["Treasury"].max_row == 2  # header + 1 op

    # Delete manual treasury op
    assert (await client.delete(f"/api/v1/treasury/operations/{op_id}", headers=h)).status_code == 204


async def test_intelligence_sources_ssrf_calendar_treemap_and_gemini(client: AsyncClient):
    h = await _bootstrap(client)

    # 1. Verified News Sources Registry auto-seeds from config/news_sources.yaml
    sources = (await client.get("/api/v1/intelligence/sources", headers=h)).json()
    assert len(sources) >= 8
    assert any(s["is_verified"] is True for s in sources)

    # Strict SSRF protection blocks loopback, metadata, private IPs, and non-http schemes
    for bad_url in (
        "http://127.0.0.1:8000/internal",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/rss.xml",
        "http://localhost/feed",
        "file:///etc/passwd",
    ):
        bad = await client.post(
            "/api/v1/intelligence/sources",
            headers=h,
            json={"name": "Bad SSRF", "url": bad_url},
        )
        assert bad.status_code == 400, f"SSRF URL should be blocked: {bad_url}"

    # Create valid custom source, test it with mocked RSS, refresh news, filter & explore
    rss_xml = """<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Gold surges as Federal Reserve signals rate cut</title>
        <link>https://feeds.example.org/gold-1</link>
        <description>XAUUSD rallies sharply on dovish Fed tone.</description>
      </item>
    </channel></rss>"""
    mock_rss = MagicMock()
    mock_rss.status_code = 200
    mock_rss.text = rss_xml
    mock_rss.raise_for_status = MagicMock()

    with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))]):
        created_src = await client.post(
            "/api/v1/intelligence/sources",
            headers=h,
            json={
                "name": "Custom Macro Desk",
                "url": "https://feeds.example.org/macro.xml",
                "category": "commodities",
                "is_verified": True,
                "asset_tags": ["XAUUSD"],
            },
        )
        assert created_src.status_code == 201
        src_id = created_src.json()["id"]

        mock_rss_http = AsyncMock()
        mock_rss_http.__aenter__.return_value = mock_rss_http
        mock_rss_http.get = AsyncMock(return_value=mock_rss)
        with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_rss_http):
            test_res = await client.post(f"/api/v1/intelligence/sources/{src_id}/test", headers=h)
            assert test_res.status_code == 200
            assert test_res.json()["ok"] is True
            assert test_res.json()["items_found"] == 1

            ref = await client.post("/api/v1/intelligence/news/refresh", headers=h)
            assert ref.status_code == 200
            assert ref.json()["inserted"] >= 1

    # Query News Wire & News Explore
    news = (await client.get("/api/v1/intelligence/news?q=Federal&asset=XAUUSD&sentiment=bullish", headers=h)).json()
    assert len(news) >= 1
    assert news[0]["sentiment"] == "bullish"
    story = await client.get(f"/api/v1/intelligence/news/{news[0]['id']}", headers=h)
    assert story.status_code == 200 and story.json()["id"] == news[0]["id"]

    explored = (await client.get("/api/v1/intelligence/news/explore?symbol=XAUUSD", headers=h)).json()
    assert len(explored) >= 1

    # 2. Economic Calendar refresh with mocked ForexFactory JSON
    ff_events = [
        {
            "title": "US Non-Farm Payrolls",
            "country": "USD",
            "date": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
            "impact": "High",
            "forecast": "185K",
            "previous": "170K",
        },
        {
            "title": "ECB Press Conference",
            "country": "EUR",
            "date": (datetime.now(UTC) + timedelta(hours=4)).isoformat(),
            "impact": "Medium",
            "forecast": "",
            "previous": "",
        },
    ]
    mock_ff = MagicMock()
    mock_ff.status_code = 200
    mock_ff.json.return_value = ff_events
    mock_ff.raise_for_status = MagicMock()
    mock_ff_http = AsyncMock()
    mock_ff_http.__aenter__.return_value = mock_ff_http
    mock_ff_http.get = AsyncMock(return_value=mock_ff)
    with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_ff_http):
        cal_ref = await client.post("/api/v1/intelligence/calendar/refresh", headers=h)
        assert cal_ref.status_code == 200
        assert cal_ref.json()["inserted"] == 2

    cal_high = (await client.get("/api/v1/intelligence/calendar?impact=High&asset=XAUUSD", headers=h)).json()
    assert len(cal_high) == 1
    assert cal_high[0]["title"] == "US Non-Farm Payrolls"
    ev_detail = await client.get(f"/api/v1/intelligence/calendar/{cal_high[0]['id']}", headers=h)
    assert ev_detail.status_code == 200 and "XAUUSD" in ev_detail.json()["affected_assets"]

    # 3. Real Treemap (mocked Yahoo Finance quotes, ZERO hash() fake data)
    mock_yahoo = MagicMock()
    mock_yahoo.status_code = 200
    mock_yahoo.text = "test-yahoo-crumb"
    mock_yahoo.json.return_value = {
        "quoteResponse": {
            "result": [
                {
                    "symbol": "NVDA",
                    "shortName": "NVIDIA Corp",
                    "regularMarketPrice": 142.50,
                    "regularMarketChangePercent": 3.25,
                    "marketCap": 3500000000000,
                    "regularMarketVolume": 52000000,
                },
                {
                    "symbol": "AAPL",
                    "shortName": "Apple Inc",
                    "regularMarketPrice": 228.10,
                    "regularMarketChangePercent": -0.45,
                    "marketCap": 3400000000000,
                    "regularMarketVolume": 41000000,
                },
            ]
        }
    }
    mock_yahoo_http = AsyncMock()
    mock_yahoo_http.__aenter__.return_value = mock_yahoo_http
    mock_yahoo_http.get = AsyncMock(return_value=mock_yahoo)
    with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_yahoo_http):
        tm = await client.get("/api/v1/intelligence/treemap?universe=nasdaq100&period=1D&q=NVDA", headers=h)
    assert tm.status_code == 200
    tm_body = tm.json()
    assert tm_body["data_status"] == "live"
    assert len(tm_body["sectors"]) == 1
    nvda_item = tm_body["sectors"][0]["items"][0]
    assert nvda_item["ticker"] == "NVDA"
    assert nvda_item["price"] == 142.5
    assert nvda_item["change_pct"] == 3.25
    assert nvda_item["live"] is True

    # 4. Gemini AI Co-Pilot with real mocked API call + Briefings CRUD
    await client.put("/api/v1/profile/vault/google_ai_api_key", headers=h, json={"value": "AIzaTestKey123"})
    mock_gem = MagicMock()
    mock_gem.status_code = 200
    mock_gem.raise_for_status = MagicMock()
    mock_gem.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "## Morning Risk Brief\n- Gold bullish on Fed tone."}]}}]
    }
    mock_gem_http = AsyncMock()
    mock_gem_http.__aenter__.return_value = mock_gem_http
    mock_gem_http.post = AsyncMock(return_value=mock_gem)
    with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_gem_http):
        ai_res = await client.post(
            "/api/v1/intelligence/ai/analyze",
            headers=h,
            json={"prompt": "Morning risk brief", "kind": "morning_brief"},
        )
    assert ai_res.status_code == 200
    assert ai_res.json()["configured"] is True
    bid = ai_res.json()["id"]

    briefings = (await client.get("/api/v1/intelligence/ai/briefings", headers=h)).json()
    assert len(briefings) == 1 and briefings[0]["id"] == bid
    assert (await client.get(f"/api/v1/intelligence/ai/briefings/{bid}", headers=h)).status_code == 200
    assert (await client.delete(f"/api/v1/intelligence/ai/briefings/{bid}", headers=h)).status_code == 204


async def test_worker_alert_rules_and_telegram_webhook_delivery():
    """Verify worker/main.py alert engine evaluates rules, enforces cooldowns, and posts webhook with secret."""
    from worker.main import evaluate_alert_rules

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sf = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    settings = Settings(
        ENVIRONMENT="test",
        ALERTS_BOT_WEBHOOK_URL="http://huseynovlar-core:8080/internal/webhooks/trading",
        ALERTS_BOT_WEBHOOK_SECRET="super-secret-webhook-key",
    )

    now = datetime.now(UTC)
    async with sf() as db:
        prof = ExnessProfile(name="Worker PA")
        db.add(prof)
        await db.flush()

        acc = TradingAccount(
            profile_id=prof.id,
            name="High Risk Acc",
            mt5_login="999001",
            mt5_server="Exness-MT5Real10",
            currency="USD",
            currency_divisor=1.0,
            api_key_prefix="htk_test",
            api_key_hash="hash_worker_test",
            last_seen_at=now - timedelta(seconds=120),  # triggers heartbeat_offline (>45s)
            last_balance=1000.0,
            last_equity=850.0,  # 15% drawdown -> triggers drawdown_critical (>10%)
            last_margin_level=180.0,  # <300% -> triggers low_margin_level
            terminal_connected=True,
            algo_trading_enabled=False,  # triggers algotrading_disabled
        )
        db.add(acc)
        await db.flush()

        db.add(
            Robot(
                account_id=acc.id,
                magic_number=555,
                name="FaultyBot",
                symbol="XAUUSD",
                live_status="ERROR",
                is_active=True,
            )
        )
        db.add(
            EconomicEvent(
                dedup_hash="worker_test_ev_1",
                title="US CPI YoY",
                currency="USD",
                impact="High",
                forecast="2.6%",
                previous="2.7%",
                event_time=now + timedelta(minutes=10),
            )
        )
        await db.commit()

        mock_post = AsyncMock()
        mock_post.return_value = MagicMock(status_code=200, raise_for_status=MagicMock())
        cooldowns: dict[str, float] = {}

        with patch("httpx.AsyncClient.post", new=mock_post):
            fired = await evaluate_alert_rules(db, settings, cooldowns)
            fired_second = await evaluate_alert_rules(db, settings, cooldowns)

        fired_codes = {f["rule"] for f in fired}
        assert {
            "heartbeat_offline",
            "drawdown_critical",
            "low_margin_level",
            "algotrading_disabled",
            "robot_error_state",
            "high_impact_news_soon",
        }.issubset(fired_codes)
        # Cooldown prevents duplicate firing on immediate second pass
        assert fired_second == []
        # Webhook received X-Trading-Webhook-Secret header
        assert mock_post.await_count == len(fired)
        first_call_headers = mock_post.await_args_list[0].kwargs["headers"]
        assert first_call_headers["X-Trading-Webhook-Secret"] == "super-secret-webhook-key"

    await engine.dispose()
