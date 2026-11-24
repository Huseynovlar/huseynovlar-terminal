from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.ws_hub import ws_hub
from app.db.models import AssetHub, Deal, MarketBar, OpenPositionLive, TradingAccount, User

router = APIRouter(tags=["charts"])


@router.get("/charts/{asset_code}")
async def get_asset_chart_bundle(
    asset_code: str,
    timeframe: str = Query(default="M5", pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$"),
    account_id: str | None = None,
    magic_number: int | None = None,
    limit: int = Query(default=300, ge=20, le=2000),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return OHLCV candles, live open positions (Entry/SL/TP), and historical entries/exits.

    Supports filtering across multiple USD and USC accounts trading the same asset.
    """
    code = asset_code.strip().upper()
    asset = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    symbols = [s.upper() for s in (asset.broker_symbols if asset and asset.broker_symbols else [code])]

    # 1. Candles
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

    # 2. Accounts linked to this asset (for USD / USC filter dropdown)
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    acc_map = {a.id: a for a in accounts}

    # 3. Live open positions (Entry / SL / TP overlays)
    pos_stmt = select(OpenPositionLive).where(OpenPositionLive.symbol.in_(symbols))
    if account_id:
        pos_stmt = pos_stmt.where(OpenPositionLive.account_id == account_id)
    if magic_number is not None:
        pos_stmt = pos_stmt.where(OpenPositionLive.magic_number == magic_number)
    open_positions = (await db.execute(pos_stmt)).scalars().all()

    # 4. Historical entries & exits (for on-chart markers + click-to-scroll order table)
    deals_stmt = select(Deal).where(Deal.symbol.in_(symbols)).order_by(Deal.time_msc.desc()).limit(250)
    if account_id:
        deals_stmt = deals_stmt.where(Deal.account_id == account_id)
    if magic_number is not None:
        deals_stmt = deals_stmt.where(Deal.magic_number == magic_number)
    deals = (await db.execute(deals_stmt)).scalars().all()

    return {
        "asset_code": code,
        "timeframe": timeframe,
        "symbols": symbols,
        "bars": [
            {
                "time": b.bar_time,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars_asc
        ],
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


@router.websocket("/ws/live")
async def websocket_live(ws: WebSocket) -> None:
    await ws_hub.connect(ws)
    try:
        while True:
            # Keep connection alive; clients may send lightweight ping frames
            await ws.receive_text()
    except WebSocketDisconnect:
        await ws_hub.disconnect(ws)
