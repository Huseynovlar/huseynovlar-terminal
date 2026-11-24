from __future__ import annotations

from httpx import AsyncClient

from app.modules.intelligence.router import parse_rss_xml


def test_resilient_rss_and_atom_parser():
    rss = """<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Gold surges on softer US CPI</title>
        <link>https://example.com/1</link>
        <description>XAUUSD rallies</description>
      </item>
    </channel></rss>"""
    items = parse_rss_xml(rss, "Kitco", "commodities")
    assert len(items) == 1
    assert items[0]["title"] == "Gold surges on softer US CPI"

    assert parse_rss_xml("<broken-xml", "Bad", "global") == []


async def test_treemap_news_and_gemini_unconfigured_fallback(client: AsyncClient):
    boot = await client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "owner", "email": "owner@huseynovlar.org", "password": "VeryStrongPassword!2026"},
    )
    h = {"Authorization": f"Bearer {boot.json()['access_token']}"}

    # Market Treemap (NASDAQ-100 & Gold Commodities)
    tm = await client.get("/api/v1/intelligence/treemap?universe=nasdaq100&period=1D", headers=h)
    assert tm.status_code == 200
    assert tm.json()["linked_asset"] == "USTEC"
    assert len(tm.json()["sectors"]) >= 3

    tm_gold = await client.get("/api/v1/intelligence/treemap?universe=gold_commodities&period=1W", headers=h)
    assert tm_gold.status_code == 200
    assert tm_gold.json()["linked_asset"] == "XAUUSD"

    # Google AI Co-Pilot gracefully explains setup when key not yet stored
    ai = await client.post(
        "/api/v1/intelligence/ai/analyze",
        headers=h,
        json={"prompt": "Сделай утренний брифинг по XAUUSD и USTEC"},
    )
    assert ai.status_code == 200
    assert ai.json()["configured"] is False
    assert "google_ai_api_key" in ai.json()["response_md"]
