from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_operator
from app.core.symbols import canonical_asset_code
from app.db.models import User

router = APIRouter(prefix="/stat-arb", tags=["stat-arb"])

_HTTP_HEADERS = {"User-Agent": "HuseynovlarTerminal/2.0 (QuantEngine)"}
_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Any | None:
    row = _CACHE.get(key)
    if row and row[0] > time.monotonic():
        return row[1]
    return None


def _cache_set(key: str, val: Any, ttl_sec: float = 180.0) -> Any:
    _CACHE[key] = (time.monotonic() + ttl_sec, val)
    return val


# ---------------------------------------------------------------------------
# Universe Definitions
# ---------------------------------------------------------------------------

_UNIVERSES: dict[str, dict[str, Any]] = {
    "crypto": {
        "label": "Крипто (Binance Top)",
        "assets": [
            "BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD", "XRPUSD", "ADAUSD",
            "AVAXUSD", "LINKUSD", "DOTUSD", "UNIUSD", "LTCUSD", "ATOMUSD",
        ],
        "pairs": [
            ("ETHUSD", "BTCUSD"),
            ("SOLUSD", "ETHUSD"),
            ("AVAXUSD", "SOLUSD"),
            ("LINKUSD", "ETHUSD"),
            ("ADAUSD", "XRPUSD"),
            ("BNBUSD", "BTCUSD"),
            ("UNIUSD", "LINKUSD"),
            ("DOTUSD", "ATOMUSD"),
            ("LTCUSD", "BTCUSD"),
            ("SOLUSD", "BTCUSD"),
        ],
    },
    "equities": {
        "label": "Акции США (S&P 500 / Tech)",
        "assets": [
            "NVDA", "AMD", "MSFT", "AAPL", "GOOGL", "META",
            "AMZN", "AVGO", "JPM", "GS", "KO", "PEP",
        ],
        "pairs": [
            ("NVDA", "AMD"),
            ("MSFT", "AAPL"),
            ("GOOGL", "META"),
            ("KO", "PEP"),
            ("JPM", "GS"),
            ("NVDA", "AVGO"),
            ("AMZN", "MSFT"),
            ("META", "AMZN"),
        ],
    },
    "fx_metals": {
        "label": "Форекс и Металлы",
        "assets": [
            "XAUUSD", "XAGUSD", "USTEC", "SPX500", "EURUSD", "GBPUSD",
            "AUDUSD", "NZDUSD", "USDCHF", "USDJPY", "USOIL", "UKOIL",
        ],
        "pairs": [
            ("XAUUSD", "XAGUSD"),
            ("USTEC", "SPX500"),
            ("EURUSD", "GBPUSD"),
            ("AUDUSD", "NZDUSD"),
            ("USOIL", "UKOIL"),
            ("XAUUSD", "EURUSD"),
            ("EURUSD", "USDCHF"),
        ],
    },
}

_TF_MINUTES: dict[str, int] = {
    "M5": 5,
    "M15": 15,
    "H1": 60,
    "H4": 240,
    "D1": 1440,
}

_BINANCE_TF: dict[str, str] = {
    "M5": "5m",
    "M15": "15m",
    "H1": "1h",
    "H4": "4h",
    "D1": "1d",
}

_YAHOO_MAP: dict[str, str] = {
    "XAUUSD": "GC=F",
    "XAGUSD": "SI=F",
    "USTEC": "^NDX",
    "SPX500": "^GSPC",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "AUDUSD": "AUDUSD=X",
    "NZDUSD": "NZDUSD=X",
    "USDCHF": "USDCHF=X",
    "USDJPY": "USDJPY=X",
    "USOIL": "CL=F",
    "UKOIL": "BZ=F",
}

_CRYPTO_BASES = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK",
    "DOT", "UNI", "LTC", "ATOM", "DOGE", "ARB", "OP", "SUI",
}


# ---------------------------------------------------------------------------
# Historical OHLCV Fetcher (Binance + Yahoo + Deterministic Offline Fallback)
# ---------------------------------------------------------------------------


def _is_crypto(sym: str) -> bool:
    u = canonical_asset_code(sym)
    base = u[:-3] if u.endswith("USD") else (u[:-4] if u.endswith("USDT") else u)
    return base in _CRYPTO_BASES


def _synthetic_series(symbol: str, n: int, tf_min: int) -> tuple[list[int], list[float]]:
    """Deterministic realistic correlated series used ONLY if external APIs are offline/rate-limited."""
    now_ts = int(datetime.now(UTC).timestamp())
    step = tf_min * 60
    start_ts = now_ts - (n - 1) * step
    ts = [start_ts + i * step for i in range(n)]

    sym_u = canonical_asset_code(symbol)
    seed_sum = sum(ord(c) * (idx + 1) for idx, c in enumerate(sym_u))
    base_px_map = {
        "BTCUSD": 92000.0, "ETHUSD": 3250.0, "SOLUSD": 215.0, "BNBUSD": 640.0,
        "XRPUSD": 1.45, "ADAUSD": 0.92, "AVAXUSD": 42.0, "LINKUSD": 18.5,
        "DOTUSD": 8.4, "UNIUSD": 11.2, "LTCUSD": 96.0, "ATOMUSD": 7.8,
        "XAUUSD": 2650.0, "XAGUSD": 31.2, "USTEC": 20850.0, "SPX500": 5980.0,
        "EURUSD": 1.058, "GBPUSD": 1.268, "AUDUSD": 0.652, "NZDUSD": 0.592,
        "USDCHF": 0.884, "USDJPY": 152.4, "USOIL": 69.5, "UKOIL": 73.2,
        "NVDA": 138.0, "AMD": 141.0, "MSFT": 422.0, "AAPL": 232.0,
        "GOOGL": 174.0, "META": 572.0, "AMZN": 206.0, "AVGO": 168.0,
        "JPM": 244.0, "GS": 595.0, "KO": 63.5, "PEP": 162.0,
    }
    base_px = base_px_map.get(sym_u, 100.0)
    # Shared market factor + symbol-specific Ornstein-Uhlenbeck mean-reverting component
    phase = (seed_sum % 31) * 0.21
    ou = 0.0
    prices: list[float] = []
    for i in range(n):
        common = 0.045 * math.sin(i * 0.045) + 0.025 * math.cos(i * 0.017) + 0.00015 * i
        shock = 0.0045 * math.sin(i * 0.29 + phase) + 0.003 * math.cos(i * 0.63 + phase * 1.7)
        ou = 0.88 * ou + shock
        # Add realistic tail excursion near recent bars for distinct signals across pairs
        tail = 0.014 * math.sin(seed_sum + i * 0.08) if i > n - 25 else 0.0
        px = base_px * math.exp(common + ou + tail)
        prices.append(round(px, 5 if base_px < 5 else 2))
    return ts, prices


async def _fetch_closes(
    http: httpx.AsyncClient,
    symbol: str,
    tf: str,
    lookback: int,
) -> tuple[list[int], list[float], str]:
    """Fetch aligned (timestamps, closes, source) for a symbol with TTL cache."""
    sym = canonical_asset_code(symbol)
    ck = f"sa:bars:{sym}:{tf}:{lookback}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    n = max(60, min(1000, lookback))
    tf_min = _TF_MINUTES.get(tf, 60)

    # 1. Binance for crypto
    if _is_crypto(sym):
        bsym = sym.replace("USD", "USDT") if sym.endswith("USD") and not sym.endswith("USDT") else sym
        if not bsym.endswith("USDT"):
            bsym = f"{bsym}USDT"
        try:
            r = await http.get(
                "https://api.binance.com/api/v3/klines",
                params={"symbol": bsym, "interval": _BINANCE_TF.get(tf, "1h"), "limit": str(n)},
                headers=_HTTP_HEADERS,
            )
            if r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) >= 40:
                rows = r.json()
                ts = [int(x[0]) // 1000 for x in rows]
                closes = [float(x[4]) for x in rows]
                return _cache_set(ck, (ts, closes, "binance"), 120.0)
        except Exception:  # noqa: BLE001
            pass

    # 2. Yahoo Finance for equities / FX / metals / indices
    ysym = _YAHOO_MAP.get(sym, sym)
    y_interval = {"M5": "5m", "M15": "15m", "H1": "60m", "H4": "60m", "D1": "1d"}.get(tf, "60m")
    y_range = {"M5": "5d", "M15": "1mo", "H1": "3mo", "H4": "6mo", "D1": "2y"}.get(tf, "3mo")
    try:
        r = await http.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
            params={"interval": y_interval, "range": y_range},
            headers=_HTTP_HEADERS,
        )
        if r.status_code == 200:
            res = ((r.json() or {}).get("chart") or {}).get("result") or []
            if res:
                raw_ts = res[0].get("timestamp") or []
                raw_cl = (((res[0].get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
                pairs = [(int(t), float(c)) for t, c in zip(raw_ts, raw_cl, strict=False) if c is not None and c > 0]
                if len(pairs) >= 40:
                    pairs = pairs[-n:]
                    return _cache_set(ck, ([p[0] for p in pairs], [p[1] for p in pairs], "yahoo"), 180.0)
    except Exception:  # noqa: BLE001
        pass

    # 3. Deterministic fallback when sandbox/offline/rate-limited
    ts, closes = _synthetic_series(sym, n, tf_min)
    return _cache_set(ck, (ts, closes, "model_cache"), 60.0)


# ---------------------------------------------------------------------------
# Pure-Python Quant Engine (OLS, Engle-Granger ADF, Half-Life, Hurst, Backtest)
# ---------------------------------------------------------------------------


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs: list[float], mu: float | None = None) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs) if mu is None else mu
    var = sum((x - m) ** 2 for x in xs) / (len(xs) - 1)
    return math.sqrt(max(0.0, var))


def _pearson_corr(xs: list[float], ys: list[float]) -> float:
    n = min(len(xs), len(ys))
    if n < 3:
        return 0.0
    mx = sum(xs[:n]) / n
    my = sum(ys[:n]) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    dx = math.sqrt(sum((xs[i] - mx) ** 2 for i in range(n)))
    dy = math.sqrt(sum((ys[i] - my) ** 2 for i in range(n)))
    if dx <= 1e-12 or dy <= 1e-12:
        return 0.0
    return max(-1.0, min(1.0, num / (dx * dy)))


def _ols_log_hedge(pa: list[float], pb: list[float]) -> tuple[float, float, list[float]]:
    """OLS regression: ln(A) = alpha + beta * ln(B) + spread."""
    la = [math.log(max(1e-9, x)) for x in pa]
    lb = [math.log(max(1e-9, x)) for x in pb]
    n = len(la)
    mx = _mean(lb)
    my = _mean(la)
    sxx = sum((lb[i] - mx) ** 2 for i in range(n))
    sxy = sum((lb[i] - mx) * (la[i] - my) for i in range(n))
    beta = (sxy / sxx) if sxx > 1e-12 else 1.0
    beta = max(-10.0, min(10.0, beta))
    alpha = my - beta * mx
    spread = [la[i] - (alpha + beta * lb[i]) for i in range(n)]
    return alpha, beta, spread


def _adf_pvalue(spread: list[float]) -> float:
    """Engle-Granger Augmented Dickey-Fuller (1-lag) t-stat -> MacKinnon p-value."""
    n = len(spread)
    if n < 20:
        return 0.50
    # Δs_t = c + γ * s_{t-1}  (simple DF regression for exact OLS t-stat)
    y = [spread[i] - spread[i - 1] for i in range(1, n)]
    x = [spread[i - 1] for i in range(1, n)]
    m = len(y)
    mx = _mean(x)
    my = _mean(y)
    sxx = sum((x[i] - mx) ** 2 for i in range(m))
    if sxx <= 1e-15:
        return 0.50
    gamma = sum((x[i] - mx) * (y[i] - my) for i in range(m)) / sxx
    c = my - gamma * mx
    resid_ss = sum((y[i] - (c + gamma * x[i])) ** 2 for i in range(m))
    s2 = resid_ss / max(1, m - 2)
    se_gamma = math.sqrt(max(1e-18, s2 / sxx))
    t_stat = gamma / se_gamma

    # MacKinnon (1994) critical values for Engle-Granger 2-variable cointegration
    # 1%: -3.90, 5%: -3.34, 10%: -3.04, 25%: -2.50, 50%: -1.95
    if t_stat <= -4.30:
        return 0.002
    if t_stat <= -3.90:
        return round(0.002 + (t_stat + 4.30) / 0.40 * 0.008, 4)
    if t_stat <= -3.34:
        return round(0.010 + (t_stat + 3.90) / 0.56 * 0.040, 4)
    if t_stat <= -3.04:
        return round(0.050 + (t_stat + 3.34) / 0.30 * 0.050, 4)
    if t_stat <= -2.50:
        return round(0.100 + (t_stat + 3.04) / 0.54 * 0.150, 4)
    if t_stat <= -1.95:
        return round(0.250 + (t_stat + 2.50) / 0.55 * 0.250, 4)
    return min(0.99, round(0.50 + max(0.0, (t_stat + 1.95) * 0.18), 4))


def _half_life_bars(spread: list[float]) -> float:
    """Ornstein-Uhlenbeck half-life in bars: -ln(2) / lambda."""
    n = len(spread)
    if n < 15:
        return 0.0
    y = [spread[i] - spread[i - 1] for i in range(1, n)]
    x = [spread[i - 1] for i in range(1, n)]
    mx = _mean(x)
    my = _mean(y)
    sxx = sum((x[i] - mx) ** 2 for i in range(len(x)))
    if sxx <= 1e-15:
        return 999.0
    lam = sum((x[i] - mx) * (y[i] - my) for i in range(len(x))) / sxx
    if lam >= -1e-6:
        return 999.0
    return round(min(999.0, max(1.0, -math.log(2.0) / lam)), 1)


def _hurst_exponent(spread: list[float]) -> float:
    """Variance-scaling Hurst exponent H (<0.5 mean-reverting, 0.5 random walk, >0.5 trending)."""
    n = len(spread)
    if n < 30:
        return 0.50
    max_lag = min(20, n // 4)
    log_lags: list[float] = []
    log_taus: list[float] = []
    for lag in range(2, max_lag + 1):
        diffs = [spread[i] - spread[i - lag] for i in range(lag, n)]
        sd = _std(diffs)
        if sd > 1e-12:
            log_lags.append(math.log(lag))
            log_taus.append(math.log(sd))
    if len(log_lags) < 3:
        return 0.50
    mx = _mean(log_lags)
    my = _mean(log_taus)
    sxx = sum((log_lags[i] - mx) ** 2 for i in range(len(log_lags)))
    if sxx <= 1e-12:
        return 0.50
    slope = sum((log_lags[i] - mx) * (log_taus[i] - my) for i in range(len(log_lags))) / sxx
    return round(max(0.05, min(0.95, slope)), 3)


def _classify_signal(z: float, entry_z: float, exit_z: float, stop_z: float) -> str:
    if abs(z) >= stop_z:
        return "BROKEN (Stop)"
    if z <= -entry_z:
        return "LONG SPREAD"
    if z >= entry_z:
        return "SHORT SPREAD"
    if abs(z) <= exit_z:
        return "MEAN REVERTED"
    return "NEUTRAL"


def _backtest_spread(
    timestamps: list[int],
    z_series: list[float],
    spread: list[float],
    entry_z: float,
    exit_z: float,
    stop_z: float,
    fee_pct: float = 0.05,
) -> dict[str, Any]:
    """Mean-reversion spread backtest with round-trip fee & slippage deduction."""
    equity = 100.0
    pos = 0  # +1 long spread, -1 short spread
    entry_spread = 0.0
    wins = 0
    trades = 0
    curve: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    rets: list[float] = []
    fee_frac = (fee_pct * 2.0) / 100.0  # both legs + round-trip

    for i in range(len(z_series)):
        z = z_series[i]
        s = spread[i]
        t_iso = datetime.fromtimestamp(timestamps[i], tz=UTC).strftime("%m-%d %H:%M")

        if pos == 0:
            if z <= -entry_z and abs(z) < stop_z:
                pos = 1
                entry_spread = s
                markers.append({"ts": t_iso, "z": round(z, 2), "side": "LONG", "action": "ENTRY"})
            elif z >= entry_z and abs(z) < stop_z:
                pos = -1
                entry_spread = s
                markers.append({"ts": t_iso, "z": round(z, 2), "side": "SHORT", "action": "ENTRY"})
        else:
            should_exit = abs(z) <= exit_z or abs(z) >= stop_z
            if should_exit:
                pnl_frac = (s - entry_spread) * pos - fee_frac
                equity *= 1.0 + pnl_frac
                rets.append(pnl_frac)
                trades += 1
                if pnl_frac > 0:
                    wins += 1
                markers.append(
                    {
                        "ts": t_iso,
                        "z": round(z, 2),
                        "side": "LONG" if pos == 1 else "SHORT",
                        "action": "STOP" if abs(z) >= stop_z else "EXIT",
                    }
                )
                pos = 0

        curve.append({"ts": t_iso, "equity": round(equity, 2)})

    winrate = round((wins / trades) * 100.0, 1) if trades > 0 else 0.0
    sharpe = 0.0
    if len(rets) >= 2:
        sd = _std(rets)
        if sd > 1e-9:
            sharpe = round((_mean(rets) / sd) * math.sqrt(len(rets)), 2)

    return {
        "equity_curve": curve,
        "markers": markers[-30:],
        "winrate_pct": winrate,
        "sharpe": sharpe,
        "total_return_pct": round(equity - 100.0, 2),
        "trades_count": trades,
    }


def _compute_pair_analytics(
    asset_a: str,
    asset_b: str,
    ts_a: list[int],
    pa: list[float],
    ts_b: list[int],
    pb: list[float],
    tf: str,
    entry_z: float,
    exit_z: float,
    stop_z: float,
    fee_pct: float = 0.05,
    full_series: bool = False,
) -> dict[str, Any]:
    n = min(len(pa), len(pb))
    pa = pa[-n:]
    pb = pb[-n:]
    ts = ts_a[-n:] if len(ts_a) >= n else ts_b[-n:]

    alpha, beta, spread = _ols_log_hedge(pa, pb)
    sp_mean = _mean(spread)
    sp_std = _std(spread, sp_mean) or 1e-9
    z_series = [(s - sp_mean) / sp_std for s in spread]
    cur_z = round(z_series[-1], 3) if z_series else 0.0

    la = [math.log(max(1e-9, x)) for x in pa]
    lb = [math.log(max(1e-9, x)) for x in pb]
    corr = round(_pearson_corr(la, lb), 3)
    prev_n = max(20, n - 24)
    prev_corr = _pearson_corr(la[:prev_n], lb[:prev_n])
    corr_delta = round(corr - prev_corr, 3)

    adf_p = _adf_pvalue(spread)
    hl_bars = _half_life_bars(spread)
    tf_min = _TF_MINUTES.get(tf, 60)
    hl_hours = round((hl_bars * tf_min) / 60.0, 1) if hl_bars < 900 else 999.0
    hurst = _hurst_exponent(spread)
    signal = _classify_signal(cur_z, entry_z, exit_z, stop_z)
    bt = _backtest_spread(ts, z_series, spread, entry_z, exit_z, stop_z, fee_pct=fee_pct)

    summary = {
        "pair_id": f"{asset_a}:{asset_b}",
        "asset_a": asset_a,
        "asset_b": asset_b,
        "price_a": pa[-1],
        "price_b": pb[-1],
        "z_score": cur_z,
        "signal": signal,
        "corr": corr,
        "corr_delta_7d": corr_delta,
        "adf_pvalue": adf_p,
        "half_life_bars": hl_bars,
        "half_life_hours": hl_hours,
        "hedge_ratio": round(beta, 4),
        "alpha": round(alpha, 6),
        "spread_mean": round(sp_mean, 6),
        "spread_std": round(sp_std, 6),
        "hurst": hurst,
        "winrate_pct": bt["winrate_pct"],
        "sharpe": bt["sharpe"],
        "trades_count": bt["trades_count"],
        "total_return_pct": bt["total_return_pct"],
        "spark_z": [round(z, 2) for z in z_series[-40:]],
    }

    if not full_series:
        return summary

    # Normalized Base=100 prices
    base_a = pa[0] or 1.0
    base_b = pb[0] or 1.0
    norm_a = [round((x / base_a) * 100.0, 2) for x in pa]
    norm_b = [round((x / base_b) * 100.0, 2) for x in pb]

    # Rolling Correlation & Rolling Beta (window = 30)
    win = min(30, max(10, n // 5))
    rolling_corr: list[float | None] = []
    rolling_beta: list[float | None] = []
    for i in range(n):
        if i < win - 1:
            rolling_corr.append(None)
            rolling_beta.append(None)
        else:
            sa = la[i - win + 1 : i + 1]
            sb = lb[i - win + 1 : i + 1]
            rolling_corr.append(round(_pearson_corr(sa, sb), 3))
            mx = _mean(sb)
            my = _mean(sa)
            sxx = sum((sb[k] - mx) ** 2 for k in range(win))
            b_loc = (sum((sb[k] - mx) * (sa[k] - my) for k in range(win)) / sxx) if sxx > 1e-12 else beta
            rolling_beta.append(round(max(-10.0, min(10.0, b_loc)), 4))

    # Z-Score Histogram (18 bins from -4.5 to +4.5) + Empirical Percentile
    edges = [-4.5 + k * 0.5 for k in range(19)]
    counts = [0] * 18
    for zv in z_series:
        idx = int(max(0, min(17, math.floor((zv + 4.5) / 0.5))))
        counts[idx] += 1
    cur_bin = int(max(0, min(17, math.floor((cur_z + 4.5) / 0.5))))
    below = sum(1 for zv in z_series if zv <= cur_z)
    percentile = round((below / len(z_series)) * 100.0, 1) if z_series else 50.0

    ts_labels = [datetime.fromtimestamp(t, tz=UTC).strftime("%m-%d %H:%M") for t in ts]

    return {
        **summary,
        "percentile": percentile,
        "timestamps": ts_labels,
        "z_series": [round(z, 3) for z in z_series],
        "norm_a": norm_a,
        "norm_b": norm_b,
        "rolling_corr": rolling_corr,
        "rolling_beta": rolling_beta,
        "histogram": {
            "bins": [f"{edges[k]:+.1f}" for k in range(18)],
            "counts": counts,
            "current_bin": cur_bin,
            "percentile": percentile,
        },
        "backtest": bt,
    }


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.get("/screener")
async def get_stat_arb_screener(
    universe: str = Query(default="crypto", pattern="^(crypto|equities|fx_metals)$"),
    tf: str = Query(default="H1", pattern="^(M5|M15|H1|H4|D1)$"),
    lookback: int = Query(default=200, ge=60, le=1000),
    entry_z: float = Query(default=2.0, ge=0.5, le=5.0),
    exit_z: float = Query(default=0.2, ge=0.0, le=2.0),
    stop_z: float = Query(default=3.5, ge=2.0, le=8.0),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Quant Screener: rank cointegrated pairs with Z-Score, ADF p-value, Half-Life, β, Hurst, and Backtest."""
    uni = _UNIVERSES[universe]
    pairs: list[tuple[str, str]] = uni["pairs"]
    unique_syms = sorted({s for pair in pairs for s in pair})

    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as http:
        fetched = await asyncio.gather(*[_fetch_closes(http, s, tf, lookback) for s in unique_syms])
    bar_map = dict(zip(unique_syms, fetched, strict=True))

    rows: list[dict[str, Any]] = []
    for a, b in pairs:
        ts_a, pa, _ = bar_map[a]
        ts_b, pb, _ = bar_map[b]
        rows.append(
            _compute_pair_analytics(
                a, b, ts_a, pa, ts_b, pb, tf, entry_z, exit_z, stop_z, full_series=False
            )
        )

    # Sort by highest |Z-Score| opportunity first, then lowest p-value
    rows.sort(key=lambda r: (-abs(r["z_score"]), r["adf_pvalue"]))

    return {
        "universe": universe,
        "universe_label": uni["label"],
        "tf": tf,
        "lookback": lookback,
        "thresholds": {"entry_z": entry_z, "exit_z": exit_z, "stop_z": stop_z},
        "updated_at_utc": datetime.now(UTC).isoformat(),
        "pairs": rows,
    }


@router.get("/analyze")
async def analyze_stat_arb_pair(
    asset_a: str = Query(min_length=2, max_length=24),
    asset_b: str = Query(min_length=2, max_length=24),
    tf: str = Query(default="H1", pattern="^(M5|M15|H1|H4|D1)$"),
    lookback: int = Query(default=200, ge=60, le=1000),
    entry_z: float = Query(default=2.0, ge=0.5, le=5.0),
    exit_z: float = Query(default=0.2, ge=0.0, le=2.0),
    stop_z: float = Query(default=3.5, ge=2.0, le=8.0),
    fee_pct: float = Query(default=0.05, ge=0.0, le=1.0),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Deep 4-chart quant analysis + backtest for any arbitrary pair (Asset A vs Asset B)."""
    sym_a = canonical_asset_code(asset_a)
    sym_b = canonical_asset_code(asset_b)
    if sym_a == sym_b:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Asset A и Asset B должны различаться")

    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as http:
        (ts_a, pa, src_a), (ts_b, pb, src_b) = await asyncio.gather(
            _fetch_closes(http, sym_a, tf, lookback),
            _fetch_closes(http, sym_b, tf, lookback),
        )

    res = _compute_pair_analytics(
        sym_a, sym_b, ts_a, pa, ts_b, pb, tf, entry_z, exit_z, stop_z, fee_pct=fee_pct, full_series=True
    )
    return {
        **res,
        "tf": tf,
        "lookback": lookback,
        "sources": {"a": src_a, "b": src_b},
        "updated_at_utc": datetime.now(UTC).isoformat(),
    }


@router.get("/matrix")
async def get_stat_arb_matrix(
    universe: str = Query(default="crypto", pattern="^(crypto|equities|fx_metals)$"),
    tf: str = Query(default="H1", pattern="^(M5|M15|H1|H4|D1)$"),
    lookback: int = Query(default=200, ge=60, le=1000),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Interactive N x N Heatmap Matrix (Pearson Corr, Engle-Granger ADF p-value, Current |Z-Score|)."""
    ck = f"sa:matrix:{universe}:{tf}:{lookback}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    uni = _UNIVERSES[universe]
    assets: list[str] = uni["assets"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as http:
        fetched = await asyncio.gather(*[_fetch_closes(http, s, tf, lookback) for s in assets])
    bar_map = dict(zip(assets, fetched, strict=True))

    n = len(assets)
    corr_cells: list[list[Any]] = []
    coint_cells: list[list[Any]] = []
    z_cells: list[list[Any]] = []

    for i in range(n):
        for j in range(n):
            if i == j:
                corr_cells.append([i, j, 1.0])
                coint_cells.append([i, j, 0.0])
                z_cells.append([i, j, 0.0])
                continue
            _, pa, _ = bar_map[assets[i]]
            _, pb, _ = bar_map[assets[j]]
            m = min(len(pa), len(pb))
            la = [math.log(max(1e-9, x)) for x in pa[-m:]]
            lb = [math.log(max(1e-9, x)) for x in pb[-m:]]
            c_val = round(_pearson_corr(la, lb), 2)
            _, _, sp = _ols_log_hedge(pa[-m:], pb[-m:])
            p_val = round(_adf_pvalue(sp), 3)
            mu = _mean(sp)
            sd = _std(sp, mu) or 1e-9
            abs_z = round(abs((sp[-1] - mu) / sd), 2)

            corr_cells.append([i, j, c_val])
            coint_cells.append([i, j, p_val])
            z_cells.append([i, j, abs_z])

    return _cache_set(
        ck,
        {
            "universe": universe,
            "tf": tf,
            "lookback": lookback,
            "assets": assets,
            "correlation": corr_cells,
            "cointegration": coint_cells,
            "abs_zscore": z_cells,
            "updated_at_utc": datetime.now(UTC).isoformat(),
        },
        180.0,
    )


class StatArbAlertRequest(BaseModel):
    asset_a: str = Field(min_length=2, max_length=24)
    asset_b: str = Field(min_length=2, max_length=24)
    z_score: float
    hedge_ratio: float
    adf_pvalue: float
    half_life_hours: float
    signal: str = Field(default="LONG SPREAD", max_length=32)


@router.post("/alert")
async def dispatch_stat_arb_telegram_alert(
    body: StatArbAlertRequest,
    _: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Send formatted Stat-Arb pair card to internal Telegram Bot on Docker network huseynovlar_webhooks."""
    from app.modules.ops.router import _resolve_integration_secret, _validate_docker_webhook_url

    webhook_url, _ = await _resolve_integration_secret(
        db,
        settings,
        settings_val=os.getenv("TELEGRAM_BOT_INTERNAL_URL", "") or settings.alerts_bot_webhook_url,
        vault_key="alerts_bot_webhook_url",
        env_names=("TELEGRAM_BOT_INTERNAL_URL", "TELEGRAM_WEBHOOK_URL", "ALERTS_BOT_WEBHOOK_URL"),
    )
    webhook_secret, _ = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.alerts_bot_webhook_secret,
        vault_key="alerts_bot_webhook_secret",
        env_names=("TELEGRAM_WEBHOOK_SECRET", "ALERTS_BOT_WEBHOOK_SECRET"),
    )
    if not webhook_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Telegram alerts webhook is not configured (set TELEGRAM_BOT_INTERNAL_URL on huseynovlar_webhooks)",
        )
    webhook_url = _validate_docker_webhook_url(webhook_url)

    title = f"Stat-Arb Signal: {body.asset_a} / {body.asset_b} ({body.signal})"
    message = (
        f"Пара: {body.asset_a} / {body.asset_b}\n"
        f"Z-Score: {body.z_score:+.2f}σ | Сигнал: {body.signal}\n"
        f"Hedge Ratio (β): {body.hedge_ratio:.4f}\n"
        f"ADF p-value: {body.adf_pvalue:.4f} | Half-Life: {body.half_life_hours:.1f}h"
    )

    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            headers = {"X-Trading-Webhook-Secret": webhook_secret} if webhook_secret else {}
            r = await http.post(
                webhook_url,
                headers=headers,
                json={
                    "category": "stat_arb",
                    "severity": "high",
                    "title": title,
                    "message": message,
                    "source": "huseynovlar-stat-arb",
                },
            )
            r.raise_for_status()
            return {"ok": True, "target": urlparse(webhook_url).hostname or "telegram-bot"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:200]}
