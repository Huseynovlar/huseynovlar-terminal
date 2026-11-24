from __future__ import annotations

import hashlib
import os
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
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


_STOPWORDS = {
    "this", "that", "with", "from", "have", "will", "into", "over", "after", "more", "than",
    "what", "when", "where", "about", "their", "there", "could", "would", "should", "says",
    "amid", "news", "market", "markets", "stock", "stocks", "price", "prices",
}


def _headline_tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{4,}", title.lower())
    return {w for w in words if w not in _STOPWORDS}


def _build_sources_map(settings: Settings) -> dict[str, dict[str, Any]]:
    cfg = settings.load_yaml_config("news_sources.yaml")
    out: dict[str, dict[str, Any]] = {}
    for feed in cfg.get("rss_feeds", []):
        name = feed.get("name") or feed.get("id", "")
        out[name] = {
            "id": feed.get("id", ""),
            "name": name,
            "domain": feed.get("domain", ""),
            "category": feed.get("category", "global"),
            "priority": feed.get("priority", "medium"),
            "verified": bool(feed.get("verified", False)),
            "trust_tier": feed.get("trust_tier", "tier2"),
            "default_assets": feed.get("default_assets", []),
        }
    return out


@router.get("/sources")
async def list_verified_sources(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[dict[str, Any]]:
    """Return the official Verified News Sources Registry with live item counts."""
    sources_map = _build_sources_map(settings)
    rows = (await db.execute(select(NewsItem.source))).scalars().all()
    counts: dict[str, int] = {}
    for src in rows:
        counts[src] = counts.get(src, 0) + 1

    result = []
    for name, meta in sources_map.items():
        result.append({**meta, "items_count": counts.get(name, 0)})
    return result


@router.get("/news")
async def list_news(
    asset: str | None = None,
    verified_only: bool = False,
    limit: int = Query(default=40, ge=1, le=200),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[dict[str, Any]]:
    sources_map = _build_sources_map(settings)
    rows = (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(limit * 3))).scalars().all()
    out: list[dict[str, Any]] = []
    target = asset.strip().upper() if asset else None
    for r in rows:
        if target and target not in (r.affected_assets or []):
            continue
        meta = sources_map.get(r.source, {})
        is_verified = bool(meta.get("verified", False))
        corroborating = list(r.corroborating_sources or [])
        verified_corroborators = [s for s in corroborating if sources_map.get(s, {}).get("verified")]
        total_verified = (1 if is_verified else 0) + len(verified_corroborators)
        if verified_only and total_verified == 0:
            continue
        out.append(
            {
                "id": r.id,
                "source": r.source,
                "source_domain": meta.get("domain", ""),
                "trust_tier": meta.get("trust_tier", "aggregator"),
                "is_verified_source": is_verified,
                "corroborating_sources": corroborating,
                "verified_corroborators": verified_corroborators,
                "verification_count": max(1, int(r.verification_count or 1)),
                "verified_source_count": total_verified,
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


async def run_news_refresh(db: AsyncSession, settings: Settings) -> dict[str, Any]:
    """Fetch all redundant RSS feeds with per-feed isolation and cross-source headline corroboration."""
    cfg = settings.load_yaml_config("news_sources.yaml")
    assets = (await db.execute(select(AssetHub))).scalars().all()
    feeds = [f for f in cfg.get("rss_feeds", []) if f.get("url")]

    cutoff = datetime.now(UTC) - timedelta(hours=18)
    recent_q = select(NewsItem).where(NewsItem.published_at >= cutoff).order_by(NewsItem.published_at.desc())
    recent_rows = (await db.execute(recent_q)).scalars().all()
    recent_tokens: list[tuple[NewsItem, set[str]]] = [(r, _headline_tokens(r.title)) for r in recent_rows]

    inserted = 0
    corroborated = 0
    failed_sources: list[str] = []

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as http:
        for feed in feeds:
            source_name = feed.get("name", feed["id"])
            try:
                resp = await http.get(feed["url"], headers={"User-Agent": "HuseynovlarTerminal/1.0"})
                resp.raise_for_status()
                parsed = parse_rss_xml(resp.text, source_name, feed.get("category", "global"))
                for item in parsed:
                    dedup = _hash_text(item["url"] or item["title"])
                    exists = (
                        await db.execute(select(NewsItem.id).where(NewsItem.dedup_hash == dedup))
                    ).scalar_one_or_none()
                    if exists:
                        continue

                    # Cross-source corroboration: check if another source already reported this story
                    tokens = _headline_tokens(item["title"])
                    matched_row: NewsItem | None = None
                    if len(tokens) >= 3:
                        for existing_row, existing_toks in recent_tokens:
                            if existing_row.source == source_name:
                                continue
                            overlap = tokens & existing_toks
                            union = tokens | existing_toks
                            if len(overlap) >= 3 or (union and len(overlap) / len(union) >= 0.45):
                                matched_row = existing_row
                                break

                    if matched_row is not None:
                        corr = list(matched_row.corroborating_sources or [])
                        if source_name not in corr:
                            corr.append(source_name)
                            matched_row.corroborating_sources = corr
                            matched_row.verification_count = 1 + len(corr)
                            matched_row.impact_score = min(10, max(matched_row.impact_score, 7 + len(corr)))
                            corroborated += 1
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
                        corroborating_sources=[],
                        verification_count=1,
                    )
                    db.add(row)
                    recent_tokens.append((row, tokens))
                    inserted += 1
                    if is_breaking:
                        await ws_hub.broadcast(
                            "breaking_news",
                            {"title": row.title, "source": row.source, "assets": row.affected_assets},
                        )
            except Exception:
                failed_sources.append(feed.get("id", "unknown"))

    await db.commit()
    return {
        "inserted": inserted,
        "corroborated": corroborated,
        "sources_checked": len(feeds),
        "failed_sources": failed_sources,
    }


@router.post("/news/refresh")
async def refresh_news_feeds(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return await run_news_refresh(db, settings)


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
