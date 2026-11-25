from __future__ import annotations

import hashlib
import html
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.db.models import AssetHub, Deal, NewsItem, OpenPositionLive, Robot, TradingAccount, User

router = APIRouter(prefix="/assets", tags=["assets"])


class AssetCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=120)
    group: str = Field(default="other", max_length=48)
    category: str = Field(default="macro", max_length=32)
    status: str = Field(default="active", pattern="^(active|watchlist|archived)$")
    color: str = Field(default="#3B82F6", max_length=16)
    icon: str = Field(default="activity", max_length=32)
    logo_url: str | None = None
    broker_symbols: list[str] = Field(default_factory=list)
    news_tags: list[str] = Field(default_factory=list)
    macro_drivers: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)


class AssetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    group: str | None = Field(default=None, max_length=48)
    category: str | None = Field(default=None, max_length=32)
    status: str | None = Field(default=None, pattern="^(active|watchlist|archived)$")
    color: str | None = Field(default=None, max_length=16)
    icon: str | None = Field(default=None, max_length=32)
    logo_url: str | None = None
    broker_symbols: list[str] | None = None
    news_tags: list[str] | None = None
    macro_drivers: list[str] | None = None
    notes: str | None = None


async def _resolve_asset(db: AsyncSession, id_or_code: str) -> AssetHub | None:
    asset = await db.get(AssetHub, id_or_code)
    if asset:
        return asset
    code = id_or_code.strip().upper()
    return (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()


def _serialize_asset(a: AssetHub, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": a.id,
        "code": a.code,
        "name": a.name,
        "group": a.group,
        "category": a.category or "macro",
        "status": a.status,
        "color": a.color,
        "icon": a.icon,
        "logo_url": a.logo_url or f"/api/v1/assets/logo/{a.code}",
        "broker_symbols": a.broker_symbols or [],
        "news_tags": a.news_tags or [],
        "macro_drivers": a.macro_drivers or [],
        "notes": a.notes,
        "created_at": a.created_at.isoformat(),
    }
    if extra:
        out.update(extra)
    return out


# ---------------------------------------------------------------------------
# Same-Origin Logo SVG Generator / Proxy (100% CSP-safe, zero broken images)
# ---------------------------------------------------------------------------

_BRAND_STYLES: dict[str, tuple[str, str, str, str]] = {
    # Metals & Commodities: (bg1, bg2, fg, label)
    "XAUUSD": ("#F59E0B", "#B45309", "#111827", "Au"),
    "GOLD": ("#F59E0B", "#B45309", "#111827", "Au"),
    "GC=F": ("#F59E0B", "#B45309", "#111827", "Au"),
    "XAGUSD": ("#CBD5E1", "#64748B", "#0F172A", "Ag"),
    "SILVER": ("#CBD5E1", "#64748B", "#0F172A", "Ag"),
    "SI=F": ("#CBD5E1", "#64748B", "#0F172A", "Ag"),
    "PL=F": ("#E2E8F0", "#475569", "#0F172A", "Pt"),
    "PA=F": ("#94A3B8", "#334155", "#FFFFFF", "Pd"),
    "USOIL": ("#334155", "#0F172A", "#F97316", "OIL"),
    "WTI": ("#334155", "#0F172A", "#F97316", "WTI"),
    "CL=F": ("#334155", "#0F172A", "#F97316", "CL"),
    "BZ=F": ("#1E293B", "#0F172A", "#38BDF8", "BZ"),
    "NG=F": ("#0284C7", "#0369A1", "#FFFFFF", "NG"),
    "HG=F": ("#C2410C", "#7C2D12", "#FFFFFF", "Cu"),
    # Indices & Macro
    "USTEC": ("#2563EB", "#1D4ED8", "#FFFFFF", "NDX"),
    "NAS100": ("#2563EB", "#1D4ED8", "#FFFFFF", "NDX"),
    "NDX": ("#2563EB", "#1D4ED8", "#FFFFFF", "NDX"),
    "^NDX": ("#2563EB", "#1D4ED8", "#FFFFFF", "NDX"),
    "SPX": ("#4F46E5", "#3730A3", "#FFFFFF", "SPX"),
    "US500": ("#4F46E5", "#3730A3", "#FFFFFF", "500"),
    "^GSPC": ("#4F46E5", "#3730A3", "#FFFFFF", "SPX"),
    "US30": ("#1D4ED8", "#1E3A8A", "#FFFFFF", "DJI"),
    "^DJI": ("#1D4ED8", "#1E3A8A", "#FFFFFF", "DJI"),
    "VIX": ("#DC2626", "#991B1B", "#FFFFFF", "VIX"),
    "^VIX": ("#DC2626", "#991B1B", "#FFFFFF", "VIX"),
    "DXY": ("#059669", "#065F46", "#FFFFFF", "DXY"),
    "DX-Y.NYB": ("#059669", "#065F46", "#FFFFFF", "DXY"),
    "US10Y": ("#0D9488", "#115E59", "#FFFFFF", "10Y"),
    "^TNX": ("#0D9488", "#115E59", "#FFFFFF", "10Y"),
    # Crypto
    "BTCUSD": ("#F7931A", "#C2410C", "#FFFFFF", "BTC"),
    "BTC-USD": ("#F7931A", "#C2410C", "#FFFFFF", "BTC"),
    "ETHUSD": ("#627EEA", "#3730A3", "#FFFFFF", "ETH"),
    "ETH-USD": ("#627EEA", "#3730A3", "#FFFFFF", "ETH"),
    "SOLUSD": ("#14F195", "#9945FF", "#0F172A", "SOL"),
    "SOL-USD": ("#14F195", "#9945FF", "#0F172A", "SOL"),
    "BNB-USD": ("#F3BA2F", "#B45309", "#111827", "BNB"),
    "XRP-USD": ("#1E293B", "#0F172A", "#38BDF8", "XRP"),
    # Mega-cap Equities
    "AAPL": ("#334155", "#0F172A", "#FFFFFF", "AAPL"),
    "MSFT": ("#0284C7", "#0369A1", "#FFFFFF", "MSFT"),
    "NVDA": ("#76B900", "#3F6212", "#FFFFFF", "NVDA"),
    "AMZN": ("#FF9900", "#B45309", "#111827", "AMZN"),
    "GOOGL": ("#2563EB", "#EA4335", "#FFFFFF", "GOOG"),
    "META": ("#0668E1", "#1D4ED8", "#FFFFFF", "META"),
    "TSLA": ("#E31937", "#991B1B", "#FFFFFF", "TSLA"),
    "AVGO": ("#CC092F", "#7F1D1D", "#FFFFFF", "AVGO"),
    "AMD": ("#18181B", "#09090B", "#EF4444", "AMD"),
    "JPM": ("#1E3A8A", "#172554", "#FFFFFF", "JPM"),
    "BRK-B": ("#312E81", "#1E1B4B", "#FFFFFF", "BRK"),
    "LLY": ("#DC2626", "#991B1B", "#FFFFFF", "LLY"),
    "NFLX": ("#E50914", "#7F1D1D", "#FFFFFF", "NFLX"),
    "XOM": ("#DC2626", "#7F1D1D", "#FFFFFF", "XOM"),
}

_FX_COLORS: dict[str, str] = {
    "EUR": "#1D4ED8",
    "USD": "#059669",
    "GBP": "#7C3AED",
    "JPY": "#E11D48",
    "CHF": "#DC2626",
    "AUD": "#0284C7",
    "CAD": "#EA580C",
    "NZD": "#0F172A",
}

_FALLBACK_PALETTE: list[tuple[str, str]] = [
    ("#EA580C", "#9A3412"),
    ("#2563EB", "#1E40AF"),
    ("#059669", "#065F46"),
    ("#7C3AED", "#5B21B6"),
    ("#0891B2", "#155E75"),
    ("#D97706", "#92400E"),
    ("#DC2626", "#991B1B"),
    ("#4F46E5", "#3730A3"),
]


def _render_symbol_logo_svg(raw_symbol: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9\-=^._]", "", raw_symbol.strip().upper())[:16] or "SYM"

    # Strip Exness suffixes (m/c) for matching known brands
    base = clean[:-1] if len(clean) >= 6 and clean[-1] in ("M", "C") and clean[:-1] in _BRAND_STYLES else clean
    fx_clean = clean.replace("=X", "")
    if len(fx_clean) == 7 and fx_clean[-1] in ("M", "C"):
        fx_clean = fx_clean[:-1]

    # Dual-currency split badge for FX pairs (e.g. EURUSD, GBPUSD, USDJPY)
    if len(fx_clean) == 6 and fx_clean[:3] in _FX_COLORS and fx_clean[3:] in _FX_COLORS:
        c1 = _FX_COLORS[fx_clean[:3]]
        c2 = _FX_COLORS[fx_clean[3:]]
        b1 = html.escape(fx_clean[:3])
        b2 = html.escape(fx_clean[3:])
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
            "<defs><clipPath id=\"r\"><rect width=\"64\" height=\"64\" rx=\"14\"/></clipPath></defs>"
            '<g clip-path="url(#r)">'
            f'<polygon points="0,0 64,0 0,64" fill="{c1}"/>'
            f'<polygon points="64,0 64,64 0,64" fill="{c2}"/>'
            '<rect width="64" height="64" rx="14" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>'
            '<text x="19" y="25" text-anchor="middle" font-family="Inter,system-ui,sans-serif" '
            f'font-weight="800" font-size="13" fill="#FFFFFF">{b1}</text>'
            '<text x="45" y="51" text-anchor="middle" font-family="Inter,system-ui,sans-serif" '
            f'font-weight="800" font-size="13" fill="#FFFFFF">{b2}</text>'
            "</g></svg>"
        )

    if base in _BRAND_STYLES:
        bg1, bg2, fg, label = _BRAND_STYLES[base]
    else:
        digest = hashlib.sha256(base.encode("utf-8")).digest()
        bg1, bg2 = _FALLBACK_PALETTE[digest[0] % len(_FALLBACK_PALETTE)]
        fg = "#FFFFFF"
        short = re.sub(r"[^A-Z0-9]", "", base)
        label = short[:4] if len(short) <= 4 else short[:3]

    safe_label = html.escape(label)
    font_size = 22 if len(label) <= 2 else (17 if len(label) == 3 else 14)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
        "<defs>"
        f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="{bg1}"/>'
        f'<stop offset="100%" stop-color="{bg2}"/>'
        "</linearGradient>"
        "</defs>"
        '<rect width="64" height="64" rx="14" fill="url(#g)"/>'
        '<rect x="1" y="1" width="62" height="62" rx="13" fill="none" '
        'stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>'
        f'<text x="32" y="38" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" '
        f'font-size="{font_size}" letter-spacing="-0.4" fill="{fg}">{safe_label}</text>'
        "</svg>"
    )


@router.get("/logo/{symbol}")
async def get_asset_logo(symbol: str) -> Response:
    """Same-origin CSP-safe logo SVG generator/proxy guaranteed to return 200 OK for every symbol."""
    svg = _render_symbol_logo_svg(symbol)
    return Response(
        content=svg,
        media_type="image/svg+xml; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/seed-defaults")
async def seed_default_assets(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cfg = settings.load_yaml_config("assets.default.yaml")
    created: list[str] = []
    for item in cfg.get("assets", []):
        code = str(item["code"]).strip().upper()
        exists = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
        if exists:
            continue
        db.add(
            AssetHub(
                code=code,
                name=item.get("name", code),
                group=item.get("group", "other"),
                category=item.get("category", "macro"),
                status=item.get("status", "active"),
                color=item.get("color", "#3B82F6"),
                icon=item.get("icon", "activity"),
                logo_url=item.get("logo_url") or f"/api/v1/assets/logo/{code}",
                broker_symbols=item.get("broker_symbols", [code]),
                news_tags=item.get("news_tags", [code]),
                macro_drivers=item.get("macro_drivers", []),
            )
        )
        created.append(code)
    await db.commit()
    return {"seeded": created}


@router.get("")
async def list_assets(
    status_filter: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(AssetHub).order_by(AssetHub.status.asc(), AssetHub.code.asc())
    if status_filter:
        stmt = stmt.where(AssetHub.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    robots = (await db.execute(select(Robot))).scalars().all()

    acc_by_asset: dict[str, int] = {}
    for a in accounts:
        if a.primary_asset_id:
            acc_by_asset[a.primary_asset_id] = acc_by_asset.get(a.primary_asset_id, 0) + 1
    rob_by_asset: dict[str, int] = {}
    for r in robots:
        if r.asset_id:
            rob_by_asset[r.asset_id] = rob_by_asset.get(r.asset_id, 0) + 1

    return page.apply([
        _serialize_asset(
            r,
            extra={
                "accounts_count": acc_by_asset.get(r.id, 0),
                "robots_count": rob_by_asset.get(r.id, 0),
            },
        )
        for r in rows
    ])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreateRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    code = body.code.strip().upper()
    existing = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Asset {code} already exists")

    asset = AssetHub(
        code=code,
        name=body.name.strip(),
        group=body.group.strip(),
        category=body.category.strip() or "macro",
        status=body.status,
        color=body.color,
        icon=body.icon,
        logo_url=body.logo_url or f"/api/v1/assets/logo/{code}",
        broker_symbols=body.broker_symbols or [code],
        news_tags=body.news_tags or [code],
        macro_drivers=body.macro_drivers,
        notes=body.notes.strip(),
    )
    db.add(asset)
    await db.flush()
    await record_audit(
        db,
        action="asset.created",
        user_id=user.id,
        resource_type="asset",
        resource_id=asset.id,
        ip_address=extract_client_ip(request),
        details={"code": asset.code, "status": asset.status},
    )
    await db.commit()
    return _serialize_asset(asset)


@router.get("/{id_or_code}")
async def get_asset_detail(
    id_or_code: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Detailed Asset Hub view: metadata + multi-account stats + real News Digest & matching news."""
    asset = await _resolve_asset(db, id_or_code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    symbols = [s.upper() for s in (asset.broker_symbols or [asset.code])]
    if asset.code not in symbols:
        symbols.append(asset.code)

    linked_accounts = (
        (await db.execute(select(TradingAccount).where(TradingAccount.primary_asset_id == asset.id))).scalars().all()
    )
    linked_robots = (await db.execute(select(Robot).where(Robot.asset_id == asset.id))).scalars().all()
    open_positions = (
        (await db.execute(select(OpenPositionLive).where(OpenPositionLive.symbol.in_(symbols)))).scalars().all()
    )
    closed_deals = (
        (
            await db.execute(
                select(Deal)
                .where(Deal.symbol.in_(symbols), Deal.entry_type.in_([1, 2]))
                .order_by(Deal.time_msc.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )

    total_balance_usd = round(sum(a.last_balance / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    total_equity_usd = round(sum(a.last_equity / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    total_floating_usd = round(sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    total_trades = len(closed_deals)
    wins = sum(1 for d in closed_deals if d.net_profit_usd > 0)
    net_pnl_usd = round(sum(d.net_profit_usd for d in closed_deals), 2)
    win_rate_pct = round((wins / total_trades) * 100.0, 2) if total_trades else 0.0

    # Real News Digest computed from DB NewsItem rows matching asset code or news_tags
    all_recent_news = (
        (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(150))).scalars().all()
    )
    tags_lower = {asset.code.lower()} | {str(t).lower() for t in (asset.news_tags or []) if str(t).strip()}
    matched_news: list[NewsItem] = []
    for item in all_recent_news:
        affected_upper = {str(x).upper() for x in (item.affected_assets or [])}
        haystack = f"{item.title} {item.summary}".lower()
        if asset.code in affected_upper or any(tag in haystack for tag in tags_lower):
            matched_news.append(item)

    sent_counts = {"bullish": 0, "bearish": 0, "neutral": 0}
    breaking_count = 0
    corroborated_count = 0
    for n in matched_news:
        s = n.sentiment if n.sentiment in sent_counts else "neutral"
        sent_counts[s] += 1
        if n.is_breaking:
            breaking_count += 1
        if (n.verification_count or 1) >= 2:
            corroborated_count += 1

    if sent_counts["bullish"] > sent_counts["bearish"] and sent_counts["bullish"] > 0:
        dominant_sentiment = "bullish"
    elif sent_counts["bearish"] > sent_counts["bullish"] and sent_counts["bearish"] > 0:
        dominant_sentiment = "bearish"
    else:
        dominant_sentiment = "neutral"

    news_digest = {
        "total_articles": len(matched_news),
        "breaking_count": breaking_count,
        "corroborated_count": corroborated_count,
        "sentiment_breakdown": sent_counts,
        "dominant_sentiment": dominant_sentiment,
        "latest_published_at": matched_news[0].published_at.isoformat() if matched_news else None,
        "top_headlines": [
            {
                "id": n.id,
                "title": n.title,
                "source": n.source,
                "sentiment": n.sentiment,
                "impact_score": n.impact_score,
                "is_breaking": n.is_breaking,
                "published_at": n.published_at.isoformat(),
            }
            for n in matched_news[:5]
        ],
    }

    recent_news_out = [
        {
            "id": n.id,
            "source": n.source,
            "category": n.category,
            "title": n.title,
            "url": n.url,
            "summary": n.summary,
            "affected_assets": n.affected_assets,
            "sentiment": n.sentiment,
            "impact_score": n.impact_score,
            "is_breaking": n.is_breaking,
            "verification_count": max(1, int(n.verification_count or 1)),
            "published_at": n.published_at.isoformat(),
        }
        for n in matched_news[:15]
    ]

    return {
        **_serialize_asset(asset),
        "stats": {
            "accounts_count": len(linked_accounts),
            "robots_count": len(linked_robots),
            "open_positions_count": len(open_positions),
            "total_balance_usd": total_balance_usd,
            "total_equity_usd": total_equity_usd,
            "total_floating_pnl_usd": total_floating_usd,
            "total_trades": total_trades,
            "win_rate_pct": win_rate_pct,
            "net_pnl_usd": net_pnl_usd,
        },
        "accounts": [
            {
                "id": a.id,
                "name": a.name,
                "mt5_login": a.mt5_login,
                "currency": a.currency,
                "last_balance_usd": round(a.last_balance / (a.currency_divisor or 1.0), 2),
                "last_equity_usd": round(a.last_equity / (a.currency_divisor or 1.0), 2),
                "terminal_connected": a.terminal_connected,
            }
            for a in linked_accounts
        ],
        "robots": [
            {
                "id": r.id,
                "name": r.name,
                "magic_number": r.magic_number,
                "symbol": r.symbol,
                "live_status": r.live_status,
                "is_active": r.is_active,
            }
            for r in linked_robots
        ],
        "news_digest": news_digest,
        "recent_news": recent_news_out,
    }


@router.patch("/{id_or_code}")
async def update_asset(
    id_or_code: str,
    body: AssetUpdateRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    asset = await _resolve_asset(db, id_or_code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    for field in (
        "name",
        "group",
        "category",
        "status",
        "color",
        "icon",
        "logo_url",
        "broker_symbols",
        "news_tags",
        "macro_drivers",
        "notes",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(asset, field, val)
    await record_audit(
        db,
        action="asset.updated",
        user_id=user.id,
        resource_type="asset",
        resource_id=asset.id,
        ip_address=extract_client_ip(request),
        details={"code": asset.code},
    )
    await db.commit()
    return _serialize_asset(asset)


@router.delete("/{id_or_code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    id_or_code: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    asset = await _resolve_asset(db, id_or_code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    code = asset.code
    aid = asset.id
    await db.delete(asset)
    await record_audit(
        db,
        action="asset.deleted",
        user_id=user.id,
        resource_type="asset",
        resource_id=aid,
        ip_address=extract_client_ip(request),
        details={"code": code},
    )
    await db.commit()
