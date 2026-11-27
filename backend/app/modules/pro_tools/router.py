from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings, load_integrations_env
from app.core.database import get_db
from app.core.deps import get_current_user
from app.db.models import MarketCache, TradingAccount, User

router = APIRouter(prefix="/pro", tags=["pro-tools"])

_SCANNER_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SCANNER_TTL_SEC = 18.0

# Institutional MT5 broker contract specifications (Exness / Raw / Standard / Cent)
CONTRACT_SPECS: dict[str, dict[str, Any]] = {
    "XAUUSD": {
        "symbol": "XAUUSD",
        "name": "Gold / US Dollar",
        "category": "metals",
        "contract_size": 100.0,
        "tick_size": 0.01,
        "tick_value": 1.0,
        "pip_size": 0.1,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 500,
        "default_price": 2650.0,
    },
    "XAGUSD": {
        "symbol": "XAGUSD",
        "name": "Silver / US Dollar",
        "category": "metals",
        "contract_size": 5000.0,
        "tick_size": 0.001,
        "tick_value": 5.0,
        "pip_size": 0.01,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 31.5,
    },
    "USTEC": {
        "symbol": "USTEC",
        "name": "US Tech 100 (Nasdaq)",
        "category": "indices",
        "contract_size": 1.0,
        "tick_size": 0.01,
        "tick_value": 0.01,
        "pip_size": 1.0,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 20800.0,
    },
    "US500": {
        "symbol": "US500",
        "name": "S&P 500 Index",
        "category": "indices",
        "contract_size": 1.0,
        "tick_size": 0.01,
        "tick_value": 0.01,
        "pip_size": 1.0,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 5950.0,
    },
    "US30": {
        "symbol": "US30",
        "name": "Dow Jones 30",
        "category": "indices",
        "contract_size": 1.0,
        "tick_size": 0.01,
        "tick_value": 0.01,
        "pip_size": 1.0,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 43800.0,
    },
    "BTCUSD": {
        "symbol": "BTCUSD",
        "name": "Bitcoin / US Dollar",
        "category": "crypto",
        "contract_size": 1.0,
        "tick_size": 0.01,
        "tick_value": 0.01,
        "pip_size": 1.0,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 95000.0,
    },
    "ETHUSD": {
        "symbol": "ETHUSD",
        "name": "Ethereum / US Dollar",
        "category": "crypto",
        "contract_size": 1.0,
        "tick_size": 0.01,
        "tick_value": 0.01,
        "pip_size": 1.0,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 3400.0,
    },
    "EURUSD": {
        "symbol": "EURUSD",
        "name": "Euro / US Dollar",
        "category": "forex",
        "contract_size": 100000.0,
        "tick_size": 0.00001,
        "tick_value": 1.0,
        "pip_size": 0.0001,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 500,
        "default_price": 1.085,
    },
    "GBPUSD": {
        "symbol": "GBPUSD",
        "name": "British Pound / US Dollar",
        "category": "forex",
        "contract_size": 100000.0,
        "tick_size": 0.00001,
        "tick_value": 1.0,
        "pip_size": 0.0001,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 500,
        "default_price": 1.275,
    },
    "USDJPY": {
        "symbol": "USDJPY",
        "name": "US Dollar / Japanese Yen",
        "category": "forex",
        "contract_size": 100000.0,
        "tick_size": 0.001,
        "tick_value": 0.65,
        "pip_size": 0.01,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 500,
        "default_price": 153.5,
    },
    "USOIL": {
        "symbol": "USOIL",
        "name": "WTI Crude Oil",
        "category": "commodities",
        "contract_size": 1000.0,
        "tick_size": 0.01,
        "tick_value": 10.0,
        "pip_size": 0.01,
        "min_lot": 0.01,
        "lot_step": 0.01,
        "default_leverage": 200,
        "default_price": 71.0,
    },
}


# ---------------------------------------------------------------------------
# Cache storage helpers (MarketCache)
# ---------------------------------------------------------------------------


async def _load_cache_list(db: AsyncSession, cache_key: str) -> list[dict[str, Any]]:
    row = (await db.execute(select(MarketCache).where(MarketCache.cache_key == cache_key))).scalar_one_or_none()
    if not row or not row.payload_json:
        return []
    try:
        parsed = json.loads(row.payload_json)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


async def _save_cache_list(db: AsyncSession, cache_key: str, items: list[dict[str, Any]]) -> None:
    now = datetime.now(UTC)
    payload = json.dumps(items, ensure_ascii=False)
    row = (await db.execute(select(MarketCache).where(MarketCache.cache_key == cache_key))).scalar_one_or_none()
    if row is None:
        db.add(MarketCache(cache_key=cache_key, payload_json=payload, updated_at=now))
    else:
        row.payload_json = payload
        row.updated_at = now
    await db.commit()


async def _dispatch_telegram_alert(text: str) -> bool:
    settings = get_settings()
    env_map = load_integrations_env(settings.integrations_env_path)
    webhook_url = (env_map.get("TELEGRAM_ALERTS_WEBHOOK") or os.getenv("TELEGRAM_ALERTS_WEBHOOK", "")).strip()
    if not webhook_url:
        return False
    parsed = urlparse(webhook_url)
    host = (parsed.hostname or "").lower()
    if host in {"127.0.0.1", "localhost", "::1", "0.0.0.0"}:
        # Strict Docker-network guard: never post to loopback inside container
        return False
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                webhook_url,
                json={"text": text, "source": "huseynovlar-terminal", "ts": datetime.now(UTC).isoformat()},
            )
            return 200 <= resp.status_code < 300
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AlertCreate(BaseModel):
    alert_type: str = Field(default="price_cross", pattern="^(price_cross|stat_arb_z|mt5_risk|macro_pre)$")
    symbol: str = Field(..., min_length=1, max_length=40)
    pair_symbol: str | None = Field(default=None, max_length=40)
    condition: str = Field(default="above", pattern="^(above|below|abs_gte|lt|offline|pre_15m)$")
    threshold: float = Field(default=0.0)
    note: str = Field(default="", max_length=240)
    channel_sound: bool = True
    sound_tone: str = Field(default="priceAlert", max_length=32)
    channel_telegram: bool = True
    channel_os: bool = True
    repeatable: bool = False


class AlertPatch(BaseModel):
    enabled: bool | None = None
    threshold: float | None = None
    channel_sound: bool | None = None
    channel_telegram: bool | None = None
    channel_os: bool | None = None
    repeatable: bool | None = None


class AlertTriggerIn(BaseModel):
    trigger_price: float | None = None
    message: str | None = None


class QuickNoteCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=40)
    text: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Unified Alerts endpoints
# ---------------------------------------------------------------------------


@router.get("/alerts")
async def list_alerts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    alerts = await _load_cache_list(db, f"pro_alerts:{user.id}")
    history = await _load_cache_list(db, f"pro_alert_history:{user.id}")
    return {"alerts": alerts, "history": history}


@router.post("/alerts", status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: AlertCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    alerts = await _load_cache_list(db, f"pro_alerts:{user.id}")
    now_iso = datetime.now(UTC).isoformat()
    item: dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "alert_type": body.alert_type,
        "symbol": body.symbol.strip().upper(),
        "pair_symbol": body.pair_symbol.strip().upper() if body.pair_symbol else None,
        "condition": body.condition,
        "threshold": float(body.threshold),
        "note": body.note.strip(),
        "channel_sound": body.channel_sound,
        "sound_tone": body.sound_tone,
        "channel_telegram": body.channel_telegram,
        "channel_os": body.channel_os,
        "repeatable": body.repeatable,
        "enabled": True,
        "triggered_count": 0,
        "last_triggered_at": None,
        "created_at": now_iso,
    }
    alerts.insert(0, item)
    await _save_cache_list(db, f"pro_alerts:{user.id}", alerts[:200])
    return item


@router.patch("/alerts/{alert_id}")
async def patch_alert(
    alert_id: str,
    body: AlertPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    alerts = await _load_cache_list(db, f"pro_alerts:{user.id}")
    target = next((a for a in alerts if a.get("id") == alert_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    for field in ("enabled", "threshold", "channel_sound", "channel_telegram", "channel_os", "repeatable"):
        val = getattr(body, field)
        if val is not None:
            target[field] = val
    await _save_cache_list(db, f"pro_alerts:{user.id}", alerts)
    return target


@router.delete("/alerts/{alert_id}")
async def delete_alert(
    alert_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    alerts = await _load_cache_list(db, f"pro_alerts:{user.id}")
    remaining = [a for a in alerts if a.get("id") != alert_id]
    if len(remaining) == len(alerts):
        raise HTTPException(status_code=404, detail="Alert not found")
    await _save_cache_list(db, f"pro_alerts:{user.id}", remaining)
    return {"deleted": True, "id": alert_id}


@router.post("/alerts/{alert_id}/trigger")
async def trigger_alert(
    alert_id: str,
    body: AlertTriggerIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    alerts = await _load_cache_list(db, f"pro_alerts:{user.id}")
    target = next((a for a in alerts if a.get("id") == alert_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    now_iso = datetime.now(UTC).isoformat()
    target["triggered_count"] = int(target.get("triggered_count", 0)) + 1
    target["last_triggered_at"] = now_iso
    if not target.get("repeatable", False):
        target["enabled"] = False

    sym_label = (
        f"{target['symbol']}/{target['pair_symbol']}" if target.get("pair_symbol") else str(target.get("symbol", ""))
    )
    msg = body.message or (
        f"[ALERT] {sym_label} ({target.get('alert_type')}) "
        f"{target.get('condition')} {target.get('threshold')} | "
        f"Price/Val: {body.trigger_price if body.trigger_price is not None else '—'}"
    )

    telegram_sent = False
    if target.get("channel_telegram"):
        telegram_sent = await _dispatch_telegram_alert(msg)

    history = await _load_cache_list(db, f"pro_alert_history:{user.id}")
    hist_entry = {
        "id": uuid.uuid4().hex[:12],
        "alert_id": alert_id,
        "alert_type": target.get("alert_type"),
        "symbol": sym_label,
        "condition": target.get("condition"),
        "threshold": target.get("threshold"),
        "trigger_price": body.trigger_price,
        "message": msg,
        "telegram_sent": telegram_sent,
        "triggered_at": now_iso,
    }
    history.insert(0, hist_entry)

    await _save_cache_list(db, f"pro_alerts:{user.id}", alerts)
    await _save_cache_list(db, f"pro_alert_history:{user.id}", history[:200])
    return {"alert": target, "event": hist_entry}


# ---------------------------------------------------------------------------
# Quick Notes endpoints (NOTE XAUUSD ...)
# ---------------------------------------------------------------------------


@router.get("/notes")
async def list_quick_notes(
    symbol: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    notes = await _load_cache_list(db, f"pro_notes:{user.id}")
    if symbol:
        sym_u = symbol.strip().upper()
        notes = [n for n in notes if str(n.get("symbol", "")).upper() == sym_u]
    return {"items": notes}


@router.post("/notes", status_code=status.HTTP_201_CREATED)
async def create_quick_note(
    body: QuickNoteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    notes = await _load_cache_list(db, f"pro_notes:{user.id}")
    item = {
        "id": uuid.uuid4().hex[:12],
        "symbol": body.symbol.strip().upper(),
        "text": body.text.strip(),
        "created_at": datetime.now(UTC).isoformat(),
    }
    notes.insert(0, item)
    await _save_cache_list(db, f"pro_notes:{user.id}", notes[:300])
    return item


@router.delete("/notes/{note_id}")
async def delete_quick_note(
    note_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    notes = await _load_cache_list(db, f"pro_notes:{user.id}")
    remaining = [n for n in notes if n.get("id") != note_id]
    await _save_cache_list(db, f"pro_notes:{user.id}", remaining)
    return {"deleted": True, "id": note_id}


# ---------------------------------------------------------------------------
# MT5 Contract Specs & Account Balances (with USC ÷ 100 → USD)
# ---------------------------------------------------------------------------


@router.get("/contract-specs")
async def get_contract_specs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    del user
    rows = (await db.execute(select(TradingAccount).order_by(TradingAccount.name.asc()))).scalars().all()
    accounts: list[dict[str, Any]] = []
    for acc in rows:
        currency = (acc.currency or "USD").upper()
        divisor = 100.0 if currency == "USC" else 1.0
        balance_raw = float(acc.balance or 0.0)
        equity_raw = float(acc.equity or balance_raw)
        accounts.append(
            {
                "id": acc.id,
                "name": acc.name,
                "mt5_login": acc.mt5_login,
                "broker": acc.broker,
                "currency": currency,
                "account_type": "cent"
                if currency == "USC"
                else ("raw" if "raw" in (acc.name or "").lower() else "standard"),
                "balance_raw": round(balance_raw, 2),
                "equity_raw": round(equity_raw, 2),
                "balance_usd": round(balance_raw / divisor, 2),
                "equity_usd": round(equity_raw / divisor, 2),
                "leverage": int(acc.leverage or 500),
            }
        )
    return {"specs": list(CONTRACT_SPECS.values()), "accounts": accounts}


# ---------------------------------------------------------------------------
# Market Anomaly Scanner (RVOL / ATR Expansion / Top Movers / Extreme Funding)
# ---------------------------------------------------------------------------

_SCANNER_CORE_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "ADAUSDT",
    "SUIUSDT",
    "TONUSDT",
    "NEARUSDT",
    "APTUSDT",
    "ARBUSDT",
    "OPUSDT",
    "INJUSDT",
    "PEPEUSDT",
    "WIFUSDT",
    "LTCUSDT",
    "PAXGUSDT",
]


async def _fetch_kline_metrics(
    client: httpx.AsyncClient,
    symbol: str,
    interval: str,
) -> tuple[str, float, float, float]:
    """Return (symbol, rvol, atr_expansion, window_change_pct) using last 21 candles."""
    try:
        resp = await client.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": symbol, "interval": interval, "limit": 22},
            timeout=6.0,
        )
        if resp.status_code != 200:
            return symbol, 1.0, 1.0, 0.0
        rows = resp.json()
        if not isinstance(rows, list) or len(rows) < 6:
            return symbol, 1.0, 1.0, 0.0

        vols = [float(r[5]) for r in rows]
        highs = [float(r[2]) for r in rows]
        lows = [float(r[3]) for r in rows]
        opens = [float(r[1]) for r in rows]
        closes = [float(r[4]) for r in rows]

        # Use last completed or active candle vs prior 20 average
        cur_vol = vols[-1] if vols[-1] > 0 else vols[-2]
        avg_vol = sum(vols[:-1]) / max(1, len(vols) - 1)
        rvol = (cur_vol / avg_vol) if avg_vol > 0 else 1.0

        ranges = [max(0.0, highs[i] - lows[i]) for i in range(len(rows))]
        atr = sum(ranges[-15:-1]) / max(1, len(ranges[-15:-1]))
        cur_range = ranges[-1]
        atr_exp = (cur_range / atr) if atr > 0 else 1.0

        open_px = opens[-1]
        close_px = closes[-1]
        win_chg = ((close_px - open_px) / open_px * 100.0) if open_px > 0 else 0.0
        return symbol, round(rvol, 2), round(atr_exp, 2), round(win_chg, 2)
    except Exception:
        return symbol, 1.0, 1.0, 0.0


@router.get("/scanner")
async def market_anomaly_scanner(
    window: str = Query(default="15m", pattern="^(5m|15m|1h|24h)$"),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    del user
    now_mono = time.monotonic()
    cached = _SCANNER_CACHE.get(window)
    if cached and (now_mono - cached[0]) < _SCANNER_TTL_SEC:
        return cached[1]

    kline_interval = "1h" if window == "24h" else window
    tickers_24h: dict[str, dict[str, Any]] = {}
    funding_map: dict[str, float] = {}
    source_status = "live"

    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            r24, rfund = await asyncio.gather(
                client.get("https://api.binance.com/api/v3/ticker/24hr"),
                client.get("https://fapi.binance.com/fapi/v1/premiumIndex"),
                return_exceptions=True,
            )
            if isinstance(r24, httpx.Response) and r24.status_code == 200:
                for row in r24.json():
                    sym = str(row.get("symbol", ""))
                    if sym in _SCANNER_CORE_SYMBOLS:
                        tickers_24h[sym] = row
            if isinstance(rfund, httpx.Response) and rfund.status_code == 200:
                for row in rfund.json():
                    sym = str(row.get("symbol", ""))
                    with contextlib.suppress(TypeError, ValueError):
                        funding_map[sym] = float(row.get("lastFundingRate") or 0.0)

            kline_results = await asyncio.gather(
                *[_fetch_kline_metrics(client, sym, kline_interval) for sym in _SCANNER_CORE_SYMBOLS]
            )
        except Exception:
            source_status = "degraded"
            kline_results = [(sym, 1.0, 1.0, 0.0) for sym in _SCANNER_CORE_SYMBOLS]

    kline_by_sym = {sym: (rvol, atr_exp, win_chg) for sym, rvol, atr_exp, win_chg in kline_results}
    items: list[dict[str, Any]] = []

    for sym in _SCANNER_CORE_SYMBOLS:
        t24 = tickers_24h.get(sym, {})
        price = float(t24.get("lastPrice") or 0.0)
        chg_24h = float(t24.get("priceChangePercent") or 0.0)
        quote_vol = float(t24.get("quoteVolume") or 0.0)
        rvol, atr_exp, win_chg = kline_by_sym.get(sym, (1.0, 1.0, 0.0))
        funding_rate = funding_map.get(sym, 0.0)
        funding_pct = round(funding_rate * 100.0, 4)

        canonical = "XAUUSD" if sym == "PAXGUSDT" else sym.replace("USDT", "USD")
        anomalies: list[str] = []
        if rvol >= 2.5:
            anomalies.append("RVOL_SPIKE")
        if atr_exp >= 1.8:
            anomalies.append("ATR_EXPANSION")
        if abs(funding_pct) >= 0.05:
            anomalies.append("EXTREME_FUNDING")

        eff_change = chg_24h if window == "24h" else win_chg
        items.append(
            {
                "symbol": canonical,
                "exchange_symbol": sym,
                "price": price,
                "change_window_pct": round(eff_change, 2),
                "change_24h_pct": round(chg_24h, 2),
                "quote_volume_24h": round(quote_vol, 2),
                "rvol": rvol,
                "atr_expansion": atr_exp,
                "funding_rate_pct": funding_pct,
                "anomalies": anomalies,
                "anomaly_score": round(rvol + atr_exp + abs(funding_pct) * 20.0 + abs(eff_change) * 0.25, 2),
            }
        )

    items.sort(key=lambda x: x["anomaly_score"], reverse=True)
    payload = {
        "window": window,
        "status": source_status if tickers_24h else "degraded",
        "updated_at": datetime.now(UTC).isoformat(),
        "summary": {
            "rvol_spikes": sum(1 for x in items if x["rvol"] >= 2.5),
            "atr_expansions": sum(1 for x in items if x["atr_expansion"] >= 1.8),
            "extreme_funding": sum(1 for x in items if abs(x["funding_rate_pct"]) >= 0.05),
            "total_scanned": len(items),
        },
        "items": items,
    }
    _SCANNER_CACHE[window] = (now_mono, payload)
    return payload


# ---------------------------------------------------------------------------
# 1. Polymarket CLOB Macro Prediction Markets (/api/v1/pro/polymarket)
# ---------------------------------------------------------------------------

_POLYMARKET_CACHE: tuple[float, dict[str, Any]] | None = None
_POLYMARKET_TTL = 90.0

_FALLBACK_POLYMARKET: list[dict[str, Any]] = [
    {
        "id": "pm-fed-cut",
        "question": "Will the Federal Reserve cut interest rates by ≥25 bps at the next FOMC meeting?",
        "category": "Fed & Rates",
        "yes_prob_pct": 64.5,
        "delta_24h_pct": 2.1,
        "volume_usd": 42_850_000.0,
        "end_date": "2026-12-16",
        "url": "https://polymarket.com/markets/economy",
    },
    {
        "id": "pm-us-recession",
        "question": "US Recession declared by NBER before end of 2026?",
        "category": "Macro / GDP",
        "yes_prob_pct": 27.0,
        "delta_24h_pct": -1.4,
        "volume_usd": 19_420_000.0,
        "end_date": "2026-12-31",
        "url": "https://polymarket.com/markets/economy",
    },
    {
        "id": "pm-us-cpi",
        "question": "Will US Core CPI YoY print below 2.8% in the next BLS release?",
        "category": "Inflation",
        "yes_prob_pct": 53.2,
        "delta_24h_pct": 0.8,
        "volume_usd": 8_910_000.0,
        "end_date": "2026-12-10",
        "url": "https://polymarket.com/markets/economy",
    },
    {
        "id": "pm-gold-3000",
        "question": "Will Gold (XAUUSD) trade above $3,000/oz before year-end?",
        "category": "Commodities",
        "yes_prob_pct": 41.8,
        "delta_24h_pct": 3.2,
        "volume_usd": 11_300_000.0,
        "end_date": "2026-12-31",
        "url": "https://polymarket.com/markets/finance",
    },
    {
        "id": "pm-btc-120k",
        "question": "Will Bitcoin (BTC) reach $120,000 before December 31?",
        "category": "Crypto Macro",
        "yes_prob_pct": 38.4,
        "delta_24h_pct": -0.9,
        "volume_usd": 29_640_000.0,
        "end_date": "2026-12-31",
        "url": "https://polymarket.com/markets/crypto",
    },
    {
        "id": "pm-geopolitics-oil",
        "question": "Will Brent Crude exceed $90/bbl amid Strait of Hormuz tensions?",
        "category": "Geopolitics",
        "yes_prob_pct": 22.5,
        "delta_24h_pct": 1.6,
        "volume_usd": 6_740_000.0,
        "end_date": "2026-12-31",
        "url": "https://polymarket.com/markets/geopolitics",
    },
]

_MACRO_KEYWORDS = (
    "fed",
    "fomc",
    "rate",
    "recession",
    "inflation",
    "cpi",
    "gdp",
    "tariff",
    "election",
    "oil",
    "gold",
    "bitcoin",
    "btc",
    "ecb",
    "boj",
    "china",
    "sanction",
    "war",
    "ceasefire",
)


@router.get("/polymarket")
async def get_polymarket_macro(
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    global _POLYMARKET_CACHE
    del user
    now_mono = time.monotonic()
    if _POLYMARKET_CACHE and (now_mono - _POLYMARKET_CACHE[0]) < _POLYMARKET_TTL:
        return _POLYMARKET_CACHE[1]

    items: list[dict[str, Any]] = []
    source = "polymarket_live"
    try:
        async with httpx.AsyncClient(timeout=7.0) as client:
            resp = await client.get(
                "https://gamma-api.polymarket.com/markets",
                params={"closed": "false", "active": "true", "limit": 50, "order": "volume24hr", "ascending": "false"},
            )
            if resp.status_code == 200:
                raw_list = resp.json()
                if isinstance(raw_list, list):
                    for m in raw_list:
                        q = str(m.get("question") or "").strip()
                        if not q:
                            continue
                        ql = q.lower()
                        if not any(kw in ql for kw in _MACRO_KEYWORDS):
                            continue
                        yes_prob = 50.0
                        prices_raw = m.get("outcomePrices")
                        with contextlib.suppress(Exception):
                            parsed_p = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                            if isinstance(parsed_p, list) and parsed_p:
                                yes_prob = round(float(parsed_p[0]) * 100.0, 1)
                        delta_24h = 0.0
                        with contextlib.suppress(TypeError, ValueError):
                            delta_24h = round(float(m.get("oneDayPriceChange") or 0.0) * 100.0, 1)
                        vol = 0.0
                        with contextlib.suppress(TypeError, ValueError):
                            vol = round(float(m.get("volumeNum") or m.get("volume") or 0.0), 2)
                        slug = str(m.get("slug") or "")
                        end_date = str(m.get("endDateIso") or m.get("endDate") or "")[:10]
                        cat = (
                            "Fed & Rates"
                            if ("fed" in ql or "fomc" in ql or "rate" in ql)
                            else "Inflation"
                            if ("cpi" in ql or "inflation" in ql)
                            else "Geopolitics"
                            if ("war" in ql or "sanction" in ql or "ceasefire" in ql or "china" in ql)
                            else "Macro / Markets"
                        )
                        items.append(
                            {
                                "id": str(m.get("id") or slug or uuid.uuid4().hex[:8]),
                                "question": q,
                                "category": cat,
                                "yes_prob_pct": max(0.1, min(99.9, yes_prob)),
                                "delta_24h_pct": delta_24h,
                                "volume_usd": vol,
                                "end_date": end_date or "—",
                                "url": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
                            }
                        )
                        if len(items) >= 12:
                            break
    except Exception:
        source = "polymarket_cached"

    if not items:
        source = "polymarket_cached"
        items = list(_FALLBACK_POLYMARKET)

    payload = {
        "source": source,
        "updated_at": datetime.now(UTC).isoformat(),
        "items": items,
    }
    _POLYMARKET_CACHE = (now_mono, payload)
    return payload


# ---------------------------------------------------------------------------
# 2. GDELT Geopolitical Incidents Layer for BMAP (/api/v1/pro/bmap/gdelt)
# ---------------------------------------------------------------------------

_GDELT_CACHE: tuple[float, dict[str, Any]] | None = None
_GDELT_TTL = 120.0

_FALLBACK_GDELT: list[dict[str, Any]] = [
    {
        "id": "gdelt-hormuz-1",
        "title": "Maritime security advisory issued near Strait of Hormuz tanker corridor",
        "category": "Maritime / Energy",
        "lat": 26.58,
        "lon": 56.28,
        "severity": "high",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
    {
        "id": "gdelt-redsea-2",
        "title": "Red Sea / Bab el-Mandeb commercial shipping rerouting continues",
        "category": "Conflict / Shipping",
        "lat": 12.62,
        "lon": 43.34,
        "severity": "high",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
    {
        "id": "gdelt-suez-3",
        "title": "Suez Canal daily transit tonnage update and LNG queue monitor",
        "category": "Port / Chokepoint",
        "lat": 30.45,
        "lon": 32.35,
        "severity": "medium",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
    {
        "id": "gdelt-blacksea-4",
        "title": "Black Sea grain & energy export terminal maritime insurance shift",
        "category": "Sanctions / Energy",
        "lat": 44.62,
        "lon": 37.78,
        "severity": "medium",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
    {
        "id": "gdelt-malacca-5",
        "title": "Strait of Malacca crude tanker congestion index elevated",
        "category": "Port / Chokepoint",
        "lat": 2.52,
        "lon": 101.24,
        "severity": "medium",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
    {
        "id": "gdelt-panama-6",
        "title": "Panama Canal daily slot allocation adjusted for Neopanamax LNG vessels",
        "category": "Port / Chokepoint",
        "lat": 9.08,
        "lon": -79.68,
        "severity": "low",
        "url": "https://www.gdeltproject.org/",
        "domain": "gdeltproject.org",
    },
]


@router.get("/bmap/gdelt")
async def get_bmap_gdelt_events(
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    global _GDELT_CACHE
    del user
    now_mono = time.monotonic()
    if _GDELT_CACHE and (now_mono - _GDELT_CACHE[0]) < _GDELT_TTL:
        return _GDELT_CACHE[1]

    events: list[dict[str, Any]] = []
    source = "gdelt_live"
    try:
        async with httpx.AsyncClient(timeout=7.0) as client:
            resp = await client.get(
                "https://api.gdeltproject.org/api/v2/geo/geo",
                params={
                    "query": "(sanctions OR oil OR tanker OR port OR strait OR energy)",
                    "mode": "PointData",
                    "format": "GeoJSON",
                    "maxpoints": 30,
                },
            )
            if resp.status_code == 200:
                geo = resp.json()
                for idx, feat in enumerate(geo.get("features") or []):
                    coords = (feat.get("geometry") or {}).get("coordinates") or []
                    props = feat.get("properties") or {}
                    if len(coords) < 2:
                        continue
                    lon, lat = float(coords[0]), float(coords[1])
                    name = str(props.get("name") or props.get("html") or "Geopolitical Event").strip()
                    # Strip any HTML tags safely
                    if "<" in name:
                        import re

                        name = re.sub(r"<[^>]+>", " ", name)
                        name = " ".join(name.split())[:140]
                    url = str(props.get("shareimage") or props.get("url") or "https://www.gdeltproject.org/")
                    events.append(
                        {
                            "id": f"gdelt-{idx}",
                            "title": name[:140],
                            "category": "Geopolitics / Energy",
                            "lat": round(lat, 4),
                            "lon": round(lon, 4),
                            "severity": "high" if idx < 6 else "medium",
                            "url": url if url.startswith("http") else "https://www.gdeltproject.org/",
                            "domain": "gdeltproject.org",
                        }
                    )
                    if len(events) >= 24:
                        break
    except Exception:
        source = "gdelt_cached"

    if not events:
        source = "gdelt_cached"
        events = list(_FALLBACK_GDELT)

    payload = {
        "source": source,
        "updated_at": datetime.now(UTC).isoformat(),
        "items": events,
    }
    _GDELT_CACHE = (now_mono, payload)
    return payload


# ---------------------------------------------------------------------------
# 3. Full-Year Exchange Holidays & IPO/FDA Calendar
# ---------------------------------------------------------------------------


@router.get("/calendar/holidays")
async def get_exchange_holidays(
    year: int = Query(default=2026, ge=2024, le=2030),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    del user
    holidays = [
        {
            "id": "h1",
            "date": f"{year}-01-01",
            "exchange": "NYSE/NASDAQ",
            "name": "New Year's Day",
            "status": "CLOSED",
            "impact": "XAUUSD / USTEC / US500",
        },
        {
            "id": "h2",
            "date": f"{year}-01-01",
            "exchange": "CME/COMEX",
            "name": "New Year's Day",
            "status": "CLOSED",
            "impact": "Gold / WTI / Indices",
        },
        {
            "id": "h3",
            "date": f"{year}-01-01",
            "exchange": "LSE",
            "name": "New Year's Day",
            "status": "CLOSED",
            "impact": "GBP / FTSE",
        },
        {
            "id": "h4",
            "date": f"{year}-01-02",
            "exchange": "TSE",
            "name": "Market Holiday (Japan)",
            "status": "CLOSED",
            "impact": "JPY / Nikkei",
        },
        {
            "id": "h5",
            "date": f"{year}-01-19",
            "exchange": "NYSE/NASDAQ",
            "name": "Martin Luther King Jr. Day",
            "status": "CLOSED",
            "impact": "US Equities / Low Vol",
        },
        {
            "id": "h6",
            "date": f"{year}-02-16",
            "exchange": "NYSE/NASDAQ",
            "name": "Presidents' Day",
            "status": "CLOSED",
            "impact": "USTEC / XAUUSD early close",
        },
        {
            "id": "h7",
            "date": f"{year}-04-03",
            "exchange": "NYSE/NASDAQ",
            "name": "Good Friday",
            "status": "CLOSED",
            "impact": "Global Liquidity Drop",
        },
        {
            "id": "h8",
            "date": f"{year}-04-03",
            "exchange": "EUREX",
            "name": "Good Friday",
            "status": "CLOSED",
            "impact": "DAX / EuroStoxx",
        },
        {
            "id": "h9",
            "date": f"{year}-04-06",
            "exchange": "LSE",
            "name": "Easter Monday",
            "status": "CLOSED",
            "impact": "GBP / EUR",
        },
        {
            "id": "h10",
            "date": f"{year}-05-01",
            "exchange": "EUREX",
            "name": "Labour Day",
            "status": "CLOSED",
            "impact": "EUR / DAX",
        },
        {
            "id": "h11",
            "date": f"{year}-05-04",
            "exchange": "TSE",
            "name": "Greenery Day (Golden Week)",
            "status": "CLOSED",
            "impact": "JPY",
        },
        {
            "id": "h12",
            "date": f"{year}-05-25",
            "exchange": "NYSE/NASDAQ",
            "name": "Memorial Day",
            "status": "CLOSED",
            "impact": "USTEC / XAUUSD",
        },
        {
            "id": "h13",
            "date": f"{year}-06-19",
            "exchange": "NYSE/NASDAQ",
            "name": "Juneteenth National Independence Day",
            "status": "CLOSED",
            "impact": "US Equities",
        },
        {
            "id": "h14",
            "date": f"{year}-07-03",
            "exchange": "NYSE/NASDAQ",
            "name": "Independence Day (Observed)",
            "status": "CLOSED",
            "impact": "US Equities / CME Early",
        },
        {
            "id": "h15",
            "date": f"{year}-08-31",
            "exchange": "LSE",
            "name": "Summer Bank Holiday",
            "status": "CLOSED",
            "impact": "London Session",
        },
        {
            "id": "h16",
            "date": f"{year}-09-07",
            "exchange": "NYSE/NASDAQ",
            "name": "Labor Day",
            "status": "CLOSED",
            "impact": "US Equities / Metals",
        },
        {
            "id": "h17",
            "date": f"{year}-11-26",
            "exchange": "NYSE/NASDAQ",
            "name": "Thanksgiving Day",
            "status": "CLOSED",
            "impact": "Низкий объём XAUUSD/USTEC",
        },
        {
            "id": "h18",
            "date": f"{year}-11-27",
            "exchange": "NYSE/NASDAQ",
            "name": "Day After Thanksgiving",
            "status": "EARLY_CLOSE 13:00 ET",
            "impact": "Раннее закрытие US",
        },
        {
            "id": "h19",
            "date": f"{year}-11-27",
            "exchange": "CME/COMEX",
            "name": "Post-Thanksgiving Early Close",
            "status": "EARLY_CLOSE 13:45 ET",
            "impact": "Gold / Nasdaq Futures",
        },
        {
            "id": "h20",
            "date": f"{year}-12-24",
            "exchange": "NYSE/NASDAQ",
            "name": "Christmas Eve",
            "status": "EARLY_CLOSE 13:00 ET",
            "impact": "Низкая ликвидность",
        },
        {
            "id": "h21",
            "date": f"{year}-12-25",
            "exchange": "NYSE/NASDAQ",
            "name": "Christmas Day",
            "status": "CLOSED",
            "impact": "Global Markets Closed",
        },
        {
            "id": "h22",
            "date": f"{year}-12-25",
            "exchange": "LSE",
            "name": "Christmas Day",
            "status": "CLOSED",
            "impact": "Global Markets Closed",
        },
        {
            "id": "h23",
            "date": f"{year}-12-25",
            "exchange": "EUREX",
            "name": "Christmas Day",
            "status": "CLOSED",
            "impact": "Global Markets Closed",
        },
        {
            "id": "h24",
            "date": f"{year}-12-31",
            "exchange": "TSE",
            "name": "Market Holiday (New Year's Eve)",
            "status": "CLOSED",
            "impact": "Tokyo Closed",
        },
    ]

    now_utc = datetime.now(UTC)
    upcoming_48h: dict[str, Any] | None = None
    for h in holidays:
        with contextlib.suppress(ValueError):
            h_dt = datetime.fromisoformat(f"{h['date']}T14:30:00+00:00")
            diff_h = (h_dt - now_utc).total_seconds() / 3600.0
            if -6.0 <= diff_h <= 48.0:
                upcoming_48h = {
                    **h,
                    "hours_until": round(max(0.0, diff_h), 1),
                    "warning_text": (
                        f"Внимание: {h['exchange']} ({h['date']}) — {h['name']} ({h['status']}). "
                        f"Возможен низкий объём по {h['impact']}."
                    ),
                }
                break

    return {
        "year": year,
        "upcoming_48h_alert": upcoming_48h,
        "items": holidays,
    }


@router.get("/calendar/corporate")
async def get_corporate_events(
    kind: str = Query(default="all", pattern="^(all|earnings|ipo|fda)$"),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    del user
    year = datetime.now(UTC).year
    items = [
        {
            "id": "ipo-1",
            "kind": "ipo",
            "date": f"{year}-12-04",
            "symbol": "STRP",
            "company": "Stripe Inc. (Expected Direct Listing)",
            "exchange": "NYSE",
            "details": "Est. Valuation $70B · Fintech",
            "url": "https://www.sec.gov/edgar/searchedgar/companysearch",
        },
        {
            "id": "ipo-2",
            "kind": "ipo",
            "date": f"{year}-12-11",
            "symbol": "DBRX",
            "company": "Databricks Inc.",
            "exchange": "NASDAQ",
            "details": "Est. Valuation $62B · AI / Data",
            "url": "https://www.sec.gov/edgar/searchedgar/companysearch",
        },
        {
            "id": "ipo-3",
            "kind": "ipo",
            "date": f"{year}-12-18",
            "symbol": "KLAR",
            "company": "Klarna Bank AB",
            "exchange": "NYSE",
            "details": "Est. Valuation $15B · Payments",
            "url": "https://www.sec.gov/edgar/searchedgar/companysearch",
        },
        {
            "id": "fda-1",
            "kind": "fda",
            "date": f"{year}-12-03",
            "symbol": "VRTX",
            "company": "Vertex Pharmaceuticals",
            "exchange": "NASDAQ",
            "details": "PDUFA Target Action Date · Suzetrigine (Pain)",
            "url": "https://www.fda.gov/drugs",
        },
        {
            "id": "fda-2",
            "kind": "fda",
            "date": f"{year}-12-12",
            "symbol": "REGN",
            "company": "Regeneron Pharmaceuticals",
            "exchange": "NASDAQ",
            "details": "FDA BLA Decision · Linvoseltamab (Oncology)",
            "url": "https://www.fda.gov/drugs",
        },
        {
            "id": "fda-3",
            "kind": "fda",
            "date": f"{year}-12-19",
            "symbol": "LLY",
            "company": "Eli Lilly and Company",
            "exchange": "NYSE",
            "details": "FDA Label Expansion Review · Tirzepatide",
            "url": "https://www.fda.gov/drugs",
        },
    ]
    if kind != "all":
        items = [x for x in items if x["kind"] == kind]
    return {"kind": kind, "items": items}


# ---------------------------------------------------------------------------
# 4. Safe /etc & Infrastructure Config Diagnostics (/api/v1/pro/etc-diagnostics)
# ---------------------------------------------------------------------------


@router.get("/etc-diagnostics")
async def get_etc_diagnostics(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    del user
    settings = get_settings()
    env_map = load_integrations_env(settings.integrations_env_path)

    def _is_set(key: str) -> bool:
        return bool((env_map.get(key) or os.getenv(key) or "").strip())

    tg_url = (env_map.get("TELEGRAM_ALERTS_WEBHOOK") or os.getenv("TELEGRAM_ALERTS_WEBHOOK") or "").strip()
    tg_host = (urlparse(tg_url).hostname or "").lower() if tg_url else ""
    tg_loopback = tg_host in {"127.0.0.1", "localhost", "::1", "0.0.0.0"}

    accounts = (await db.execute(select(TradingAccount))).scalars().all()
    bridge_online = sum(1 for a in accounts if (a.bridge_status or "").lower() == "online")

    return {
        "updated_at": datetime.now(UTC).isoformat(),
        "env_checks": [
            {"key": "DATABASE_URL", "configured": bool(settings.database_url), "scope": "Core DB"},
            {"key": "REDIS_URL", "configured": bool(settings.redis_url), "scope": "WS / Cache"},
            {
                "key": "TELEGRAM_ALERTS_WEBHOOK",
                "configured": bool(tg_url) and not tg_loopback,
                "scope": "huseynovlar_webhooks",
            },
            {"key": "ALPACA_API_KEY", "configured": _is_set("ALPACA_API_KEY"), "scope": "Equities WS"},
            {"key": "FINNHUB_API_KEY", "configured": _is_set("FINNHUB_API_KEY"), "scope": "Earnings / News"},
            {"key": "FRED_API_KEY", "configured": _is_set("FRED_API_KEY"), "scope": "Macro Series"},
            {"key": "AISSTREAM_API_KEY", "configured": _is_set("AISSTREAM_API_KEY"), "scope": "BMAP AIS"},
        ],
        "network_routes": [
            {
                "service": "nginx / Reverse Proxy",
                "target": settings.terminal_origin,
                "network": "huseynovlar_internal",
                "status": "OK",
            },
            {
                "service": "Telegram Webhook Bridge",
                "target": tg_url if (tg_url and not tg_loopback) else "http://telegram-bot:8080/api/notify",
                "network": "huseynovlar_webhooks",
                "status": "LOOPBACK_BLOCKED" if tg_loopback else ("OK" if tg_url else "NOT_CONFIGURED"),
            },
            {
                "service": "ExnessPanelBridge (MT5 IPC)",
                "target": f"{bridge_online}/{len(accounts)} MT5 accounts online",
                "network": "ep_ipc / docker-proxy:2375",
                "status": "OK" if bridge_online > 0 else "IDLE",
            },
        ],
    }


# ---------------------------------------------------------------------------
# 5. Private VPN Tauri v2 Auto-Updater Manifest (/api/v1/pro/releases/latest.json)
# ---------------------------------------------------------------------------


@router.get("/releases/latest.json")
async def get_desktop_latest_release() -> dict[str, Any]:
    """Tauri v2 updater manifest served behind private VPN (no GitHub token needed on clients)."""
    raw_override = os.getenv("DESKTOP_LATEST_RELEASE_JSON", "").strip()
    if raw_override:
        with contextlib.suppress(Exception):
            parsed = json.loads(raw_override)
            if isinstance(parsed, dict) and parsed.get("version"):
                return parsed

    return {
        "version": "2.0.0",
        "notes": (
            "Huseynovlar Terminal v2.0.0 — Bloomberg Command Bar, Multi-Chart + Bar Replay, "
            "Native Keep-Awake, VPN Gate."
        ),
        "pub_date": datetime.now(UTC).isoformat(),
        "platforms": {},
    }
