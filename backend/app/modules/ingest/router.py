from __future__ import annotations

import contextlib
import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import hash_api_key
from app.core.database import get_db, get_session_factory
from app.core.deps import verify_account_api_key
from app.core.market_ws_hub import market_ws_hub
from app.core.mt5_zones_store import record_zone_point
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
    sent_at_utc: str = ""
    sent_at_msc: int = 0


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
    seq: int = 0
    updated_at_utc: str = ""
    updated_at_msc: int = 0
    bid: float = 0.0
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
    seq: int = 0
    sent_at_utc: str = ""
    sent_at_msc: int = 0
    updated_at_utc: str = ""
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
    sent_at_msc: int = 0


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
    sent_at_msc: int = 0
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

    # 1. Process explicit robot_states (from ExnessPanelHook.mqh / ep_ipc / Bridge v2.33)
    snap_utc = body.updated_at_utc or body.sent_at_utc or now.isoformat()
    for rs in body.robot_states:
        ea_label = rs.ea_name or rs.program_name or str(rs.state_json.get("ea_name") or "")
        if "bridge" in ea_label.lower():
            continue
        sym = rs.symbol or str(rs.state_json.get("symbol") or body.symbol or "")
        enriched_state = dict(rs.state_json or {})
        eff_seq = rs.seq or body.seq or int(enriched_state.get("seq") or 0)
        eff_updated = rs.updated_at_utc or snap_utc or str(enriched_state.get("updated_at_utc") or now.isoformat())
        eff_bid = rs.bid or body.bid or float(enriched_state.get("bid") or 0.0)
        if eff_seq > 0:
            enriched_state["seq"] = eff_seq
        if eff_updated:
            enriched_state["updated_at_utc"] = eff_updated
        if rs.updated_at_msc > 0:
            enriched_state["updated_at_msc"] = rs.updated_at_msc
        if eff_bid > 0:
            enriched_state["bid"] = eff_bid
        robot = await _upsert_robot_telemetry(
            db,
            account,
            magic_number=rs.magic_number,
            ea_name=ea_label,
            symbol=sym,
            version=rs.version or str(enriched_state.get("version") or ""),
            status_str=rs.status,
            execution_ms=rs.execution_ms,
            state_json=enriched_state,
            now=now,
        )
        updated_robots.append(robot)
        seen_magics.add(rs.magic_number)

    # 2. Process sibling-chart EA discoveries reported by ExnessPanelBridge.mq5 (skip Bridge itself)
    for sea in body.sibling_eas:
        if "bridge" in (sea.ea_name or "").lower():
            continue
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
        r_state = robot.live_state_json or {}
        await ws_hub.broadcast(
            "robot_state",
            {
                "robot_id": robot.id,
                "account_id": account.id,
                "account_name": account.name,
                "account_login": account.mt5_login,
                "magic_number": robot.magic_number,
                "name": robot.name,
                "symbol": robot.symbol,
                "live_status": robot.live_status,
                "live_state_json": r_state,
                "seq": int(r_state.get("seq") or body.seq or 0),
                "updated_at_utc": str(r_state.get("updated_at_utc") or body.updated_at_utc or now.isoformat()),
                "last_execution_ms": robot.last_execution_ms,
                "last_heartbeat_at": now.isoformat(),
            },
        )
        raw_zones = r_state.get("zones")
        z_sell = z_mean = z_fair = z_buy = 0.0
        z_bar_time = 0
        if isinstance(raw_zones, dict):
            z_bar_time = int(raw_zones.get("bar_time") or 0)
            z_sell = float(raw_zones.get("sell") or 0.0)
            z_mean = float(raw_zones.get("mean") or 0.0)
            z_fair = float(raw_zones.get("fair") or 0.0)
            z_buy = float(raw_zones.get("buy") or 0.0)
        elif any(float(r_state.get(k) or 0.0) > 0 for k in ("bb_upper", "bb_mid", "bb_lower")):
            z_bar_time = (int(now.timestamp()) // 300) * 300
            z_sell = float(r_state.get("bb_upper") or 0.0)
            z_mean = float(r_state.get("bb_mid") or 0.0)
            z_fair = float(r_state.get("vwap") or z_mean or 0.0)
            z_buy = float(r_state.get("bb_lower") or 0.0)

        if z_bar_time > 0 and (z_sell > 0 or z_buy > 0 or z_mean > 0):
            z_tf = str(r_state.get("timeframe") or r_state.get("tf") or "M5")
            zone_evt = await record_zone_point(
                robot.symbol or body.symbol,
                z_tf,
                z_bar_time,
                z_sell,
                z_mean,
                z_fair,
                z_buy,
                db=db,
            )
            if zone_evt:
                await ws_hub.broadcast("mt5_zones.update", zone_evt)

    await db.commit()
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


class TickItem(BaseModel):
    time_msc: int = 0
    bid: float
    ask: float = 0.0


class TicksPayload(BaseModel):
    symbol: str
    sent_at_msc: int = 0
    ticks: list[TickItem] = Field(default_factory=list)


async def _process_mt5_ticks(symbol: str, ticks: list[TickItem]) -> int:
    raw_sym = symbol.strip().upper()
    canon_sym = canonical_asset_code(raw_sym) or raw_sym
    if not canon_sym or not ticks:
        return 0
    recorded = 0
    last_entry: dict[str, Any] | None = None
    for t in ticks[-80:]:
        if t.bid <= 0:
            continue
        eff_ask = t.ask if t.ask >= t.bid else t.bid
        entry = market_ws_hub.record_tick(
            canon_sym,
            t.bid,
            eff_ask,
            source="mt5_live",
            min_interval=0.0,
            ts_ms=t.time_msc if t.time_msc > 0 else None,
        )
        if entry:
            last_entry = entry
            recorded += 1
    if last_entry is not None:
        await ws_hub.broadcast("tick", {**last_entry, "raw_symbol": raw_sym})
    return recorded


@router.post("/ticks")
async def ingest_ticks(
    body: TicksPayload,
    _: TradingAccount = Depends(verify_account_api_key),
) -> dict[str, Any]:
    """Ingest sub-second / 1-second millisecond CopyTicks batches from ExnessPanelBridge.mq5."""
    recorded = await _process_mt5_ticks(body.symbol, body.ticks)
    return {"status": "ok", "recorded": recorded}


async def _auth_mt5_ws_account(ws: WebSocket, db: AsyncSession) -> TradingAccount | None:
    raw_key = ws.query_params.get("api_key") or ws.headers.get("x-account-api-key") or ""
    raw_key = raw_key.strip()
    if not raw_key:
        return None
    digest = hash_api_key(raw_key)
    return (
        await db.execute(
            select(TradingAccount).where(TradingAccount.api_key_hash == digest, TradingAccount.is_active.is_(True))
        )
    ).scalar_one_or_none()


@router.websocket("/ws")
async def ingest_ws_stream(ws: WebSocket) -> None:
    """Persistent real-time WebSocket stream for MT5 ExnessPanelBridge.mq5 v2.33 (wss://)."""
    db_override = ws.app.dependency_overrides.get(get_db)

    async def _with_db(fn: Any) -> Any:
        if db_override is not None:
            gen = db_override()
            session = await anext(gen)
            try:
                return await fn(session)
            finally:
                with contextlib.suppress(StopAsyncIteration):
                    await anext(gen)
        factory = get_session_factory()
        async with factory() as session:
            return await fn(session)

    account: TradingAccount | None = await _with_db(lambda db: _auth_mt5_ws_account(ws, db))
    if account is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid account API key")
        return

    acc_id = account.id
    await ws.accept()
    await ws.send_text(json.dumps({"type": "welcome", "account_id": acc_id, "bridge_min_ver": "2.33"}))

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue

            mtype = str(msg.get("type") or "")
            try:
                if mtype == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
                elif mtype == "tick":
                    sym = str(msg.get("symbol") or "")
                    bid = float(msg.get("bid") or 0.0)
                    ask = float(msg.get("ask") or bid)
                    tmsc = int(msg.get("time_msc") or 0)
                    if sym and bid > 0:
                        await _process_mt5_ticks(sym, [TickItem(time_msc=tmsc, bid=bid, ask=ask)])
                elif mtype == "ticks":
                    parsed = TicksPayload.model_validate(msg)
                    await _process_mt5_ticks(parsed.symbol, parsed.ticks)
                elif mtype == "snapshot":

                    async def _do_snap(db: AsyncSession, payload_dict: dict[str, Any] = msg) -> dict[str, Any]:
                        acc_row = await db.get(TradingAccount, acc_id)
                        if not acc_row:
                            return {"pending_commands": []}
                        snap_body = SnapshotPayload.model_validate(payload_dict)
                        return await ingest_snapshot(snap_body, acc_row, db)

                    snap_res = await _with_db(_do_snap)
                    cmds = snap_res.get("pending_commands") or []
                    if cmds:
                        await ws.send_text(json.dumps({"type": "commands", "pending_commands": cmds}))
                elif mtype == "bars":

                    async def _do_bars(db: AsyncSession, payload_dict: dict[str, Any] = msg) -> None:
                        acc_row = await db.get(TradingAccount, acc_id)
                        if acc_row:
                            bars_body = BarsPayload.model_validate(payload_dict)
                            await ingest_bars(bars_body, acc_row, db)

                    await _with_db(_do_bars)
                elif mtype == "trade_event":

                    async def _do_trade(db: AsyncSession, payload_dict: dict[str, Any] = msg) -> None:
                        acc_row = await db.get(TradingAccount, acc_id)
                        if acc_row:
                            ev_body = TradeEventPayload.model_validate(payload_dict)
                            await ingest_trade_event(ev_body, acc_row, db)

                    await _with_db(_do_trade)
                elif mtype == "bootstrap":

                    async def _do_boot(db: AsyncSession, payload_dict: dict[str, Any] = msg) -> dict[str, Any]:
                        acc_row = await db.get(TradingAccount, acc_id)
                        if not acc_row:
                            return {}
                        boot_body = BootstrapPayload.model_validate(payload_dict)
                        return await ingest_bootstrap(boot_body, acc_row, db)

                    boot_res = await _with_db(_do_boot)
                    await ws.send_text(json.dumps({"type": "bootstrap_ack", **boot_res}))
            except Exception as frame_exc:
                await ws.send_text(json.dumps({"type": "error", "frame": mtype, "detail": str(frame_exc)[:200]}))
    except WebSocketDisconnect:
        pass

