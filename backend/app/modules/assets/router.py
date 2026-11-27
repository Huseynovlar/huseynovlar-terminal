from __future__ import annotations

import contextlib
import hashlib
import html
import re
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.market_ws_hub import market_ws_hub
from app.core.pagination import Page
from app.core.symbols import (
    asset_related_currencies,
    canonical_asset_code,
    expand_symbol_variants,
    sql_symbol_match,
    symbol_matches_asset,
)
from app.db.models import (
    AssetHub,
    Deal,
    EconomicEvent,
    MarketTicker,
    NewsItem,
    OpenPositionLive,
    Robot,
    TradingAccount,
    User,
)

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
    found = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    if found:
        return found
    canon = canonical_asset_code(code)
    if canon and canon != code:
        return (await db.execute(select(AssetHub).where(AssetHub.code == canon))).scalar_one_or_none()
    return None


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


_LOGO_MIME_BY_EXT: dict[str, str] = {
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
_EXT_BY_LOGO_MIME: dict[str, str] = {
    "image/svg+xml": ".svg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/jpeg": ".jpg",
}

_KNOWN_CRYPTO_BASES = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "TON", "LTC",
    "AVAX", "DOT", "LINK", "MATIC", "POL", "TRX", "SHIB", "UNI", "ATOM",
    "NEAR", "APT", "ARB", "OP", "SUI", "BCH", "XLM", "ETC", "FIL", "HBAR",
}

_INDEX_ETF_LOGO_MAP: dict[str, str] = {
    "USTEC": "QQQ",
    "NAS100": "QQQ",
    "NDX": "QQQ",
    "US500": "SPY",
    "SPX": "SPY",
    "US30": "DIA",
    "DJI": "DIA",
    "XAUUSD": "PAXG",
    "XAU": "PAXG",
    "GOLD": "PAXG",
    "XAGUSD": "SLV",
    "XAG": "SLV",
    "SILVER": "SLV",
    "USOIL": "USO",
    "WTI": "USO",
}

# Negative cache so missing upstream symbols aren't re-fetched on every request
_LOGO_MISS_CACHE: dict[str, float] = {}


def _logo_storage_dir(settings: Settings) -> Path:
    for candidate in (
        settings.config_dir.parent / "data" / "asset_logos",
        Path("/tmp/huseynovlar_asset_logos"),
    ):
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            continue
    return Path("/tmp")


_LOGO_CACHE_TTL_SEC = 14 * 86400  # 14 days local disk cache


def _candidate_official_logo_urls(clean_sym: str) -> list[str]:
    """Institutional Fallback Chain (trading_asset_icons.md):
    - Crypto: logoapi.sh SVG -> Web3 Icons (jsDelivr) -> Elbstream -> nvstly/icons (jsDelivr)
    - Stocks/ETFs/Indices: logoapi.sh SVG -> Elbstream -> nvstly/icons (jsDelivr) -> FMP
    """
    mapped = _INDEX_ETF_LOGO_MAP.get(clean_sym, clean_sym)
    urls: list[str] = []

    crypto_base = mapped
    for suffix in ("USDT", "USDC", "USD"):
        if crypto_base.endswith(suffix) and len(crypto_base) > len(suffix):
            candidate_base = crypto_base[: -len(suffix)]
            if candidate_base in _KNOWN_CRYPTO_BASES or candidate_base == "PAXG":
                crypto_base = candidate_base
                break

    if crypto_base in _KNOWN_CRYPTO_BASES or crypto_base == "PAXG":
        urls.extend(
            [
                f"https://logoapi.sh/crypto/{crypto_base}.svg",
                f"https://cdn.jsdelivr.net/gh/GMWalletApp/crypto-icons@latest/assets/tokens/branded/{crypto_base.lower()}.svg",
                f"https://api.elbstream.com/logos/crypto/{crypto_base}",
                f"https://cdn.jsdelivr.net/gh/nvstly/icons@main/crypto_icons/{crypto_base}.png",
            ]
        )
    else:
        urls.extend(
            [
                f"https://logoapi.sh/ticker/{mapped}.svg",
                f"https://api.elbstream.com/logos/symbol/{mapped}",
                f"https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/{mapped}.png",
                f"https://financialmodelingprep.com/image-stock/{mapped}.png",
                f"https://cdn.jsdelivr.net/gh/nvstly/icons@main/crypto_icons/{mapped}.png",
            ]
        )
    return urls


async def _fetch_and_cache_official_logo(clean_sym: str, logo_dir: Path) -> tuple[bytes, str] | None:
    now = time.time()
    miss_ts = _LOGO_MISS_CACHE.get(clean_sym)
    if miss_ts and (now - miss_ts) < 3600:
        return None

    urls = _candidate_official_logo_urls(clean_sym)
    async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as http:
        for url in urls:
            try:
                resp = await http.get(url, headers={"User-Agent": "HuseynovlarTerminal/2.2"})
                if resp.status_code != 200 or not resp.content or len(resp.content) < 80:
                    continue
                ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                ext = _EXT_BY_LOGO_MIME.get(ct)
                if not ext:
                    if url.endswith(".svg") or resp.content.lstrip().startswith((b"<svg", b"<?xml")):
                        ext = ".svg"
                        ct = "image/svg+xml; charset=utf-8"
                    elif url.endswith(".png") or resp.content.startswith(b"\x89PNG"):
                        ext = ".png"
                        ct = "image/png"
                    elif resp.content.startswith(b"RIFF"):
                        ext = ".webp"
                        ct = "image/webp"
                if not ext:
                    continue
                if ext == ".svg" and b"<svg" not in resp.content.lower():
                    continue
                with contextlib.suppress(OSError):
                    (logo_dir / f"{clean_sym}{ext}").write_bytes(resp.content)
                return resp.content, ct
            except Exception:
                continue

    _LOGO_MISS_CACHE[clean_sym] = now
    return None


@router.get("/logo/{symbol}")
async def get_asset_logo(
    symbol: str,
    settings: Settings = Depends(get_settings),
) -> Response:
    """Same-origin CSP-safe logo proxy with 14-day local disk cache and official Fallback Chain."""
    clean = re.sub(r"[^A-Z0-9]", "", symbol.strip().upper())[:24]
    clean_stripped = re.sub(r"(C|M|RAW|PRO)$", "", clean) if len(clean) > 4 else clean
    lookup_key = clean_stripped or clean

    if lookup_key:
        logo_dir = _logo_storage_dir(settings)
        now = time.time()
        # 1. Serve from local disk cache if fresh (< 14 days)
        for ext, mime in _LOGO_MIME_BY_EXT.items():
            candidate = logo_dir / f"{lookup_key}{ext}"
            if candidate.is_file():
                age = now - candidate.stat().st_mtime
                if age < _LOGO_CACHE_TTL_SEC:
                    return Response(
                        content=candidate.read_bytes(),
                        media_type=mime,
                        headers={
                            "Cache-Control": "public, max-age=86400",
                            "X-Content-Type-Options": "nosniff",
                        },
                    )

        # 2. Fetch real official brand logo via Fallback Chain and cache locally
        fetched = await _fetch_and_cache_official_logo(lookup_key, logo_dir)
        if fetched is not None:
            raw_bytes, mime = fetched
            return Response(
                content=raw_bytes,
                media_type=mime,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "X-Content-Type-Options": "nosniff",
                },
            )

    # 3. Last-resort deterministic SVG badge
    svg = _render_symbol_logo_svg(symbol)
    return Response(
        content=svg,
        media_type="image/svg+xml; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{id_or_code}/logo")
async def upload_asset_logo(
    id_or_code: str,
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Upload a custom PNG/WebP/JPEG/SVG logo for a catalog asset."""
    asset = await _resolve_asset(db, id_or_code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    ct = (file.content_type or "").split(";")[0].strip().lower()
    ext = _EXT_BY_LOGO_MIME.get(ct)
    if not ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Upload PNG, WebP, JPEG, or SVG.",
        )

    raw = await file.read()
    if not raw or len(raw) > 1_048_576:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be between 1 byte and 1 MB")

    clean = re.sub(r"[^A-Z0-9]", "", asset.code.strip().upper())[:24] or "ASSET"
    logo_dir = _logo_storage_dir(settings)
    for old_ext in _LOGO_MIME_BY_EXT:
        old_file = logo_dir / f"{clean}{old_ext}"
        if old_file.exists():
            old_file.unlink(missing_ok=True)
    (logo_dir / f"{clean}{ext}").write_bytes(raw)

    asset.logo_url = f"/api/v1/assets/logo/{clean}?v={int(time.time())}"
    await db.commit()
    return _serialize_asset(asset)


_CORE_MARKET_TICKERS: list[tuple[str, str, str, str]] = [
    # Metals & Commodities
    ("XAUUSD", "Gold Spot / US Dollar", "metals", "SPOT"),
    ("XAGUSD", "Silver Spot / US Dollar", "metals", "SPOT"),
    ("USOIL", "WTI Crude Oil", "commodities", "NYMEX"),
    ("UKOIL", "Brent Crude Oil", "commodities", "ICE"),
    ("NGAS", "Natural Gas", "commodities", "NYMEX"),
    # Indices & Macro
    ("USTEC", "NASDAQ-100 Index (US Tech 100)", "indices", "NASDAQ"),
    ("US500", "S&P 500 Index", "indices", "NYSE"),
    ("US30", "Dow Jones Industrial Average 30", "indices", "NYSE"),
    ("DXY", "US Dollar Index", "indices", "ICE"),
    ("VIX", "CBOE Volatility Index", "indices", "CBOE"),
    ("US10Y", "US 10-Year Treasury Yield", "indices", "UST"),
    # Major Forex
    ("EURUSD", "Euro / US Dollar", "forex", "FX"),
    ("GBPUSD", "British Pound / US Dollar", "forex", "FX"),
    ("USDJPY", "US Dollar / Japanese Yen", "forex", "FX"),
    ("USDCHF", "US Dollar / Swiss Franc", "forex", "FX"),
    ("USDCAD", "US Dollar / Canadian Dollar", "forex", "FX"),
    ("AUDUSD", "Australian Dollar / US Dollar", "forex", "FX"),
    ("NZDUSD", "New Zealand Dollar / US Dollar", "forex", "FX"),
    ("EURGBP", "Euro / British Pound", "forex", "FX"),
    ("EURJPY", "Euro / Japanese Yen", "forex", "FX"),
    ("GBPJPY", "British Pound / Japanese Yen", "forex", "FX"),
    ("AUDJPY", "Australian Dollar / Japanese Yen", "forex", "FX"),
    ("EURAUD", "Euro / Australian Dollar", "forex", "FX"),
    ("EURCHF", "Euro / Swiss Franc", "forex", "FX"),
    # Major Crypto
    ("BTCUSD", "Bitcoin / US Dollar", "crypto", "BINANCE"),
    ("ETHUSD", "Ethereum / US Dollar", "crypto", "BINANCE"),
    ("SOLUSD", "Solana / US Dollar", "crypto", "BINANCE"),
    ("BNBUSD", "BNB / US Dollar", "crypto", "BINANCE"),
    ("XRPUSD", "XRP / US Dollar", "crypto", "BINANCE"),
    ("ADAUSD", "Cardano / US Dollar", "crypto", "BINANCE"),
    ("DOGEUSD", "Dogecoin / US Dollar", "crypto", "BINANCE"),
    ("TONUSD", "Toncoin / US Dollar", "crypto", "BINANCE"),
    ("LTCUSD", "Litecoin / US Dollar", "crypto", "BINANCE"),
    ("AVAXUSD", "Avalanche / US Dollar", "crypto", "BINANCE"),
    ("DOTUSD", "Polkadot / US Dollar", "crypto", "BINANCE"),
    ("LINKUSD", "Chainlink / US Dollar", "crypto", "BINANCE"),
    ("UNIUSD", "Uniswap / US Dollar", "crypto", "BINANCE"),
    ("NEARUSD", "NEAR Protocol / US Dollar", "crypto", "BINANCE"),
    ("SUIUSD", "Sui / US Dollar", "crypto", "BINANCE"),
    # Top US Equities & ETFs
    ("NVDA", "NVIDIA Corporation", "equities", "NASDAQ"),
    ("AAPL", "Apple Inc.", "equities", "NASDAQ"),
    ("MSFT", "Microsoft Corporation", "equities", "NASDAQ"),
    ("AMZN", "Amazon.com Inc.", "equities", "NASDAQ"),
    ("GOOGL", "Alphabet Inc. (Google)", "equities", "NASDAQ"),
    ("META", "Meta Platforms Inc.", "equities", "NASDAQ"),
    ("TSLA", "Tesla Inc.", "equities", "NASDAQ"),
    ("AMD", "Advanced Micro Devices Inc.", "equities", "NASDAQ"),
    ("NFLX", "Netflix Inc.", "equities", "NASDAQ"),
    ("COIN", "Coinbase Global Inc.", "equities", "NASDAQ"),
    ("AVGO", "Broadcom Inc.", "equities", "NASDAQ"),
    ("INTC", "Intel Corporation", "equities", "NASDAQ"),
    ("ORCL", "Oracle Corporation", "equities", "NYSE"),
    ("JPM", "JPMorgan Chase & Co.", "equities", "NYSE"),
    ("V", "Visa Inc.", "equities", "NYSE"),
    ("MA", "Mastercard Incorporated", "equities", "NYSE"),
    ("PLTR", "Palantir Technologies Inc.", "equities", "NASDAQ"),
    ("MSTR", "MicroStrategy Incorporated", "equities", "NASDAQ"),
    ("SPY", "SPDR S&P 500 ETF Trust", "equities", "NYSE"),
    ("QQQ", "Invesco QQQ Trust (NASDAQ-100)", "equities", "NASDAQ"),
    ("DIA", "SPDR Dow Jones Industrial ETF", "equities", "NYSE"),
    ("GLD", "SPDR Gold Shares ETF", "equities", "NYSE"),
]


_SPECIFIC_NEWS_KEYWORDS: dict[str, list[str]] = {
    "XAUUSD": ["XAUUSD", "Gold", "Bullion", "Spot Gold", "XAU", "Fed", "Real Yields", "DXY", "Inflation", "Safe Haven"],
    "XAGUSD": ["XAGUSD", "Silver", "Bullion", "XAG", "Industrial Metals", "Fed", "DXY", "Inflation"],
    "USOIL": ["USOIL", "WTI", "Crude Oil", "OPEC", "EIA Inventory", "Energy", "Geopolitics"],
    "UKOIL": ["UKOIL", "Brent", "Crude Oil", "OPEC", "North Sea", "Energy", "Geopolitics"],
    "NGAS": ["NGAS", "Natural Gas", "Henry Hub", "LNG", "EIA Storage", "Energy"],
    "USTEC": ["USTEC", "NASDAQ", "Nasdaq 100", "NDX", "QQQ", "Big Tech", "AI", "Semiconductors", "Fed", "US Yields"],
    "US500": ["US500", "S&P 500", "SPX", "SPY", "Wall Street", "Fed", "FOMC", "US CPI", "Earnings"],
    "US30": ["US30", "Dow Jones", "DJI", "DIA", "Blue Chips", "US Economy", "Fed"],
    "DXY": ["DXY", "US Dollar", "Dollar Index", "Fed", "FOMC", "Treasury Yields", "CPI", "NFP"],
    "VIX": ["VIX", "Volatility", "CBOE VIX", "Risk-Off", "Options", "S&P 500"],
    "US10Y": ["US10Y", "Treasury Yields", "10-Year Yield", "Bonds", "Fed", "Inflation"],
    "BTCUSD": ["BTC", "Bitcoin", "BTCUSD", "Spot Bitcoin ETF", "Crypto", "SEC", "Halving", "Institutional Flow"],
    "ETHUSD": ["ETH", "Ethereum", "ETHUSD", "Spot ETH ETF", "Layer 2", "DeFi", "Staking", "Crypto"],
    "SOLUSD": ["SOL", "Solana", "SOLUSD", "Solana DeFi", "DEX", "Crypto", "Altcoins"],
    "BNBUSD": ["BNB", "BNB Chain", "Binance", "Crypto", "Exchange"],
    "XRPUSD": ["XRP", "Ripple", "RLUSD", "SEC", "Payments", "Crypto"],
    "TONUSD": ["TON", "Toncoin", "Telegram", "Web3", "Crypto"],
    "DOGEUSD": ["DOGE", "Dogecoin", "Memecoin", "Crypto"],
    "ADAUSD": ["ADA", "Cardano", "Smart Contracts", "Crypto"],
    "NVDA": ["NVDA", "NVIDIA", "AI Chips", "GPU", "Blackwell", "Data Center", "Semiconductors"],
    "AAPL": ["AAPL", "Apple", "iPhone", "Apple Intelligence", "Services", "Big Tech"],
    "MSFT": ["MSFT", "Microsoft", "Azure", "OpenAI", "Cloud", "Enterprise AI"],
    "AMZN": ["AMZN", "Amazon", "AWS", "Cloud", "E-Commerce", "Retail"],
    "GOOGL": ["GOOGL", "Alphabet", "Google", "Gemini", "Search", "Cloud"],
    "META": ["META", "Meta", "Llama", "Instagram", "Digital Ads", "AI"],
    "TSLA": ["TSLA", "Tesla", "EV", "FSD", "Robotaxi", "Energy Storage"],
    "AMD": ["AMD", "Advanced Micro Devices", "MI300", "AI Chips", "Semiconductors"],
    "COIN": ["COIN", "Coinbase", "Crypto Exchange", "Bitcoin ETF", "Base", "SEC"],
    "MSTR": ["MSTR", "MicroStrategy", "Bitcoin Treasury", "BTC"],
    "PLTR": ["PLTR", "Palantir", "AIP", "Defense AI", "Enterprise Software"],
}

_CCY_CENTRAL_BANKS: dict[str, list[str]] = {
    "USD": ["USD", "Fed", "FOMC", "US CPI", "NFP"],
    "EUR": ["EUR", "ECB", "Eurozone CPI", "Lagarde"],
    "GBP": ["GBP", "BOE", "Bank of England", "UK CPI"],
    "JPY": ["JPY", "BOJ", "Bank of Japan", "Yen Intervention"],
    "CHF": ["CHF", "SNB", "Swiss Franc"],
    "AUD": ["AUD", "RBA", "Australia", "China PMI"],
    "CAD": ["CAD", "BOC", "Bank of Canada", "Crude Oil"],
    "NZD": ["NZD", "RBNZ", "New Zealand"],
}

_SEARCH_SYNONYMS: dict[str, str] = {
    "XAUSD": "XAUUSD",
    "XAU": "XAUUSD",
    "GOLD": "XAUUSD",
    "ЗОЛОТО": "XAUUSD",
    "XAG": "XAGUSD",
    "SILVER": "XAGUSD",
    "СЕРЕБРО": "XAGUSD",
    "NAS100": "USTEC",
    "NASDAQ": "USTEC",
    "NDX": "USTEC",
    "US100": "USTEC",
    "SPX": "US500",
    "SP500": "US500",
    "DJI": "US30",
    "WTI": "USOIL",
    "НЕФТЬ": "USOIL",
    "OIL": "USOIL",
    "БИТКОИН": "BTCUSD",
    "BTC": "BTCUSD",
    "ЭФИР": "ETHUSD",
    "ETH": "ETHUSD",
}


def build_ticker_news_keywords(symbol: str, name: str = "", asset_class: str = "", exchange: str = "") -> list[str]:
    """Generate rich asset-specific news keywords/tags for any crypto, forex, metal, index, or equity ticker."""
    sym = symbol.strip().upper()
    if sym in _SPECIFIC_NEWS_KEYWORDS:
        return list(_SPECIFIC_NEWS_KEYWORDS[sym])

    cls = (asset_class or "").strip().lower()
    clean_name = re.sub(r"\s*\(.*?\)\s*", " ", name or "").replace("/ US Dollar", "").strip()
    out: list[str] = [sym]

    if cls == "crypto" or (sym.endswith("USD") and exchange.upper() == "BINANCE"):
        base = sym[:-3] if sym.endswith("USD") and len(sym) > 3 else sym
        for kw in (base, clean_name, f"{base}USDT", "Crypto", "Altcoin", "Blockchain", "Binance", "DeFi", "SEC"):
            if kw and kw not in out:
                out.append(kw)
        return out[:10]

    if cls == "forex" or (len(sym) == 6 and sym[:3] in _CCY_CENTRAL_BANKS and sym[3:] in _CCY_CENTRAL_BANKS):
        c1, c2 = sym[:3], sym[3:6]
        out.append(f"{c1}/{c2}")
        for kw in [*_CCY_CENTRAL_BANKS.get(c1, []), *_CCY_CENTRAL_BANKS.get(c2, []), "Forex", "Interest Rates"]:
            if kw and kw not in out:
                out.append(kw)
        return out[:10]

    if cls in ("metals", "commodities"):
        for kw in (clean_name, "Commodities", "Fed", "DXY", "Inflation", "Supply"):
            if kw and kw not in out:
                out.append(kw)
        return out[:9]

    if cls == "indices":
        for kw in (clean_name, "Macro", "Fed", "FOMC", "Yields", "Earnings"):
            if kw and kw not in out:
                out.append(kw)
        return out[:9]

    # Equities / ETFs
    short_corp = re.sub(
        r"\b(Inc\.?|Corporation|Corp\.?|Ltd\.?|PLC|Holdings|Group|Incorporated|Class [A-Z])\b",
        "",
        clean_name,
        flags=re.IGNORECASE,
    ).strip(" ,.-")
    for kw in (short_corp, clean_name, exchange.upper(), "Earnings", "Guidance", "Wall Street", "US Stocks"):
        if kw and len(kw) >= 2 and kw not in out:
            out.append(kw)
    return out[:9]


def build_ticker_broker_symbols(symbol: str, asset_class: str = "") -> list[str]:
    sym = symbol.strip().upper()
    cls = (asset_class or "").strip().lower()
    if sym == "XAUUSD":
        return ["XAUUSD", "XAUUSDc", "XAUUSDm", "GOLD"]
    if sym == "XAGUSD":
        return ["XAGUSD", "XAGUSDc", "XAGUSDm", "SILVER"]
    if sym == "USTEC":
        return ["USTEC", "USTECc", "USTECm", "NAS100"]
    if sym == "US500":
        return ["US500", "US500c", "US500m", "SPX500"]
    if sym == "US30":
        return ["US30", "US30c", "US30m", "DJ30"]
    if cls in ("forex", "metals", "indices", "commodities", "crypto"):
        return [sym, f"{sym}c", f"{sym}m"]
    return [sym]


async def _ensure_core_tickers(db: AsyncSession) -> None:
    existing = set((await db.execute(select(MarketTicker.symbol))).scalars().all())
    missing = [item for item in _CORE_MARKET_TICKERS if item[0] not in existing]
    if not missing:
        return
    for sym, name, cls, exch in missing:
        db.add(MarketTicker(symbol=sym, name=name, asset_class=cls, exchange=exch, source="core"))
    await db.commit()


_TICKER_24H_CACHE: dict[str, dict[str, Any]] = {}
_TICKER_24H_BINANCE_TS = 0.0
_TICKER_24H_ALPACA_TS: dict[str, float] = {}


async def _fetch_batch_24h_stats(symbols: list[str], settings: Settings) -> dict[str, dict[str, Any]]:
    """Lightweight 60s-cached 24h volume/high/low/change batch loader (Binance Vision + Alpaca Snapshots)."""
    global _TICKER_24H_BINANCE_TS
    now_m = time.monotonic()

    need_binance = now_m - _TICKER_24H_BINANCE_TS >= 60.0
    stock_syms = [
        s.upper()
        for s in symbols
        if s.isalpha() and 1 <= len(s) <= 5 and not s.upper().endswith("USD")
        and (now_m - _TICKER_24H_ALPACA_TS.get(s.upper(), 0.0) >= 60.0)
    ][:30]

    if need_binance or (stock_syms and settings.alpaca_api_key and settings.alpaca_api_secret):
        async with httpx.AsyncClient(timeout=5.0) as http:
            if need_binance:
                try:
                    resp = await http.get("https://data-api.binance.vision/api/v3/ticker/24hr")
                    if resp.status_code == 200 and isinstance(resp.json(), list):
                        for row in resp.json():
                            sym = str(row.get("symbol") or "").upper()
                            if not sym.endswith("USDT"):
                                continue
                            base = sym[:-4]
                            canon = f"{base}USD"
                            _TICKER_24H_CACHE[canon] = {
                                "price": float(row.get("lastPrice") or 0.0) or None,
                                "change_pct_24h": float(row.get("priceChangePercent") or 0.0),
                                "high_24h": float(row.get("highPrice") or 0.0) or None,
                                "low_24h": float(row.get("lowPrice") or 0.0) or None,
                                "volume_24h": float(row.get("quoteVolume") or 0.0) or None,
                                "ws_source": "Binance Vision",
                            }
                        _TICKER_24H_BINANCE_TS = now_m
                except Exception:  # noqa: BLE001
                    pass

            if stock_syms and settings.alpaca_api_key and settings.alpaca_api_secret:
                try:
                    resp = await http.get(
                        "https://data.alpaca.markets/v2/stocks/snapshots",
                        params={"symbols": ",".join(stock_syms), "feed": "iex"},
                        headers={
                            "APCA-API-KEY-ID": settings.alpaca_api_key,
                            "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
                        },
                    )
                    if resp.status_code == 200 and isinstance(resp.json(), dict):
                        for sym, snap in resp.json().items():
                            if not isinstance(snap, dict):
                                continue
                            db_bar = snap.get("dailyBar") or {}
                            prev_bar = snap.get("prevDailyBar") or {}
                            lt = snap.get("latestTrade") or {}
                            px = float(lt.get("p") or db_bar.get("c") or 0.0) or None
                            prev_c = float(prev_bar.get("c") or 0.0)
                            vol_sh = float(db_bar.get("v") or 0.0)
                            vol_usd = round(vol_sh * (px or prev_c), 2) if vol_sh > 0 and (px or prev_c) else None
                            chg = round(((px - prev_c) / prev_c) * 100.0, 2) if px and prev_c > 0 else None
                            _TICKER_24H_CACHE[sym.upper()] = {
                                "price": px,
                                "change_pct_24h": chg,
                                "high_24h": float(db_bar.get("h") or 0.0) or None,
                                "low_24h": float(db_bar.get("l") or 0.0) or None,
                                "volume_24h": vol_usd,
                                "ws_source": "Alpaca IEX",
                            }
                            _TICKER_24H_ALPACA_TS[sym.upper()] = now_m
                except Exception:  # noqa: BLE001
                    pass

    return _TICKER_24H_CACHE


@router.get("/tickers")
async def list_market_tickers(
    response: Response,
    q: str | None = Query(default=None, max_length=64),
    asset_class: str | None = Query(default=None, max_length=32),
    page: Page = Depends(),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[dict[str, Any]]:
    """Master reference directory of all available market tickers with news_keywords & broker_symbols."""
    await _ensure_core_tickers(db)
    stmt = select(MarketTicker)
    if asset_class and asset_class.strip().lower() not in ("", "all"):
        stmt = stmt.where(MarketTicker.asset_class == asset_class.strip().lower())

    q_clean = q.strip() if q and q.strip() else ""
    q_up = q_clean.upper()
    synonym_sym = _SEARCH_SYNONYMS.get(q_up) or canonical_asset_code(q_up)
    if q_clean:
        pat = f"%{q_clean}%"
        conds = [MarketTicker.symbol.ilike(pat), MarketTicker.name.ilike(pat)]
        if synonym_sym and synonym_sym != q_up:
            conds.append(MarketTicker.symbol.ilike(f"%{synonym_sym}%"))
        stmt = stmt.where(or_(*conds))

    total = int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one() or 0)
    response.headers["X-Total-Count"] = str(total)

    # Always rank exact/synonym matches and core institutional instruments (XAUUSD, USTEC, EURUSD, BTCUSD, NVDA) first!
    core_rank = case((MarketTicker.source == "core", 0), else_=1)
    if q_up:
        exact_rank = case(
            (MarketTicker.symbol == q_up, 0),
            (MarketTicker.symbol == synonym_sym, 1),
            (MarketTicker.symbol.ilike(f"{q_up}%"), 2),
            else_=3,
        )
        ordered_stmt = (
            stmt.order_by(exact_rank, core_rank, MarketTicker.symbol.asc()).limit(page.limit).offset(page.offset)
        )
    else:
        ordered_stmt = stmt.order_by(core_rank, MarketTicker.symbol.asc()).limit(page.limit).offset(page.offset)

    rows = (await db.execute(ordered_stmt)).scalars().all()
    stats_24h = await _fetch_batch_24h_stats([r.symbol for r in rows], settings)
    out_tickers: list[dict[str, Any]] = []
    for idx, r in enumerate(rows):
        canon = canonical_asset_code(r.symbol) or r.symbol.upper()
        recent = market_ws_hub.get_recent_ticks(canon, limit=2)
        last_tick = recent[-1] if recent else None
        bid = float(last_tick.get("bid") or 0.0) if isinstance(last_tick, dict) else 0.0
        ask = float(last_tick.get("ask") or 0.0) if isinstance(last_tick, dict) else 0.0
        spread_bps = round(((ask - bid) / ((ask + bid) / 2)) * 10_000, 2) if bid > 0 and ask >= bid else None
        st24 = stats_24h.get(canon) or stats_24h.get(r.symbol.upper()) or {}
        out_tickers.append(
            {
                "id": page.offset + idx + 1,
                "symbol": r.symbol,
                "name": r.name,
                "asset_class": r.asset_class,
                "exchange": r.exchange,
                "source": r.source,
                "logo_url": f"/api/v1/assets/logo/{r.symbol}",
                "broker_symbols": build_ticker_broker_symbols(r.symbol, r.asset_class),
                "news_keywords": build_ticker_news_keywords(r.symbol, r.name, r.asset_class, r.exchange),
                "price": (last_tick.get("price") if isinstance(last_tick, dict) else None) or st24.get("price"),
                "change_pct_24h": st24.get("change_pct_24h"),
                "high_24h": st24.get("high_24h"),
                "low_24h": st24.get("low_24h"),
                "volume_24h": st24.get("volume_24h"),
                "spread_bps": spread_bps,
                "ws_source": (last_tick.get("source") if isinstance(last_tick, dict) else None)
                or st24.get("ws_source"),
            }
        )
    return out_tickers


class ManualTickerCreateRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=128)
    asset_class: str = Field(default="crypto", max_length=32)
    exchange: str = Field(default="CUSTOM", max_length=64)
    source: str = Field(default="manual", max_length=32)


@router.post("/tickers", status_code=status.HTTP_201_CREATED)
async def create_market_ticker(
    body: ManualTickerCreateRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Manually add a rare or custom instrument to the master MarketTicker directory."""
    sym = body.symbol.strip().upper().replace(" ", "")
    if not sym:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Symbol is required")
    existing = (await db.execute(select(MarketTicker).where(MarketTicker.symbol == sym))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Ticker {sym} already exists")
    tk = MarketTicker(
        symbol=sym,
        name=body.name.strip(),
        asset_class=body.asset_class.strip().lower() or "crypto",
        exchange=body.exchange.strip().upper() or "CUSTOM",
        source=body.source.strip().lower() or "manual",
    )
    db.add(tk)
    await db.commit()
    return {
        "symbol": tk.symbol,
        "name": tk.name,
        "asset_class": tk.asset_class,
        "exchange": tk.exchange,
        "source": tk.source,
        "logo_url": f"/api/v1/assets/logo/{tk.symbol}",
    }


@router.post("/tickers/sync")
async def sync_market_tickers(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Sync live master ticker directory from Binance (Crypto) + Alpaca (US Stocks/ETFs) + Core FX/Metals/Indices."""
    await _ensure_core_tickers(db)
    added = 0
    sources_synced: list[str] = ["core"]

    existing = set((await db.execute(select(MarketTicker.symbol))).scalars().all())

    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as http:
        # 1. Binance Spot USDT pairs (top liquid crypto)
        try:
            r = await http.get("https://api.binance.com/api/v3/exchangeInfo")
            if r.status_code == 200:
                data = r.json()
                sources_synced.append("binance")
                for s in data.get("symbols") or []:
                    if s.get("status") == "TRADING" and s.get("quoteAsset") == "USDT":
                        base = str(s.get("baseAsset") or "").upper()
                        if not base or len(base) > 10:
                            continue
                        sym = f"{base}USD"
                        if sym not in existing:
                            db.add(
                                MarketTicker(
                                    symbol=sym,
                                    name=f"{base} / US Dollar (Binance)",
                                    asset_class="crypto",
                                    exchange="BINANCE",
                                    source="binance",
                                )
                            )
                            existing.add(sym)
                            added += 1
        except Exception:
            pass

        # 2. Alpaca US Equities & ETFs (if API key configured in /opt/huseynovlar-terminal/.env)
        if settings.alpaca_api_key and settings.alpaca_api_secret:
            try:
                base_url = settings.alpaca_endpoint.rstrip("/")
                r = await http.get(
                    f"{base_url}/assets",
                    params={"status": "active", "asset_class": "us_equity"},
                    headers={
                        "APCA-API-KEY-ID": settings.alpaca_api_key,
                        "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
                    },
                )
                if r.status_code == 200:
                    rows = r.json()
                    sources_synced.append("alpaca")
                    for item in rows[:2500]:
                        if not item.get("tradable"):
                            continue
                        sym = str(item.get("symbol") or "").strip().upper()
                        if not sym or "/" in sym or "." in sym or len(sym) > 10:
                            continue
                        if sym not in existing:
                            db.add(
                                MarketTicker(
                                    symbol=sym,
                                    name=str(item.get("name") or sym)[:160],
                                    asset_class="equities",
                                    exchange=str(item.get("exchange") or "US")[:64],
                                    source="alpaca",
                                )
                            )
                            existing.add(sym)
                            added += 1
            except Exception:
                pass

    await db.commit()
    total = int((await db.execute(select(func.count(MarketTicker.symbol)))).scalar_one() or 0)
    return {"added": added, "total": total, "sources": sources_synced}


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
    q: str | None = Query(default=None),
    status_filter: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(AssetHub).order_by(AssetHub.status.asc(), AssetHub.code.asc())
    if status_filter:
        stmt = stmt.where(AssetHub.status == status_filter)
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            AssetHub.id.ilike(pat)
            | AssetHub.code.ilike(pat)
            | AssetHub.name.ilike(pat)
            | AssetHub.category.ilike(pat)
            | AssetHub.group.ilike(pat)
        )
    rows = (await db.execute(stmt)).scalars().all()
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    robots = (await db.execute(select(Robot))).scalars().all()
    open_positions = (await db.execute(select(OpenPositionLive))).scalars().all()
    now_utc = datetime.now(UTC)
    today_start_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_msc = int(today_start_utc.timestamp() * 1000)
    since_24h = now_utc - timedelta(hours=24)
    recent_deals = (
        await db.execute(
            select(Deal.account_id, Deal.symbol, Deal.net_profit_usd, Deal.time_msc).where(
                Deal.deal_type.in_([0, 1]),
                Deal.time_msc >= today_start_msc,
            )
        )
    ).all()
    recent_news = (
        await db.execute(
            select(NewsItem.title, NewsItem.sentiment, NewsItem.affected_assets)
            .where(NewsItem.published_at >= since_24h)
            .limit(200)
        )
    ).all()

    out_items: list[dict[str, Any]] = []
    for hub in rows:
        matched_robots = [
            rb
            for rb in robots
            if rb.asset_id == hub.id or symbol_matches_asset(rb.symbol, hub.code, hub.broker_symbols)
        ]
        matched_positions = [
            pos for pos in open_positions if symbol_matches_asset(pos.symbol, hub.code, hub.broker_symbols)
        ]
        matched_acc_ids: set[str] = {a.id for a in accounts if a.primary_asset_id == hub.id}
        matched_acc_ids.update(rb.account_id for rb in matched_robots)
        for pos in matched_positions:
            matched_acc_ids.add(pos.account_id)

        realized_24h_usd = 0.0
        for acc_id, sym, net_usd, _ in recent_deals:
            if symbol_matches_asset(sym, hub.code, hub.broker_symbols):
                matched_acc_ids.add(acc_id)
                realized_24h_usd += float(net_usd or 0.0)

        floating_pnl_usd = sum(float(p.profit_usd or 0.0) for p in matched_positions)
        open_lots = sum(float(p.volume or 0.0) for p in matched_positions)
        pnl_24h_usd = round(realized_24h_usd + floating_pnl_usd, 2)

        robots_running = 0
        robots_paused = 0
        robots_error = 0
        mt5_zone: str | None = None
        for rb in matched_robots:
            st_u = (rb.live_status or "").upper()
            stale = (
                rb.last_heartbeat_at is not None
                and (now_utc - rb.last_heartbeat_at.replace(tzinfo=UTC)).total_seconds() > 300
            )
            if "ERR" in st_u or stale:
                robots_error += 1
            elif "PAUS" in st_u or "STOP" in st_u or "BLOCK" in st_u:
                robots_paused += 1
            else:
                robots_running += 1

            st = rb.live_state_json or {}
            z_obj = st.get("zones") if isinstance(st.get("zones"), dict) else None
            sell_lvl = float((z_obj or {}).get("sell") or st.get("bb_upper") or 0.0)
            buy_lvl = float((z_obj or {}).get("buy") or st.get("bb_lower") or 0.0)
            bid_px = float(st.get("bid") or 0.0)
            if mt5_zone is None and sell_lvl > 0 and buy_lvl > 0:
                if bid_px > 0:
                    if bid_px >= sell_lvl:
                        mt5_zone = "SELL ZONE"
                    elif bid_px <= buy_lvl:
                        mt5_zone = "BUY ZONE"
                    else:
                        mt5_zone = "FAIR"
                else:
                    mt5_zone = "FAIR"

        # Aggregate 24h news sentiment for this asset
        bull_hits = 0
        bear_hits = 0
        tags = {hub.code.upper(), *(str(t).upper() for t in (hub.news_tags or []))}
        for title, sent, syms_json in recent_news:
            syms_set = {str(s).upper() for s in (syms_json or [])}
            title_up = (title or "").upper()
            if (syms_set & tags) or any(t in title_up for t in tags if len(t) >= 3):
                s_u = (sent or "").upper()
                if "BULL" in s_u or "POS" in s_u:
                    bull_hits += 1
                elif "BEAR" in s_u or "NEG" in s_u:
                    bear_hits += 1
        news_sentiment = "BULL" if bull_hits > bear_hits else "BEAR" if bear_hits > bull_hits else "NEUTRAL"

        out_items.append(
            _serialize_asset(
                hub,
                extra={
                    "accounts_count": len(matched_acc_ids),
                    "robots_count": len(matched_robots),
                    "robots_running": robots_running,
                    "robots_paused": robots_paused,
                    "robots_error": robots_error,
                    "open_positions_count": len(matched_positions),
                    "open_positions_lots": round(open_lots, 2),
                    "floating_pnl_usd": round(floating_pnl_usd, 2),
                    "pnl_24h_usd": pnl_24h_usd,
                    "mt5_zone": mt5_zone,
                    "news_sentiment": news_sentiment,
                },
            )
        )

    return page.apply(out_items)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreateRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    code = canonical_asset_code(body.code) or body.code.strip().upper()
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


def _deal_usd_normalized(d: Deal, acc_map: dict[str, TradingAccount]) -> float:
    acc = acc_map.get(d.account_id)
    div = acc.currency_divisor if acc and acc.currency_divisor else 1.0
    if div != 1.0 and abs(d.net_profit - d.net_profit_usd) < 1e-6 and abs(d.net_profit) > 0:
        return round(d.net_profit / div, 4)
    return float(d.net_profit_usd)


@router.get("/{id_or_code}")
async def get_asset_detail(
    id_or_code: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Detailed Asset Hub bundle: metadata, alias-matched accounts/robots (live HUD), stats, news & calendar."""
    asset = await _resolve_asset(db, id_or_code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    symbols = expand_symbol_variants(asset.code, asset.broker_symbols)
    all_accounts = (await db.execute(select(TradingAccount))).scalars().all()
    acc_map = {a.id: a for a in all_accounts}

    all_robots = (await db.execute(select(Robot).order_by(Robot.created_at.asc()))).scalars().all()
    linked_robots: list[Robot] = []
    healed = False
    for r in all_robots:
        if r.asset_id == asset.id or symbol_matches_asset(r.symbol, asset.code, asset.broker_symbols):
            if r.asset_id is None:
                r.asset_id = asset.id
                healed = True
            linked_robots.append(r)

    open_positions = (
        (
            await db.execute(
                select(OpenPositionLive)
                .where(sql_symbol_match(OpenPositionLive.symbol, asset.code, asset.broker_symbols))
                .order_by(OpenPositionLive.open_time.desc())
            )
        )
        .scalars()
        .all()
    )
    closed_deals = (
        (
            await db.execute(
                select(Deal)
                .where(
                    sql_symbol_match(Deal.symbol, asset.code, asset.broker_symbols),
                    Deal.entry_type.in_([1, 2]),
                    Deal.deal_type.in_([0, 1]),
                )
                .order_by(Deal.time_msc.desc())
            )
        )
        .scalars()
        .all()
    )

    matched_acc_ids: set[str] = {a.id for a in all_accounts if a.primary_asset_id == asset.id}
    matched_acc_ids.update(r.account_id for r in linked_robots)
    matched_acc_ids.update(p.account_id for p in open_positions)
    matched_acc_ids.update(d.account_id for d in closed_deals)
    linked_accounts = [a for a in all_accounts if a.id in matched_acc_ids]

    if healed:
        await db.commit()

    now_msc = int(datetime.now(UTC).timestamp() * 1000)
    day_msc = 86_400_000

    total_balance_usd = round(sum(a.last_balance / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    total_equity_usd = round(sum(a.last_equity / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    total_floating_usd = round(sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in linked_accounts), 2)
    asset_floating_usd = round(sum(p.profit_usd for p in open_positions), 2)

    deal_pnls = [(d.time_msc, _deal_usd_normalized(d, acc_map)) for d in closed_deals]
    total_trades = len(deal_pnls)
    wins = sum(1 for _, pnl in deal_pnls if pnl > 0)
    net_pnl_usd = round(sum(pnl for _, pnl in deal_pnls), 2)
    today_start_msc = int(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
    pnl_24h_usd = round(sum(pnl for ts, pnl in deal_pnls if ts >= today_start_msc), 2)
    pnl_7d_usd = round(sum(pnl for ts, pnl in deal_pnls if now_msc - ts <= 7 * day_msc), 2)
    pnl_30d_usd = round(sum(pnl for ts, pnl in deal_pnls if now_msc - ts <= 30 * day_msc), 2)
    win_rate_pct = round((wins / total_trades) * 100.0, 2) if total_trades else 0.0

    # Real News Digest computed from DB NewsItem rows matching asset code or news_tags
    all_recent_news = (
        (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(150))).scalars().all()
    )
    tags_lower = {asset.code.lower()} | {str(t).lower() for t in (asset.news_tags or []) if str(t).strip()}
    matched_news: list[NewsItem] = []
    for item in all_recent_news:
        affected_upper = {canonical_asset_code(str(x)) for x in (item.affected_assets or [])} | {
            str(x).upper() for x in (item.affected_assets or [])
        }
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

    rel_currencies = asset_related_currencies(asset.code)
    cal_rows = (
        (
            await db.execute(
                select(EconomicEvent)
                .where(func.upper(EconomicEvent.currency).in_(rel_currencies))
                .order_by(EconomicEvent.event_time.desc())
                .limit(15)
            )
        )
        .scalars()
        .all()
    )

    return {
        **_serialize_asset(asset),
        "resolved_symbols": symbols[:25],
        "stats": {
            "accounts_count": len(linked_accounts),
            "robots_count": len(linked_robots),
            "open_positions_count": len(open_positions),
            "total_balance_usd": total_balance_usd,
            "total_equity_usd": total_equity_usd,
            "total_floating_pnl_usd": total_floating_usd,
            "asset_floating_pnl_usd": asset_floating_usd,
            "pnl_24h_usd": pnl_24h_usd,
            "pnl_7d_usd": pnl_7d_usd,
            "pnl_30d_usd": pnl_30d_usd,
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
                "last_floating_pnl_usd": round(a.last_floating_pnl / (a.currency_divisor or 1.0), 2),
                "terminal_connected": a.terminal_connected,
            }
            for a in linked_accounts
        ],
        "robots": [
            {
                "id": r.id,
                "account_id": r.account_id,
                "account_name": acc_map[r.account_id].name if r.account_id in acc_map else "",
                "account_login": acc_map[r.account_id].mt5_login if r.account_id in acc_map else "",
                "account_currency": acc_map[r.account_id].currency if r.account_id in acc_map else "USD",
                "name": r.name,
                "program_name": r.program_name,
                "version": r.version,
                "magic_number": r.magic_number,
                "symbol": r.symbol,
                "live_status": r.live_status,
                "live_state_json": r.live_state_json or {},
                "seq": int((r.live_state_json or {}).get("seq") or 0),
                "updated_at_utc": str(
                    (r.live_state_json or {}).get("updated_at_utc")
                    or (r.last_heartbeat_at.isoformat() if r.last_heartbeat_at else "")
                ),
                "last_execution_ms": r.last_execution_ms,
                "last_heartbeat_at": r.last_heartbeat_at.isoformat() if r.last_heartbeat_at else None,
                "is_active": r.is_active,
            }
            for r in linked_robots
        ],
        "open_positions": [
            {
                "position_ticket": p.position_ticket,
                "account_id": p.account_id,
                "account_name": acc_map[p.account_id].name if p.account_id in acc_map else "",
                "magic_number": p.magic_number,
                "symbol": p.symbol,
                "side": p.side,
                "volume": p.volume,
                "open_price": p.open_price,
                "current_price": p.current_price,
                "sl": p.sl,
                "tp": p.tp,
                "profit_usd": round(p.profit_usd, 2),
                "open_time": p.open_time,
            }
            for p in open_positions
        ],
        "calendar_events": [
            {
                "id": ev.id,
                "title": ev.title,
                "currency": ev.currency,
                "impact": ev.impact,
                "actual": getattr(ev, "actual", ""),
                "forecast": ev.forecast,
                "previous": ev.previous,
                "event_time": ev.event_time.isoformat(),
            }
            for ev in cal_rows
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
