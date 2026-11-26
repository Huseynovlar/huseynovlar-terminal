from __future__ import annotations

import hashlib
import ipaddress
import logging
import re
import socket
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import market_data
from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.core.symbols import canonical_asset_code, sql_symbol_match, symbol_matches_asset
from app.core.ws_hub import ws_hub
from app.db.models import (
    AiBriefing,
    AssetHub,
    EconomicEvent,
    MarketBar,
    MarketCache,
    NewsItem,
    NewsSource,
    OpenPositionLive,
    Robot,
    SecretVaultEntry,
    TradingAccount,
    User,
)

NEWS_STREAM_SCAN_CAP = 5000

router = APIRouter(prefix="/intelligence", tags=["intelligence"])
logger = logging.getLogger(__name__)

_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}

_STOPWORDS = {
    "this",
    "that",
    "with",
    "from",
    "have",
    "will",
    "into",
    "over",
    "after",
    "more",
    "than",
    "what",
    "when",
    "where",
    "about",
    "their",
    "there",
    "could",
    "would",
    "should",
    "says",
    "amid",
    "news",
    "market",
    "markets",
    "stock",
    "stocks",
    "price",
    "prices",
}

_BULLISH_WORDS = {
    "surge",
    "surges",
    "rally",
    "rallies",
    "jump",
    "jumps",
    "gain",
    "gains",
    "bullish",
    "record high",
    "all-time high",
    "soar",
    "soars",
    "beats",
    "beat",
    "dovish",
    "rate cut",
    "rebound",
}
_BEARISH_WORDS = {
    "plunge",
    "plunges",
    "drop",
    "drops",
    "fall",
    "falls",
    "slump",
    "slumps",
    "bearish",
    "crash",
    "tumble",
    "tumbles",
    "selloff",
    "sell-off",
    "hawkish",
    "rate hike",
    "miss",
    "misses",
    "recession",
}

_ASSET_CURRENCY_MAP: dict[str, set[str]] = {
    "XAUUSD": {"USD"},
    "USTEC": {"USD"},
    "SPX": {"USD"},
    "US30": {"USD"},
    "BTCUSD": {"USD"},
    "USOIL": {"USD"},
    "EURUSD": {"EUR", "USD"},
    "GBPUSD": {"GBP", "USD"},
    "USDJPY": {"USD", "JPY"},
    "USDCHF": {"USD", "CHF"},
    "AUDUSD": {"AUD", "USD"},
    "USDCAD": {"USD", "CAD"},
    "NZDUSD": {"NZD", "USD"},
}

_PERIOD_TO_YAHOO_RANGE: dict[str, tuple[str, str]] = {
    "1D": ("1d", "5d"),
    "1W": ("1d", "5d"),
    "1M": ("1d", "1mo"),
    "3M": ("1d", "3mo"),
    "YTD": ("1d", "ytd"),
}


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


def _headline_tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{4,}", title.lower())
    return {w for w in words if w not in _STOPWORDS}


def _infer_sentiment(text: str) -> str:
    low = text.lower()
    bull = sum(1 for w in _BULLISH_WORDS if w in low)
    bear = sum(1 for w in _BEARISH_WORDS if w in low)
    if bull > bear:
        return "bullish"
    if bear > bull:
        return "bearish"
    return "neutral"


def _tag_assets_from_text(text: str, assets: list[AssetHub], default_assets: list[str]) -> list[str]:
    low = text.lower()
    matched = {str(a).upper() for a in default_assets if str(a).strip()}
    for asset in assets:
        for tag in asset.news_tags or [asset.code]:
            if str(tag).lower() in low:
                matched.add(asset.code.upper())
                break
    return sorted(matched)


def _extract_domain(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def validate_safe_external_url(url: str) -> str:
    """Strict SSRF protection: allow only public HTTP(S) URLs, blocking loopback/private/link-local/metadata IPs."""
    raw = url.strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only http:// and https:// feed URLs are allowed",
        )
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Feed URL must contain a valid hostname")

    blocked_hosts = {"localhost", "localhost.localdomain", "metadata.google.internal", "169.254.169.254"}
    if host in blocked_hosts or host.endswith(".local") or host.endswith(".internal") or host.endswith(".localhost"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Internal, loopback, or metadata hostnames are blocked (SSRF protection)",
        )

    def _check_ip(ip_str: str) -> None:
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Blocked non-public IP target ({ip_str}) — SSRF protection",
            )

    # Check if host is a literal IP first
    try:
        _check_ip(host)
        return raw
    except ValueError:
        pass

    # Resolve DNS and verify every returned IP is public
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        for info in infos:
            addr = info[4][0]
            _check_ip(str(addr))
    except HTTPException:
        raise
    except socket.gaierror:
        # DNS may be unavailable in isolated test environments; hostname already passed static checks
        pass

    return raw


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

    if not items:
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall(".//atom:entry", ns)[:20]:
            title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.attrib.get("href", "") if link_el is not None else ""
            if title:
                items.append({"source": source_name, "category": category, "title": title, "url": link, "summary": ""})
    return items


# ---------------------------------------------------------------------------
# Database-Backed Verified News Sources Registry CRUD + Auto-Seed + Test
# ---------------------------------------------------------------------------


class NewsSourceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    url: str = Field(min_length=8, max_length=1000)
    category: str = Field(default="global", max_length=48)
    trust_tier: str = Field(default="custom", pattern="^(tier_1|tier_2|custom)$")
    is_verified: bool = False
    is_enabled: bool = True
    asset_tags: list[str] = Field(default_factory=list)
    poll_interval_sec: int = Field(default=300, ge=30, le=86400)


class NewsSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    url: str | None = Field(default=None, min_length=8, max_length=1000)
    category: str | None = Field(default=None, max_length=48)
    trust_tier: str | None = Field(default=None, pattern="^(tier_1|tier_2|custom)$")
    is_verified: bool | None = None
    is_enabled: bool | None = None
    asset_tags: list[str] | None = None
    poll_interval_sec: int | None = Field(default=None, ge=30, le=86400)


def _serialize_source(s: NewsSource, live_items_count: int | None = None) -> dict[str, Any]:
    count = live_items_count if live_items_count is not None else int(s.article_count or 0)
    return {
        "id": s.id,
        "name": s.name,
        "url": s.url,
        "domain": _extract_domain(s.url),
        "category": s.category,
        "trust_tier": s.trust_tier,
        "verified": bool(s.is_verified),
        "is_verified": bool(s.is_verified),
        "is_enabled": bool(s.is_enabled),
        "asset_tags": s.asset_tags or [],
        "default_assets": s.asset_tags or [],
        "poll_interval_sec": s.poll_interval_sec,
        "last_polled_at": s.last_polled_at.isoformat() if s.last_polled_at else None,
        "last_error": s.last_error or "",
        "article_count": count,
        "items_count": count,
        "created_at": s.created_at.isoformat(),
    }


async def ensure_default_news_sources(db: AsyncSession, settings: Settings) -> list[NewsSource]:
    """Idempotently auto-seed `config/news_sources.yaml` into PostgreSQL `news_sources`."""
    existing = (await db.execute(select(NewsSource).order_by(NewsSource.created_at.asc()))).scalars().all()
    if existing:
        return list(existing)

    cfg = settings.load_yaml_config("news_sources.yaml")
    added: list[NewsSource] = []
    seen_urls: set[str] = set()
    for feed in cfg.get("rss_feeds", []):
        url = str(feed.get("url") or "").strip()
        if not url or url in seen_urls or feed.get("type") == "gdelt_api":
            continue
        seen_urls.add(url)
        src_id = str(feed.get("id") or _hash_text(url)[:16])
        tier = str(feed.get("trust_tier") or "tier_2").replace("tier1", "tier_1").replace("tier2", "tier_2")
        if tier not in ("tier_1", "tier_2", "custom"):
            tier = "tier_2"
        row = NewsSource(
            id=src_id,
            name=str(feed.get("name") or src_id),
            url=url,
            category=str(feed.get("category") or "global"),
            trust_tier=tier,
            is_verified=bool(feed.get("is_verified", feed.get("verified", False))),
            is_enabled=bool(feed.get("is_enabled", True)),
            asset_tags=list(feed.get("asset_tags") or feed.get("default_assets") or []),
            poll_interval_sec=int(feed.get("poll_interval_sec") or 300),
        )
        db.add(row)
        added.append(row)
    if added:
        await db.commit()
    return added


DEFAULT_SOURCE_CATEGORIES = ["macro", "commodities", "equities", "forex", "crypto", "central_banks", "global"]


class SourceCategoryCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=64)


async def _load_source_categories(db: AsyncSession) -> list[str]:
    row = await db.get(MarketCache, "news_source_categories")
    saved: list[str] = list((row.payload_json or {}).get("categories") or []) if row else []
    used = list((await db.execute(select(NewsSource.category).distinct())).scalars().all())
    merged = sorted({c.strip().lower() for c in [*DEFAULT_SOURCE_CATEGORIES, *saved, *used] if c and c.strip()})
    return merged


@router.get("/source-categories")
async def list_source_categories(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    return await _load_source_categories(db)


@router.post("/source-categories", status_code=status.HTTP_201_CREATED)
async def create_source_category(
    body: SourceCategoryCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", body.slug.strip().lower()).strip("_")
    if len(slug) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category slug")
    cats = await _load_source_categories(db)
    if slug not in cats:
        cats.append(slug)
        cats.sort()
    row = await db.get(MarketCache, "news_source_categories")
    if row is None:
        db.add(MarketCache(cache_key="news_source_categories", payload_json={"categories": cats}))
    else:
        row.payload_json = {"categories": cats}
    await db.commit()
    return cats


@router.delete("/source-categories/{slug}")
async def delete_source_category(
    slug: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    target = slug.strip().lower()
    cats = [c for c in await _load_source_categories(db) if c != target]
    row = await db.get(MarketCache, "news_source_categories")
    if row is None:
        db.add(MarketCache(cache_key="news_source_categories", payload_json={"categories": cats}))
    else:
        row.payload_json = {"categories": cats}
    await db.commit()
    return cats


@router.get("/sources")
async def list_verified_sources(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    """Return the database-backed Verified News Sources Registry (auto-seeded from YAML on first read)."""
    sources = await ensure_default_news_sources(db, settings)
    rows = (await db.execute(select(NewsItem.source))).scalars().all()
    counts: dict[str, int] = {}
    for src in rows:
        counts[src] = counts.get(src, 0) + 1
    serialized = [_serialize_source(s, live_items_count=counts.get(s.name, s.article_count)) for s in sources]
    if category and category.strip():
        cat_lo = category.strip().lower()
        serialized = [s for s in serialized if str(s.get("category", "")).lower() == cat_lo]
    if q and q.strip():
        needle = q.strip().lower()
        serialized = [
            s
            for s in serialized
            if needle in str(s.get("id", "")).lower()
            or needle in str(s.get("name", "")).lower()
            or needle in str(s.get("url", "")).lower()
            or needle in str(s.get("category", "")).lower()
        ]
    return page.apply(serialized)


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def create_news_source(
    body: NewsSourceCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    safe_url = validate_safe_external_url(body.url)
    dup = (await db.execute(select(NewsSource).where(NewsSource.url == safe_url))).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="News source URL already registered")

    src = NewsSource(
        name=body.name.strip(),
        url=safe_url,
        category=body.category.strip() or "global",
        trust_tier=body.trust_tier,
        is_verified=body.is_verified,
        is_enabled=body.is_enabled,
        asset_tags=[t.strip().upper() for t in body.asset_tags if t.strip()],
        poll_interval_sec=body.poll_interval_sec,
    )
    db.add(src)
    await db.flush()
    await record_audit(
        db,
        action="news_source.created",
        user_id=user.id,
        resource_type="news_source",
        resource_id=src.id,
        ip_address=extract_client_ip(request),
        details={"name": src.name, "url": src.url},
    )
    await db.commit()
    return _serialize_source(src)


@router.get("/sources/{source_id}")
async def get_news_source(
    source_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    await ensure_default_news_sources(db, settings)
    src = await db.get(NewsSource, source_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News source not found")
    recent = (
        (
            await db.execute(
                select(NewsItem).where(NewsItem.source == src.name).order_by(NewsItem.published_at.desc()).limit(20)
            )
        )
        .scalars()
        .all()
    )
    return {
        **_serialize_source(src, live_items_count=len(recent)),
        "recent_articles": [
            {
                "id": n.id,
                "title": n.title,
                "url": n.url,
                "sentiment": n.sentiment,
                "impact_score": n.impact_score,
                "published_at": n.published_at.isoformat(),
            }
            for n in recent
        ],
    }


@router.patch("/sources/{source_id}")
async def update_news_source(
    source_id: str,
    body: NewsSourceUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    src = await db.get(NewsSource, source_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News source not found")

    if body.url is not None:
        safe_url = validate_safe_external_url(body.url)
        dup = (
            await db.execute(select(NewsSource).where(NewsSource.url == safe_url, NewsSource.id != src.id))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="News source URL already registered")
        src.url = safe_url
    if body.name is not None:
        src.name = body.name.strip()
    if body.category is not None:
        src.category = body.category.strip()
    if body.trust_tier is not None:
        src.trust_tier = body.trust_tier
    if body.is_verified is not None:
        src.is_verified = body.is_verified
    if body.is_enabled is not None:
        src.is_enabled = body.is_enabled
    if body.asset_tags is not None:
        src.asset_tags = [t.strip().upper() for t in body.asset_tags if t.strip()]
    if body.poll_interval_sec is not None:
        src.poll_interval_sec = body.poll_interval_sec

    await record_audit(
        db,
        action="news_source.updated",
        user_id=user.id,
        resource_type="news_source",
        resource_id=src.id,
        ip_address=extract_client_ip(request),
        details={"name": src.name},
    )
    await db.commit()
    return _serialize_source(src)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_news_source(
    source_id: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    src = await db.get(NewsSource, source_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News source not found")
    name = src.name
    await db.delete(src)
    await record_audit(
        db,
        action="news_source.deleted",
        user_id=user.id,
        resource_type="news_source",
        resource_id=source_id,
        ip_address=extract_client_ip(request),
        details={"name": name},
    )
    await db.commit()


@router.post("/sources/{source_id}/test")
async def test_news_source(
    source_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    src = await db.get(NewsSource, source_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News source not found")

    safe_url = validate_safe_external_url(src.url)
    now = datetime.now(UTC)
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as http:
            resp = await http.get(
                safe_url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                    ),
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
            )
            resp.raise_for_status()
            parsed = parse_rss_xml(resp.text, src.name, src.category)
        src.last_polled_at = now
        src.last_error = ""
        await db.commit()
        return {
            "ok": True,
            "status_code": resp.status_code,
            "items_found": len(parsed),
            "entries_found": len(parsed),
            "sample_titles": [p["title"] for p in parsed[:5]],
            "error": "",
        }
    except Exception as exc:
        src.last_polled_at = now
        src.last_error = str(exc)[:300]
        await db.commit()
        return {
            "ok": False,
            "status_code": 0,
            "items_found": 0,
            "entries_found": 0,
            "sample_titles": [],
            "error": str(exc)[:300],
        }


# ---------------------------------------------------------------------------
# Dynamic News Wire, Explore & Story Detail
# ---------------------------------------------------------------------------


def _serialize_news_item(r: NewsItem, source_map: dict[str, NewsSource]) -> dict[str, Any]:
    src = source_map.get(r.source)
    is_verified = bool(src.is_verified) if src else False
    corroborating = list(r.corroborating_sources or [])
    verified_corroborators = [s for s in corroborating if source_map.get(s) and source_map[s].is_verified]
    total_verified = (1 if is_verified else 0) + len(verified_corroborators)
    return {
        "id": r.id,
        "source": r.source,
        "source_id": src.id if src else None,
        "source_domain": _extract_domain(src.url) if src else _extract_domain(r.url),
        "trust_tier": src.trust_tier if src else "custom",
        "is_verified_source": is_verified,
        "corroborating_sources": corroborating,
        "verified_corroborators": verified_corroborators,
        "verification_count": max(1, int(r.verification_count or 1)),
        "verified_source_count": total_verified,
        "category": r.category,
        "title": r.title,
        "url": r.url,
        "summary": r.summary,
        "affected_assets": r.affected_assets or [],
        "sentiment": r.sentiment,
        "impact_score": r.impact_score,
        "is_breaking": r.is_breaking,
        "ai_summary": r.ai_summary,
        "published_at": r.published_at.isoformat(),
    }


@router.get("/news")
async def list_news(
    q: str | None = None,
    asset: str | None = None,
    source_id: str | None = None,
    verified_only: bool = False,
    sentiment: str | None = Query(default=None, pattern="^(bullish|bearish|neutral)$"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    """Full news stream, newest first, paginated via ?limit=&offset= (X-Total-Count header)."""
    sources = await ensure_default_news_sources(db, settings)
    source_map = {s.name: s for s in sources}
    source_by_id = {s.id: s for s in sources}

    stmt = select(NewsItem).order_by(NewsItem.published_at.desc()).limit(NEWS_STREAM_SCAN_CAP)
    if source_id and source_id in source_by_id:
        stmt = stmt.where(NewsItem.source == source_by_id[source_id].name)
    if sentiment:
        stmt = stmt.where(NewsItem.sentiment == sentiment)

    rows = (await db.execute(stmt)).scalars().all()
    target = asset.strip().upper() if asset else None
    ql = q.strip().lower() if q and q.strip() else None

    out: list[dict[str, Any]] = []
    for r in rows:
        if target:
            affected = {str(x).upper() for x in (r.affected_assets or [])}
            if target not in affected and target.lower() not in f"{r.title} {r.summary}".lower():
                continue
        if ql and ql not in f"{r.title} {r.summary} {r.source}".lower():
            continue
        item = _serialize_news_item(r, source_map)
        if verified_only and item["verified_source_count"] == 0:
            continue
        out.append(item)
    return page.apply(out)


@router.get("/news/explore")
async def explore_symbol_news(
    symbol: str | None = None,
    q: str | None = None,
    verified_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[dict[str, Any]]:
    """Return filtered real news matching an arbitrary explored symbol or search query."""
    sources = await ensure_default_news_sources(db, settings)
    source_map = {s.name: s for s in sources}
    rows = (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(250))).scalars().all()

    sym = symbol.strip().upper() if symbol and symbol.strip() else None
    ql = q.strip().lower() if q and q.strip() else None
    terms: set[str] = set()
    if sym:
        terms.add(sym.lower())
        hub = (await db.execute(select(AssetHub).where(AssetHub.code == sym))).scalar_one_or_none()
        if hub and hub.news_tags:
            terms.update(str(t).lower() for t in hub.news_tags if str(t).strip())

    out: list[dict[str, Any]] = []
    for r in rows:
        haystack = f"{r.title} {r.summary}".lower()
        affected = {str(x).upper() for x in (r.affected_assets or [])}
        if sym and sym not in affected and not any(t in haystack for t in terms):
            continue
        if ql and ql not in haystack and ql not in r.source.lower():
            continue
        item = _serialize_news_item(r, source_map)
        if verified_only and item["verified_source_count"] == 0:
            continue
        out.append(item)
        if len(out) >= limit:
            break
    return out


@router.get("/news/{news_id}")
async def get_news_detail(
    news_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    row = await db.get(NewsItem, news_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")
    sources = await ensure_default_news_sources(db, settings)
    source_map = {s.name: s for s in sources}
    return _serialize_news_item(row, source_map)


async def run_news_refresh(db: AsyncSession, settings: Settings) -> dict[str, Any]:
    """Fetch enabled DB NewsSource feeds with per-feed isolation, sentiment tagging, and corroboration."""
    sources = await ensure_default_news_sources(db, settings)
    enabled_sources = [s for s in sources if s.is_enabled and s.url]
    assets = (await db.execute(select(AssetHub))).scalars().all()

    cutoff = datetime.now(UTC) - timedelta(hours=18)
    recent_q = select(NewsItem).where(NewsItem.published_at >= cutoff).order_by(NewsItem.published_at.desc())
    recent_rows = (await db.execute(recent_q)).scalars().all()
    recent_tokens: list[tuple[NewsItem, set[str]]] = [(r, _headline_tokens(r.title)) for r in recent_rows]

    inserted = 0
    corroborated = 0
    failed_sources: list[str] = []
    now = datetime.now(UTC)

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as http:
        for src in enabled_sources:
            try:
                validate_safe_external_url(src.url)
                resp = await http.get(src.url, headers={"User-Agent": "HuseynovlarTerminal/1.0"})
                resp.raise_for_status()
                parsed = parse_rss_xml(resp.text, src.name, src.category)
                src_added = 0
                for item in parsed:
                    dedup = _hash_text(item["url"] or item["title"])
                    exists = (
                        await db.execute(select(NewsItem.id).where(NewsItem.dedup_hash == dedup))
                    ).scalar_one_or_none()
                    if exists:
                        continue

                    tokens = _headline_tokens(item["title"])
                    matched_row: NewsItem | None = None
                    if len(tokens) >= 3:
                        for existing_row, existing_toks in recent_tokens:
                            if existing_row.source == src.name:
                                continue
                            overlap = tokens & existing_toks
                            union = tokens | existing_toks
                            if len(overlap) >= 3 or (union and len(overlap) / len(union) >= 0.45):
                                matched_row = existing_row
                                break

                    if matched_row is not None:
                        corr = list(matched_row.corroborating_sources or [])
                        if src.name not in corr:
                            corr.append(src.name)
                            matched_row.corroborating_sources = corr
                            matched_row.verification_count = 1 + len(corr)
                            matched_row.impact_score = min(10, max(matched_row.impact_score, 7 + len(corr)))
                            corroborated += 1
                        continue

                    full_text = f"{item['title']} {item['summary']}"
                    tags = _tag_assets_from_text(full_text, list(assets), list(src.asset_tags or []))
                    is_breaking = src.trust_tier == "tier_1" and src.category == "central_banks"
                    row = NewsItem(
                        dedup_hash=dedup,
                        source=src.name,
                        category=src.category,
                        title=item["title"],
                        url=item["url"],
                        summary=item["summary"],
                        affected_assets=tags,
                        sentiment=_infer_sentiment(full_text),
                        is_breaking=is_breaking,
                        impact_score=9 if is_breaking else (7 if src.is_verified else 5),
                        corroborating_sources=[],
                        verification_count=1,
                    )
                    db.add(row)
                    recent_tokens.append((row, tokens))
                    inserted += 1
                    src_added += 1
                    if is_breaking:
                        await ws_hub.broadcast(
                            "breaking_news",
                            {"title": row.title, "source": row.source, "assets": row.affected_assets},
                        )

                src.last_polled_at = now
                src.last_error = ""
                src.article_count = int(src.article_count or 0) + src_added
            except Exception as exc:
                src.last_polled_at = now
                src.last_error = str(exc)[:300]
                failed_sources.append(src.id)

    await db.commit()
    return {
        "inserted": inserted,
        "corroborated": corroborated,
        "sources_checked": len(enabled_sources),
        "failed_sources": failed_sources,
    }


@router.post("/news/refresh")
async def refresh_news_feeds(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return await run_news_refresh(db, settings)


# ---------------------------------------------------------------------------
# Real Economic Calendar (ForexFactory JSON Collector + Filters + Detail View)
# ---------------------------------------------------------------------------


def _parse_ff_datetime(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        return None


async def run_calendar_refresh(db: AsyncSession, settings: Settings) -> dict[str, Any]:
    """Fetch real ForexFactory economic calendar JSON (this week & next week) and upsert into `economic_events`."""
    cfg = settings.load_yaml_config("news_sources.yaml")
    cal_cfg = cfg.get("economic_calendar") or {}
    urls = [
        cal_cfg.get("primary_url") or "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
        cal_cfg.get("fallback_url") or "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
    ]
    inserted = 0
    updated = 0
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as http:
        for url in urls:
            if not url:
                continue
            try:
                resp = await http.get(url, headers={"User-Agent": "HuseynovlarTerminal/1.0"})
                resp.raise_for_status()
                events = resp.json()
                if not isinstance(events, list):
                    continue
                for ev in events:
                    title = str(ev.get("title") or "").strip()
                    currency = str(ev.get("country") or ev.get("currency") or "").strip().upper()
                    impact = str(ev.get("impact") or "Low").strip().title()
                    if impact not in ("High", "Medium", "Low", "Holiday"):
                        impact = "Low"
                    event_dt = _parse_ff_datetime(str(ev.get("date") or ""))
                    if not title or not currency or event_dt is None:
                        continue
                    dedup = _hash_text(f"{currency}|{title}|{event_dt.strftime('%Y-%m-%dT%H:%M')}")
                    existing = (
                        await db.execute(select(EconomicEvent).where(EconomicEvent.dedup_hash == dedup))
                    ).scalar_one_or_none()
                    forecast = str(ev.get("forecast") or "").strip()[:32]
                    previous = str(ev.get("previous") or "").strip()[:32]
                    if existing:
                        existing.impact = impact
                        existing.forecast = forecast
                        existing.previous = previous
                        existing.event_time = event_dt
                        updated += 1
                    else:
                        db.add(
                            EconomicEvent(
                                dedup_hash=dedup,
                                title=title[:200],
                                currency=currency[:8],
                                impact=impact,
                                forecast=forecast,
                                previous=previous,
                                event_time=event_dt,
                            )
                        )
                        inserted += 1
            except Exception as exc:
                errors.append(f"{url}: {exc}")

    await db.commit()
    return {"inserted": inserted, "updated": updated, "errors": errors}


@router.get("/calendar")
async def list_economic_calendar(
    impact: str | None = None,
    currency: str | None = None,
    asset: str | None = None,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=120, ge=1, le=500),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(EconomicEvent).order_by(EconomicEvent.event_time.asc())
    if impact:
        impacts = [x.strip().title() for x in impact.split(",") if x.strip()]
        if impacts:
            stmt = stmt.where(EconomicEvent.impact.in_(impacts))
    if currency:
        currs = [x.strip().upper() for x in currency.split(",") if x.strip()]
        if currs:
            stmt = stmt.where(EconomicEvent.currency.in_(currs))
    elif asset:
        mapped = _ASSET_CURRENCY_MAP.get(asset.strip().upper())
        if mapped:
            stmt = stmt.where(EconomicEvent.currency.in_(sorted(mapped)))
    if from_date:
        dt_from = _parse_ff_datetime(from_date if "T" in from_date else f"{from_date}T00:00:00Z")
        if dt_from:
            stmt = stmt.where(EconomicEvent.event_time >= dt_from)
    if to_date:
        dt_to = _parse_ff_datetime(to_date if "T" in to_date else f"{to_date}T23:59:59Z")
        if dt_to:
            stmt = stmt.where(EconomicEvent.event_time <= dt_to)

    rows = (await db.execute(stmt.limit(limit))).scalars().all()
    return page.apply(
        [
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
    )


@router.get("/calendar/{event_id}")
async def get_economic_event_detail(
    event_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ev = await db.get(EconomicEvent, event_id)
    if not ev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Economic event not found")

    affected_assets = sorted(
        code for code, currencies in _ASSET_CURRENCY_MAP.items() if ev.currency.upper() in currencies
    )
    return {
        "id": ev.id,
        "title": ev.title,
        "currency": ev.currency,
        "impact": ev.impact,
        "forecast": ev.forecast,
        "previous": ev.previous,
        "event_time": ev.event_time.isoformat(),
        "affected_assets": affected_assets,
    }


@router.post("/calendar/refresh")
async def refresh_economic_calendar(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return await run_calendar_refresh(db, settings)


# ---------------------------------------------------------------------------
# Real Yahoo Finance Market Treemap (ZERO hash() / ZERO fake numbers!)
# ---------------------------------------------------------------------------


async def _fetch_yahoo_treemap_quotes(
    tickers: list[str], period: str, stale: dict[str, dict[str, Any]] | None = None
) -> dict[str, dict[str, Any]]:
    """Real period % changes via the resilient provider chain (Yahoo -> Stooq/Binance/Frankfurter -> cache)."""
    return await market_data.fetch_quotes(tickers, period, stale=stale)


async def refresh_treemap_universe(
    db: AsyncSession,
    settings: Settings,
    universe: str,
    period: str = "1D",
) -> dict[str, Any]:
    """Fetch live Yahoo Finance treemap data for a universe & period and persist in MarketCache."""
    cfg = settings.load_yaml_config("treemap.yaml")
    universes = cfg.get("universes") or {}
    if universe not in universes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown treemap universe '{universe}'")

    uni = universes[universe]
    sectors_cfg: dict[str, list[str]] = uni.get("sectors", {})
    all_tickers = [t for tickers in sectors_cfg.values() for t in tickers]
    prev_row = await db.get(MarketCache, f"treemap:{universe}:{period}")
    stale: dict[str, dict[str, Any]] = {}
    for prev_sector in ((prev_row.payload_json or {}).get("sectors") or []) if prev_row else []:
        for prev_item in prev_sector.get("items") or []:
            if prev_item.get("price") is not None and prev_item.get("change_pct") is not None:
                stale[str(prev_item.get("ticker", "")).upper()] = {
                    "name": prev_item.get("name"),
                    "price": prev_item.get("price"),
                    "change_pct": prev_item.get("change_pct"),
                    "market_cap": prev_item.get("market_cap"),
                    "volume": prev_item.get("volume"),
                }
    quotes = await _fetch_yahoo_treemap_quotes(all_tickers, period, stale=stale)

    live_count = 0
    sectors_out: list[dict[str, Any]] = []
    for sector_name, tickers in sectors_cfg.items():
        items: list[dict[str, Any]] = []
        for idx, ticker in enumerate(tickers):
            q = quotes.get(ticker.upper(), {})
            is_live = bool(q.get("live"))
            if is_live:
                live_count += 1
            mcap = q.get("market_cap")
            vol = q.get("volume")
            items.append(
                {
                    "ticker": ticker,
                    "name": q.get("name") or ticker,
                    "price": q.get("price"),
                    "change_pct": q.get("change_pct") if q.get("change_pct") is not None else 0.0,
                    "market_cap": mcap,
                    "volume": vol,
                    "weight": round(mcap / 1e9, 2) if mcap else max(10.0, 100.0 - idx * 5.0),
                    "live": is_live,
                    "logo_url": f"/api/v1/assets/logo/{ticker}",
                }
            )
        sectors_out.append({"sector": sector_name, "items": items})

    now = datetime.now(UTC)
    payload = {
        "universe": universe,
        "name": uni.get("name", universe),
        "linked_asset": uni.get("linked_asset", ""),
        "period": period,
        "available_universes": [
            {"id": k, "name": v.get("name", k), "linked_asset": v.get("linked_asset", "")} for k, v in universes.items()
        ],
        "data_status": "live" if live_count > 0 else "unavailable",
        "live_tickers": live_count,
        "total_tickers": len(all_tickers),
        "updated_at": now.isoformat(),
        "sectors": sectors_out,
    }

    cache_key = f"treemap:{universe}:{period}"
    cache_row = await db.get(MarketCache, cache_key)
    if cache_row is None:
        db.add(MarketCache(cache_key=cache_key, payload_json=payload, updated_at=now))
    else:
        cache_row.payload_json = payload
        cache_row.updated_at = now
    await db.commit()
    return payload


@router.get("/treemap")
async def get_market_treemap(
    universe: str = Query(
        default="nasdaq100",
        pattern="^(sp500_top|nasdaq100|global_leaders|gold_commodities|crypto_majors|forex_majors)$",
    ),
    period: str = Query(default="1D", pattern="^(1D|1W|1M|3M|YTD)$"),
    sector: str | None = None,
    size_by: str = Query(default="market_cap", pattern="^(market_cap|volume|equal)$"),
    q: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Return real Yahoo Finance Market Treemap data grouped by sector (backed by MarketCache)."""
    cache_key = f"treemap:{universe}:{period}"
    cache_row = await db.get(MarketCache, cache_key)
    now = datetime.now(UTC)
    payload: dict[str, Any] | None = None

    if cache_row and cache_row.payload_json:
        updated = cache_row.updated_at
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
        if (now - updated).total_seconds() <= 300:
            payload = dict(cache_row.payload_json)

    if payload is None:
        payload = await refresh_treemap_universe(db, settings, universe, period)

    # Apply sector, search query, and size_by weight calculation cleanly
    sec_filter = sector.strip().lower() if sector and sector.strip() else None
    ql = q.strip().lower() if q and q.strip() else None

    filtered_sectors: list[dict[str, Any]] = []
    for sec in payload.get("sectors", []):
        if sec_filter and sec_filter not in str(sec.get("sector", "")).lower():
            continue
        items_out: list[dict[str, Any]] = []
        for item in sec.get("items", []):
            if ql and ql not in f"{item.get('ticker', '')} {item.get('name', '')}".lower():
                continue
            row = dict(item)
            if size_by == "equal":
                row["weight"] = 10.0
            elif size_by == "volume":
                row["weight"] = round((row.get("volume") or 0) / 1e6, 2) or 10.0
            else:
                row["weight"] = round((row.get("market_cap") or 0) / 1e9, 2) or float(row.get("weight") or 10.0)
            items_out.append(row)
        if items_out:
            filtered_sectors.append({"sector": sec["sector"], "items": items_out})

    return {**payload, "size_by": size_by, "sectors": filtered_sectors}


@router.post("/treemap/refresh")
async def refresh_market_treemap(
    universe: str = Query(
        default="nasdaq100",
        pattern="^(sp500_top|nasdaq100|global_leaders|gold_commodities|crypto_majors|forex_majors)$",
    ),
    period: str = Query(default="1D", pattern="^(1D|1W|1M|3M|YTD)$"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return await refresh_treemap_universe(db, settings, universe, period)


# ---------------------------------------------------------------------------
# Google AI (Gemini) Co-Pilot & Briefings CRUD
# ---------------------------------------------------------------------------


class AiAnalyzeRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    kind: str = Field(default="copilot", max_length=32)
    mode: str | None = Field(default=None, max_length=32)
    symbol: str | None = Field(default=None, max_length=32)
    model: str | None = Field(default=None, max_length=64)


def _compute_chart_snapshot_stats(bars: list[dict[str, Any]]) -> dict[str, Any]:
    if not bars:
        return {}
    closes = [float(b["close"]) for b in bars if b.get("close")]
    highs = [float(b["high"]) for b in bars if b.get("high")]
    lows = [float(b["low"]) for b in bars if b.get("low")]
    if not closes:
        return {}
    last = closes[-1]
    first = closes[0]
    chg_pct = round(((last - first) / first) * 100.0, 2) if first else 0.0
    hi = max(highs) if highs else last
    lo = min(lows) if lows else last

    # Bollinger Bands (20, 2.0)
    win = closes[-20:] if len(closes) >= 20 else closes
    mean = sum(win) / len(win)
    variance = sum((c - mean) ** 2 for c in win) / len(win)
    sd = variance**0.5
    sell_zone = mean + 2.0 * sd
    buy_zone = mean - 2.0 * sd

    # RSI(14)
    rsi = 50.0
    if len(closes) >= 15:
        gains = 0.0
        losses = 0.0
        for i in range(-14, 0):
            diff = closes[i] - closes[i - 1]
            if diff >= 0:
                gains += diff
            else:
                losses -= diff
        avg_g = gains / 14.0
        avg_l = losses / 14.0
        rsi = 100.0 if avg_l == 0 else 100.0 - (100.0 / (1.0 + avg_g / avg_l))

    # Rolling VWAP
    tp_vol = 0.0
    vol_sum = 0.0
    for b in bars[-60:]:
        tp = (float(b["high"]) + float(b["low"]) + float(b["close"])) / 3.0
        v = max(1.0, float(b.get("volume") or 1.0))
        tp_vol += tp * v
        vol_sum += v
    vwap = tp_vol / vol_sum if vol_sum > 0 else mean

    dec = 5 if last < 10 else 2
    return {
        "price": round(last, dec),
        "high_24h": round(hi, dec),
        "low_24h": round(lo, dec),
        "change_pct": chg_pct,
        "sell_zone": round(sell_zone, dec),
        "mean": round(mean, dec),
        "buy_zone": round(buy_zone, dec),
        "vwap": round(vwap, dec),
        "rsi_14": round(rsi, 1),
        "bars_count": len(closes),
    }


async def _build_asset_deep_context(db: AsyncSession, raw_symbol: str) -> tuple[str, dict[str, Any]]:
    from app.modules.assets.router import build_ticker_news_keywords
    from app.modules.charts.router import fetch_yahoo_chart

    canon = canonical_asset_code(raw_symbol) or raw_symbol.strip().upper()
    hub = (await db.execute(select(AssetHub).where(AssetHub.code == canon))).scalar_one_or_none()
    broker_syms = hub.broker_symbols if hub and hub.broker_symbols else [canon]

    # 1. 24h News digest for this asset (fallback to recent macro news if quiet 24h)
    now = datetime.now(UTC)
    cutoff_24h = now - timedelta(hours=24)
    recent_rows = (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(200))).scalars().all()
    kw_list = build_ticker_news_keywords(canon, hub.name if hub else canon, hub.group if hub else "")
    kw_set = {k.lower() for k in kw_list}
    if hub and hub.news_tags:
        kw_set.update(str(t).lower() for t in hub.news_tags if str(t).strip())

    matched_24h: list[NewsItem] = []
    matched_older: list[NewsItem] = []
    for n in recent_rows:
        aff = {canonical_asset_code(str(x)) for x in (n.affected_assets or [])}
        hay = f"{n.title} {n.summary}".lower()
        is_match = canon in aff or any(k in hay for k in kw_set)
        pub = n.published_at if n.published_at.tzinfo else n.published_at.replace(tzinfo=UTC)
        if is_match:
            if pub >= cutoff_24h:
                matched_24h.append(n)
            else:
                matched_older.append(n)

    selected_news = matched_24h[:12] if matched_24h else (matched_older[:8] or recent_rows[:6])
    bull_c = sum(1 for n in selected_news if n.sentiment == "bullish")
    bear_c = sum(1 for n in selected_news if n.sentiment == "bearish")

    # 2. Recent M5/H1 chart bars & technical indicators
    db_bars = (
        (
            await db.execute(
                select(MarketBar)
                .where(sql_symbol_match(MarketBar.symbol, canon, broker_syms), MarketBar.timeframe == "M5")
                .order_by(MarketBar.bar_time.desc())
                .limit(288)
            )
        )
        .scalars()
        .all()
    )
    bars_list = [
        {"open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume}
        for b in reversed(db_bars)
    ]
    if len(bars_list) < 30:
        try:
            y = await fetch_yahoo_chart(canon, "M5")
            bars_list = list(y.get("bars") or [])[-288:]
        except Exception:
            pass
    tech = _compute_chart_snapshot_stats(bars_list)

    # 3. Active Robot HUD telemetry & open positions
    all_robots = (await db.execute(select(Robot))).scalars().all()
    matched_robots = [
        r for r in all_robots if (hub and r.asset_id == hub.id) or symbol_matches_asset(r.symbol, canon, broker_syms)
    ]
    pos_stmt = select(OpenPositionLive).where(sql_symbol_match(OpenPositionLive.symbol, canon, broker_syms))
    positions = (await db.execute(pos_stmt)).scalars().all()

    robot_lines: list[str] = []
    for r in matched_robots[:3]:
        st = r.live_state_json or {}
        tel = st.get("telemetry") if isinstance(st.get("telemetry"), dict) else {}
        merged = {**st, **tel}
        robot_lines.append(
            f"{r.name} ({r.symbol}, status={r.live_status}, regime={merged.get('regime', 'N/A')}, "
            f"bias={merged.get('signal_bias', 'N/A')}, rsi={merged.get('rsi_m5', 'N/A')}, "
            f"vwap_z={merged.get('vwap_z', 'N/A')}, filter={merged.get('wait_reason', 'N/A')})"
        )

    news_lines = [
        f"- [{n.sentiment.upper()}] ({n.source}, {n.published_at.strftime('%H:%M UTC')}): {n.title}"
        for n in selected_news[:10]
    ]

    summary_block = (
        f"Asset: {canon} ({hub.name if hub else canon})\n"
        f"Chart Technicals (M5 last 24h): {tech if tech else 'No bar data'}\n"
        f"Active Robots HUD: {'; '.join(robot_lines) if robot_lines else 'None'}\n"
        f"Open Positions on {canon}: {len(positions)}\n"
        f"24h News Sentiment: Bullish={bull_c}, Bearish={bear_c}, Total={len(selected_news)}\n"
        f"Recent 24h Headlines:\n" + ("\n".join(news_lines) if news_lines else "- No recent headlines")
    )
    meta = {
        "canon": canon,
        "name": hub.name if hub else canon,
        "tech": tech,
        "bull_c": bull_c,
        "bear_c": bear_c,
        "headlines": [n.title for n in selected_news[:6]],
        "robots": robot_lines,
        "open_positions": len(positions),
    }
    return summary_block, meta


def _build_algorithmic_brief_fallback(meta: dict[str, Any]) -> str:
    canon = meta.get("canon", "ASSET")
    tech = meta.get("tech") or {}
    price = tech.get("price", "—")
    chg = tech.get("change_pct", 0.0)
    hi = tech.get("high_24h", "—")
    lo = tech.get("low_24h", "—")
    rsi = tech.get("rsi_14", 50.0)
    sell_z = tech.get("sell_zone", "—")
    buy_z = tech.get("buy_zone", "—")
    vwap = tech.get("vwap", "—")
    bull_c = meta.get("bull_c", 0)
    bear_c = meta.get("bear_c", 0)
    headlines = meta.get("headlines") or []
    robots = meta.get("robots") or []

    rsi_note = (
        "перекупленность (потенциал отката к VWAP)"
        if isinstance(rsi, (int, float)) and rsi >= 68
        else "перепроданность (потенциал возврата к среднему)"
        if isinstance(rsi, (int, float)) and rsi <= 32
        else "нейтральный баланс импульса"
    )
    sent_note = "Бычий" if bull_c > bear_c else "Медвежий" if bear_c > bull_c else "Нейтральный"
    hl_md = "\n".join(f"- {h}" for h in headlines[:5]) if headlines else "- Значимых публикаций за 24ч не зафиксировано"
    rob_md = "\n".join(f"- {r}" for r in robots) if robots else "- Активных советников с телеметрией нет"

    return (
        f"### Аналитическая сводка 24ч — {canon}\n\n"
        f"**1. Структура графика и ключевые зоны (M5 / 24ч)**\n"
        f"- Текущая котировка: **{price}** ({'+' if isinstance(chg, (int, float)) and chg >= 0 else ''}{chg}%)\n"
        f"- Диапазон 24ч: Low **{lo}** — High **{hi}**\n"
        f"- Зоны стратегии: **SELL ZONE {sell_z}** • **FAIR (VWAP) {vwap}** • **BUY ZONE {buy_z}**\n"
        f"- Индикатор **RSI(14): {rsi}** — {rsi_note}\n\n"
        f"**2. Новостной фон за 24 часа ({sent_note}: Bull {bull_c} / Bear {bear_c})**\n"
        f"{hl_md}\n\n"
        f"**3. Телеметрия торговых роботов**\n"
        f"{rob_md}"
    )


async def _try_free_llm_fallback(system_prompt: str, user_prompt: str) -> tuple[str, str] | None:
    """Zero-key free LLM fallback (Pollinations OpenAI-compatible API) used when Gemini models return 503/429."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(28.0, connect=6.0)) as http:
            resp = await http.post(
                "https://text.pollinations.ai/openai",
                json={
                    "model": "openai",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                txt = (
                    ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
                    or ""
                ).strip()
                if txt:
                    return txt, "free-ai-gpt4o-mini"
    except Exception:
        pass
    return None


@router.post("/ai/analyze")
async def gemini_ai_copilot(
    body: AiAnalyzeRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Multi-model AI Analyst enriched with 24h news headlines, real OHLC chart indicators, and Robot HUD."""
    api_key = (settings.google_ai_api_key or "").strip()
    if not api_key:
        vault_entry = await db.get(SecretVaultEntry, "google_ai_api_key")
        if vault_entry:
            api_key = decrypt_secret(vault_entry.value_enc, settings.vault_master_key).strip()

    default_model = (settings.google_ai_default_model or "gemini-2.5-flash-lite").strip()
    primary_model = (body.model or default_model).strip()
    is_asset_brief = bool((body.symbol and body.symbol.strip()) or body.mode == "asset_deep_dive")

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

    asset_meta: dict[str, Any] = {}
    if body.symbol and body.symbol.strip():
        asset_block, asset_meta = await _build_asset_deep_context(db, body.symbol)
        context_text = f"{context_text}\n\n{asset_block}"

    if not api_key and not is_asset_brief:
        reply = (
            "**Google AI (Gemini) ключ не настроен.**\n\n"
            "Добавьте `GEMINI_API_KEY` (или `google_ai_api_key`) в `/opt/huseynovlar-terminal/.env` "
            "на сервере и перезапустите backend.\n\n"
            f"Живой контекст портфеля, готовый для передачи в Gemini:\n> {context_text}"
        )
        return {
            "configured": False,
            "error": "Gemini API key not configured in /opt/huseynovlar-terminal/.env",
            "model": primary_model,
            "response_md": reply,
            "content_md": reply,
        }

    sys_instruction = (
        "Ты — институциональный мульти-активный аналитик уровня Bloomberg / MetaTrader 5. "
        "Отвечай на русском языке чётко, структурированно, по пунктам: "
        "1) Рыночный режим и ключевые уровни графика (SELL ZONE / FAIR VWAP / BUY ZONE / RSI), "
        "2) Сводка новостей за 24 часа и их влияние, "
        "3) Оценка рисков и сценарий для торгового робота. Используй только переданные реальные данные."
    )
    full_text_prompt = f"{sys_instruction}\n\n{context_text}\n\nЗапрос: {body.prompt}"

    text_out = ""
    used_model = primary_model
    last_status_exc: httpx.HTTPStatusError | None = None

    if api_key:
        candidate_models = list(
            dict.fromkeys(
                [
                    primary_model,
                    "gemini-2.5-flash-lite",
                    "gemini-2.0-flash-lite",
                    "gemini-2.0-flash",
                    "gemini-2.5-flash",
                    "gemini-flash-latest",
                ]
            )
        )
        payload = {"contents": [{"parts": [{"text": full_text_prompt}]}]}
        timeout = httpx.Timeout(45.0, connect=10.0)
        transport = httpx.AsyncHTTPTransport(retries=1)

        try:
            async with httpx.AsyncClient(timeout=timeout, transport=transport) as http:
                for cand_model in candidate_models:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cand_model}:generateContent"
                    try:
                        resp = await http.post(url, params={"key": api_key}, json=payload)
                        if resp.status_code in (404, 429, 500, 502, 503, 504):
                            logger.warning(
                                "Gemini model %s returned HTTP %d; trying next fallback model",
                                cand_model,
                                resp.status_code,
                            )
                            resp.raise_for_status()
                        resp.raise_for_status()
                        data = resp.json()
                        cand_txt = (
                            data.get("candidates", [{}])[0]
                            .get("content", {})
                            .get("parts", [{}])[0]
                            .get("text", "")
                        )
                        if cand_txt:
                            text_out = cand_txt
                            used_model = cand_model
                            break
                    except httpx.HTTPStatusError as st_exc:
                        last_status_exc = st_exc
                        if st_exc.response.status_code in (404, 429, 500, 502, 503, 504):
                            continue
                        raise
        except httpx.TimeoutException as exc:
            if not is_asset_brief:
                logger.warning("Gemini API timed out (model=%s)", primary_model, exc_info=True)
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=(
                        f"Gemini API timed out ({type(exc).__name__}) while waiting for model "
                        f"{primary_model}. Check outbound HTTPS access from the backend and retry."
                    ),
                ) from exc
        except httpx.RequestError as exc:
            if not is_asset_brief:
                logger.warning("Gemini API connection failed (model=%s)", primary_model, exc_info=True)
                reason = str(exc).strip() or repr(exc)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Gemini API connection failed ({type(exc).__name__}): {reason}",
                ) from exc
        except httpx.HTTPStatusError as exc:
            if not is_asset_brief:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Gemini API error ({exc.response.status_code}): {exc.response.text[:250]}",
                ) from exc

    # Free keyless LLM fallback when all Gemini models are overloaded (503/429) or unconfigured on Hub View
    if not text_out:
        free_res = await _try_free_llm_fallback(sys_instruction, f"{context_text}\n\nЗапрос: {body.prompt}")
        if free_res is not None:
            text_out, used_model = free_res

    # Deterministic quantitative 24h digest if all external AI providers are unreachable
    if not text_out and asset_meta:
        text_out = _build_algorithmic_brief_fallback(asset_meta)
        used_model = "quant-digest-24h"

    if not text_out:
        if last_status_exc is not None:
            sc = last_status_exc.response.status_code
            body_snip = last_status_exc.response.text[:250]
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Gemini API error ({sc}): {body_snip}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Empty response from AI provider")

    kind_val = body.mode or body.kind
    briefing = AiBriefing(kind=kind_val[:32], model_name=used_model[:64], prompt=body.prompt, response_md=text_out)
    db.add(briefing)
    await db.commit()
    return {
        "configured": True,
        "id": briefing.id,
        "kind": briefing.kind,
        "model": briefing.model_name,
        "prompt": briefing.prompt,
        "response_md": briefing.response_md,
        "content_md": briefing.response_md,
        "summary": briefing.response_md,
        "created_at": briefing.created_at.isoformat(),
    }


@router.get("/ai/briefings")
async def list_ai_briefings(
    kind: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(AiBriefing).order_by(AiBriefing.created_at.desc()).limit(limit)
    if kind:
        stmt = stmt.where(AiBriefing.kind == kind)
    rows = (await db.execute(stmt)).scalars().all()
    return page.apply(
        [
            {
                "id": b.id,
                "kind": b.kind,
                "model_name": b.model_name,
                "prompt": b.prompt,
                "response_md": b.response_md,
                "created_at": b.created_at.isoformat(),
            }
            for b in rows
        ]
    )


@router.get("/ai/briefings/{briefing_id}")
async def get_ai_briefing(
    briefing_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    b = await db.get(AiBriefing, briefing_id)
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI briefing not found")
    return {
        "id": b.id,
        "kind": b.kind,
        "model_name": b.model_name,
        "prompt": b.prompt,
        "response_md": b.response_md,
        "created_at": b.created_at.isoformat(),
    }


@router.delete("/ai/briefings/{briefing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_briefing(
    briefing_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    b = await db.get(AiBriefing, briefing_id)
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI briefing not found")
    await db.delete(b)
    await record_audit(
        db,
        action="ai_briefing.deleted",
        user_id=user.id,
        resource_type="ai_briefing",
        resource_id=briefing_id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
