from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import verify_account_api_key
from app.core.ws_hub import ws_hub
from app.db.models import (
    BalanceOperation,
    Deal,
    EquitySnapshot,
    MarketBar,
    OpenPositionLive,
    PendingCommand,
    TradingAccount,
)

router = APIRouter(prefix="/ingest", tags=["ingest"])

# MT5 ENUM_DEAL_TYPE values representing balance/treasury operations (not trading PnL)
BALANCE_DEAL_TYPES = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}


def _classify_balance_op(amount: float, comment: str) -> str:
    low = comment.lower()
    if "vault" in low or "хранилищ" in low:
        return "EXNESS_VAULT"
    if "transfer" in low or "internal" in low:
        return "INTERNAL_TRANSFER"
    if "rebate" in low or "bonus" in low or "credit" in low:
        return "REBATE"
    return "DEPOSIT" if amount >= 0 else "WITHDRAWAL"


class BootstrapPayload(BaseModel):
    mt5_login: str = ""
    mt5_server: str = ""
    currency: str = ""
    leverage: int = 0
    algo_trading_enabled: bool = False
    balance: float = 0.0
    equity: float = 0.0
    terminal_build: int = 0


class OpenPositionItem(BaseModel):
    position_ticket: int
    magic_number: int = 0
    symbol: str
    side: str
    volume: float
    open_price: float
    current_price: float
    sl: float = 0.0
    tp: float = 0.0
    swap: float = 0.0
    profit: float = 0.0
    mae: float = 0.0
    mfe: float = 0.0
    open_time: int = 0
    comment: str = ""


class RobotLiveStateItem(BaseModel):
    magic_number: int
    status: str = "RUNNING"
    execution_ms: int = 0
    state_json: dict[str, Any] = Field(default_factory=dict)


class SnapshotPayload(BaseModel):
    balance: float
    equity: float
    floating_pnl: float = 0.0
    margin: float = 0.0
    free_margin: float = 0.0
    margin_level: float = 0.0
    algo_trading_enabled: bool = False
    terminal_connected: bool = True
    ping_ms: int = 0
    symbol: str = ""
    bid: float = 0.0
    ask: float = 0.0
    spread_pts: int = 0
    open_positions: list[OpenPositionItem] = Field(default_factory=list)
    robot_states: list[RobotLiveStateItem] = Field(default_factory=list)


class TradeEventPayload(BaseModel):
    mt5_deal_ticket: int
    order_ticket: int = 0
    position_id: int = 0
    magic_number: int = 0
    symbol: str = ""
    deal_type: int = 0
    entry_type: int = 0
    volume: float = 0.0
    price: float = 0.0
    commission: float = 0.0
    swap: float = 0.0
    profit: float = 0.0
    fee: float = 0.0
    comment: str = ""
    time_msc: int = 0


class BarItem(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


class BarsPayload(BaseModel):
    symbol: str
    timeframe: str = Field(pattern="^(M1|M5|M15|M30|H1|H4|D1|W1)$")
    bars: list[BarItem] = Field(default_factory=list)


@router.post("/bootstrap")
async def ingest_bootstrap(
    body: BootstrapPayload,
    account: TradingAccount = Depends(verify_account_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account.last_seen_at = datetime.now(UTC)
    account.algo_trading_enabled = body.algo_trading_enabled
    if body.leverage > 0:
        account.leverage = body.leverage
    if body.balance:
        account.last_balance = body.balance
    if body.equity:
        account.last_equity = body.equity
    await db.commit()
    return {
        "account_id": account.id,
        "currency": account.currency,
        "currency_divisor": account.currency_divisor,
        "last_synced_deal_ticket": account.last_synced_deal_ticket,
    }


@router.post("/snapshot")
async def ingest_snapshot(
    body: SnapshotPayload,
    account: TradingAccount = Depends(verify_account_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from app.db.models import Robot

    now = datetime.now(UTC)
    div = account.currency_divisor or 1.0
    balance_usd = round(body.balance / div, 4)
    equity_usd = round(body.equity / div, 4)
    floating_usd = round(body.floating_pnl / div, 4)

    changed = (
        abs(account.last_equity - body.equity) > 1e-6
        or abs(account.last_balance - body.balance) > 1e-6
        or account.last_seen_at is None
        or (now - account.last_seen_at).total_seconds() >= 30
    )

    account.last_seen_at = now
    account.algo_trading_enabled = body.algo_trading_enabled
    account.terminal_connected = body.terminal_connected
    account.last_ping_ms = max(0, body.ping_ms)
    account.last_balance = body.balance
    account.last_equity = body.equity
    account.last_floating_pnl = body.floating_pnl
    account.last_margin_level = body.margin_level

    # Update live robot statuses reported by ExnessPanelHook.mqh / Bridge
    for rs in body.robot_states:
        robot = (
            await db.execute(select(Robot).where(Robot.account_id == account.id, Robot.magic_number == rs.magic_number))
        ).scalar_one_or_none()
        if robot:
            robot.live_status = rs.status[:64]
            robot.live_state_json = rs.state_json
            if rs.execution_ms > 0:
                robot.last_execution_ms = rs.execution_ms
            robot.last_heartbeat_at = now

    # Replace live open positions for this account atomically
    await db.execute(delete(OpenPositionLive).where(OpenPositionLive.account_id == account.id))
    for p in body.open_positions:
        db.add(
            OpenPositionLive(
                account_id=account.id,
                position_ticket=p.position_ticket,
                magic_number=p.magic_number,
                symbol=p.symbol.upper(),
                side=p.side.upper(),
                volume=p.volume,
                open_price=p.open_price,
                current_price=p.current_price,
                sl=p.sl,
                tp=p.tp,
                swap=p.swap,
                profit=p.profit,
                profit_usd=round((p.profit + p.swap) / div, 4),
                mae_usd=round(p.mae / div, 4),
                mfe_usd=round(p.mfe / div, 4),
                open_time=p.open_time,
                comment=p.comment,
                updated_at=now,
            )
        )

    if changed:
        db.add(
            EquitySnapshot(
                account_id=account.id,
                balance_usd=balance_usd,
                equity_usd=equity_usd,
                floating_pnl_usd=floating_usd,
                margin_level=body.margin_level,
                open_positions_count=len(body.open_positions),
                recorded_at=now,
            )
        )

    # Fetch and consume pending Kill-Switch commands (if any)
    cmds = (
        (
            await db.execute(
                select(PendingCommand).where(
                    PendingCommand.account_id == account.id, PendingCommand.consumed.is_(False)
                )
            )
        )
        .scalars()
        .all()
    )
    cmd_list = [{"id": c.id, "command": c.command, "payload": c.payload} for c in cmds]
    for c in cmds:
        c.consumed = True

    await db.commit()

    await ws_hub.broadcast(
        "snapshot",
        {
            "account_id": account.id,
            "currency": account.currency,
            "balance_usd": balance_usd,
            "equity_usd": equity_usd,
            "floating_pnl_usd": floating_usd,
            "margin_level": body.margin_level,
            "symbol": body.symbol.upper(),
            "bid": body.bid,
            "ask": body.ask,
            "spread_pts": body.spread_pts,
            "open_count": len(body.open_positions),
        },
    )
    return {"status": "ok", "pending_commands": cmd_list}


@router.post("/trade-event")
async def ingest_trade_event(
    body: TradeEventPayload,
    account: TradingAccount = Depends(verify_account_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    div = account.currency_divisor or 1.0

    # Separate balance/treasury/Vault operations from trading deals
    if body.deal_type in BALANCE_DEAL_TYPES or not body.symbol.strip():
        exists = (
            await db.execute(
                select(BalanceOperation).where(
                    BalanceOperation.account_id == account.id,
                    BalanceOperation.mt5_deal_ticket == body.mt5_deal_ticket,
                )
            )
        ).scalar_one_or_none()
        if exists:
            return {"status": "duplicate", "kind": "balance_operation"}

        op_kind = _classify_balance_op(body.profit, body.comment)
        db.add(
            BalanceOperation(
                account_id=account.id,
                mt5_deal_ticket=body.mt5_deal_ticket,
                op_kind=op_kind,
                amount=body.profit,
                amount_usd=round(body.profit / div, 4),
                comment=body.comment,
                time_msc=body.time_msc,
            )
        )
        if body.mt5_deal_ticket > account.last_synced_deal_ticket:
            account.last_synced_deal_ticket = body.mt5_deal_ticket
        await db.commit()
        return {"status": "recorded", "kind": "balance_operation", "op_kind": op_kind}

    # Trading deal — idempotent by (account_id, mt5_deal_ticket)
    exists_deal = (
        await db.execute(
            select(Deal).where(Deal.account_id == account.id, Deal.mt5_deal_ticket == body.mt5_deal_ticket)
        )
    ).scalar_one_or_none()
    if exists_deal:
        return {"status": "duplicate", "kind": "deal"}

    net_profit = body.profit + body.commission + body.swap + body.fee
    net_profit_usd = round(net_profit / div, 4)

    db.add(
        Deal(
            account_id=account.id,
            mt5_deal_ticket=body.mt5_deal_ticket,
            order_ticket=body.order_ticket,
            position_id=body.position_id,
            magic_number=body.magic_number,
            symbol=body.symbol.strip().upper(),
            deal_type=body.deal_type,
            entry_type=body.entry_type,
            volume=body.volume,
            price=body.price,
            commission=body.commission,
            swap=body.swap,
            profit=body.profit,
            fee=body.fee,
            net_profit=net_profit,
            net_profit_usd=net_profit_usd,
            comment=body.comment,
            time_msc=body.time_msc,
        )
    )
    if body.mt5_deal_ticket > account.last_synced_deal_ticket:
        account.last_synced_deal_ticket = body.mt5_deal_ticket
    await db.commit()

    await ws_hub.broadcast(
        "trade_event",
        {
            "account_id": account.id,
            "symbol": body.symbol.strip().upper(),
            "magic_number": body.magic_number,
            "entry_type": body.entry_type,
            "deal_type": body.deal_type,
            "volume": body.volume,
            "price": body.price,
            "net_profit_usd": net_profit_usd,
            "time_msc": body.time_msc,
        },
    )
    return {"status": "recorded", "kind": "deal", "net_profit_usd": net_profit_usd}


@router.post("/bars")
async def ingest_bars(
    body: BarsPayload,
    _: TradingAccount = Depends(verify_account_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    sym = body.symbol.strip().upper()
    upserted = 0
    for b in body.bars:
        existing = (
            await db.execute(
                select(MarketBar).where(
                    MarketBar.symbol == sym, MarketBar.timeframe == body.timeframe, MarketBar.bar_time == b.time
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.open = b.open
            existing.high = b.high
            existing.low = b.low
            existing.close = b.close
            existing.volume = b.volume
        else:
            db.add(
                MarketBar(
                    symbol=sym,
                    timeframe=body.timeframe,
                    bar_time=b.time,
                    open=b.open,
                    high=b.high,
                    low=b.low,
                    close=b.close,
                    volume=b.volume,
                )
            )
        upserted += 1
    await db.commit()
    return {"status": "ok", "upserted": upserted}
