from __future__ import annotations

import csv
import html
import io
import math
import re
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.core.symbols import sql_symbol_match
from app.db.models import (
    AssetHub,
    BalanceOperation,
    Deal,
    EconomicEvent,
    EquitySnapshot,
    MarketCache,
    NewsItem,
    OpenPositionLive,
    Robot,
    TradingAccount,
    User,
)

router = APIRouter(tags=["analytics"])


def _deal_divisor(deal: Deal, acc_map: dict[str, TradingAccount]) -> float:
    acc = acc_map.get(deal.account_id)
    if acc and acc.currency_divisor and acc.currency_divisor > 0:
        return float(acc.currency_divisor)
    return 1.0


def _deal_net_usd(deal: Deal, acc_map: dict[str, TradingAccount]) -> float:
    div = _deal_divisor(deal, acc_map)
    if deal.net_profit_usd != 0.0:
        return float(deal.net_profit_usd)
    return (deal.profit + deal.commission + deal.swap + deal.fee) / div


def _compute_trade_stats(closed_deals: list[Deal], acc_map: dict[str, TradingAccount]) -> dict[str, Any]:
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
            "total_fee_usd": 0.0,
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
    pnls = [_deal_net_usd(d, acc_map) for d in ordered]
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

    mean_p = net_pnl / total_trades
    variance = sum((p - mean_p) ** 2 for p in pnls) / total_trades if total_trades > 1 else 0.0
    std_p = math.sqrt(variance)
    sharpe = (mean_p / std_p) * math.sqrt(total_trades) if std_p > 0 else 0.0

    # CRITICAL USC FIX: normalize commission, swap, and fee by account currency_divisor (100.0 for USC)
    total_lots = sum(d.volume for d in ordered)
    total_comm_usd = sum(d.commission / _deal_divisor(d, acc_map) for d in ordered)
    total_swap_usd = sum(d.swap / _deal_divisor(d, acc_map) for d in ordered)
    total_fee_usd = sum(d.fee / _deal_divisor(d, acc_map) for d in ordered)

    return {
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(win_rate, 2),
        "gross_profit_usd": round(gross_profit, 2),
        "gross_loss_usd": round(gross_loss, 2),
        "total_commission_usd": round(total_comm_usd, 2),
        "total_swap_usd": round(total_swap_usd, 2),
        "total_fee_usd": round(total_fee_usd, 2),
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


def _parse_iso_to_msc(value: str | None, *, end_of_day: bool = False) -> int | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            dt = datetime.fromisoformat(raw).replace(tzinfo=UTC)
            if end_of_day:
                dt = dt + timedelta(days=1) - timedelta(milliseconds=1)
            return int(dt.timestamp() * 1000)
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _compute_market_sessions(now: datetime) -> list[dict[str, Any]]:
    """Compute real-time UTC status for major institutional FX/equity trading sessions."""
    hour = now.hour + now.minute / 60.0
    weekday = now.weekday()  # 0=Mon..6=Sun
    is_weekend = weekday == 5 or (weekday == 6 and hour < 22.0) or (weekday == 4 and hour >= 22.0)

    sessions = [
        {"name": "Sydney", "code": "SYD", "open_utc": 22, "close_utc": 7},
        {"name": "Tokyo", "code": "TYO", "open_utc": 0, "close_utc": 9},
        {"name": "London", "code": "LDN", "open_utc": 8, "close_utc": 17},
        {"name": "New York", "code": "NYC", "open_utc": 13, "close_utc": 22},
    ]
    out: list[dict[str, Any]] = []
    for s in sessions:
        o, c = s["open_utc"], s["close_utc"]
        if is_weekend:
            is_open = False
        elif o < c:
            is_open = o <= hour < c
        else:
            is_open = hour >= o or hour < c
        out.append(
            {
                "name": s["name"],
                "code": s["code"],
                "open_utc": f"{o:02d}:00",
                "close_utc": f"{c:02d}:00",
                "is_open": is_open,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Home Command Center Summary
# ---------------------------------------------------------------------------


_FNG_CACHE: dict[str, Any] = {"value": None, "classification": None, "ts": 0.0}
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    cleaned = _HTML_TAG_RE.sub(" ", html.unescape(text))
    return re.sub(r"\s+", " ", cleaned).strip()


def _is_internal_transfer_deal(d: Deal) -> bool:
    """Exclude ALLINT / internal transfers & balance ops from trading PnL and equity curve."""
    if d.deal_type not in (0, 1):
        return True
    c = (d.comment or "").upper()
    return "ALLINT" in c or "INTERNAL" in c or "TRANSFER" in c


def _is_bridge_robot_row(r: Robot) -> bool:
    name_l = (r.name or "").strip().lower()
    st = r.live_state_json or {}
    ea_l = str(st.get("ea_name") or "").strip().lower()
    if "bridge" in name_l or "bridge" in ea_l:
        return True
    has_strat = any(
        st.get(k) is not None
        for k in ("rsi_m5", "er_h1", "regime", "signal_bias", "bb_upper", "zones", "risk_mode")
    )
    if not has_strat and st.get("discovery_source") == "sibling_chart":
        return True
    return not has_strat and name_l.startswith("ea #") and int(r.magic_number or 0) < 1_000_000


async def _get_crypto_fear_greed() -> dict[str, Any] | None:
    now_m = time.monotonic()
    if now_m - float(_FNG_CACHE.get("ts") or 0.0) < 600.0 and _FNG_CACHE.get("value") is not None:
        return {"value": _FNG_CACHE["value"], "classification": _FNG_CACHE["classification"]}
    try:
        async with httpx.AsyncClient(timeout=4.0) as http:
            resp = await http.get("https://api.alternative.me/fng/?limit=1")
            if resp.status_code == 200:
                rows = (resp.json() or {}).get("data") or []
                if rows:
                    _FNG_CACHE["value"] = int(rows[0].get("value") or 50)
                    _FNG_CACHE["classification"] = str(rows[0].get("value_classification") or "Neutral")
                    _FNG_CACHE["ts"] = now_m
                    return {"value": _FNG_CACHE["value"], "classification": _FNG_CACHE["classification"]}
    except Exception:  # noqa: BLE001
        pass
    return (
        {"value": _FNG_CACHE["value"], "classification": _FNG_CACHE["classification"]}
        if _FNG_CACHE.get("value") is not None
        else None
    )


@router.get("/analytics/home-summary")
async def get_home_summary(
    period: str = Query(default="7D", pattern="^(24H|7D|30D|90D|ALL)$"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    accounts = (await db.execute(select(TradingAccount).order_by(TradingAccount.created_at.asc()))).scalars().all()
    acc_map = {a.id: a for a in accounts}
    all_robots = (await db.execute(select(Robot).order_by(Robot.created_at.asc()))).scalars().all()
    robots = [r for r in all_robots if not _is_bridge_robot_row(r)]
    open_positions = (await db.execute(select(OpenPositionLive))).scalars().all()
    asset_hubs = (await db.execute(select(AssetHub).order_by(AssetHub.code.asc()))).scalars().all()

    start_today_msc = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
    start_week_msc = int((now - timedelta(days=7)).timestamp() * 1000)
    start_30d_msc = int((now - timedelta(days=30)).timestamp() * 1000)

    period_days_map = {"24H": 1, "7D": 7, "30D": 30, "90D": 90, "ALL": 3650}
    curve_days = period_days_map.get(period, 7)
    curve_start_dt = now - timedelta(days=curve_days)
    curve_start_msc = int(curve_start_dt.timestamp() * 1000)

    fetch_since_msc = min(start_30d_msc, curve_start_msc)
    raw_deals = (
        (
            await db.execute(
                select(Deal)
                .where(Deal.entry_type.in_([1, 2]), Deal.deal_type.in_([0, 1]), Deal.time_msc >= fetch_since_msc)
                .order_by(Deal.time_msc.asc())
            )
        )
        .scalars()
        .all()
    )
    clean_deals = [d for d in raw_deals if not _is_internal_transfer_deal(d)]
    deals_30d = [d for d in clean_deals if d.time_msc >= start_30d_msc]
    deals_period = [d for d in clean_deals if d.time_msc >= curve_start_msc]

    total_balance_usd = round(sum(a.last_balance / (a.currency_divisor or 1.0) for a in accounts), 2)
    total_equity_usd = round(sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts), 2)
    total_floating_usd = round(sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts), 2)
    today_pnl_usd = round(
        sum(_deal_net_usd(d, acc_map) for d in deals_30d if d.time_msc >= start_today_msc) + total_floating_usd, 2
    )
    week_pnl_usd = round(sum(_deal_net_usd(d, acc_map) for d in deals_30d if d.time_msc >= start_week_msc), 2)
    stats_30d = _compute_trade_stats(deals_30d, acc_map)
    expectancy_30d = round(stats_30d["net_pnl_usd"] / len(deals_30d), 2) if deals_30d else 0.0

    # Build clean trading-only equity curve (strictly excluding ALLINT transfers) over requested period (default 7D)
    period_pnl_total = sum(_deal_net_usd(d, acc_map) for d in deals_period)
    base_equity = round(max(0.01, total_balance_usd - period_pnl_total), 2)
    equity_curve: list[dict[str, Any]] = []
    cum = 0.0
    peak_eq = base_equity

    # Anchor start of period so 7D always spans at least 7 days cleanly
    equity_curve.append(
        {
            "time_sec": int(curve_start_dt.timestamp()),
            "date": curve_start_dt.strftime("%m-%d %H:%M"),
            "equity_usd": base_equity,
            "cum_pnl_usd": 0.0,
            "pnl_pct": 0.0,
            "dd_pct": 0.0,
        }
    )

    for d in deals_period:
        cum += _deal_net_usd(d, acc_map)
        eq = round(base_equity + cum, 2)
        if eq > peak_eq:
            peak_eq = eq
        dd = round(((peak_eq - eq) / peak_eq) * 100.0, 2) if peak_eq > 0 else 0.0
        pct = round((cum / base_equity) * 100.0, 2) if base_equity > 0 else 0.0
        equity_curve.append(
            {
                "time_sec": d.time_msc // 1000,
                "date": datetime.fromtimestamp(d.time_msc / 1000, tz=UTC).strftime("%m-%d %H:%M"),
                "equity_usd": eq,
                "cum_pnl_usd": round(cum, 2),
                "pnl_pct": pct,
                "dd_pct": dd,
            }
        )

    # Always append current live equity point at `now`
    live_eq = total_equity_usd if total_equity_usd > 0 else round(base_equity + cum, 2)
    if live_eq > peak_eq:
        peak_eq = live_eq
    live_dd = round(((peak_eq - live_eq) / peak_eq) * 100.0, 2) if peak_eq > 0 else 0.0
    live_cum = round(cum + total_floating_usd, 2)
    live_pct = round((live_cum / base_equity) * 100.0, 2) if base_equity > 0 else 0.0
    equity_curve.append(
        {
            "time_sec": int(now.timestamp()),
            "date": now.strftime("%m-%d %H:%M"),
            "equity_usd": live_eq,
            "cum_pnl_usd": live_cum,
            "pnl_pct": live_pct,
            "dd_pct": live_dd,
        }
    )

    # Live Ticker Strip symbols: user's My Assets + core global benchmarks (zero broken ASS stubs)
    benchmarks = ["BTCUSD", "XAUUSD", "USTEC", "EURUSD", "DXY", "US10Y"]
    ticker_symbols = list(dict.fromkeys([*(h.code.upper() for h in asset_hubs), *benchmarks]))[:12]

    # Treemap caches (US Sectors + Crypto Top)
    def _extract_treemap_items(cache_row: MarketCache | None) -> list[dict[str, Any]]:
        if not cache_row or not isinstance(cache_row.payload_json, dict):
            return []
        items_out: list[dict[str, Any]] = []
        for sec in cache_row.payload_json.get("sectors", []):
            sec_name = str(sec.get("sector") or "")
            for it in sec.get("items") or []:
                chg = it.get("change_pct")
                val = float(it.get("market_cap") or it.get("weight") or 1.0)
                sym = str(it.get("symbol") or it.get("ticker") or "")
                if not sym or chg is None:
                    continue
                items_out.append(
                    {
                        "name": sym,
                        "sector": sec_name,
                        "value": max(1.0, val),
                        "change_pct": round(float(chg), 2),
                        "price": it.get("price"),
                    }
                )
        return items_out[:24]

    us_cache = await db.get(MarketCache, "treemap:sp500_top:1D") or await db.get(MarketCache, "treemap:nasdaq100:1D")
    crypto_cache = await db.get(MarketCache, "treemap:crypto_majors:1D")
    treemap_us = _extract_treemap_items(us_cache)
    treemap_crypto = _extract_treemap_items(crypto_cache)

    sector_pulse: list[dict[str, Any]] = []
    if us_cache and us_cache.payload_json:
        for sec in us_cache.payload_json.get("sectors", []):
            items = sec.get("items") or []
            changes = [float(i["change_pct"]) for i in items if i.get("change_pct") is not None]
            avg_chg = round(sum(changes) / len(changes), 2) if changes else 0.0
            sector_pulse.append({"sector": sec.get("sector", ""), "avg_change_pct": avg_chg, "count": len(items)})

    breaking_news = (
        (await db.execute(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(10))).scalars().all()
    )
    upcoming_rows = (
        (
            await db.execute(
                select(EconomicEvent)
                .where(EconomicEvent.event_time >= now)
                .order_by(EconomicEvent.event_time.asc())
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    next_event = upcoming_rows[0] if upcoming_rows else None
    fear_greed = await _get_crypto_fear_greed()

    stale_robots_count = 0
    robots_pulse_out: list[dict[str, Any]] = []
    for r in robots:
        st = r.live_state_json or {}
        hb = r.last_heartbeat_at
        age_sec = (now - hb.replace(tzinfo=UTC)).total_seconds() if hb else 999999
        is_stale = age_sec > 15 or "ERR" in (r.live_status or "").upper()
        if is_stale and r.is_active:
            stale_robots_count += 1
        robots_pulse_out.append(
            {
                "id": r.id,
                "account_id": r.account_id,
                "name": r.name,
                "symbol": r.symbol,
                "magic_number": r.magic_number,
                "live_status": r.live_status,
                "is_active": r.is_active,
                "seq": int(st.get("seq") or 0),
                "updated_at_utc": str(st.get("updated_at_utc") or (hb.isoformat() if hb else "")),
                "regime": str(st.get("regime") or ""),
                "rsi_m5": st.get("rsi_m5"),
                "er_h1": st.get("er_h1"),
                "day_pnl": st.get("day_pnl"),
                "last_heartbeat_at": hb.isoformat() if hb else None,
            }
        )

    return {
        "server_time_utc": now.isoformat(),
        "period": period,
        "ticker_symbols": ticker_symbols,
        "kpis": {
            "total_balance_usd": total_balance_usd,
            "total_equity_usd": total_equity_usd,
            "total_floating_pnl_usd": total_floating_usd,
            "today_pnl_usd": today_pnl_usd,
            "week_pnl_usd": week_pnl_usd,
            "month_pnl_usd": stats_30d["net_pnl_usd"],
            "win_rate_30d_pct": stats_30d["win_rate_pct"],
            "profit_factor_30d": stats_30d["profit_factor"],
            "expectancy_30d_usd": expectancy_30d,
            "accounts_count": len(accounts),
            "connected_accounts_count": sum(1 for a in accounts if a.terminal_connected),
            "open_positions_count": len(open_positions),
            "active_robots_count": sum(1 for r in robots if r.is_active),
            "stale_robots_count": stale_robots_count,
        },
        "equity_curve": equity_curve,
        "accounts_pulse": [
            {
                "id": a.id,
                "name": a.name,
                "mt5_login": a.mt5_login,
                "currency": a.currency,
                "balance_usd": round(a.last_balance / (a.currency_divisor or 1.0), 2),
                "equity_usd": round(a.last_equity / (a.currency_divisor or 1.0), 2),
                "floating_pnl_usd": round(a.last_floating_pnl / (a.currency_divisor or 1.0), 2),
                "terminal_connected": a.terminal_connected,
                "algo_trading_enabled": a.algo_trading_enabled,
                "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
            }
            for a in accounts
        ],
        "robots_pulse": robots_pulse_out,
        "market_sessions": _compute_market_sessions(now),
        "treemap_us": treemap_us,
        "treemap_crypto": treemap_crypto,
        "fear_greed": fear_greed,
        "sector_pulse": sector_pulse,
        "breaking_news": [
            {
                "id": n.id,
                "title": _strip_html(n.title),
                "source": n.source,
                "sentiment": n.sentiment,
                "impact_score": n.impact_score,
                "is_breaking": n.is_breaking,
                "affected_assets": n.affected_assets,
                "published_at": n.published_at.isoformat(),
            }
            for n in breaking_news
        ],
        "upcoming_events": [
            {
                "id": ev.id,
                "title": _strip_html(ev.title),
                "currency": ev.currency,
                "impact": ev.impact,
                "forecast": ev.forecast,
                "previous": ev.previous,
                "actual": ev.actual,
                "event_time": ev.event_time.isoformat(),
            }
            for ev in upcoming_rows
        ],
        "next_macro_event": {
            "id": next_event.id,
            "title": _strip_html(next_event.title),
            "currency": next_event.currency,
            "impact": next_event.impact,
            "forecast": next_event.forecast,
            "previous": next_event.previous,
            "event_time": next_event.event_time.isoformat(),
        }
        if next_event
        else None,
    }


# ---------------------------------------------------------------------------
# Deep Analytics & Risk Lab (8 Charts + Filters + USC Divisor Fix)
# ---------------------------------------------------------------------------


@router.get("/analytics/overview")
async def get_analytics_overview(
    account_id: str | None = None,
    symbol: str | None = None,
    magic_number: int | None = None,
    side: str | None = Query(default=None, pattern="^(BUY|SELL|LONG|SHORT)$"),
    days: int = Query(default=90, ge=1, le=3650),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Comprehensive institutional analytics across all Exness USD & USC accounts, assets, and robots."""
    all_accounts = (await db.execute(select(TradingAccount))).scalars().all()
    accounts = [a for a in all_accounts if a.id == account_id] if account_id else list(all_accounts)
    acc_map = {a.id: a for a in all_accounts}

    from_msc = _parse_iso_to_msc(from_date) or int((datetime.now(UTC) - timedelta(days=days)).timestamp() * 1000)
    to_msc = _parse_iso_to_msc(to_date, end_of_day=True)

    deal_stmt = select(Deal).where(Deal.entry_type.in_([1, 2]), Deal.time_msc >= from_msc)
    if to_msc is not None:
        deal_stmt = deal_stmt.where(Deal.time_msc <= to_msc)
    if account_id:
        deal_stmt = deal_stmt.where(Deal.account_id == account_id)
    if symbol:
        deal_stmt = deal_stmt.where(
            or_(Deal.symbol.ilike(f"%{symbol.strip()}%"), sql_symbol_match(Deal.symbol, symbol))
        )
    if magic_number is not None:
        deal_stmt = deal_stmt.where(Deal.magic_number == magic_number)
    if side:
        norm_side = side.upper()
        deal_stmt = deal_stmt.where(Deal.deal_type == (0 if norm_side in ("BUY", "LONG") else 1))
    closed_deals = (await db.execute(deal_stmt)).scalars().all()

    robots = (await db.execute(select(Robot))).scalars().all()
    robot_map = {(r.account_id, r.magic_number): r.name for r in robots}

    total_balance_usd = sum(a.last_balance / (a.currency_divisor or 1.0) for a in accounts)
    total_equity_usd = sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts)
    total_floating_usd = sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts)

    stats = _compute_trade_stats(list(closed_deals), acc_map)

    daily_map: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"net_pnl_usd": 0.0, "trades": 0, "wins": 0, "losses": 0}
    )
    hourly_map: dict[int, dict[str, Any]] = {
        h: {"hour": h, "net_pnl_usd": 0.0, "trades": 0, "wins": 0, "losses": 0, "win_rate_pct": 0.0} for h in range(24)
    }
    by_symbol: dict[str, list[Deal]] = defaultdict(list)
    by_account: dict[str, list[Deal]] = defaultdict(list)
    by_robot: dict[tuple[str, int], list[Deal]] = defaultdict(list)
    long_deals: list[Deal] = []
    short_deals: list[Deal] = []

    for d in closed_deals:
        pnl_usd = _deal_net_usd(d, acc_map)
        dt = datetime.fromtimestamp(d.time_msc / 1000, tz=UTC)
        day_key = dt.strftime("%Y-%m-%d")
        daily_map[day_key]["net_pnl_usd"] = round(daily_map[day_key]["net_pnl_usd"] + pnl_usd, 2)
        daily_map[day_key]["trades"] += 1
        if pnl_usd > 0:
            daily_map[day_key]["wins"] += 1
            hourly_map[dt.hour]["wins"] += 1
        elif pnl_usd < 0:
            daily_map[day_key]["losses"] += 1
            hourly_map[dt.hour]["losses"] += 1

        hourly_map[dt.hour]["net_pnl_usd"] = round(hourly_map[dt.hour]["net_pnl_usd"] + pnl_usd, 2)
        hourly_map[dt.hour]["trades"] += 1

        by_symbol[d.symbol].append(d)
        by_account[d.account_id].append(d)
        by_robot[(d.account_id, d.magic_number)].append(d)
        if d.deal_type == 0:
            long_deals.append(d)
        else:
            short_deals.append(d)

    for h in range(24):
        t = hourly_map[h]["trades"]
        hourly_map[h]["win_rate_pct"] = round((hourly_map[h]["wins"] / t) * 100.0, 2) if t else 0.0

    # Cumulative Equity, Underwater Drawdown, Rolling Win-Rate & MAE/MFE Scatter
    ordered = sorted(closed_deals, key=lambda d: d.time_msc)
    equity_curve: list[dict[str, Any]] = []
    drawdown_curve: list[dict[str, Any]] = []
    rolling_win_rate: list[dict[str, Any]] = []
    mae_mfe_scatter: list[dict[str, Any]] = []

    cum = peak = 0.0
    window = 10
    recent_outcomes: list[int] = []
    for idx, d in enumerate(ordered, start=1):
        pnl_usd = _deal_net_usd(d, acc_map)
        cum += pnl_usd
        peak = max(peak, cum)
        dd_usd = round(cum - peak, 2)
        dd_pct = round((dd_usd / peak) * 100.0, 2) if peak > 0 else 0.0
        date_str = datetime.fromtimestamp(d.time_msc / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M")

        equity_curve.append(
            {
                "time_sec": d.time_msc // 1000,
                "date": date_str,
                "cum_pnl_usd": round(cum, 2),
                "drawdown_usd": dd_usd,
            }
        )
        drawdown_curve.append(
            {
                "time_sec": d.time_msc // 1000,
                "date": date_str,
                "drawdown_usd": dd_usd,
                "drawdown_pct": dd_pct,
            }
        )

        recent_outcomes.append(1 if pnl_usd > 0 else 0)
        if len(recent_outcomes) > window:
            recent_outcomes.pop(0)
        rolling_win_rate.append(
            {
                "trade_index": idx,
                "time_sec": d.time_msc // 1000,
                "date": date_str,
                "rolling_win_rate_pct": round((sum(recent_outcomes) / len(recent_outcomes)) * 100.0, 2),
                "window": len(recent_outcomes),
            }
        )

        mae_mfe_scatter.append(
            {
                "deal_id": d.id,
                "symbol": d.symbol,
                "side": "BUY" if d.deal_type == 0 else "SELL",
                "volume": d.volume,
                "net_profit_usd": round(pnl_usd, 2),
                "mae_usd": round(min(0.0, pnl_usd), 2),
                "mfe_usd": round(max(0.0, pnl_usd), 2),
                "time_sec": d.time_msc // 1000,
            }
        )

    # Include live open positions' exact MAE/MFE in scatter
    pos_stmt = select(OpenPositionLive)
    if account_id:
        pos_stmt = pos_stmt.where(OpenPositionLive.account_id == account_id)
    if symbol:
        pos_stmt = pos_stmt.where(OpenPositionLive.symbol.ilike(f"%{symbol.strip()}%"))
    if magic_number is not None:
        pos_stmt = pos_stmt.where(OpenPositionLive.magic_number == magic_number)
    for pos in (await db.execute(pos_stmt)).scalars().all():
        mae_mfe_scatter.append(
            {
                "deal_id": f"pos-{pos.position_ticket}",
                "symbol": pos.symbol,
                "side": pos.side,
                "volume": pos.volume,
                "net_profit_usd": round(pos.profit_usd, 2),
                "mae_usd": round(pos.mae_usd, 2),
                "mfe_usd": round(pos.mfe_usd, 2),
                "time_sec": pos.open_time,
                "is_open": True,
            }
        )

    snap_count = len((await db.execute(select(EquitySnapshot.id).limit(500))).scalars().all())
    daily_list = [{"date": k, **v} for k, v in sorted(daily_map.items())]
    hourly_list = [hourly_map[h] for h in range(24)]

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
        "drawdown_curve": drawdown_curve,
        "daily_calendar": daily_list,
        "daily_pnl": daily_list,
        "hourly_heatmap": hourly_list,
        "hourly_pnl": hourly_list,
        "by_symbol": [
            {"symbol": sym, **_compute_trade_stats(items, acc_map)} for sym, items in sorted(by_symbol.items())
        ],
        "by_account": [
            {
                "account_id": aid,
                "account_name": acc_map[aid].name if aid in acc_map else aid,
                "currency": acc_map[aid].currency if aid in acc_map else "USD",
                **_compute_trade_stats(items, acc_map),
            }
            for aid, items in by_account.items()
        ],
        "by_robot": [
            {
                "account_id": aid,
                "magic_number": magic,
                "robot_name": robot_map.get((aid, magic), f"Magic #{magic}"),
                **_compute_trade_stats(items, acc_map),
            }
            for (aid, magic), items in by_robot.items()
        ],
        "long_short_breakdown": {
            "long": _compute_trade_stats(long_deals, acc_map),
            "short": _compute_trade_stats(short_deals, acc_map),
        },
        "mae_mfe_scatter": mae_mfe_scatter,
        "rolling_win_rate": rolling_win_rate,
    }


# ---------------------------------------------------------------------------
# Trading Journal (Deals, Notes/Tags CRUD, Live Positions)
# ---------------------------------------------------------------------------


class DealUpdateRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = None


def _serialize_deal(
    d: Deal,
    acc_map: dict[str, TradingAccount],
    robot_map: dict[tuple[str, int], str],
) -> dict[str, Any]:
    acc = acc_map.get(d.account_id)
    div = (acc.currency_divisor if acc and acc.currency_divisor else 1.0)
    return {
        "id": d.id,
        "account_id": d.account_id,
        "account_name": acc.name if acc else d.account_id,
        "account_login": acc.mt5_login if acc else "",
        "currency": acc.currency if acc else "USD",
        "currency_divisor": div,
        "mt5_deal_ticket": d.mt5_deal_ticket,
        "order_ticket": d.order_ticket,
        "position_id": d.position_id,
        "magic_number": d.magic_number,
        "robot_name": robot_map.get((d.account_id, d.magic_number), f"Magic #{d.magic_number}")
        if d.magic_number
        else "Manual",
        "symbol": d.symbol,
        "side": "BUY" if d.deal_type == 0 else "SELL",
        "entry": "IN" if d.entry_type == 0 else "OUT" if d.entry_type == 1 else "INOUT",
        "entry_type": d.entry_type,
        "volume": d.volume,
        "price": d.price,
        "profit": d.profit,
        "profit_usd": round(d.profit / div, 2),
        "commission": d.commission,
        "commission_usd": round(d.commission / div, 2),
        "swap": d.swap,
        "swap_usd": round(d.swap / div, 2),
        "fee": d.fee,
        "fee_usd": round(d.fee / div, 2),
        "net_profit": d.net_profit,
        "net_profit_usd": round(_deal_net_usd(d, acc_map), 2),
        "comment": d.comment,
        "notes": d.notes or "",
        "tags": d.tags or [],
        "time_msc": d.time_msc,
        "timestamp": datetime.fromtimestamp(d.time_msc / 1000, tz=UTC).isoformat(),
    }


@router.get("/journal/deals")
async def list_journal_deals(
    account_id: str | None = None,
    symbol: str | None = None,
    magic_number: int | None = None,
    side: str | None = Query(default=None, pattern="^(BUY|SELL)$"),
    entry_type: int | None = None,
    q: str | None = None,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(Deal).order_by(Deal.time_msc.desc())
    if account_id:
        stmt = stmt.where(Deal.account_id == account_id)
    if symbol:
        stmt = stmt.where(
            or_(Deal.symbol.ilike(f"%{symbol.strip()}%"), sql_symbol_match(Deal.symbol, symbol))
        )
    if magic_number is not None:
        stmt = stmt.where(Deal.magic_number == magic_number)
    if side:
        stmt = stmt.where(Deal.deal_type == (0 if side == "BUY" else 1))
    if entry_type is not None:
        stmt = stmt.where(Deal.entry_type == entry_type)
    from_msc = _parse_iso_to_msc(from_date)
    to_msc = _parse_iso_to_msc(to_date, end_of_day=True)
    if from_msc is not None:
        stmt = stmt.where(Deal.time_msc >= from_msc)
    if to_msc is not None:
        stmt = stmt.where(Deal.time_msc <= to_msc)

    rows = (await db.execute(stmt)).scalars().all()
    if q and q.strip():
        ql = q.strip().lower()
        rows = [
            d
            for d in rows
            if ql in d.symbol.lower()
            or ql in (d.comment or "").lower()
            or ql in (d.notes or "").lower()
            or any(ql in str(t).lower() for t in (d.tags or []))
        ]

    acc_map = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    robot_map = {(r.account_id, r.magic_number): r.name for r in (await db.execute(select(Robot))).scalars().all()}
    return page.apply([_serialize_deal(d, acc_map, robot_map) for d in rows])


@router.get("/journal/deals/{deal_id}")
async def get_journal_deal(
    deal_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    deal = await db.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    acc_map = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    robot_map = {(r.account_id, r.magic_number): r.name for r in (await db.execute(select(Robot))).scalars().all()}
    return _serialize_deal(deal, acc_map, robot_map)


@router.patch("/journal/deals/{deal_id}")
async def update_journal_deal(
    deal_id: str,
    body: DealUpdateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    deal = await db.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")

    if body.notes is not None:
        deal.notes = body.notes.strip()
    if body.tags is not None:
        deal.tags = [str(t).strip() for t in body.tags if str(t).strip()][:20]

    await record_audit(
        db,
        action="journal.deal_annotated",
        user_id=user.id,
        resource_type="deal",
        resource_id=deal.id,
        ip_address=extract_client_ip(request),
        details={"tags": deal.tags},
    )
    await db.commit()
    acc_map = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    robot_map = {(r.account_id, r.magic_number): r.name for r in (await db.execute(select(Robot))).scalars().all()}
    return _serialize_deal(deal, acc_map, robot_map)


@router.get("/journal/positions")
async def list_journal_positions(
    account_id: str | None = None,
    symbol: str | None = None,
    magic_number: int | None = None,
    side: str | None = Query(default=None, pattern="^(BUY|SELL)$"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(OpenPositionLive).order_by(OpenPositionLive.updated_at.desc())
    if account_id:
        stmt = stmt.where(OpenPositionLive.account_id == account_id)
    if symbol:
        stmt = stmt.where(
            or_(OpenPositionLive.symbol.ilike(f"%{symbol.strip()}%"), sql_symbol_match(OpenPositionLive.symbol, symbol))
        )
    if magic_number is not None:
        stmt = stmt.where(OpenPositionLive.magic_number == magic_number)
    if side:
        stmt = stmt.where(OpenPositionLive.side == side)
    rows = (await db.execute(stmt)).scalars().all()
    acc_map = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    return page.apply([
        {
            "id": p.id,
            "account_id": p.account_id,
            "account_name": acc_map[p.account_id].name if p.account_id in acc_map else p.account_id,
            "currency": acc_map[p.account_id].currency if p.account_id in acc_map else "USD",
            "position_ticket": p.position_ticket,
            "magic_number": p.magic_number,
            "symbol": p.symbol,
            "side": p.side,
            "volume": p.volume,
            "open_price": p.open_price,
            "current_price": p.current_price,
            "sl": p.sl,
            "tp": p.tp,
            "swap": p.swap,
            "profit": p.profit,
            "profit_usd": round(p.profit_usd, 2),
            "mae_usd": round(p.mae_usd, 2),
            "mfe_usd": round(p.mfe_usd, 2),
            "open_time": p.open_time,
            "comment": p.comment,
            "updated_at": p.updated_at.isoformat(),
        }
        for p in rows
    ])


# ---------------------------------------------------------------------------
# Treasury & Manual Balance Operations CRUD
# ---------------------------------------------------------------------------


class TreasuryOpCreate(BaseModel):
    account_id: str
    op_kind: str = Field(
        default="DEPOSIT",
        pattern="^(DEPOSIT|WITHDRAWAL|INTERNAL_TRANSFER|EXNESS_VAULT|REBATE)$",
    )
    amount: float
    comment: str = Field(default="", max_length=255)
    notes: str = Field(default="", max_length=2000)
    time_msc: int | None = None


class TreasuryOpUpdate(BaseModel):
    op_kind: str | None = Field(
        default=None,
        pattern="^(DEPOSIT|WITHDRAWAL|INTERNAL_TRANSFER|EXNESS_VAULT|REBATE)$",
    )
    amount: float | None = None
    comment: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


def _serialize_treasury_op(o: BalanceOperation, acc_map: dict[str, TradingAccount]) -> dict[str, Any]:
    acc = acc_map.get(o.account_id)
    return {
        "id": o.id,
        "account_id": o.account_id,
        "account_name": acc.name if acc else "",
        "account_login": acc.mt5_login if acc else "",
        "currency": acc.currency if acc else "USD",
        "mt5_deal_ticket": o.mt5_deal_ticket,
        "op_kind": o.op_kind,
        "amount": o.amount,
        "amount_usd": round(o.amount_usd, 2),
        "comment": o.comment,
        "is_manual": bool(o.is_manual),
        "notes": o.notes or "",
        "time_msc": o.time_msc,
        "timestamp": datetime.fromtimestamp(o.time_msc / 1000, tz=UTC).isoformat(),
    }


@router.get("/analytics/treasury")
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

    def _is_internal_transfer(o: BalanceOperation) -> bool:
        if o.op_kind == "INTERNAL_TRANSFER":
            return True
        c = (o.comment or "").lower()
        keywords = ("internal transfer", "transfer between", "transfer from", "transfer to", "int. transfer")
        return any(k in c for k in keywords)

    total_deposited = sum(
        o.amount_usd for o in ops if o.op_kind == "DEPOSIT" and o.amount_usd > 0 and not _is_internal_transfer(o)
    )
    total_withdrawn = abs(
        sum(
            o.amount_usd
            for o in ops
            if o.op_kind == "WITHDRAWAL" and o.amount_usd < 0 and not _is_internal_transfer(o)
        )
    )
    total_internal_transfers = sum(abs(o.amount_usd) for o in ops if _is_internal_transfer(o))
    total_vault = abs(sum(o.amount_usd for o in ops if o.op_kind == "EXNESS_VAULT" and o.amount_usd < 0))
    total_rebates = sum(o.amount_usd for o in ops if o.op_kind == "REBATE")
    working_capital = sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts)
    realized_profit = sum(_deal_net_usd(d, acc_map) for d in deals)
    profit_ready = max(0.0, realized_profit - total_vault - total_withdrawn)

    return {
        "summary": {
            "working_capital_usd": round(working_capital, 2),
            "total_deposited_usd": round(total_deposited, 2),
            "total_withdrawn_usd": round(total_withdrawn, 2),
            "total_internal_transfers_usd": round(total_internal_transfers, 2),
            "total_vault_usd": round(total_vault, 2),
            "total_rebates_usd": round(total_rebates, 2),
            "realized_trading_profit_usd": round(realized_profit, 2),
            "profit_ready_for_vault_usd": round(profit_ready, 2),
            "vault_target_usd": vault_target_usd,
            "vault_target_reached": profit_ready >= vault_target_usd,
        },
        "operations": [_serialize_treasury_op(o, acc_map) for o in ops],
    }


@router.get("/treasury/operations")
async def list_treasury_operations(
    q: str | None = Query(default=None),
    account_id: str | None = None,
    op_kind: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(BalanceOperation).order_by(BalanceOperation.time_msc.desc()).limit(limit)
    if account_id:
        stmt = stmt.where(BalanceOperation.account_id == account_id)
    if op_kind:
        stmt = stmt.where(BalanceOperation.op_kind == op_kind.upper())
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            BalanceOperation.id.ilike(pat)
            | BalanceOperation.op_kind.ilike(pat)
            | BalanceOperation.comment.ilike(pat)
            | BalanceOperation.notes.ilike(pat)
        )
    ops = (await db.execute(stmt)).scalars().all()
    acc_map = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    return page.apply([_serialize_treasury_op(o, acc_map) for o in ops])


@router.post("/treasury/operations", status_code=status.HTTP_201_CREATED)
async def create_treasury_operation(
    body: TreasuryOpCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await db.get(TradingAccount, body.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    div = account.currency_divisor or 1.0
    now_msc = body.time_msc or int(time.time() * 1000)
    # Manual entries use a unique negative synthetic ticket so they never collide with MT5 tickets
    synthetic_ticket = -int(time.time_ns() // 1000)
    op = BalanceOperation(
        account_id=account.id,
        mt5_deal_ticket=synthetic_ticket,
        op_kind=body.op_kind,
        amount=body.amount,
        amount_usd=round(body.amount / div, 4),
        comment=body.comment.strip(),
        is_manual=True,
        notes=body.notes.strip(),
        time_msc=now_msc,
    )
    db.add(op)
    await db.flush()
    await record_audit(
        db,
        action="treasury.operation_created",
        user_id=user.id,
        resource_type="balance_operation",
        resource_id=op.id,
        ip_address=extract_client_ip(request),
        details={"op_kind": op.op_kind, "amount_usd": op.amount_usd},
    )
    await db.commit()
    return _serialize_treasury_op(op, {account.id: account})


@router.get("/treasury/operations/{op_id}")
async def get_treasury_operation(
    op_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    op = await db.get(BalanceOperation, op_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treasury operation not found")
    acc = await db.get(TradingAccount, op.account_id)
    acc_map = {acc.id: acc} if acc else {}

    prior_ops = (
        (
            await db.execute(
                select(BalanceOperation).where(
                    BalanceOperation.account_id == op.account_id,
                    BalanceOperation.time_msc < op.time_msc,
                )
            )
        )
        .scalars()
        .all()
    )
    prior_deals = (
        (
            await db.execute(
                select(Deal).where(
                    Deal.account_id == op.account_id,
                    Deal.entry_type.in_([1, 2]),
                    Deal.time_msc <= op.time_msc,
                )
            )
        )
        .scalars()
        .all()
    )
    balance_before = round(
        sum(p.amount_usd for p in prior_ops) + sum(_deal_net_usd(d, acc_map) for d in prior_deals),
        2,
    )
    balance_after = round(balance_before + op.amount_usd, 2)
    payload = _serialize_treasury_op(op, acc_map)
    payload["balance_before_usd"] = balance_before
    payload["balance_after_usd"] = balance_after
    return payload


@router.patch("/treasury/operations/{op_id}")
async def update_treasury_operation(
    op_id: str,
    body: TreasuryOpUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    op = await db.get(BalanceOperation, op_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treasury operation not found")
    if not op.is_manual:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Broker-synced transactions are read-only and cannot be edited",
        )
    acc = await db.get(TradingAccount, op.account_id)
    div = (acc.currency_divisor if acc and acc.currency_divisor else 1.0)

    if body.op_kind is not None:
        op.op_kind = body.op_kind
    if body.amount is not None:
        op.amount = body.amount
        op.amount_usd = round(body.amount / div, 4)
    if body.comment is not None:
        op.comment = body.comment.strip()
    if body.notes is not None:
        op.notes = body.notes.strip()

    await record_audit(
        db,
        action="treasury.operation_updated",
        user_id=user.id,
        resource_type="balance_operation",
        resource_id=op.id,
        ip_address=extract_client_ip(request),
        details={"op_kind": op.op_kind, "amount_usd": op.amount_usd},
    )
    await db.commit()
    return _serialize_treasury_op(op, {acc.id: acc} if acc else {})


@router.delete("/treasury/operations/{op_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_treasury_operation(
    op_id: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    op = await db.get(BalanceOperation, op_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treasury operation not found")
    await db.delete(op)
    await record_audit(
        db,
        action="treasury.operation_deleted",
        user_id=user.id,
        resource_type="balance_operation",
        resource_id=op_id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Statement Exports (CSV & real openpyxl XLSX — works with Bearer, cookie, or ?dl_token=)
# ---------------------------------------------------------------------------


@router.get("/analytics/statement.csv")
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
    buf.write("\ufeff")
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
            "Commission (USD)",
            "Swap (USD)",
            "Net Profit (USD)",
            "Comment",
            "Notes",
        ]
    )
    for d in deals:
        acc = accounts.get(d.account_id)
        div = _deal_divisor(d, accounts)
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
                round(d.commission / div, 2),
                round(d.swap / div, 2),
                round(_deal_net_usd(d, accounts), 2),
                d.comment,
                d.notes or "",
            ]
        )

    buf.seek(0)
    filename = f"exness_statement_{datetime.now(UTC).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/analytics/statement.xlsx")
async def export_full_exness_statement_xlsx(
    account_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Export institutional multi-sheet Excel (.xlsx) workbook: Summary, Deals, Positions, Treasury."""
    all_accounts = (await db.execute(select(TradingAccount))).scalars().all()
    acc_map = {a.id: a for a in all_accounts}
    accounts = [a for a in all_accounts if a.id == account_id] if account_id else list(all_accounts)

    deal_stmt = select(Deal).order_by(Deal.time_msc.desc())
    pos_stmt = select(OpenPositionLive).order_by(OpenPositionLive.updated_at.desc())
    op_stmt = select(BalanceOperation).order_by(BalanceOperation.time_msc.desc())
    if account_id:
        deal_stmt = deal_stmt.where(Deal.account_id == account_id)
        pos_stmt = pos_stmt.where(OpenPositionLive.account_id == account_id)
        op_stmt = op_stmt.where(BalanceOperation.account_id == account_id)

    deals = (await db.execute(deal_stmt)).scalars().all()
    positions = (await db.execute(pos_stmt)).scalars().all()
    ops = (await db.execute(op_stmt)).scalars().all()

    closed_deals = [d for d in deals if d.entry_type in (1, 2)]
    stats = _compute_trade_stats(closed_deals, acc_map)

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="EA580C", end_color="EA580C", fill_type="solid")

    def _style_headers(ws: Any) -> None:
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

    # Sheet 1: Summary
    ws_sum = wb.active
    ws_sum.title = "Summary"
    ws_sum.append(["Metric", "Value"])
    _style_headers(ws_sum)
    total_bal = round(sum(a.last_balance / (a.currency_divisor or 1.0) for a in accounts), 2)
    total_eq = round(sum(a.last_equity / (a.currency_divisor or 1.0) for a in accounts), 2)
    total_fl = round(sum(a.last_floating_pnl / (a.currency_divisor or 1.0) for a in accounts), 2)
    summary_rows = [
        ("Generated At (UTC)", datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")),
        ("Accounts Included", len(accounts)),
        ("Total Balance (USD)", total_bal),
        ("Total Equity (USD)", total_eq),
        ("Floating PnL (USD)", total_fl),
        ("Closed Trades", stats["total_trades"]),
        ("Win Rate (%)", stats["win_rate_pct"]),
        ("Net Realized PnL (USD)", stats["net_pnl_usd"]),
        ("Gross Profit (USD)", stats["gross_profit_usd"]),
        ("Gross Loss (USD)", stats["gross_loss_usd"]),
        ("Total Commission (USD)", stats["total_commission_usd"]),
        ("Total Swap (USD)", stats["total_swap_usd"]),
        ("Profit Factor", stats["profit_factor"]),
        ("Max Drawdown (USD)", stats["max_drawdown_usd"]),
        ("Sharpe Ratio", stats["sharpe_ratio"]),
        ("Total Lots", stats["total_lots"]),
    ]
    for row in summary_rows:
        ws_sum.append(list(row))

    # Sheet 2: Deals
    ws_deals = wb.create_sheet("Deals")
    ws_deals.append(
        [
            "Timestamp (UTC)",
            "Account",
            "Currency",
            "Ticket",
            "Position ID",
            "Magic",
            "Symbol",
            "Side",
            "Entry",
            "Volume",
            "Price",
            "Profit (USD)",
            "Commission (USD)",
            "Swap (USD)",
            "Net PnL (USD)",
            "Comment",
            "Notes",
        ]
    )
    _style_headers(ws_deals)
    for d in deals:
        acc = acc_map.get(d.account_id)
        div = _deal_divisor(d, acc_map)
        ws_deals.append(
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
                round(d.profit / div, 2),
                round(d.commission / div, 2),
                round(d.swap / div, 2),
                round(_deal_net_usd(d, acc_map), 2),
                d.comment,
                d.notes or "",
            ]
        )

    # Sheet 3: Positions
    ws_pos = wb.create_sheet("Positions")
    ws_pos.append(
        [
            "Account",
            "Ticket",
            "Magic",
            "Symbol",
            "Side",
            "Volume",
            "Open Price",
            "Current Price",
            "SL",
            "TP",
            "Floating PnL (USD)",
            "MAE (USD)",
            "MFE (USD)",
        ]
    )
    _style_headers(ws_pos)
    for p in positions:
        acc = acc_map.get(p.account_id)
        ws_pos.append(
            [
                acc.name if acc else p.account_id,
                p.position_ticket,
                p.magic_number,
                p.symbol,
                p.side,
                p.volume,
                p.open_price,
                p.current_price,
                p.sl,
                p.tp,
                round(p.profit_usd, 2),
                round(p.mae_usd, 2),
                round(p.mfe_usd, 2),
            ]
        )

    # Sheet 4: Treasury
    ws_tr = wb.create_sheet("Treasury")
    ws_tr.append(
        [
            "Timestamp (UTC)",
            "Account",
            "Currency",
            "Kind",
            "Amount (Native)",
            "Amount (USD)",
            "Manual",
            "Comment",
            "Notes",
        ]
    )
    _style_headers(ws_tr)
    for o in ops:
        acc = acc_map.get(o.account_id)
        ws_tr.append(
            [
                datetime.fromtimestamp(o.time_msc / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M:%S"),
                acc.name if acc else o.account_id,
                acc.currency if acc else "USD",
                o.op_kind,
                o.amount,
                round(o.amount_usd, 2),
                "YES" if o.is_manual else "NO",
                o.comment,
                o.notes or "",
            ]
        )

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    filename = f"exness_statement_{datetime.now(UTC).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
