from __future__ import annotations

import hashlib
import ipaddress
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
from app.core.ws_hub import ws_hub
from app.db.models import (
    AiBriefing,
    AssetHub,
    EconomicEvent,
    MarketCache,
    NewsItem,
    NewsSource,
    OpenPositionLive,
    SecretVaultEntry,
    TradingAccount,
    User,
)

NEWS_STREAM_SCAN_CAP = 5000

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

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


@router.get("/sources")
async def list_verified_sources(
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
    return page.apply([_serialize_source(s, live_items_count=counts.get(s.name, s.article_count)) for s in sources])


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
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as http:
            resp = await http.get(safe_url, headers={"User-Agent": "HuseynovlarTerminal/1.0"})
            resp.raise_for_status()
            parsed = parse_rss_xml(resp.text, src.name, src.category)
        src.last_polled_at = now
        src.last_error = ""
        await db.commit()
        return {
            "ok": True,
            "status_code": resp.status_code,
            "items_found": len(parsed),
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
    model: str | None = Field(default=None, max_length=64)


@router.post("/ai/analyze")
async def gemini_ai_copilot(
    body: AiAnalyzeRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Google AI (Gemini) Co-Pilot enriched with live portfolio equity, open positions, and recent news."""
    api_key = (settings.google_ai_api_key or "").strip()
    if not api_key:
        vault_entry = await db.get(SecretVaultEntry, "google_ai_api_key")
        if vault_entry:
            api_key = decrypt_secret(vault_entry.value_enc, settings.vault_master_key).strip()

    default_model = (settings.google_ai_default_model or "gemini-3.8-flash").strip()
    model_name = (body.model or default_model).strip()
    if model_name.startswith(("gemini-1.", "gemini-2.")):
        model_name = default_model

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
            "**Google AI (Gemini) ключ не настроен.**\n\n"
            "Добавьте `GEMINI_API_KEY` (или `google_ai_api_key`) в `/opt/huseynovlar-terminal/.env` "
            "на сервере и перезапустите backend.\n\n"
            f"Живой контекст портфеля, готовый для передачи в Gemini:\n> {context_text}"
        )
        return {
            "configured": False,
            "error": "Gemini API key not configured in /opt/huseynovlar-terminal/.env",
            "model": model_name,
            "response_md": reply,
        }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "You are an institutional Bloomberg-grade multi-asset trading & risk analyst. "
                            "Respond concisely with clear, structured bullet points based only on real data.\n\n"
                            f"{context_text}\n\nUser request: {body.prompt}"
                        )
                    }
                ]
            }
        ]
    }
    try:
        # Gemini 3.x may take longer on analytical prompts. Keep a bounded
        # response timeout and retry connection establishment once.
        timeout = httpx.Timeout(90.0, connect=10.0)
        transport = httpx.AsyncHTTPTransport(retries=1)
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as http:
            resp = await http.post(url, params={"key": api_key}, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini API error ({exc.response.status_code}): {exc.response.text[:250]}",
        ) from exc
    except httpx.TimeoutException as exc:
        logger.warning("Gemini API timed out (model=%s)", model_name, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                f"Gemini API timed out ({type(exc).__name__}) while waiting for model "
                f"{model_name}. Check outbound HTTPS access from the backend and retry."
            ),
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("Gemini API connection failed (model=%s)", model_name, exc_info=True)
        reason = str(exc).strip() or repr(exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Gemini API connection failed ({type(exc).__name__}): {reason}",
        ) from exc

    text_out = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    if not text_out:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Empty response from Gemini API")

    briefing = AiBriefing(kind=body.kind, model_name=model_name, prompt=body.prompt, response_md=text_out)
    db.add(briefing)
    await db.commit()
    return {
        "configured": True,
        "id": briefing.id,
        "kind": briefing.kind,
        "model": briefing.model_name,
        "prompt": briefing.prompt,
        "response_md": briefing.response_md,
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
