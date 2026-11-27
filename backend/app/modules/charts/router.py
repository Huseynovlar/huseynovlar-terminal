from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import market_data
from app.core.config import Settings, get_settings
from app.core.database import get_db, get_session_factory
from app.core.deps import get_current_user
from app.core.market_ws_hub import market_ws_hub
from app.core.mt5_zones_store import get_zone_series
from app.core.security import decode_token
from app.core.symbols import canonical_asset_code, expand_symbol_variants, sql_symbol_match
from app.core.ws_hub import ws_hub
from app.db.models import (
    AssetHub,
    ChartState,
    Deal,
    MarketBar,
    MarketCache,
    OpenPositionLive,
    Robot,
    TradingAccount,
    User,
    UserSession,
)

router = APIRouter(tags=["charts"])

_YAHOO_SYMBOL_ALIASES: dict[str, str] = {
    "XAUUSD": "GC=F",
    "GOLD": "GC=F",
    "XAGUSD": "SI=F",
    "SILVER": "SI=F",
    "USTEC": "^NDX",
    "NAS100": "^NDX",
    "NASDAQ": "^NDX",
    "NDX": "^NDX",
    "US500": "^GSPC",
    "SPX": "^GSPC",
    "US30": "^DJI",
    "US2000": "^RUT",
    "DE40": "^GDAXI",
    "GER40": "^GDAXI",
    "DAX": "^GDAXI",
    "UK100": "^FTSE",
    "FR40": "^FCHI",
    "EU50": "^STOXX50E",
    "HK50": "^HSI",
    "JP225": "^N225",
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "VIX": "^VIX",
    "USOIL": "CL=F",
    "WTI": "CL=F",
    "UKOIL": "BZ=F",
    "NGAS": "NG=F",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "NZDUSD": "NZDUSD=X",
    "EURGBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "GBPJPY": "GBPJPY=X",
    "AUDJPY": "AUDJPY=X",
    "EURAUD": "EURAUD=X",
    "EURCHF": "EURCHF=X",
    "BTCUSD": "BTC-USD",
    "ETHUSD": "ETH-USD",
    "SOLUSD": "SOL-USD",
    "BNBUSD": "BNB-USD",
    "XRPUSD": "XRP-USD",
    "ADAUSD": "ADA-USD",
    "DOGEUSD": "DOGE-USD",
    "TONUSD": "TON11419-USD",
    "LTCUSD": "LTC-USD",
}

_TF_TO_YAHOO: dict[str, tuple[str, str]] = {
    "M1": ("1m", "5d"),
    "M5": ("5m", "1mo"),
    "M15": ("15m", "1mo"),
    "M30": ("30m", "1mo"),
    "H1": ("60m", "3mo"),
    "H4": ("60m", "6mo"),
    "D1": ("1d", "2y"),
    "W1": ("1wk", "5y"),
}

_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}


class ChartStateUpsert(BaseModel):
    timeframe: str = Field(default="M5", pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$")
    indicators_json: dict[str, Any] = Field(default_factory=dict)
    drawings_json: list[dict[str, Any]] = Field(default_factory=list)
    filters_json: dict[str, Any] = Field(default_factory=dict)


async def fetch_yahoo_chart(
    symbol: str,
    timeframe: str = "H1",
    provider: str = "auto",
    before_ts: int | None = None,
) -> dict[str, Any]:
    """OHLC bars with 429-resistant caching, multi-provider routing, and backward pagination."""
    clean = canonical_asset_code(symbol) or symbol.strip().upper().replace(" ", "")
    yahoo_sym = _YAHOO_SYMBOL_ALIASES.get(clean, clean)
    interval, range_str = _TF_TO_YAHOO.get(timeframe, ("60m", "3mo"))

    res = await market_data.fetch_chart_with_fallback(
        yahoo_sym,
        timeframe,
        interval,
        range_str,
        provider=provider,
        before_ts=before_ts,
    )
    if not res:
        raise ValueError(f"Symbol '{clean}' unavailable: all market data providers failed or rate-limited")

    bars = res["bars"]
    if timeframe == "H4" and interval == "60m" and bars:
        # Aggregate 1-hour bars into genuine 4-hour UTC buckets
        buckets: dict[int, dict[str, Any]] = {}
        for b in bars:
            bt = (int(b["time"]) // 14400) * 14400
            if bt not in buckets:
                buckets[bt] = {
                    "time": bt,
                    "open": float(b["open"]),
                    "high": float(b["high"]),
                    "low": float(b["low"]),
                    "close": float(b["close"]),
                    "volume": float(b.get("volume") or 0),
                }
            else:
                cur = buckets[bt]
                cur["high"] = max(cur["high"], float(b["high"]))
                cur["low"] = min(cur["low"], float(b["low"]))
                cur["close"] = float(b["close"])
                cur["volume"] += float(b.get("volume") or 0)
        bars = [buckets[k] for k in sorted(buckets.keys())]

    reg_price = float(res["price"])
    prev_close = float(res.get("prev_close") or (bars[-2]["close"] if len(bars) >= 2 else reg_price) or 1.0)
    change_pct = round(((reg_price - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0

    return {
        "asset_code": clean,
        "yahoo_symbol": yahoo_sym,
        "name": res.get("name") or clean,
        "currency": res.get("currency") or "USD",
        "price": round(reg_price, 4),
        "change_pct": change_pct,
        "timeframe": timeframe if timeframe == "H4" else (res.get("timeframe") or timeframe),
        "requested_timeframe": timeframe,
        "source": res.get("source", "yahoo"),
        "logo_url": f"/api/v1/assets/logo/{clean}",
        "bars": bars[-1500:],
    }


async def refresh_macro_quotes(db: AsyncSession, settings: Settings) -> list[dict[str, Any]]:
    """Fetch live Yahoo Finance quotes for the macro ribbon symbols and store in MarketCache."""
    cfg = settings.load_yaml_config("news_sources.yaml")
    symbols_cfg = (cfg.get("macro_quotes") or {}).get("symbols") or [
        {"code": "DXY", "yahoo": "DX-Y.NYB", "label": "US Dollar Index"},
        {"code": "US10Y", "yahoo": "^TNX", "label": "US 10Y Yield"},
        {"code": "VIX", "yahoo": "^VIX", "label": "Volatility Index"},
        {"code": "SPX", "yahoo": "^GSPC", "label": "S&P 500"},
        {"code": "NDX", "yahoo": "^NDX", "label": "NASDAQ-100"},
        {"code": "XAUUSD", "yahoo": "GC=F", "label": "Gold Futures"},
        {"code": "BTCUSD", "yahoo": "BTC-USD", "label": "Bitcoin USD"},
    ]

    prev_row = await db.get(MarketCache, "macro:quotes")
    stale = (
        {
            str(q.get("yahoo_symbol", "")).upper(): q
            for q in ((prev_row.payload_json or {}).get("quotes") or [])
            if q.get("price") is not None
        }
        if prev_row
        else {}
    )
    live_quotes = await market_data.fetch_quotes(
        [str(i.get("yahoo", i.get("code", ""))) for i in symbols_cfg], "1D", stale=stale
    )

    quotes: list[dict[str, Any]] = []
    for item in symbols_cfg:
        code = str(item.get("code", "")).upper()
        yahoo_sym = str(item.get("yahoo", code))
        q = live_quotes.get(yahoo_sym.upper()) or {}
        quotes.append(
            {
                "code": code,
                "yahoo_symbol": yahoo_sym,
                "label": str(item.get("label", code)),
                "price": q.get("price"),
                "change_pct": q.get("change_pct") if q.get("change_pct") is not None else 0.0,
                "live": bool(q.get("live")),
                "source": q.get("source", "none"),
                "logo_url": f"/api/v1/assets/logo/{code}",
            }
        )

    now = datetime.now(UTC)
    cache_row = await db.get(MarketCache, "macro:quotes")
    payload = {"quotes": quotes, "updated_at": now.isoformat()}
    if cache_row is None:
        db.add(MarketCache(cache_key="macro:quotes", payload_json=payload, updated_at=now))
    else:
        cache_row.payload_json = payload
        cache_row.updated_at = now
    await db.commit()
    return quotes


@router.get("/charts/macro")
async def get_macro_ribbon(
    refresh: bool = False,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cache_row = await db.get(MarketCache, "macro:quotes")
    if cache_row and not refresh:
        payload = cache_row.payload_json or {}
        if payload.get("quotes"):
            return {
                "quotes": payload["quotes"],
                "updated_at": payload.get("updated_at") or cache_row.updated_at.isoformat(),
                "cached": True,
            }

    quotes = await refresh_macro_quotes(db, settings)
    return {"quotes": quotes, "updated_at": datetime.now(UTC).isoformat(), "cached": False}


@router.get("/charts/search")
async def search_symbols(
    q: str = Query(min_length=1, max_length=40),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    query = q.strip()
    q_upper = query.upper()
    q_lower = query.lower()

    hubs = (await db.execute(select(AssetHub))).scalars().all()
    hub_codes = {h.code.upper() for h in hubs}

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    # 1. Local Asset Hubs matches first
    for h in hubs:
        if q_upper in h.code.upper() or q_lower in h.name.lower():
            seen.add(h.code.upper())
            results.append(
                {
                    "symbol": h.code.upper(),
                    "name": h.name,
                    "exchange": h.group.upper(),
                    "type": h.category or h.group,
                    "logo_url": h.logo_url or f"/api/v1/assets/logo/{h.code.upper()}",
                    "in_hubs": True,
                }
            )

    # 2. Known institutional aliases
    for alias, ysym in _YAHOO_SYMBOL_ALIASES.items():
        if alias not in seen and (q_upper in alias or q_upper in ysym.upper()):
            seen.add(alias)
            results.append(
                {
                    "symbol": alias,
                    "name": f"{alias} ({ysym})",
                    "exchange": "GLOBAL",
                    "type": "instrument",
                    "logo_url": f"/api/v1/assets/logo/{alias}",
                    "in_hubs": alias in hub_codes,
                }
            )

    # 3. Live Yahoo Finance global symbol search
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as http:
            resp = await http.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={"q": query, "quotesCount": 12, "newsCount": 0},
                headers=_YAHOO_HEADERS,
            )
            if resp.status_code == 200:
                for item in resp.json().get("quotes") or []:
                    sym = str(item.get("symbol") or "").upper()
                    if not sym or sym in seen:
                        continue
                    seen.add(sym)
                    results.append(
                        {
                            "symbol": sym,
                            "name": item.get("shortname") or item.get("longname") or sym,
                            "exchange": item.get("exchDisp") or item.get("exchange") or "",
                            "type": item.get("quoteType") or "EQUITY",
                            "logo_url": f"/api/v1/assets/logo/{sym}",
                            "in_hubs": sym in hub_codes,
                        }
                    )
    except Exception:
        pass

    return results[:20]


@router.get("/charts/explore")
async def explore_any_symbol_chart(
    symbol: str = Query(min_length=1, max_length=24),
    timeframe: str = Query(default="H1", pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$"),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Search and chart ANY global market symbol (Forex, Gold, Indices, Crypto, Stocks) without adding it to DB."""
    try:
        data = await fetch_yahoo_chart(symbol, timeframe)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Market data lookup failed for {symbol.strip().upper()}: {exc}",
        ) from exc

    return {
        **data,
        "open_positions": [],
        "deals": [],
        "is_explorer": True,
    }


def _estimate_half_spread(canon: str, ref_price: float) -> float:
    if canon == "XAUUSD":
        return 0.08
    if canon == "XAGUSD":
        return 0.012
    if canon in ("USTEC", "US30"):
        return 0.65
    if canon == "US500":
        return 0.18
    if ref_price < 10:
        return round(max(ref_price * 0.00006, 0.00005), 6)
    return round(max(ref_price * 0.00012, 0.01), 4)


@router.get("/charts/ticks/{symbol}")
async def get_symbol_recent_ticks(
    symbol: str,
    limit: int = Query(default=140, ge=10, le=500),
    market_only: bool = Query(default=False),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return rolling live Bid/Ask ticks + latest L2 orderbook + server-computed spread."""
    canon = canonical_asset_code(symbol) or symbol.strip().upper()
    live_ticks = market_ws_hub.get_recent_ticks(canon, limit=limit)
    if market_only:
        live_ticks = [t for t in live_ticks if str(t.get("source") or "") != "mt5_live"]
    ob = market_ws_hub.get_latest_orderbook(canon)

    if len(live_ticks) < 24:
        seed_bars: list[dict[str, Any]] = []
        if not market_only:
            bars_db = (
                (
                    await db.execute(
                        select(MarketBar)
                        .where(sql_symbol_match(MarketBar.symbol, canon), MarketBar.timeframe.in_(["M1", "M5"]))
                        .order_by(MarketBar.bar_time.desc())
                        .limit(30)
                    )
                )
                .scalars()
                .all()
            )
            seed_bars = [
                {
                    "time": int(b.bar_time),
                    "open": float(b.open),
                    "high": float(b.high),
                    "low": float(b.low),
                    "close": float(b.close),
                }
                for b in reversed(bars_db)
            ]
        if len(seed_bars) < 12:
            with contextlib.suppress(Exception):
                y = await fetch_yahoo_chart(canon, "M1")
                seed_bars = list(y.get("bars") or [])[-30:]

        if seed_bars:
            cutoff_ms = live_ticks[0]["ts_ms"] if live_ticks else int(datetime.now(UTC).timestamp() * 1000) + 1
            synth: list[dict[str, Any]] = []
            prev_p = float(seed_bars[0]["open"])
            for b in seed_bars:
                base_ms = int(b["time"]) * 1000
                if base_ms >= cutoff_ms:
                    continue
                o, h, lo, c = float(b["open"]), float(b["high"]), float(b["low"]), float(b["close"])
                seq = (o, lo, h, c) if c >= o else (o, h, lo, c)
                for idx, mid_p in enumerate(seq):
                    ts_ms = base_ms + idx * 12_000
                    if ts_ms >= cutoff_ms:
                        break
                    hs = _estimate_half_spread(canon, mid_p)
                    dec = 5 if mid_p < 10 else 3
                    synth.append(
                        {
                            "ts_ms": ts_ms,
                            "symbol": canon,
                            "bid": round(mid_p - hs, dec),
                            "ask": round(mid_p + hs, dec),
                            "price": round(mid_p, dec),
                            "side": "buy" if mid_p >= prev_p else "sell",
                            "source": "history_seed",
                        }
                    )
                    prev_p = mid_p
            live_ticks = (synth + live_ticks)[-limit:]

    spread_usd = 0.0
    spread_bps = 0.0
    if ob and ob.get("bids") and ob.get("asks"):
        best_bid = float(ob["bids"][0][0])
        best_ask = float(ob["asks"][0][0])
        if best_bid > 0 and best_ask >= best_bid:
            spread_usd = round(best_ask - best_bid, 5)
            mid = (best_ask + best_bid) / 2.0
            spread_bps = round((spread_usd / mid) * 10_000.0, 2) if mid > 0 else 0.0
    elif live_ticks:
        last_t = live_ticks[-1]
        best_bid = float(last_t.get("bid") or 0.0)
        best_ask = float(last_t.get("ask") or best_bid)
        if best_bid > 0 and best_ask >= best_bid:
            spread_usd = round(best_ask - best_bid, 5)
            mid = (best_ask + best_bid) / 2.0
            spread_bps = round((spread_usd / mid) * 10_000.0, 2) if mid > 0 else 0.0

    return {
        "symbol": canon,
        "ticks": live_ticks,
        "orderbook": ob,
        "spread_usd": spread_usd,
        "spread_bps": spread_bps,
    }


@router.get("/charts/state/{symbol}")
async def get_chart_state(
    symbol: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    sym = symbol.strip().upper()
    row = (
        await db.execute(select(ChartState).where(ChartState.user_id == user.id, ChartState.symbol == sym))
    ).scalar_one_or_none()
    if not row:
        return {
            "symbol": sym,
            "timeframe": "H1",
            "indicators_json": {},
            "drawings_json": [],
            "filters_json": {},
            "updated_at": None,
        }
    return {
        "symbol": row.symbol,
        "timeframe": row.timeframe,
        "indicators_json": row.indicators_json or {},
        "drawings_json": row.drawings_json or [],
        "filters_json": row.filters_json or {},
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.put("/charts/state/{symbol}")
async def upsert_chart_state(
    symbol: str,
    body: ChartStateUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    sym = symbol.strip().upper()
    now = datetime.now(UTC)
    row = (
        await db.execute(select(ChartState).where(ChartState.user_id == user.id, ChartState.symbol == sym))
    ).scalar_one_or_none()
    if row is None:
        row = ChartState(
            user_id=user.id,
            symbol=sym,
            timeframe=body.timeframe,
            indicators_json=body.indicators_json,
            drawings_json=body.drawings_json,
            filters_json=body.filters_json,
            updated_at=now,
        )
        db.add(row)
    else:
        row.timeframe = body.timeframe
        row.indicators_json = body.indicators_json
        row.drawings_json = body.drawings_json
        row.filters_json = body.filters_json
        row.updated_at = now
    await db.commit()
    return {
        "symbol": row.symbol,
        "timeframe": row.timeframe,
        "indicators_json": row.indicators_json or {},
        "drawings_json": row.drawings_json or [],
        "filters_json": row.filters_json or {},
        "updated_at": row.updated_at.isoformat(),
    }


@router.get("/charts/{asset_code}")
async def get_asset_chart_bundle(
    asset_code: str,
    timeframe: str = Query(default="M5", pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$"),
    account_id: str | None = None,
    magic_number: int | None = None,
    limit: int = Query(default=1000, ge=20, le=2000),
    market_only: bool = Query(default=False),
    provider: str = Query(default="auto"),
    before: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return multi-day OHLCV candles, server-computed 24h market stats, positions, deals, and chart state."""
    t0_ms = int(datetime.now(UTC).timestamp() * 1000)
    raw_code = asset_code.strip().upper()
    code = canonical_asset_code(raw_code) or raw_code
    asset = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    if asset is None and raw_code != code:
        asset = (await db.execute(select(AssetHub).where(AssetHub.code == raw_code))).scalar_one_or_none()
    broker_syms = asset.broker_symbols if asset and asset.broker_symbols else [code]
    symbols = expand_symbol_variants(code, broker_syms)

    mt5_bars: list[dict[str, Any]] = []
    if not market_only and before is None:
        # 1. Candles from MT5 DB (legacy backward-compat mode when market_only=False)
        bars = (
            (
                await db.execute(
                    select(MarketBar)
                    .where(sql_symbol_match(MarketBar.symbol, code, broker_syms), MarketBar.timeframe == timeframe)
                    .order_by(MarketBar.bar_time.desc())
                    .limit(limit * 2)
                )
            )
            .scalars()
            .all()
        )
        mt5_by_time: dict[int, dict[str, Any]] = {}
        for b in reversed(bars):
            bt = int(b.bar_time)
            prev = mt5_by_time.get(bt)
            if prev is None or b.volume >= prev["volume"]:
                mt5_by_time[bt] = {
                    "time": bt,
                    "open": float(b.open),
                    "high": float(b.high),
                    "low": float(b.low),
                    "close": float(b.close),
                    "volume": int(b.volume or 0),
                }
        mt5_bars = [mt5_by_time[t] for t in sorted(mt5_by_time.keys())][-limit:]

    # 2. Direct market data history (strictly used when market_only=True or to backfill multi-day history)
    bars_out = mt5_bars
    source = "mt5_live" if mt5_bars else "market_history"
    ydata_meta: dict[str, Any] = {}
    min_history_bars = min(limit, 320)
    if market_only or before is not None or len(mt5_bars) < min_history_bars:
        try:
            ydata = await fetch_yahoo_chart(code, timeframe, provider=provider, before_ts=before)
            ydata_meta = ydata
            up_raw = [
                {
                    "time": int(ub["time"]),
                    "open": float(ub["open"]),
                    "high": float(ub["high"]),
                    "low": float(ub["low"]),
                    "close": float(ub["close"]),
                    "volume": float(ub.get("volume") or 0),
                }
                for ub in (ydata.get("bars") or [])
                if ub.get("time") and ub.get("close") and (before is None or int(ub["time"]) < int(before))
            ]
            if market_only or before is not None or not mt5_bars:
                dedup_up: dict[int, dict[str, Any]] = {ub["time"]: ub for ub in up_raw}
                bars_out = [dedup_up[t] for t in sorted(dedup_up.keys())][-limit:]
                source = str(ydata.get("source") or "market_history")
            elif up_raw:
                first_mt5 = mt5_bars[0]
                older = [ub for ub in up_raw if ub["time"] < first_mt5["time"]]
                if older:
                    seam_ref = older[-1]["close"]
                    delta = first_mt5["open"] - seam_ref
                    if seam_ref > 0 and abs(delta) / seam_ref < 0.05:
                        older = [
                            {
                                "time": ub["time"],
                                "open": round(ub["open"] + delta, 5),
                                "high": round(ub["high"] + delta, 5),
                                "low": round(ub["low"] + delta, 5),
                                "close": round(ub["close"] + delta, 5),
                                "volume": ub["volume"],
                            }
                            for ub in older
                        ]
                    merged_by_time: dict[int, dict[str, Any]] = {}
                    for ub in older:
                        merged_by_time[ub["time"]] = ub
                    for mb in mt5_bars:
                        merged_by_time[mb["time"]] = mb
                    bars_out = [merged_by_time[t] for t in sorted(merged_by_time.keys())][-limit:]
                    source = "mt5_merged"
        except Exception:
            source = "mt5_live" if mt5_bars else "unavailable"

    # Server-side 24h market statistics
    latency_ms = max(1, int(datetime.now(UTC).timestamp() * 1000) - t0_ms)
    now_sec = int(datetime.now(UTC).timestamp())
    cutoff_24h = now_sec - 86400
    bars_24h = [b for b in bars_out if int(b["time"]) >= cutoff_24h] or bars_out[-24:]
    last_price = float(bars_out[-1]["close"]) if bars_out else float(ydata_meta.get("price") or 0.0)
    open_24h = float(bars_24h[0]["open"]) if bars_24h else last_price
    high_24h = max((float(b["high"]) for b in bars_24h), default=last_price)
    low_24h = min((float(b["low"]) for b in bars_24h), default=last_price)
    vol_24h = sum(float(b.get("volume") or 0.0) for b in bars_24h)
    change_24h_pct = (
        round(((last_price - open_24h) / open_24h) * 100.0, 2)
        if open_24h > 0
        else float(ydata_meta.get("change_pct") or 0.0)
    )
    ob = market_ws_hub.get_latest_orderbook(code)
    spread_usd = 0.0
    spread_bps = 0.0
    if ob and ob.get("bids") and ob.get("asks"):
        bb = float(ob["bids"][0][0])
        ba = float(ob["asks"][0][0])
        if bb > 0 and ba >= bb:
            spread_usd = round(ba - bb, 5)
            spread_bps = round((spread_usd / ((ba + bb) / 2.0)) * 10_000.0, 2)
    elif last_price > 0:
        hs = _estimate_half_spread(code, last_price)
        spread_usd = round(hs * 2.0, 5)
        spread_bps = round((spread_usd / last_price) * 10_000.0, 2)

    market_stats = {
        "price": round(last_price, 5),
        "change_pct": change_24h_pct,
        "high_24h": round(high_24h, 5),
        "low_24h": round(low_24h, 5),
        "volume_24h": round(vol_24h, 2),
        "spread_usd": spread_usd,
        "spread_bps": spread_bps,
        "provider": provider if provider != "auto" else source,
        "latency_ms": latency_ms,
    }

    # 3. Accounts map
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    acc_map = {a.id: a for a in accounts}

    # 4. Live open positions across all broker symbol variants
    pos_stmt = select(OpenPositionLive).where(sql_symbol_match(OpenPositionLive.symbol, code, broker_syms))
    if account_id:
        pos_stmt = pos_stmt.where(OpenPositionLive.account_id == account_id)
    if magic_number is not None:
        pos_stmt = pos_stmt.where(OpenPositionLive.magic_number == magic_number)
    open_positions = (await db.execute(pos_stmt)).scalars().all()

    # 5. Historical entries & exits across all broker symbol variants
    deals_stmt = (
        select(Deal)
        .where(sql_symbol_match(Deal.symbol, code, broker_syms), Deal.deal_type.in_([0, 1]))
        .order_by(Deal.time_msc.desc())
        .limit(300)
    )
    if account_id:
        deals_stmt = deals_stmt.where(Deal.account_id == account_id)
    if magic_number is not None:
        deals_stmt = deals_stmt.where(Deal.magic_number == magic_number)
    deals = (await db.execute(deals_stmt)).scalars().all()

    # 6. Saved chart state for current user
    saved_state = (
        await db.execute(select(ChartState).where(ChartState.user_id == user.id, ChartState.symbol == code))
    ).scalar_one_or_none()

    return {
        "asset_code": code,
        "timeframe": timeframe,
        "source": source,
        "logo_url": asset.logo_url if asset and asset.logo_url else f"/api/v1/assets/logo/{code}",
        "symbols": symbols[:25],
        "bars": bars_out,
        "market_stats": market_stats,
        "chart_state": {
            "timeframe": saved_state.timeframe,
            "indicators_json": saved_state.indicators_json or {},
            "drawings_json": saved_state.drawings_json or [],
            "filters_json": saved_state.filters_json or {},
            "updated_at": saved_state.updated_at.isoformat() if saved_state.updated_at else None,
        }
        if saved_state
        else None,
        "open_positions": [
            {
                "position_ticket": p.position_ticket,
                "account_id": p.account_id,
                "account_name": acc_map[p.account_id].name if p.account_id in acc_map else "",
                "currency": acc_map[p.account_id].currency if p.account_id in acc_map else "USD",
                "magic_number": p.magic_number,
                "symbol": p.symbol,
                "side": p.side,
                "volume": p.volume,
                "open_price": p.open_price,
                "current_price": p.current_price,
                "sl": p.sl,
                "tp": p.tp,
                "profit_usd": p.profit_usd,
                "mae_usd": p.mae_usd,
                "mfe_usd": p.mfe_usd,
                "open_time": p.open_time,
            }
            for p in open_positions
        ],
        "deals": [
            {
                "id": d.id,
                "mt5_deal_ticket": d.mt5_deal_ticket,
                "account_id": d.account_id,
                "account_name": acc_map[d.account_id].name if d.account_id in acc_map else "",
                "currency": acc_map[d.account_id].currency if d.account_id in acc_map else "USD",
                "position_id": d.position_id,
                "magic_number": d.magic_number,
                "symbol": d.symbol,
                "side": "BUY" if d.deal_type == 0 else "SELL",
                "entry": "IN" if d.entry_type == 0 else "OUT" if d.entry_type == 1 else "INOUT",
                "volume": d.volume,
                "price": d.price,
                "net_profit_usd": d.net_profit_usd,
                "commission": d.commission,
                "swap": d.swap,
                "time_sec": d.time_msc // 1000,
                "comment": d.comment,
            }
            for d in deals
        ],
        "has_more": len(bars_out) >= 20,
        "mt5_zones_series": await get_zone_series(code, timeframe, db=db) if before is None else [],
    }


async def _authenticate_ws_and_portfolio(
    ws: WebSocket,
    db: AsyncSession,
    settings: Settings,
) -> dict[str, Any] | None:
    token = ws.cookies.get("ht_access_token") or ws.query_params.get("token")
    if not token:
        return None
    try:
        payload = decode_token(token, settings, expected_type="access")
    except jwt.PyJWTError:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    sid = payload.get("sid")
    if sid:
        session = await db.get(UserSession, sid)
        if not session or session.user_id != user_id or session.revoked:
            return None
        exp = session.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)
        if exp <= datetime.now(UTC):
            return None

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        return None

    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    open_positions = (await db.execute(select(OpenPositionLive))).scalars().all()
    robots = (await db.execute(select(Robot).where(Robot.is_active.is_(True)))).scalars().all()

    return {
        "total_balance_usd": round(sum(a.last_balance / (a.currency_divisor or 1.0) for a in accounts), 2),
        "total_equity_usd": round(sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts), 2),
        "total_floating_pnl_usd": round(sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts), 2),
        "accounts_count": len(accounts),
        "open_positions_count": len(open_positions),
        "active_robots_count": len(robots),
    }


async def _run_ws_session(
    ws: WebSocket,
    settings: Settings,
    *,
    channels: set[str] | None = None,
) -> None:
    db_override = ws.app.dependency_overrides.get(get_db)
    portfolio: dict[str, Any] | None = None
    if db_override is not None:
        gen = db_override()
        db = await anext(gen)
        try:
            portfolio = await _authenticate_ws_and_portfolio(ws, db, settings)
        finally:
            with contextlib.suppress(StopAsyncIteration):
                await anext(gen)
    else:
        factory = get_session_factory()
        async with factory() as db:
            portfolio = await _authenticate_ws_and_portfolio(ws, db, settings)

    if portfolio is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication required")
        return

    await ws_hub.connect(ws, send_welcome=True, portfolio=portfolio, channels=channels)
    heartbeat_task = asyncio.create_task(ws_hub.run_heartbeat_loop(ws, interval_sec=10.0))
    try:
        while True:
            raw = await ws.receive_text()
            await ws_hub.handle_client_message(ws, raw)
    except WebSocketDisconnect:
        pass
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        await ws_hub.disconnect(ws)


@router.websocket("/ws/live")
async def websocket_live(
    ws: WebSocket,
    settings: Settings = Depends(get_settings),
) -> None:
    """Authenticated live WebSocket stream with welcome, 10s heartbeat, ping/pong RTT, and Redis Pub/Sub."""
    await _run_ws_session(ws, settings, channels=None)


@router.websocket("/ws/account")
async def websocket_account(
    ws: WebSocket,
    settings: Settings = Depends(get_settings),
) -> None:
    """Dedicated account & MT5 robot telemetry WebSocket channel."""
    await _run_ws_session(ws, settings, channels={"account"})


@router.websocket("/ws/market")
async def websocket_market(
    ws: WebSocket,
    settings: Settings = Depends(get_settings),
) -> None:
    """Dedicated subscription-based market data WebSocket channel (direct market WS only, no MT5 bridge)."""
    await _run_ws_session(ws, settings, channels={"market"})


@router.websocket("/ws/news")
async def websocket_news(
    ws: WebSocket,
    settings: Settings = Depends(get_settings),
) -> None:
    """Dedicated real-time news & macro calendar WebSocket channel."""
    await _run_ws_session(ws, settings, channels={"news"})
