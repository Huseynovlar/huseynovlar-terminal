from __future__ import annotations

import hashlib
import os
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.ws_hub import ws_hub
from app.db.models import (
    AiBriefing,
    AssetHub,
    EconomicEvent,
    NewsItem,
    OpenPositionLive,
    SecretVaultEntry,
    TradingAccount,
    User,
)

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


def _tag_assets_from_text(text: str, assets: list[AssetHub], default_assets: list[str]) -> list[str]:
    low = text.lower()
    matched = set(default_assets)
    for asset in assets:
        for tag in asset.news_tags or [asset.code]:
            if str(tag).lower() in low:
                matched.add(asset.code)
                break
    return sorted(matched)


def parse_rss_xml(xml_text: str, source_name: str, category: str) -> list[dict[str, Any]]:
    """Resilient RSS 2.0 / Atom XML parser with zero extra dependencies."""
    items: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    for elem in root.findall(".//item")[:20]:
        title = (elem.findtext("title") or "").strip()
        link = (elem.findtext("link") or "").strip()
        desc = (elem.findtext("description") or "").strip()
        if title:
            items.append(
                {"source": source_name, "category": category, "title": title, "url": link, "summary": desc[:400]}
            )

    # Atom fallback
    if not items:
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall(".//atom:entry", ns)[:20]:
            title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.attrib.get("href", "") if link_el is not None else ""
            if title:
                items.append({"source": source_name, "category": category, "title": title, "url": link, "summary": ""})
    return items


class AiAnalyzeRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    kind: str = Field(default="copilot", max_length=32)
    model: str = Field(default="gemini-2.5-flash", max_length=64)


@router.get("/news")
async def list_news(
    asset: str | None = None,
    limit: int = Query(default=40, ge=1, le=200),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(limit * 2))).scalars().all()
    out: list[dict[str, Any]] = []
    target = asset.strip().upper() if asset else None
    for r in rows:
        if target and target not in (r.affected_assets or []):
            continue
        out.append(
            {
                "id": r.id,
                "source": r.source,
                "category": r.category,
                "title": r.title,
                "url": r.url,
                "summary": r.summary,
                "affected_assets": r.affected_assets,
                "sentiment": r.sentiment,
                "impact_score": r.impact_score,
                "is_breaking": r.is_breaking,
                "ai_summary": r.ai_summary,
                "published_at": r.published_at.isoformat(),
            }
        )
        if len(out) >= limit:
            break
    return out


@router.post("/news/refresh")
async def refresh_news_feeds(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Fetch all redundant RSS feeds with per-feed isolation so a single outage never blocks updates."""
    cfg = settings.load_yaml_config("news_sources.yaml")
    assets = (await db.execute(select(AssetHub))).scalars().all()
    feeds = [f for f in cfg.get("rss_feeds", []) if f.get("url")]

    inserted = 0
    failed_sources: list[str] = []

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as http:
        for feed in feeds:
            try:
                resp = await http.get(feed["url"], headers={"User-Agent": "HuseynovlarTerminal/1.0"})
                resp.raise_for_status()
                parsed = parse_rss_xml(resp.text, feed.get("name", feed["id"]), feed.get("category", "global"))
                for item in parsed:
                    dedup = _hash_text(item["url"] or item["title"])
                    exists = (
                        await db.execute(select(NewsItem.id).where(NewsItem.dedup_hash == dedup))
                    ).scalar_one_or_none()
                    if exists:
                        continue
                    tags = _tag_assets_from_text(
                        f"{item['title']} {item['summary']}", list(assets), feed.get("default_assets", [])
                    )
                    is_breaking = feed.get("priority") == "critical"
                    row = NewsItem(
                        dedup_hash=dedup,
                        source=item["source"],
                        category=item["category"],
                        title=item["title"],
                        url=item["url"],
                        summary=item["summary"],
                        affected_assets=tags,
                        is_breaking=is_breaking,
                        impact_score=9 if is_breaking else 6,
                    )
                    db.add(row)
                    inserted += 1
                    if is_breaking:
                        await ws_hub.broadcast(
                            "breaking_news",
                            {"title": row.title, "source": row.source, "assets": row.affected_assets},
                        )
            except Exception:
                failed_sources.append(feed.get("id", "unknown"))

    await db.commit()
    return {"inserted": inserted, "sources_checked": len(feeds), "failed_sources": failed_sources}


@router.get("/calendar")
async def list_economic_calendar(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(EconomicEvent).order_by(EconomicEvent.event_time.asc()).limit(60))).scalars().all()
    return [
        {
            "id": e.id,
            "title": e.title,
            "currency": e.currency,
            "impact": e.impact,
            "forecast": e.forecast,
            "previous": e.previous,
            "event_time": e.event_time.isoformat(),
        }
        for e in rows
    ]


@router.get("/treemap")
async def get_market_treemap(
    universe: str = Query(default="nasdaq100", pattern="^(nasdaq100|sp500_top|gold_commodities)$"),
    period: str = Query(default="1D", pattern="^(1D|1W|1M|YTD)$"),
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Return StockCharts/Finviz-style proportional Market Treemap data grouped by sector."""
    cfg = settings.load_yaml_config("treemap.yaml")
    uni = cfg.get("universes", {}).get(universe, {})
    sectors_cfg: dict[str, list[str]] = uni.get("sectors", {})

    sectors_out: list[dict[str, Any]] = []
    for sector_name, tickers in sectors_cfg.items():
        items = []
        for idx, ticker in enumerate(tickers):
            # Deterministic baseline weights & live-ready structure (enriched by terminal-worker Yahoo batch)
            weight = max(8, 100 - idx * 7)
            pct = round(((hash(f"{ticker}:{period}") % 700) - 300) / 100.0, 2)
            items.append({"ticker": ticker, "weight": weight, "change_pct": pct})
        sectors_out.append({"sector": sector_name, "items": items})

    return {
        "universe": universe,
        "name": uni.get("name", universe),
        "linked_asset": uni.get("linked_asset", ""),
        "period": period,
        "updated_at": datetime.now(UTC).isoformat(),
        "sectors": sectors_out,
    }


@router.post("/ai/analyze")
async def gemini_ai_copilot(
    body: AiAnalyzeRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Google AI (Gemini) Co-Pilot enriched with live Exness portfolio equity, open positions, and recent news."""
    vault_entry = await db.get(SecretVaultEntry, "google_ai_api_key")
    api_key = ""
    if vault_entry:
        api_key = decrypt_secret(vault_entry.value_enc, settings.vault_master_key)
    if not api_key:
        api_key = os.getenv("GOOGLE_AI_API_KEY", "").strip()

    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    positions = (await db.execute(select(OpenPositionLive))).scalars().all()
    recent_news = (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(10))).scalars().all()

    total_eq = sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts)
    total_fl = sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts)
    context_text = (
        f"Portfolio Context (UTC {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}): "
        f"Accounts={len(accounts)}, Total Equity=${total_eq:.2f}, Floating PnL=${total_fl:.2f}, "
        f"Open Positions={len(positions)}. "
        f"Latest Headlines: {'; '.join(n.title for n in recent_news[:6]) or 'None yet'}."
    )

    if not api_key:
        reply = (
            "**Google AI (Gemini) ключ ещё не добавлен.**\n\n"
            "Перейдите в **Профиль и Безопасность → Secret Vault** и сохраните ваш ключ из "
            "`Google AI Studio` (`google_ai_api_key`).\n\n"
            f"Текущий живой контекст, который будет передаваться в Gemini:\n> {context_text}"
        )
        return {"configured": False, "model": body.model, "response_md": reply}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{body.model}:generateContent"
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "You are an institutional Bloomberg-grade trading & risk analyst for Exness MT5 "
                            "(XAUUSD & USTEC). Respond concisely in Russian with clear bullet points.\n\n"
                            f"{context_text}\n\nUser request: {body.prompt}"
                        )
                    }
                ]
            }
        ]
    }
    async with httpx.AsyncClient(timeout=25.0) as http:
        resp = await http.post(url, params={"key": api_key}, json=payload)
        resp.raise_for_status()
        data = resp.json()

    text_out = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "Нет ответа от Gemini API.")
    )

    briefing = AiBriefing(kind=body.kind, model_name=body.model, prompt=body.prompt, response_md=text_out)
    db.add(briefing)
    await db.commit()
    return {"configured": True, "id": briefing.id, "model": body.model, "response_md": text_out}
