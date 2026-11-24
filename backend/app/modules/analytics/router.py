from __future__ import annotations

import csv
import io
import math
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.db.models import BalanceOperation, Deal, EquitySnapshot, Robot, TradingAccount, User

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _compute_trade_stats(closed_deals: list[Deal]) -> dict[str, Any]:
    if not closed_deals:
        return {
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "win_rate_pct": 0.0,
            "gross_profit_usd": 0.0,
            "gross_loss_usd": 0.0,
            "total_commission_usd": 0.0,
            "total_swap_usd": 0.0,
            "net_pnl_usd": 0.0,
            "profit_factor": 0.0,
            "expectancy_usd": 0.0,
            "payoff_ratio": 0.0,
            "avg_win_usd": 0.0,
            "avg_loss_usd": 0.0,
            "max_consecutive_wins": 0,
            "max_consecutive_losses": 0,
            "max_drawdown_usd": 0.0,
            "max_drawdown_pct": 0.0,
            "recovery_factor": 0.0,
            "sharpe_ratio": 0.0,
            "total_lots": 0.0,
        }

    ordered = sorted(closed_deals, key=lambda d: d.time_msc)
    pnls = [d.net_profit_usd for d in ordered]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    net_pnl = sum(pnls)
    total_trades = len(pnls)
    win_rate = (len(wins) / total_trades) * 100.0 if total_trades else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (99.99 if gross_profit > 0 else 0.0)
    avg_win = (gross_profit / len(wins)) if wins else 0.0
    avg_loss = (gross_loss / len(losses)) if losses else 0.0
    payoff = (avg_win / avg_loss) if avg_loss > 0 else (99.99 if avg_win > 0 else 0.0)
    expectancy = net_pnl / total_trades if total_trades else 0.0

    # Consecutive streaks & cumulative drawdown
    max_consec_w = max_consec_l = cur_w = cur_l = 0
    cum = peak = max_dd_usd = 0.0
    for p in pnls:
        if p > 0:
            cur_w += 1
            cur_l = 0
            max_consec_w = max(max_consec_w, cur_w)
        elif p < 0:
            cur_l += 1
            cur_w = 0
            max_consec_l = max(max_consec_l, cur_l)
        cum += p
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd_usd:
            max_dd_usd = dd

    max_dd_pct = (max_dd_usd / peak * 100.0) if peak > 0 else 0.0
    recovery_factor = (net_pnl / max_dd_usd) if max_dd_usd > 0 else (99.99 if net_pnl > 0 else 0.0)

    # Trade-level Sharpe approximation
    mean_p = net_pnl / total_trades
    variance = sum((p - mean_p) ** 2 for p in pnls) / total_trades if total_trades > 1 else 0.0
    std_p = math.sqrt(variance)
    sharpe = (mean_p / std_p) * math.sqrt(total_trades) if std_p > 0 else 0.0

    # Account-level commission/swap approximation in USD (proportional to net_profit_usd ratio if non-zero)
    total_lots = sum(d.volume for d in ordered)
    total_comm = sum(d.commission for d in ordered)
    total_swap = sum(d.swap for d in ordered)

    return {
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(win_rate, 2),
        "gross_profit_usd": round(gross_profit, 2),
        "gross_loss_usd": round(gross_loss, 2),
        "total_commission_usd": round(total_comm, 2),
        "total_swap_usd": round(total_swap, 2),
        "net_pnl_usd": round(net_pnl, 2),
        "profit_factor": round(profit_factor, 2),
        "expectancy_usd": round(expectancy, 2),
        "payoff_ratio": round(payoff, 2),
        "avg_win_usd": round(avg_win, 2),
        "avg_loss_usd": round(avg_loss, 2),
        "max_consecutive_wins": max_consec_w,
        "max_consecutive_losses": max_consec_l,
        "max_drawdown_usd": round(max_dd_usd, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "recovery_factor": round(recovery_factor, 2),
        "sharpe_ratio": round(sharpe, 2),
        "total_lots": round(total_lots, 2),
    }


@router.get("/overview")
async def get_analytics_overview(
    account_id: str | None = None,
    symbol: str | None = None,
    days: int = Query(default=90, ge=1, le=3650),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Comprehensive institutional analytics across all Exness USD & USC accounts, assets, and robots."""
    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    if account_id:
        accounts = [a for a in accounts if a.id == account_id]
    acc_map = {a.id: a for a in accounts}

    cutoff_msc = int((datetime.now(UTC) - timedelta(days=days)).timestamp() * 1000)
    deal_stmt = select(Deal).where(Deal.entry_type.in_([1, 2]), Deal.time_msc >= cutoff_msc)
    if account_id:
        deal_stmt = deal_stmt.where(Deal.account_id == account_id)
    if symbol:
        deal_stmt = deal_stmt.where(Deal.symbol.ilike(f"%{symbol.strip()}%"))
    closed_deals = (await db.execute(deal_stmt)).scalars().all()

    robots = (await db.execute(select(Robot))).scalars().all()
    robot_map = {(r.account_id, r.magic_number): r.name for r in robots}

    # Portfolio totals (all normalized to USD using account currency_divisor)
    total_balance_usd = sum(a.last_balance / (a.currency_divisor or 1.0) for a in accounts)
    total_equity_usd = sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts)
    total_floating_usd = sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts)

    stats = _compute_trade_stats(list(closed_deals))

    # Daily Calendar Heatmap & Hourly Performance Heatmap
    daily_map: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"net_pnl_usd": 0.0, "trades": 0, "wins": 0, "losses": 0}
    )
    hourly_map: dict[int, dict[str, Any]] = {h: {"hour": h, "net_pnl_usd": 0.0, "trades": 0} for h in range(24)}
    by_symbol: dict[str, list[Deal]] = defaultdict(list)
    by_account: dict[str, list[Deal]] = defaultdict(list)
    by_robot: dict[tuple[str, int], list[Deal]] = defaultdict(list)

    for d in closed_deals:
        dt = datetime.fromtimestamp(d.time_msc / 1000, tz=UTC)
        day_key = dt.strftime("%Y-%m-%d")
        daily_map[day_key]["net_pnl_usd"] = round(daily_map[day_key]["net_pnl_usd"] + d.net_profit_usd, 2)
        daily_map[day_key]["trades"] += 1
        if d.net_profit_usd > 0:
            daily_map[day_key]["wins"] += 1
        elif d.net_profit_usd < 0:
            daily_map[day_key]["losses"] += 1

        hourly_map[dt.hour]["net_pnl_usd"] = round(hourly_map[dt.hour]["net_pnl_usd"] + d.net_profit_usd, 2)
        hourly_map[dt.hour]["trades"] += 1

        by_symbol[d.symbol].append(d)
        by_account[d.account_id].append(d)
        by_robot[(d.account_id, d.magic_number)].append(d)

    # Cumulative Equity & Underwater Drawdown curve from closed deals
    ordered = sorted(closed_deals, key=lambda d: d.time_msc)
    equity_curve: list[dict[str, Any]] = []
    cum = peak = 0.0
    for d in ordered:
        cum += d.net_profit_usd
        peak = max(peak, cum)
        dd = round(cum - peak, 2)  # <= 0 for underwater chart
        equity_curve.append(
            {
                "time_sec": d.time_msc // 1000,
                "date": datetime.fromtimestamp(d.time_msc / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M"),
                "cum_pnl_usd": round(cum, 2),
                "drawdown_usd": dd,
            }
        )

    # Recent snapshots count for liveness indicator
    snap_count = len((await db.execute(select(EquitySnapshot.id).limit(500))).scalars().all())

    return {
        "portfolio": {
            "total_balance_usd": round(total_balance_usd, 2),
            "total_equity_usd": round(total_equity_usd, 2),
            "total_floating_pnl_usd": round(total_floating_usd, 2),
            "accounts_count": len(accounts),
            "snapshots_recorded": snap_count,
        },
        "metrics": stats,
        "equity_curve": equity_curve,
        "daily_calendar": [{"date": k, **v} for k, v in sorted(daily_map.items())],
        "hourly_heatmap": [hourly_map[h] for h in range(24)],
        "by_symbol": [{"symbol": sym, **_compute_trade_stats(items)} for sym, items in sorted(by_symbol.items())],
        "by_account": [
            {
                "account_id": aid,
                "account_name": acc_map[aid].name if aid in acc_map else aid,
                "currency": acc_map[aid].currency if aid in acc_map else "USD",
                **_compute_trade_stats(items),
            }
            for aid, items in by_account.items()
        ],
        "by_robot": [
            {
                "account_id": aid,
                "magic_number": magic,
                "robot_name": robot_map.get((aid, magic), f"Magic #{magic}"),
                **_compute_trade_stats(items),
            }
            for (aid, magic), items in by_robot.items()
        ],
    }


@router.get("/treasury")
async def get_treasury_report(
    account_id: str | None = None,
    vault_target_usd: float = Query(default=500.0, gt=0),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Exness Treasury & Vault Ledger — separates deposits, withdrawals, internal transfers, and Exness Vault."""
    acc_stmt = select(TradingAccount)
    if account_id:
        acc_stmt = acc_stmt.where(TradingAccount.id == account_id)
    accounts = (await db.execute(acc_stmt)).scalars().all()
    acc_map = {a.id: a for a in accounts}

    op_stmt = select(BalanceOperation).order_by(BalanceOperation.time_msc.desc())
    if account_id:
        op_stmt = op_stmt.where(BalanceOperation.account_id == account_id)
    ops = (await db.execute(op_stmt)).scalars().all()

    deal_stmt = select(Deal).where(Deal.entry_type.in_([1, 2]))
    if account_id:
        deal_stmt = deal_stmt.where(Deal.account_id == account_id)
    deals = (await db.execute(deal_stmt)).scalars().all()

    total_deposited = sum(o.amount_usd for o in ops if o.op_kind == "DEPOSIT" and o.amount_usd > 0)
    total_withdrawn = abs(sum(o.amount_usd for o in ops if o.op_kind == "WITHDRAWAL" and o.amount_usd < 0))
    total_vault = abs(sum(o.amount_usd for o in ops if o.op_kind == "EXNESS_VAULT" and o.amount_usd < 0))
    total_rebates = sum(o.amount_usd for o in ops if o.op_kind == "REBATE")
    working_capital = sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts)
    realized_profit = sum(d.net_profit_usd for d in deals)
    profit_ready = max(0.0, realized_profit - total_vault - total_withdrawn)

    return {
        "summary": {
            "working_capital_usd": round(working_capital, 2),
            "total_deposited_usd": round(total_deposited, 2),
            "total_withdrawn_usd": round(total_withdrawn, 2),
            "total_vault_usd": round(total_vault, 2),
            "total_rebates_usd": round(total_rebates, 2),
            "realized_trading_profit_usd": round(realized_profit, 2),
            "profit_ready_for_vault_usd": round(profit_ready, 2),
            "vault_target_usd": vault_target_usd,
            "vault_target_reached": profit_ready >= vault_target_usd,
        },
        "operations": [
            {
                "id": o.id,
                "account_id": o.account_id,
                "account_name": acc_map[o.account_id].name if o.account_id in acc_map else "",
                "currency": acc_map[o.account_id].currency if o.account_id in acc_map else "USD",
                "mt5_deal_ticket": o.mt5_deal_ticket,
                "op_kind": o.op_kind,
                "amount": o.amount,
                "amount_usd": round(o.amount_usd, 2),
                "comment": o.comment,
                "timestamp": datetime.fromtimestamp(o.time_msc / 1000, tz=UTC).isoformat(),
            }
            for o in ops
        ],
    }


@router.get("/statement.csv")
async def export_full_exness_statement_csv(
    account_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Export full Excel-compatible Exness statement (UTF-8 BOM CSV)."""
    accounts = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    stmt = select(Deal).order_by(Deal.time_msc.desc())
    if account_id:
        stmt = stmt.where(Deal.account_id == account_id)
    deals = (await db.execute(stmt)).scalars().all()

    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM for clean Excel opening
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Timestamp (UTC)",
            "Account",
            "Currency",
            "MT5 Deal Ticket",
            "Position ID",
            "MagicNumber",
            "Symbol",
            "Side",
            "Entry",
            "Volume",
            "Price",
            "Gross Profit (Native)",
            "Commission (Native)",
            "Swap (Native)",
            "Net Profit (USD)",
            "Comment",
        ]
    )
    for d in deals:
        acc = accounts.get(d.account_id)
        writer.writerow(
            [
                datetime.fromtimestamp(d.time_msc / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M:%S"),
                acc.name if acc else d.account_id,
                acc.currency if acc else "USD",
                d.mt5_deal_ticket,
                d.position_id,
                d.magic_number,
                d.symbol,
                "BUY" if d.deal_type == 0 else "SELL",
                "IN" if d.entry_type == 0 else "OUT" if d.entry_type == 1 else "INOUT",
                d.volume,
                d.price,
                d.profit,
                d.commission,
                d.swap,
                round(d.net_profit_usd, 2),
                d.comment,
            ]
        )

    buf.seek(0)
    filename = f"exness_statement_{datetime.now(UTC).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
