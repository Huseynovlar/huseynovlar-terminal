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

from app.core.config import Settings, get_settings
from app.core.database import get_db, get_session_factory
from app.core.deps import get_current_user
from app.core.security import decode_token
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
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "VIX": "^VIX",
    "USOIL": "CL=F",
    "WTI": "CL=F",
    "UKOIL": "BZ=F",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "NZDUSD": "NZDUSD=X",
    "BTCUSD": "BTC-USD",
    "ETHUSD": "ETH-USD",
    "SOLUSD": "SOL-USD",
}

_TF_TO_YAHOO: dict[str, tuple[str, str]] = {
    "M1": ("1m", "1d"),
    "M5": ("5m", "5d"),
    "M15": ("15m", "5d"),
    "M30": ("30m", "1mo"),
    "H1": ("60m", "1mo"),
    "H4": ("60m", "3mo"),
    "D1": ("1d", "1y"),
    "W1": ("1wk", "5y"),
}

_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}


class ChartStateUpsert(BaseModel):
    timeframe: str = Field(default="H1", pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$")
    indicators_json: dict[str, Any] = Field(default_factory=dict)
    drawings_json: list[dict[str, Any]] = Field(default_factory=list)
    filters_json: dict[str, Any] = Field(default_factory=dict)


async def fetch_yahoo_chart(symbol: str, timeframe: str = "H1") -> dict[str, Any]:
    clean = symbol.strip().upper().replace(" ", "")
    yahoo_sym = _YAHOO_SYMBOL_ALIASES.get(clean, clean)
    interval, range_str = _TF_TO_YAHOO.get(timeframe, ("60m", "1mo"))

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}"
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as http:
        resp = await http.get(url, params={"interval": interval, "range": range_str}, headers=_YAHOO_HEADERS)
        resp.raise_for_status()
        payload = resp.json()

    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        raise ValueError(f"Symbol '{clean}' not found")

    res = results[0]
    meta = res.get("meta") or {}
    timestamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    bars: list[dict[str, Any]] = []
    for idx, ts in enumerate(timestamps):
        if idx >= len(closes) or opens[idx] is None or closes[idx] is None or highs[idx] is None or lows[idx] is None:
            continue
        bars.append(
            {
                "time": int(ts),
                "open": float(opens[idx]),
                "high": float(highs[idx]),
                "low": float(lows[idx]),
                "close": float(closes[idx]),
                "volume": float(volumes[idx] or 0) if idx < len(volumes) else 0.0,
            }
        )

    reg_price = float(meta.get("regularMarketPrice") or (bars[-1]["close"] if bars else 0.0))
    prev_close = float(meta.get("chartPreviousClose") or meta.get("previousClose") or reg_price or 1.0)
    change_pct = round(((reg_price - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0

    return {
        "asset_code": clean,
        "yahoo_symbol": yahoo_sym,
        "name": meta.get("longName") or meta.get("shortName") or clean,
        "currency": meta.get("currency") or "USD",
        "price": round(reg_price, 4),
        "change_pct": change_pct,
        "timeframe": timeframe,
        "logo_url": f"/api/v1/assets/logo/{clean}",
        "bars": bars[-500:],
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

    quotes: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=7.0, follow_redirects=True) as http:
        for item in symbols_cfg:
            code = str(item.get("code", "")).upper()
            yahoo_sym = str(item.get("yahoo", code))
            label = str(item.get("label", code))
            price: float | None = None
            change_pct: float = 0.0
            live = False
            try:
                resp = await http.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}",
                    params={"interval": "1d", "range": "5d"},
                    headers=_YAHOO_HEADERS,
                )
                resp.raise_for_status()
                res_list = ((resp.json().get("chart") or {}).get("result")) or []
                if res_list:
                    meta = res_list[0].get("meta") or {}
                    reg = meta.get("regularMarketPrice")
                    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                    if reg is not None:
                        price = round(float(reg), 4)
                        if prev:
                            change_pct = round(((float(reg) - float(prev)) / float(prev)) * 100.0, 2)
                        live = True
            except Exception:
                pass
            quotes.append(
                {
                    "code": code,
                    "yahoo_symbol": yahoo_sym,
                    "label": label,
                    "price": price,
                    "change_pct": change_pct,
                    "live": live,
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
                for item in (resp.json().get("quotes") or []):
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
    limit: int = Query(default=300, ge=20, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return OHLCV candles (MT5 DB with Yahoo Finance fallback), live open positions, deals, and saved chart state."""
    code = asset_code.strip().upper()
    asset = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    symbols = [s.upper() for s in (asset.broker_symbols if asset and asset.broker_symbols else [code])]

    # 1. Candles from MT5 DB
    bars = (
        (
            await db.execute(
                select(MarketBar)
                .where(MarketBar.symbol.in_(symbols), MarketBar.timeframe == timeframe)
                .order_by(MarketBar.bar_time.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    bars_asc = list(reversed(bars))
    bars_out = [
        {
            "time": b.bar_time,
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": b.volume,
        }
        for b in bars_asc
    ]
    source = "mt5_db"
    if not bars_out:
        try:
            ydata = await fetch_yahoo_chart(code, timeframe)
            bars_out = ydata["bars"][-limit:]
            source = "yahoo_fallback"
        except Exception:
            source = "mt5_db"

    # 2. Accounts linked to this asset
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    acc_map = {a.id: a for a in accounts}

    # 3. Live open positions
    pos_stmt = select(OpenPositionLive).where(OpenPositionLive.symbol.in_(symbols))
    if account_id:
        pos_stmt = pos_stmt.where(OpenPositionLive.account_id == account_id)
    if magic_number is not None:
        pos_stmt = pos_stmt.where(OpenPositionLive.magic_number == magic_number)
    open_positions = (await db.execute(pos_stmt)).scalars().all()

    # 4. Historical entries & exits
    deals_stmt = select(Deal).where(Deal.symbol.in_(symbols)).order_by(Deal.time_msc.desc()).limit(250)
    if account_id:
        deals_stmt = deals_stmt.where(Deal.account_id == account_id)
    if magic_number is not None:
        deals_stmt = deals_stmt.where(Deal.magic_number == magic_number)
    deals = (await db.execute(deals_stmt)).scalars().all()

    # 5. Saved chart state for current user
    saved_state = (
        await db.execute(select(ChartState).where(ChartState.user_id == user.id, ChartState.symbol == code))
    ).scalar_one_or_none()

    return {
        "asset_code": code,
        "timeframe": timeframe,
        "source": source,
        "logo_url": asset.logo_url if asset and asset.logo_url else f"/api/v1/assets/logo/{code}",
        "symbols": symbols,
        "bars": bars_out,
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


@router.websocket("/ws/live")
async def websocket_live(
    ws: WebSocket,
    settings: Settings = Depends(get_settings),
) -> None:
    """Authenticated live WebSocket stream with welcome, 10s heartbeat, ping/pong RTT, and Redis Pub/Sub."""
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

    await ws_hub.connect(ws, send_welcome=True, portfolio=portfolio)
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
