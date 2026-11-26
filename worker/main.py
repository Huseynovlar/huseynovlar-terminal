"""Unified background async collector & alert engine for Huseynovlar Terminal.

Syncs:
1. DB Verified News Sources RSS feeds -> `news_items` + `breaking_news` WS publish
2. ForexFactory Economic Calendar -> `economic_events` + `calendar_alert` WS/Webhook
3. Yahoo Finance Treemap & Macro Quotes -> `market_cache` + `macro_quotes` WS publish
4. Alert Rules (`config/alerts.default.yaml`) -> Redis Pub/Sub `terminal:live` + `server_telegram_bot` webhook
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from app.core.config import Settings, get_settings
from app.core.database import build_engine, get_session_factory
from app.core.ws_hub import ws_hub
from app.db.models import BalanceOperation, Deal, EconomicEvent, Robot, TradingAccount
from app.db.schema_sync import reconcile_schema
from app.modules.charts.router import refresh_macro_quotes
from app.modules.intelligence.router import (
    refresh_treemap_universe,
    run_calendar_refresh,
    run_news_refresh,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(levelname)s %(message)s")
logger = logging.getLogger("terminal.worker")


async def send_telegram_webhook(
    settings: Settings,
    *,
    title: str,
    message: str,
    severity: str = "info",
    symbol: str | None = None,
    account_login: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Deliver a trading/infrastructure alert to `server_telegram_bot` (`POST /internal/webhooks/trading`)."""
    url = (settings.alerts_bot_webhook_url or "").strip()
    if not url:
        return False
    headers = {"Content-Type": "application/json"}
    secret = (settings.alerts_bot_webhook_secret or "").strip()
    if secret:
        headers["X-Trading-Webhook-Secret"] = secret

    payload: dict[str, Any] = {
        "title": title,
        "message": message,
        "severity": severity,
        "source": "huseynovlar-terminal",
        "metadata": metadata or {},
    }
    if symbol:
        payload["symbol"] = symbol
    if account_login:
        payload["account_login"] = account_login

    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            resp = await http.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return True
    except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
        logger.warning("Webhook delivery failed (%s): %s", url, exc)
        return False


def _can_fire(cooldown_state: dict[str, float], key: str, cooldown_sec: int, now_ts: float) -> bool:
    last = cooldown_state.get(key)
    if last is not None and (now_ts - last) < cooldown_sec:
        return False
    cooldown_state[key] = now_ts
    return True


async def sync_news_cycle(db: AsyncSession, settings: Settings) -> dict[str, Any]:
    stats = await run_news_refresh(db, settings)
    logger.info(
        "News cycle: inserted=%s corroborated=%s checked=%s failed=%s",
        stats["inserted"],
        stats["corroborated"],
        stats["sources_checked"],
        len(stats["failed_sources"]),
    )
    return stats


async def sync_calendar_cycle(db: AsyncSession, settings: Settings) -> dict[str, Any]:
    stats = await run_calendar_refresh(db, settings)
    logger.info(
        "Calendar cycle: inserted=%s updated=%s errors=%s",
        stats["inserted"],
        stats["updated"],
        len(stats["errors"]),
    )
    return stats


async def sync_market_cycle(
    db: AsyncSession,
    settings: Settings,
    universes: list[str] | None = None,
) -> dict[str, Any]:
    quotes = await refresh_macro_quotes(db, settings)
    await ws_hub.broadcast("macro_quotes", {"quotes": quotes, "ts": datetime.now(UTC).isoformat()})

    target_universes = universes or [
        "sp500_top",
        "nasdaq100",
        "gold_commodities",
        "global_leaders",
        "crypto_majors",
        "forex_majors",
    ]
    refreshed: dict[str, int] = {}
    for uni in target_universes:
        try:
            res = await refresh_treemap_universe(db, settings, uni, "1D")
            refreshed[uni] = int(res.get("live_tickers", 0))
        except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
            logger.warning("Treemap refresh failed for %s: %s", uni, exc)
            refreshed[uni] = 0
    return {"macro_quotes": len(quotes), "treemap_live": refreshed}


async def evaluate_alert_rules(
    db: AsyncSession,
    settings: Settings,
    cooldown_state: dict[str, float],
) -> list[dict[str, Any]]:
    """Evaluate `config/alerts.default.yaml` rules against live accounts, robots, treasury & calendar."""
    cfg = settings.load_yaml_config("alerts.default.yaml")
    rules = {str(r["code"]): r for r in cfg.get("rules", []) if r.get("enabled", True)}
    if not rules:
        return []

    now = datetime.now(UTC)
    now_ts = time.monotonic()
    fired: list[dict[str, Any]] = []

    accounts = (await db.execute(select(TradingAccount).where(TradingAccount.is_active.is_(True)))).scalars().all()
    robots = (await db.execute(select(Robot).where(Robot.is_active.is_(True)))).scalars().all()

    async def _emit(
        rule_code: str,
        entity_key: str,
        title: str,
        message: str,
        severity: str,
        *,
        event_type: str = "alert",
        symbol: str | None = None,
        account_login: str | None = None,
    ) -> None:
        rule = rules.get(rule_code)
        if not rule:
            return
        cooldown = int(rule.get("cooldown_sec") or 300)
        if not _can_fire(cooldown_state, f"{rule_code}:{entity_key}", cooldown, now_ts):
            return
        alert_obj = {
            "rule": rule_code,
            "title": title,
            "message": message,
            "severity": severity,
            "symbol": symbol,
            "account_login": account_login,
            "ts": now.isoformat(),
        }
        fired.append(alert_obj)
        await ws_hub.broadcast(event_type, alert_obj)
        await send_telegram_webhook(
            settings,
            title=title,
            message=message,
            severity=severity,
            symbol=symbol,
            account_login=account_login,
            metadata={"rule": rule_code},
        )

    for acc in accounts:
        div = acc.currency_divisor or 1.0
        bal_usd = acc.last_balance / div
        eq_usd = acc.last_equity / div

        # 1. Heartbeat offline
        if "heartbeat_offline" in rules and acc.last_seen_at is not None:
            last_seen = acc.last_seen_at
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=UTC)
            age_sec = (now - last_seen).total_seconds()
            threshold = float(rules["heartbeat_offline"].get("threshold_sec", 45))
            if age_sec > threshold:
                await _emit(
                    "heartbeat_offline",
                    acc.id,
                    f"MT5 Offline: {acc.name}",
                    f"Account {acc.mt5_login} has not reported for {int(age_sec)}s (threshold {int(threshold)}s).",
                    "critical",
                    account_login=acc.mt5_login,
                )

        # 2. Drawdown warning / critical
        if bal_usd > 0 and eq_usd < bal_usd:
            dd_pct = ((bal_usd - eq_usd) / bal_usd) * 100.0
            crit_rule = rules.get("drawdown_critical")
            warn_rule = rules.get("drawdown_warning")
            if crit_rule and dd_pct >= float(crit_rule.get("threshold_pct", 10.0)):
                await _emit(
                    "drawdown_critical",
                    acc.id,
                    f"Critical Drawdown: {acc.name} (-{dd_pct:.1f}%)",
                    f"Equity ${eq_usd:.2f} vs Balance ${bal_usd:.2f}.",
                    "critical",
                    account_login=acc.mt5_login,
                )
            elif warn_rule and dd_pct >= float(warn_rule.get("threshold_pct", 5.0)):
                await _emit(
                    "drawdown_warning",
                    acc.id,
                    f"Drawdown Warning: {acc.name} (-{dd_pct:.1f}%)",
                    f"Equity ${eq_usd:.2f} vs Balance ${bal_usd:.2f}.",
                    "warning",
                    account_login=acc.mt5_login,
                )

        # 3. Low margin level
        if "low_margin_level" in rules and acc.last_margin_level > 0:
            thresh = float(rules["low_margin_level"].get("threshold_pct", 300.0))
            if acc.last_margin_level < thresh:
                await _emit(
                    "low_margin_level",
                    acc.id,
                    f"Low Margin Level: {acc.name} ({acc.last_margin_level:.0f}%)",
                    f"Account {acc.mt5_login} margin level fell below {thresh:.0f}%.",
                    "critical",
                    account_login=acc.mt5_login,
                )

        # 4. AlgoTrading disabled
        if "algotrading_disabled" in rules and acc.terminal_connected and not acc.algo_trading_enabled:
            await _emit(
                "algotrading_disabled",
                acc.id,
                f"AlgoTrading Disabled: {acc.name}",
                f"MT5 terminal {acc.mt5_login} is connected but AlgoTrading is OFF.",
                "warning",
                account_login=acc.mt5_login,
            )

    # 5. Robot error state
    if "robot_error_state" in rules:
        for r in robots:
            if (r.live_status or "").upper() in {"ERROR", "CRASHED", "HALTED", "STOPPED_ERROR"}:
                await _emit(
                    "robot_error_state",
                    r.id,
                    f"Robot Error: {r.name}",
                    f"Robot {r.name} (Magic #{r.magic_number}, {r.symbol}) reported status {r.live_status}.",
                    "critical",
                    symbol=r.symbol,
                )

    # 6. High-impact economic calendar countdown
    if "high_impact_news_soon" in rules:
        lead_min = int(rules["high_impact_news_soon"].get("lead_minutes", 15))
        window_end = now + timedelta(minutes=lead_min)
        upcoming = (
            (
                await db.execute(
                    select(EconomicEvent).where(
                        EconomicEvent.impact == "High",
                        EconomicEvent.event_time >= now,
                        EconomicEvent.event_time <= window_end,
                    )
                )
            )
            .scalars()
            .all()
        )
        for ev in upcoming:
            await _emit(
                "high_impact_news_soon",
                ev.id,
                f"High-Impact Event Soon: {ev.currency} — {ev.title}",
                f"Scheduled at {ev.event_time.strftime('%H:%M UTC')} (Forecast: {ev.forecast or 'N/A'}).",
                "info",
                event_type="calendar_alert",
            )

    # 7. Vault profit target reached
    if "vault_profit_target" in rules:
        target_usd = float(rules["vault_profit_target"].get("threshold_usd", 500.0))
        deals = (await db.execute(select(Deal).where(Deal.entry_type.in_([1, 2])))).scalars().all()
        ops = (await db.execute(select(BalanceOperation))).scalars().all()
        realized = sum(d.net_profit_usd for d in deals)
        vaulted = abs(sum(o.amount_usd for o in ops if o.op_kind == "EXNESS_VAULT" and o.amount_usd < 0))
        withdrawn = abs(sum(o.amount_usd for o in ops if o.op_kind == "WITHDRAWAL" and o.amount_usd < 0))
        ready = realized - vaulted - withdrawn
        if ready >= target_usd:
            await _emit(
                "vault_profit_target",
                "portfolio",
                f"Vault Target Reached: ${ready:.2f}",
                f"Realized profit ready for Exness Vault (${ready:.2f}) exceeded target ${target_usd:.2f}.",
                "info",
            )

    return fired


async def run_worker_loop() -> None:
    logger.info("Huseynovlar Terminal Unified Worker started (News, Calendar, Market, Alerts)")
    settings = get_settings()

    engine = build_engine(settings.database_url)
    try:
        await reconcile_schema(engine)
    finally:
        await engine.dispose()

    await ws_hub.start_redis_bridge(settings.redis_url)
    session_factory = get_session_factory()
    cooldown_state: dict[str, float] = {}

    last_news = 0.0
    last_cal = 0.0
    last_mkt = 0.0

    try:
        while True:
            now_mono = time.monotonic()

            if now_mono - last_news >= 180:
                try:
                    async with session_factory() as db:
                        await sync_news_cycle(db, settings)
                except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
                    logger.warning("News cycle error: %s", exc)
                last_news = now_mono

            if now_mono - last_cal >= 900:
                try:
                    async with session_factory() as db:
                        await sync_calendar_cycle(db, settings)
                except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
                    logger.warning("Calendar cycle error: %s", exc)
                last_cal = now_mono

            if now_mono - last_mkt >= 120:
                try:
                    async with session_factory() as db:
                        await sync_market_cycle(db, settings)
                except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
                    logger.warning("Market cycle error: %s", exc)
                last_mkt = now_mono

            try:
                async with session_factory() as db:
                    await evaluate_alert_rules(db, settings, cooldown_state)
            except Exception as exc:  # noqa: BLE001 - worker loop must survive any failure
                logger.warning("Alert evaluation error: %s", exc)

            await asyncio.sleep(30)
    finally:
        await ws_hub.stop_redis_bridge()


if __name__ == "__main__":
    asyncio.run(run_worker_loop())
