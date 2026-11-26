from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import verify_account_api_key
from app.core.market_ws_hub import market_ws_hub
from app.core.symbols import canonical_asset_code
from app.core.ws_hub import ws_hub
from app.db.models import (
    AssetHub,
    BalanceOperation,
    Deal,
    EquitySnapshot,
    MarketBar,
    OpenPositionLive,
    PendingCommand,
    Robot,
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


async def _resolve_asset_id_for_symbol(db: AsyncSession, raw_symbol: str) -> str | None:
    canon = canonical_asset_code(raw_symbol)
    if not canon:
        return None
    hub = (await db.execute(select(AssetHub).where(AssetHub.code == canon))).scalar_one_or_none()
    return hub.id if hub else None


async def _upsert_robot_telemetry(
    db: AsyncSession,
    account: TradingAccount,
    *,
    magic_number: int,
    ea_name: str = "",
    symbol: str = "",
    version: str = "",
    status_str: str = "RUNNING",
    execution_ms: int = 0,
    state_json: dict[str, Any] | None = None,
    now: datetime,
) -> Robot:
    robot = (
        await db.execute(select(Robot).where(Robot.account_id == account.id, Robot.magic_number == magic_number))
    ).scalar_one_or_none()
    clean_ea = ea_name.strip()
    clean_sym = symbol.strip().upper()
    matched_asset_id = await _resolve_asset_id_for_symbol(db, clean_sym) if clean_sym else None
    if account.primary_asset_id is None and matched_asset_id is not None:
        account.primary_asset_id = matched_asset_id

    if robot is None:
        robot = Robot(
            account_id=account.id,
            asset_id=matched_asset_id or account.primary_asset_id,
            magic_number=magic_number,
            name=clean_ea or f"EA #{magic_number}",
            symbol=clean_sym,
            program_name=clean_ea,
            version=version.strip() or "auto",
            strategy_notes="Auto-discovered via MT5 bridge telemetry",
            live_status=status_str[:64],
            live_state_json=state_json or {},
            last_execution_ms=max(0, execution_ms),
            last_heartbeat_at=now,
            is_active=True,
        )
        db.add(robot)
        await db.flush()
    else:
        robot.live_status = status_str[:64]
        if state_json:
            merged = dict(robot.live_state_json or {})
            merged.update(state_json)
            robot.live_state_json = merged
        if clean_ea and not robot.program_name:
            robot.program_name = clean_ea
        if clean_sym and not robot.symbol:
            robot.symbol = clean_sym
        if robot.asset_id is None and matched_asset_id is not None:
            robot.asset_id = matched_asset_id
        if version.strip() and robot.version in ("", "1.0", "auto"):
            robot.version = version.strip()
        if execution_ms > 0:
            robot.last_execution_ms = execution_ms
        robot.last_heartbeat_at = now
    return robot


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
    magic_number: int = Field(ge=0)
    ea_name: str = ""
    program_name: str = ""
    symbol: str = ""
    version: str = ""
    status: str = "RUNNING"
    execution_ms: int = 0
    state_json: dict[str, Any] = Field(default_factory=dict)


class SiblingChartEA(BaseModel):
    chart_id: int = 0
    symbol: str = ""
    timeframe: str = ""
    ea_name: str = ""
    magic_number: int = 0
    status: str = "ATTACHED"


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
    sibling_eas: list[SiblingChartEA] = Field(default_factory=list)


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
    ea_name: str = ""
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
    account.terminal_connected = True
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
    now = datetime.now(UTC)
    div = account.currency_divisor or 1.0
    balance_usd = round(body.balance / div, 4)
    equity_usd = round(body.equity / div, 4)
    floating_usd = round(body.floating_pnl / div, 4)

    last_seen = account.last_seen_at
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=UTC)

    changed = (
        abs(account.last_equity - body.equity) > 1e-6
        or abs(account.last_balance - body.balance) > 1e-6
        or last_seen is None
        or (now - last_seen).total_seconds() >= 30
    )

    account.last_seen_at = now
    account.algo_trading_enabled = body.algo_trading_enabled
    account.terminal_connected = body.terminal_connected
    account.last_ping_ms = max(0, body.ping_ms)
    account.last_balance = body.balance
    account.last_equity = body.equity
    account.last_floating_pnl = body.floating_pnl
    account.last_margin_level = body.margin_level

    updated_robots: list[Robot] = []
    seen_magics: set[int] = set()

    # 1. Process explicit robot_states (from ExnessPanelHook.mqh / ep_ipc / Bridge)
    for rs in body.robot_states:
        ea_label = rs.ea_name or rs.program_name or str(rs.state_json.get("ea_name") or "")
        sym = rs.symbol or str(rs.state_json.get("symbol") or body.symbol or "")
        robot = await _upsert_robot_telemetry(
            db,
            account,
            magic_number=rs.magic_number,
            ea_name=ea_label,
            symbol=sym,
            version=rs.version or str(rs.state_json.get("version") or ""),
            status_str=rs.status,
            execution_ms=rs.execution_ms,
            state_json=rs.state_json,
            now=now,
        )
        updated_robots.append(robot)
        seen_magics.add(rs.magic_number)

    # 2. Process sibling-chart EA discoveries reported by ExnessPanelBridge.mq5
    for sea in body.sibling_eas:
        if sea.magic_number > 0 and sea.magic_number not in seen_magics:
            robot = await _upsert_robot_telemetry(
                db,
                account,
                magic_number=sea.magic_number,
                ea_name=sea.ea_name,
                symbol=sea.symbol or body.symbol,
                status_str=sea.status or "ATTACHED",
                state_json={
                    "chart_id": sea.chart_id,
                    "timeframe": sea.timeframe,
                    "discovery_source": "sibling_chart",
                },
                now=now,
            )
            updated_robots.append(robot)
            seen_magics.add(sea.magic_number)

    # 3. Replace live open positions for this account atomically & auto-discover active magic numbers
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
        if p.magic_number > 0 and p.magic_number not in seen_magics:
            robot = await _upsert_robot_telemetry(
                db,
                account,
                magic_number=p.magic_number,
                ea_name=p.comment if p.comment and len(p.comment) <= 64 else "",
                symbol=p.symbol,
                status_str="ACTIVE_POSITION",
                state_json={"discovery_source": "open_position"},
                now=now,
            )
            updated_robots.append(robot)
            seen_magics.add(p.magic_number)

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
            "mt5_login": account.mt5_login,
            "account_name": account.name,
            "currency": account.currency,
            "balance_usd": balance_usd,
            "equity_usd": equity_usd,
            "floating_pnl_usd": floating_usd,
            "margin_level": body.margin_level,
            "algo_trading_enabled": body.algo_trading_enabled,
            "terminal_connected": body.terminal_connected,
            "ping_ms": max(0, body.ping_ms),
            "symbol": body.symbol.upper(),
            "bid": body.bid,
            "ask": body.ask,
            "spread_pts": body.spread_pts,
            "open_count": len(body.open_positions),
            "ts": now.isoformat(),
        },
    )

    if body.symbol.strip() and body.bid > 0:
        canon_sym = canonical_asset_code(body.symbol) or body.symbol.strip().upper()
        eff_ask = body.ask if body.ask > 0 else body.bid
        market_ws_hub.record_tick(canon_sym, body.bid, eff_ask, source="mt5_live", min_interval=0.15)
        await ws_hub.broadcast(
            "tick",
            {
                "symbol": canon_sym,
                "raw_symbol": body.symbol.strip().upper(),
                "bid": body.bid,
                "ask": eff_ask,
                "price": round((body.bid + eff_ask) / 2.0, 5),
                "spread_pts": body.spread_pts,
                "source": "mt5_live",
            },
        )

    for robot in updated_robots:
        await ws_hub.broadcast(
            "robot_state",
            {
                "robot_id": robot.id,
                "account_id": account.id,
                "magic_number": robot.magic_number,
                "name": robot.name,
                "symbol": robot.symbol,
                "live_status": robot.live_status,
                "live_state_json": robot.live_state_json or {},
                "last_execution_ms": robot.last_execution_ms,
                "last_heartbeat_at": now.isoformat(),
            },
        )

    return {"status": "ok", "pending_commands": cmd_list, "robots_updated": len(updated_robots)}


@router.post("/trade-event")
async def ingest_trade_event(
    body: TradeEventPayload,
    account: TradingAccount = Depends(verify_account_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    div = account.currency_divisor or 1.0
    now = datetime.now(UTC)

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
        amount_usd = round(body.profit / div, 4)
        db.add(
            BalanceOperation(
                account_id=account.id,
                mt5_deal_ticket=body.mt5_deal_ticket,
                op_kind=op_kind,
                amount=body.profit,
                amount_usd=amount_usd,
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
                "kind": "balance_operation",
                "account_id": account.id,
                "op_kind": op_kind,
                "amount_usd": amount_usd,
                "time_msc": body.time_msc,
            },
        )
        return {"status": "recorded", "kind": "balance_operation", "op_kind": op_kind}

    # Trading deal — idempotent by (account_id, mt5_deal_ticket)
    exists_deal = (
        await db.execute(
            select(Deal).where(Deal.account_id == account.id, Deal.mt5_deal_ticket == body.mt5_deal_ticket)
        )
    ).scalar_one_or_none()
    if exists_deal:
        return {"status": "duplicate", "kind": "deal"}

    sym = body.symbol.strip().upper()
    net_profit = body.profit + body.commission + body.swap + body.fee
    net_profit_usd = round(net_profit / div, 4)

    db.add(
        Deal(
            account_id=account.id,
            mt5_deal_ticket=body.mt5_deal_ticket,
            order_ticket=body.order_ticket,
            position_id=body.position_id,
            magic_number=body.magic_number,
            symbol=sym,
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

    if body.magic_number > 0:
        await _upsert_robot_telemetry(
            db,
            account,
            magic_number=body.magic_number,
            ea_name=body.ea_name,
            symbol=sym,
            status_str="TRADING",
            state_json={"last_deal_ticket": body.mt5_deal_ticket, "discovery_source": "trade_event"},
            now=now,
        )

    if body.mt5_deal_ticket > account.last_synced_deal_ticket:
        account.last_synced_deal_ticket = body.mt5_deal_ticket
    await db.commit()

    await ws_hub.broadcast(
        "trade_event",
        {
            "kind": "deal",
            "account_id": account.id,
            "symbol": sym,
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
    latest_bar: BarItem | None = None
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
        if latest_bar is None or b.time >= latest_bar.time:
            latest_bar = b
        upserted += 1
    await db.commit()

    if latest_bar is not None:
        bar_dict = {
            "time": latest_bar.time,
            "open": latest_bar.open,
            "high": latest_bar.high,
            "low": latest_bar.low,
            "close": latest_bar.close,
            "volume": latest_bar.volume,
        }
        await ws_hub.broadcast(
            "bar_update",
            {
                "symbol": canonical_asset_code(sym) or sym,
                "raw_symbol": sym,
                "timeframe": body.timeframe,
                **bar_dict,
                "bar": bar_dict,
            },
        )
    return {"status": "ok", "upserted": upserted}
