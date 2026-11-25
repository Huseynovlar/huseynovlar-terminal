"""End-to-End Full Journey Integration Test covering all 36 features (F01-F36).

Exercises the complete real FastAPI application over ASGI (HTTP + WebSocket) with an
isolated in-memory SQLite database and real JWT/Argon2id/Fernet/TOTP/WebAuthn/openpyxl
code paths, mocking only external internet HTTP endpoints (Yahoo Finance, RSS,
ForexFactory, Gemini API).
"""

from __future__ import annotations

import asyncio
import io
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pyotp
import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import create_app


@pytest.mark.asyncio
async def test_e2e_full_platform_journey_f01_to_f36(client: AsyncClient, test_settings: Settings) -> None:
    """Continuous E2E journey across Auth, RBAC, Trading Desk, Ingest, Analytics, Intelligence, and Ops."""

    # =========================================================================
    # 1. AUTH: Bootstrap -> Dual Cookies (Path=/) -> 120m TTL & sid claim ->
    #    /auth/refresh -> /auth/logout deletes UserSession & invalidates token
    # =========================================================================
    boot_resp = await client.post(
        "/api/v1/auth/bootstrap",
        headers={"X-Forwarded-For": "100.104.10.55", "User-Agent": "E2E-Journey/1.0"},
        json={
            "username": "owner",
            "email": "owner@huseynovlar.org",
            "password": "VeryStrongPassword!2026",
            "display_name": "Institutional Owner",
        },
    )
    assert boot_resp.status_code == 201
    boot_data = boot_resp.json()
    access_token_1 = boot_data["access_token"]
    admin_id = boot_data["user_id"]

    # Verify 120-minute TTL and embedded sid claim
    claims_1 = jwt.decode(
        access_token_1,
        test_settings.jwt_secret_key,
        algorithms=[test_settings.jwt_algorithm],
    )
    assert "sid" in claims_1 and claims_1["sid"]
    ttl_seconds = claims_1["exp"] - claims_1["iat"]
    assert 119 * 60 <= ttl_seconds <= 121 * 60, f"Expected ~120m TTL, got {ttl_seconds}s"

    # Verify both HttpOnly cookies are issued with Path=/
    set_cookie_headers = boot_resp.headers.get_list("set-cookie")
    access_cookie_hdr = next(h for h in set_cookie_headers if h.startswith("ht_access_token="))
    refresh_cookie_hdr = next(h for h in set_cookie_headers if h.startswith("ht_refresh_token="))
    assert "Path=/" in access_cookie_hdr
    assert "Path=/" in refresh_cookie_hdr
    assert client.cookies.get("ht_access_token") == access_token_1
    assert client.cookies.get("ht_refresh_token")

    # Cookie-only request works without Authorization header
    me_via_cookie = await client.get("/api/v1/profile/me")
    assert me_via_cookie.status_code == 200
    assert me_via_cookie.json()["username"] == "owner"

    # /auth/refresh rotates session & invalidates old token immediately
    refresh_resp = await client.post("/api/v1/auth/refresh")
    assert refresh_resp.status_code == 200
    access_token_2 = refresh_resp.json()["access_token"]
    assert access_token_2 != access_token_1
    assert (
        await client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {access_token_1}"})
    ).status_code == 401

    # Create a second concurrent session so we can inspect /auth/sessions after logout
    login_2 = await client.post(
        "/api/v1/auth/login",
        headers={"X-Forwarded-For": "100.104.20.88", "User-Agent": "E2E-Device2/1.0"},
        json={"username": "owner", "password": "VeryStrongPassword!2026"},
    )
    assert login_2.status_code == 200
    token_device2 = login_2.json()["access_token"]
    sessions_before = (
        await client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token_device2}"})
    ).json()
    assert len(sessions_before) == 2

    # Logout device 2 via Bearer token ONLY (no cookies) -> UserSession deleted immediately
    client.cookies.clear()
    logout_resp = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token_device2}"})
    assert logout_resp.status_code == 200
    assert logout_resp.json()["sessions_removed"] == 1
    assert (
        await client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {token_device2}"})
    ).status_code == 401

    sessions_after = (
        await client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {access_token_2}"})
    ).json()
    assert len(sessions_after) == 1

    # =========================================================================
    # 2. RE-LOGIN -> 2FA SVG QR + 10 Backup Codes + Disable -> WebAuthn ->
    #    RBAC Users CRUD + Last-Admin Guard -> Profile/Prefs -> Audit & Wiki
    # =========================================================================
    relogin = await client.post(
        "/api/v1/auth/login",
        headers={"X-Forwarded-For": "100.104.10.55"},
        json={"username": "owner", "password": "VeryStrongPassword!2026"},
    )
    assert relogin.status_code == 200
    auth_h = {"Authorization": f"Bearer {relogin.json()['access_token']}"}

    # 2FA setup (inline SVG QR) + verify (10 backup codes) + single-use login + disable
    tfa_setup = await client.post("/api/v1/auth/2fa/setup", headers=auth_h)
    assert tfa_setup.status_code == 200
    tfa_data = tfa_setup.json()
    assert "<svg" in tfa_data["qr_svg"]
    totp_secret = tfa_data["secret"]

    tfa_verify = await client.post(
        "/api/v1/auth/2fa/verify",
        headers=auth_h,
        json={"code": pyotp.TOTP(totp_secret).now()},
    )
    assert tfa_verify.status_code == 200
    backup_codes = tfa_verify.json()["backup_codes"]
    assert len(backup_codes) == 10

    backup_login = await client.post(
        "/api/v1/auth/login",
        json={"username": "owner", "password": "VeryStrongPassword!2026", "totp_code": backup_codes[0]},
    )
    assert backup_login.status_code == 200

    tfa_disable = await client.post(
        "/api/v1/auth/2fa/disable",
        headers=auth_h,
        json={"password": "VeryStrongPassword!2026", "code": pyotp.TOTP(totp_secret).now()},
    )
    assert tfa_disable.status_code == 200 and tfa_disable.json()["totp_enabled"] is False

    # WebAuthn registration options (base64url challenge & user.id ready for client converter)
    wa_opts = await client.post("/api/v1/auth/webauthn/register/options", headers=auth_h)
    assert wa_opts.status_code == 200
    wa_json = wa_opts.json()
    assert isinstance(wa_json["challenge"], str) and len(wa_json["challenge"]) > 10
    assert wa_json["rp"]["id"] == "terminal.huseynovlar.org"
    assert isinstance(wa_json["user"]["id"], str)

    # RBAC Users CRUD + Last-Admin Protection
    assert (await client.delete(f"/api/v1/users/{admin_id}", headers=auth_h)).status_code == 400
    assert (await client.patch(f"/api/v1/users/{admin_id}", headers=auth_h, json={"role": "VIEWER"})).status_code == 400

    new_user = (
        await client.post(
            "/api/v1/users",
            headers=auth_h,
            json={
                "username": "desk_operator",
                "email": "operator@huseynovlar.org",
                "password": "OperatorPass!2026",
                "role": "OPERATOR",
            },
        )
    )
    assert new_user.status_code == 201
    uid = new_user.json()["id"]
    assert (await client.get(f"/api/v1/users/{uid}", headers=auth_h)).status_code == 200
    assert (await client.patch(f"/api/v1/users/{uid}", headers=auth_h, json={"role": "VIEWER"})).status_code == 200
    assert (await client.delete(f"/api/v1/users/{uid}", headers=auth_h)).status_code == 204

    # Profile & Preferences persistence (tangerine, floating, bloomberg, ru, UTC)
    prof_upd = await client.patch(
        "/api/v1/profile/me",
        headers=auth_h,
        json={"display_name": "Huseynovlar Desk", "bio": "Multi-asset algorithmic trading"},
    )
    assert prof_upd.status_code == 200 and prof_upd.json()["display_name"] == "Huseynovlar Desk"

    prefs_default = (await client.get("/api/v1/profile/preferences", headers=auth_h)).json()["preferences"]
    assert prefs_default["theme_preset"] == "tangerine"
    assert prefs_default["sidebar_variant"] == "floating"
    assert prefs_default["density"] == "bloomberg"
    assert prefs_default["language"] == "ru"
    assert prefs_default["timezone"] == "UTC"

    prefs_patch = await client.patch(
        "/api/v1/profile/preferences",
        headers=auth_h,
        json={"preferences": {"language": "en", "sound_enabled": True, "vault_target_usd": 5000}},
    )
    assert prefs_patch.status_code == 200
    prefs_reloaded = (await client.get("/api/v1/profile/preferences", headers=auth_h)).json()["preferences"]
    assert prefs_reloaded["language"] == "en"
    assert prefs_reloaded["theme_preset"] == "tangerine"
    assert prefs_reloaded["vault_target_usd"] == 5000

    # Audit Log & Wiki CRUD
    audits = (await client.get("/api/v1/audit?limit=20", headers=auth_h)).json()
    assert len(audits) >= 3
    assert (await client.get(f"/api/v1/audit/{audits[0]['id']}", headers=auth_h)).status_code == 200

    wiki_list = (await client.get("/api/v1/wiki", headers=auth_h)).json()
    assert len(wiki_list) >= 3
    wiki_created = await client.post(
        "/api/v1/wiki",
        headers=auth_h,
        json={"slug": "e2e-playbook", "title": "E2E Runbook", "category": "ops", "content_md": "# Runbook"},
    )
    assert wiki_created.status_code == 201
    assert (await client.get("/api/v1/wiki/e2e-playbook", headers=auth_h)).status_code == 200
    assert (
        await client.patch("/api/v1/wiki/e2e-playbook", headers=auth_h, json={"title": "E2E Runbook v2"})
    ).status_code == 200
    assert (await client.delete("/api/v1/wiki/e2e-playbook", headers=auth_h)).status_code == 204

    # =========================================================================
    # 3. EXNESS PROFILE + TRADING ACCOUNT (api_key_enc) + bridge.set + ?dl_token=
    # =========================================================================
    ex_prof = (
        await client.post(
            "/api/v1/profiles",
            headers=auth_h,
            json={"name": "Exness Primary PA", "notes": "Live MT5 accounts"},
        )
    )
    assert ex_prof.status_code == 201
    ex_prof_id = ex_prof.json()["id"]

    acc_resp = await client.post(
        "/api/v1/accounts",
        headers=auth_h,
        json={
            "profile_id": ex_prof_id,
            "name": "USTEC Cent Live",
            "mt5_login": "253752700",
            "mt5_server": "Exness-MT5Real10",
            "account_type": "STANDARD_CENT",
            "currency": "USC",
            "platform": "MT5",
        },
    )
    assert acc_resp.status_code == 201
    acc = acc_resp.json()
    api_key = acc["api_key"]
    assert api_key.startswith("htk_")
    assert acc["has_encrypted_key"] is True
    assert acc["currency_divisor"] == 100.0

    # Issue signed ?dl_token= and test incognito (cookie-less, header-less) downloads
    dl_token = (await client.post("/api/v1/auth/download-token", headers=auth_h)).json()["dl_token"]
    client.cookies.clear()

    bset = await client.get(f"/api/v1/ops/setup-wizard/253752700/bridge.set?dl_token={dl_token}")
    assert bset.status_code == 200
    assert f"AccountApiKey={api_key}" in bset.text
    assert "ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest" in bset.text

    mq5 = await client.get(f"/api/v1/ops/downloads/ExnessPanelBridge.mq5?dl_token={dl_token}")
    assert mq5.status_code == 200 and "ExnessPanelBridge" in mq5.text
    mqh = await client.get(f"/api/v1/ops/downloads/ExnessPanelHook.mqh?dl_token={dl_token}")
    assert mqh.status_code == 200

    # =========================================================================
    # 4. MT5 INGEST (bootstrap, snapshot, trade-event, bars) + AUTO-ROBOTS + DUAL ROUTES
    # =========================================================================
    mt5_h = {"X-Account-Api-Key": api_key}
    now_msc = int(datetime.now(UTC).timestamp() * 1000)

    bs = await client.post(
        "/api/v1/ingest/bootstrap",
        headers=mt5_h,
        json={"balance": 100000.0, "equity": 100500.0, "algo_trading_enabled": True},
    )
    assert bs.status_code == 200 and bs.json()["currency_divisor"] == 100.0

    snap = await client.post(
        "/api/v1/ingest/snapshot",
        headers=mt5_h,
        json={
            "balance": 100000.0,
            "equity": 100500.0,
            "floating_pnl": 500.0,
            "margin_level": 1400.0,
            "algo_trading_enabled": True,
            "symbol": "USTECc",
            "bid": 20850.5,
            "ask": 20851.5,
            "spread_pts": 10,
            "robot_states": [
                {
                    "magic_number": 301001,
                    "ea_name": "NasdaqPulse v3.01",
                    "symbol": "USTECc",
                    "status": "RUNNING",
                    "execution_ms": 12,
                    "state_json": {"bias": "BULLISH", "regime": "TREND"},
                }
            ],
            "sibling_eas": [
                {
                    "chart_id": 2001,
                    "symbol": "XAUUSDc",
                    "timeframe": "M5",
                    "ea_name": "GoldPulse EA",
                    "magic_number": 301002,
                    "status": "ATTACHED",
                }
            ],
        },
    )
    assert snap.status_code == 200 and snap.json()["robots_updated"] == 2

    # Verify Robots dual routes (/api/v1/robots and /api/v1/accounts/robots)
    robots_a = (await client.get("/api/v1/robots", headers=auth_h)).json()
    robots_b = (await client.get("/api/v1/accounts/robots", headers=auth_h)).json()
    assert len(robots_a) == 2 and len(robots_b) == 2
    assert {r["magic_number"] for r in robots_a} == {301001, 301002}

    # Ingest 2 USC deals to verify USC /100 divisor fix on profit, commission, and swap
    # Deal 1: +25000 USC profit, -500 USC commission, -100 USC swap -> net = +24400 USC = +$244.00
    d1 = await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 9001,
            "magic_number": 301001,
            "symbol": "USTECc",
            "deal_type": 0,
            "entry_type": 1,
            "volume": 1.0,
            "price": 20840.0,
            "profit": 25000.0,
            "commission": -500.0,
            "swap": -100.0,
            "time_msc": now_msc - 120000,
        },
    )
    assert d1.status_code == 200 and d1.json()["net_profit_usd"] == 244.0

    # Deal 2: -4000 USC profit, -200 USC commission, 0 swap -> net = -4200 USC = -$42.00
    d2 = await client.post(
        "/api/v1/ingest/trade-event",
        headers=mt5_h,
        json={
            "mt5_deal_ticket": 9002,
            "magic_number": 301001,
            "symbol": "USTECc",
            "deal_type": 1,
            "entry_type": 1,
            "volume": 0.5,
            "price": 20855.0,
            "profit": -4000.0,
            "commission": -200.0,
            "swap": 0.0,
            "time_msc": now_msc - 60000,
        },
    )
    assert d2.status_code == 200 and d2.json()["net_profit_usd"] == -42.0

    # Ingest OHLCV bars
    bars_res = await client.post(
        "/api/v1/ingest/bars",
        headers=mt5_h,
        json={
            "symbol": "USTECc",
            "timeframe": "M5",
            "bars": [
                {"time": 1732400100, "open": 20810.0, "high": 20845.0, "low": 20805.0, "close": 20840.0, "volume": 320},
                {"time": 1732400400, "open": 20840.0, "high": 20860.0, "low": 20835.0, "close": 20855.0, "volume": 410},
            ],
        },
    )
    assert bars_res.status_code == 200 and bars_res.json()["upserted"] == 2

    # =========================================================================
    # 5. ASSET HUBS CRUD + DETAIL (NEWS DIGEST) + LOGO PROXY + CHART STATE
    # =========================================================================
    await client.post("/api/v1/assets/seed-defaults", headers=auth_h)
    custom_hub = await client.post(
        "/api/v1/assets",
        headers=auth_h,
        json={"code": "SPX500", "name": "S&P 500 Index", "category": "indices", "broker_symbols": ["US500"]},
    )
    assert custom_hub.status_code == 201
    hub_detail = await client.get("/api/v1/assets/USTEC", headers=auth_h)
    assert hub_detail.status_code == 200
    assert "news_digest" in hub_detail.json() and "sentiment_breakdown" in hub_detail.json()["news_digest"]

    logo_resp = await client.get("/api/v1/assets/logo/USTEC")
    assert logo_resp.status_code == 200
    assert "image/svg+xml" in logo_resp.headers["content-type"]
    assert "<svg" in logo_resp.text

    chart_put = await client.put(
        "/api/v1/charts/state/USTEC",
        headers=auth_h,
        json={
            "timeframe": "M5",
            "indicators_json": {"ema20": True, "ema50": True, "vwap": True},
            "drawings_json": [{"type": "hline", "price": 20840.0, "label": "VWAP Pivot"}],
            "filters_json": {"show_deals": True},
        },
    )
    assert chart_put.status_code == 200
    chart_get = await client.get("/api/v1/charts/state/USTEC", headers=auth_h)
    assert chart_get.status_code == 200
    assert chart_get.json()["timeframe"] == "M5"
    assert chart_get.json()["drawings_json"][0]["price"] == 20840.0

    # =========================================================================
    # 6. ANALYTICS (HOME + 8-CHART OVERVIEW + USC FIX) + JOURNAL + TREASURY + EXPORTS
    # =========================================================================
    home = await client.get("/api/v1/analytics/home-summary", headers=auth_h)
    assert home.status_code == 200
    assert "kpis" in home.json() and len(home.json()["market_sessions"]) == 4

    overview = (await client.get("/api/v1/analytics/overview?magic_number=301001", headers=auth_h)).json()
    m = overview["metrics"]
    assert m["total_trades"] == 2
    assert m["total_commission_usd"] == -7.0  # (-500 + -200) / 100
    assert m["total_swap_usd"] == -1.0  # -100 / 100
    assert m["net_pnl_usd"] == 202.0  # 244.0 - 42.0
    for chart_key in (
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
        assert chart_key in overview

    deals_page = (await client.get("/api/v1/journal/deals?symbol=USTEC", headers=auth_h)).json()
    assert deals_page["total"] == 2
    deal_id = deals_page["items"][0]["id"]
    deal_upd = await client.patch(
        f"/api/v1/journal/deals/{deal_id}",
        headers=auth_h,
        json={"notes": "NY Open momentum breakout", "tags": ["ny-open", "A+"]},
    )
    assert deal_upd.status_code == 200 and deal_upd.json()["notes"] == "NY Open momentum breakout"

    treasury_op = await client.post(
        "/api/v1/treasury/operations",
        headers=auth_h,
        json={
            "account_id": acc["id"],
            "op_kind": "EXNESS_VAULT",
            "amount": -10000.0,  # -10000 USC = -$100 USD
            "comment": "Weekly Vault lock",
            "notes": "Verified transfer",
        },
    )
    assert treasury_op.status_code == 201 and treasury_op.json()["amount_usd"] == -100.0
    op_id = treasury_op.json()["id"]

    # Statement CSV & XLSX downloads via ?dl_token= (incognito)
    csv_res = await client.get(f"/api/v1/analytics/statement.csv?dl_token={dl_token}")
    assert csv_res.status_code == 200 and "USTEC" in csv_res.text

    xlsx_res = await client.get(f"/api/v1/analytics/statement.xlsx?dl_token={dl_token}")
    assert xlsx_res.status_code == 200
    wb = load_workbook(io.BytesIO(xlsx_res.content))
    assert wb.sheetnames == ["Summary", "Deals", "Positions", "Treasury"]
    assert wb["Deals"].max_row == 3
    assert wb["Treasury"].max_row == 2

    assert (await client.delete(f"/api/v1/treasury/operations/{op_id}", headers=auth_h)).status_code == 204

    # =========================================================================
    # 7. INTELLIGENCE (TREEMAP, CALENDAR, SOURCES + SSRF, NEWS WIRE) & OPS CONTAINERS
    # =========================================================================
    # Verified Sources seeded + strict SSRF block
    sources = (await client.get("/api/v1/intelligence/sources", headers=auth_h)).json()
    assert len(sources) >= 8
    for ssrf_url in (
        "http://127.0.0.1:8000/healthz",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/rss",
        "file:///etc/passwd",
    ):
        ssrf_resp = await client.post(
            "/api/v1/intelligence/sources",
            headers=auth_h,
            json={"name": "SSRF Probe", "url": ssrf_url},
        )
        assert ssrf_resp.status_code == 400, f"Expected SSRF 400 for {ssrf_url}"

    # Valid custom source + mocked RSS refresh -> Dynamic News Wire
    rss_xml = """<?xml version="1.0"?>
    <rss><channel><item>
      <title>NASDAQ surges as tech earnings beat forecasts</title>
      <link>https://feeds.example.org/nasdaq-1</link>
      <description>USTEC rallies strongly on AI semiconductor demand.</description>
    </item></channel></rss>"""
    mock_rss = MagicMock(status_code=200, text=rss_xml)
    mock_rss.raise_for_status = MagicMock()
    mock_rss_http = AsyncMock()
    mock_rss_http.__aenter__.return_value = mock_rss_http
    mock_rss_http.get = AsyncMock(return_value=mock_rss)

    with (
        patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))]),
        patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_rss_http),
    ):
        src_create = await client.post(
            "/api/v1/intelligence/sources",
            headers=auth_h,
            json={
                "name": "E2E Macro Feed",
                "url": "https://feeds.example.org/e2e.xml",
                "category": "equities",
                "is_verified": True,
                "asset_tags": ["USTEC"],
            },
        )
        assert src_create.status_code == 201
        ref_news = await client.post("/api/v1/intelligence/news/refresh", headers=auth_h)
        assert ref_news.status_code == 200 and ref_news.json()["inserted"] >= 1

    wire = (await client.get("/api/v1/intelligence/news?q=NASDAQ&asset=USTEC", headers=auth_h)).json()
    assert len(wire) >= 1
    assert (await client.get(f"/api/v1/intelligence/news/{wire[0]['id']}", headers=auth_h)).status_code == 200

    # Economic Calendar refresh (mocked ForexFactory JSON)
    mock_ff = MagicMock(status_code=200)
    mock_ff.raise_for_status = MagicMock()
    mock_ff.json.return_value = [
        {
            "title": "US CPI YoY",
            "country": "USD",
            "date": (datetime.now(UTC) + timedelta(hours=3)).isoformat(),
            "impact": "High",
            "forecast": "2.6%",
            "previous": "2.7%",
        }
    ]
    mock_ff_http = AsyncMock()
    mock_ff_http.__aenter__.return_value = mock_ff_http
    mock_ff_http.get = AsyncMock(return_value=mock_ff)
    with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_ff_http):
        assert (await client.post("/api/v1/intelligence/calendar/refresh", headers=auth_h)).status_code == 200
    cal_items = (await client.get("/api/v1/intelligence/calendar?impact=High", headers=auth_h)).json()
    assert len(cal_items) >= 1 and cal_items[0]["title"] == "US CPI YoY"

    # Market Treemap (mocked live Yahoo Finance)
    mock_yf = MagicMock(status_code=200)
    mock_yf.json.return_value = {
        "quoteResponse": {
            "result": [
                {
                    "symbol": "NVDA",
                    "shortName": "NVIDIA Corp",
                    "regularMarketPrice": 145.0,
                    "regularMarketChangePercent": 2.4,
                    "marketCap": 3550000000000,
                    "regularMarketVolume": 48000000,
                }
            ]
        }
    }
    mock_yf_http = AsyncMock()
    mock_yf_http.__aenter__.return_value = mock_yf_http
    mock_yf_http.get = AsyncMock(return_value=mock_yf)
    with patch("app.modules.intelligence.router.httpx.AsyncClient", return_value=mock_yf_http):
        tm = await client.get("/api/v1/intelligence/treemap?universe=nasdaq100&period=1D&q=NVDA", headers=auth_h)
    assert tm.status_code == 200
    assert tm.json()["data_status"] == "live"
    assert tm.json()["sectors"][0]["items"][0]["ticker"] == "NVDA"

    # Ops Containers CRUD + /etc Integrations Status
    c_create = await client.post(
        "/api/v1/ops/containers",
        headers=auth_h,
        json={"container_name": "mt5-ustec", "display_name": "MT5 USTEC Live", "host_label": "vps-main"},
    )
    assert c_create.status_code == 201
    cid = c_create.json()["id"]
    assert (await client.get("/api/v1/ops/containers/mt5-ustec", headers=auth_h)).status_code == 200
    assert (
        await client.patch(f"/api/v1/ops/containers/{cid}", headers=auth_h, json={"display_name": "MT5 USTEC Prod"})
    ).status_code == 200
    assert (await client.delete(f"/api/v1/ops/containers/{cid}", headers=auth_h)).status_code == 204

    integ = await client.get("/api/v1/ops/integrations/status", headers=auth_h)
    assert integ.status_code == 200
    assert integ.json()["telegram_webhook"]["auth_header"] == "X-Trading-Webhook-Secret"


def test_e2e_websocket_live_welcome_and_ping_pong() -> None:
    """Verify live WebSocket stream /api/v1/ws/live emits welcome + portfolio + ping/pong RTT."""
    settings = Settings(
        ENVIRONMENT="test",
        TERMINAL_DOMAIN="terminal.huseynovlar.org",
        TERMINAL_ORIGIN="https://terminal.huseynovlar.org",
        WEBAUTHN_RP_ID="terminal.huseynovlar.org",
        JWT_SECRET_KEY="test-jwt-secret-key-at-least-32-bytes-long",
        VAULT_MASTER_KEY="test-vault-master-key-at-least-32-bytes",
        COOKIE_SECURE=False,
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    app = create_app()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with patch("app.main.get_settings", return_value=settings), TestClient(app) as tc:
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

            ts_ms = int(datetime.now(UTC).timestamp() * 1000)
            ws.send_json({"type": "ping", "ts": ts_ms})
            pong = ws.receive_json()
            assert pong["type"] == "pong"
            assert pong["client_ts"] == ts_ms

    asyncio.run(engine.dispose())
