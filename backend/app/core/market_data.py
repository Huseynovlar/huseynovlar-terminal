"""Resilient multi-provider market data (Yahoo Finance + Stooq/Binance/Frankfurter fallbacks).

Fixes Yahoo ``429 Too Many Requests`` on ``query1.finance.yahoo.com/v8/finance/chart/*`` by:
  * browser-like headers + cookie/crumb session reused across requests,
  * in-process TTL cache and in-flight de-duplication of identical requests,
  * a global cooldown (exponential back-off) after a 429 so we stop hammering Yahoo,
  * provider fallbacks: Binance (crypto), Frankfurter (FX), Stooq (equities/indices/futures),
  * finally caller-supplied *stale* quotes (last cached worker quotes from ``MarketCache``).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

_HTTPX_ASYNC_CLIENT_TYPE = httpx.AsyncClient

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
}

QUOTE_TTL_SEC = 120.0
CHART_TTL_SEC = 45.0
COOLDOWN_BASE_SEC = 60.0
COOLDOWN_MAX_SEC = 900.0

PERIOD_TO_YAHOO_RANGE: dict[str, str] = {"1D": "5d", "1W": "1mo", "1M": "3mo", "3M": "6mo", "YTD": "ytd"}

_STOOQ_SPECIAL: dict[str, str] = {
    "^GSPC": "^spx",
    "^NDX": "^ndx",
    "^DJI": "^dji",
    "^VIX": "vi.f",
    "^TNX": "10usy.b",
    "GC=F": "gc.f",
    "SI=F": "si.f",
    "PL=F": "pl.f",
    "PA=F": "pa.f",
    "CL=F": "cl.f",
    "BZ=F": "lb.f",
    "NG=F": "ng.f",
    "HG=F": "hg.f",
    "DX-Y.NYB": "dx.f",
}

_cache: dict[str, tuple[float, Any]] = {}
_inflight: dict[str, asyncio.Future[Any]] = {}
_state: dict[str, Any] = {"cooldown_until": 0.0, "strikes": 0, "crumb": None, "cookies": None}


def reset_state() -> None:
    """Clear caches / cooldown (used by tests)."""
    _cache.clear()
    _inflight.clear()
    _state.update({"cooldown_until": 0.0, "strikes": 0, "crumb": None, "cookies": None})


def yahoo_in_cooldown() -> bool:
    return time.monotonic() < float(_state["cooldown_until"])


def _register_429() -> None:
    _state["strikes"] = int(_state["strikes"]) + 1
    wait = min(COOLDOWN_MAX_SEC, COOLDOWN_BASE_SEC * (2 ** (int(_state["strikes"]) - 1)))
    _state["cooldown_until"] = time.monotonic() + wait
    logger.warning("yahoo: 429 received; cooling down for %.0fs", wait)


def _register_ok() -> None:
    _state["strikes"] = 0


async def cached_call(key: str, ttl: float, factory: Callable[[], Awaitable[Any]]) -> Any:
    """TTL cache + single-flight: identical concurrent requests share one upstream call."""
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    pending = _inflight.get(key)
    if pending is not None:
        return await pending
    fut: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    try:
        value = await factory()
    except BaseException as exc:
        fut.set_exception(exc)
        fut.exception()  # mark retrieved
        raise
    else:
        if value is not None:
            _cache[key] = (time.monotonic(), value)
        fut.set_result(value)
        return value
    finally:
        _inflight.pop(key, None)


def new_client(timeout: float = 8.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=YAHOO_HEADERS)


# ---------------------------------------------------------------------------
# Symbol helpers
# ---------------------------------------------------------------------------


def to_binance_symbol(sym: str) -> str | None:
    s = sym.upper()
    if s.endswith("-USD") and len(s) > 4:
        return f"{s[:-4]}USDT"
    return None


def to_fx_pair(sym: str) -> tuple[str, str] | None:
    s = sym.upper()
    if not s.endswith("=X"):
        return None
    core = s[:-2]
    if len(core) == 6 and core.isalpha():
        return core[:3], core[3:]
    if len(core) == 3 and core.isalpha():
        return "USD", core
    return None


def to_stooq_symbol(sym: str) -> str | None:
    s = sym.strip()
    if not s:
        return None
    if s.upper() in _STOOQ_SPECIAL:
        return _STOOQ_SPECIAL[s.upper()]
    if s.endswith("=X") or s.upper().endswith("-USD"):
        return None
    if s.startswith("^"):
        return s.lower()
    return f"{s.lower()}.us"


# ---------------------------------------------------------------------------
# Series math
# ---------------------------------------------------------------------------


def change_from_series(series: list[tuple[int, float]], period: str, live_price: float | None = None) -> dict[str, Any]:
    """Compute price & % change over ``period`` from an ascending [(epoch_sec, close)] daily series."""
    pts = [(int(t), float(c)) for t, c in series if c is not None]
    if not pts:
        return {"price": live_price, "change_pct": None}
    price = float(live_price) if live_price else pts[-1][1]
    base: float | None = None
    now = datetime.fromtimestamp(pts[-1][0], tz=UTC)
    if period == "1D":
        if len(pts) >= 2:
            base = pts[-2][1]
    else:
        if period == "YTD":
            target = datetime(now.year, 1, 1, tzinfo=UTC)
        else:
            days = {"1W": 7, "1M": 30, "3M": 91}.get(period, 7)
            target = now - timedelta(days=days)
        before = [c for t, c in pts if t <= target.timestamp()]
        base = before[-1] if before else pts[0][1]
        if period == "YTD" and not before:
            base = pts[0][1]
    chg = round((price - base) / base * 100.0, 2) if base else None
    return {"price": round(price, 4), "change_pct": chg}


# ---------------------------------------------------------------------------
# Yahoo
# ---------------------------------------------------------------------------


async def _yahoo_crumb(http: httpx.AsyncClient) -> str | None:
    if _state["crumb"]:
        # Tests and adapters may pass AsyncMock instead of a real httpx client.
        if _state["cookies"] and isinstance(http, _HTTPX_ASYNC_CLIENT_TYPE):
            http.cookies.update(_state["cookies"])
        return str(_state["crumb"])
    try:
        await http.get("https://fc.yahoo.com", headers=YAHOO_HEADERS)  # sets A3 consent cookie (404 is fine)
        resp = await http.get("https://query1.finance.yahoo.com/v1/test/getcrumb", headers=YAHOO_HEADERS)
        if resp.status_code == 429:
            _register_429()
            return None
        text = resp.text.strip()
        if resp.status_code == 200 and text and "<" not in text and len(text) < 64:
            _state["crumb"] = text
            # Only inspect cookies on a real httpx client. AsyncMock exposes
            # coroutine-like attributes that can emit un-awaited coroutine warnings.
            _state["cookies"] = dict(http.cookies) if isinstance(http, _HTTPX_ASYNC_CLIENT_TYPE) else {}
            return text
    except httpx.HTTPError:
        return None
    return None


async def yahoo_get_json(
    http: httpx.AsyncClient, url: str, params: dict[str, Any], *, crumb: bool = False
) -> dict[str, Any] | None:
    """GET JSON from Yahoo honoring cooldown; returns None on 429/any failure."""
    if yahoo_in_cooldown():
        return None
    query = dict(params)
    if crumb:
        value = await _yahoo_crumb(http)
        if not value:
            return None
        query["crumb"] = value
    try:
        resp = await http.get(url, params=query, headers=YAHOO_HEADERS)
    except httpx.HTTPError:
        return None
    if resp.status_code == 429:
        _register_429()
        return None
    if resp.status_code in (401, 403):
        _state["crumb"] = None
        return None
    if resp.status_code != 200:
        return None
    _register_ok()
    try:
        data = resp.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _parse_yahoo_chart(data: dict[str, Any]) -> dict[str, Any] | None:
    results = ((data.get("chart") or {}).get("result")) or []
    if not results:
        return None
    res = results[0]
    meta = res.get("meta") or {}
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    stamps = res.get("timestamp") or []
    return {
        "meta": meta,
        "timestamps": stamps,
        "open": quote.get("open") or [],
        "high": quote.get("high") or [],
        "low": quote.get("low") or [],
        "close": quote.get("close") or [],
        "volume": quote.get("volume") or [],
    }


async def yahoo_chart(http: httpx.AsyncClient, sym: str, interval: str, rng: str) -> dict[str, Any] | None:
    async def _go() -> dict[str, Any] | None:
        data = await yahoo_get_json(
            http,
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
            {"interval": interval, "range": rng},
        )
        return _parse_yahoo_chart(data) if data else None

    ttl = CHART_TTL_SEC if interval not in ("1d", "1wk") else QUOTE_TTL_SEC
    return await cached_call(f"y:chart:{sym}:{interval}:{rng}", ttl, _go)


async def _yahoo_quote_via_chart(http: httpx.AsyncClient, sym: str, period: str) -> dict[str, Any] | None:
    parsed = await yahoo_chart(http, sym, "1d", PERIOD_TO_YAHOO_RANGE.get(period, "5d"))
    if not parsed:
        return None
    series = [(int(t), float(c)) for t, c in zip(parsed["timestamps"], parsed["close"], strict=False) if c is not None]
    meta = parsed["meta"]
    live = meta.get("regularMarketPrice")
    out = change_from_series(series, period, float(live) if live is not None else None)
    if out["price"] is None:
        return None
    return {
        "name": meta.get("shortName") or meta.get("longName") or sym,
        "price": out["price"],
        "change_pct": out["change_pct"],
        "market_cap": None,
        "volume": meta.get("regularMarketVolume"),
        "live": True,
        "source": "yahoo",
    }


async def _yahoo_batch_quotes(http: httpx.AsyncClient, tickers: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(tickers), 50):
        chunk = tickers[i : i + 50]
        key = "y:v7:" + ",".join(chunk)

        async def _go(chunk: list[str] = chunk) -> dict[str, Any] | None:
            return await yahoo_get_json(
                http, "https://query1.finance.yahoo.com/v7/finance/quote", {"symbols": ",".join(chunk)}, crumb=True
            )

        data = await cached_call(key, QUOTE_TTL_SEC, _go)
        for q in ((data or {}).get("quoteResponse") or {}).get("result") or []:
            sym = str(q.get("symbol") or "").upper()
            if not sym or q.get("regularMarketPrice") is None:
                continue
            chg = q.get("regularMarketChangePercent")
            out[sym] = {
                "name": q.get("shortName") or q.get("longName") or sym,
                "price": round(float(q["regularMarketPrice"]), 4),
                "change_pct": round(float(chg), 2) if chg is not None else None,
                "market_cap": float(q["marketCap"]) if q.get("marketCap") else None,
                "volume": float(q["regularMarketVolume"]) if q.get("regularMarketVolume") else None,
                "live": True,
                "source": "yahoo",
            }
    return out


# ---------------------------------------------------------------------------
# Fallback providers (daily series: [(epoch_sec, close)])
# ---------------------------------------------------------------------------


async def binance_daily_series(http: httpx.AsyncClient, sym: str, limit: int = 400) -> list[tuple[int, float]] | None:
    pair = to_binance_symbol(sym)
    if not pair:
        return None

    async def _go() -> list[tuple[int, float]] | None:
        try:
            resp = await http.get(
                "https://api.binance.com/api/v3/klines", params={"symbol": pair, "interval": "1d", "limit": limit}
            )
            if resp.status_code != 200:
                return None
            rows = resp.json()
            return [(int(r[0]) // 1000, float(r[4])) for r in rows] or None
        except (httpx.HTTPError, ValueError, IndexError, TypeError):
            return None

    return await cached_call(f"b:d:{pair}:{limit}", QUOTE_TTL_SEC, _go)


async def frankfurter_daily_series(http: httpx.AsyncClient, sym: str) -> list[tuple[int, float]] | None:
    pair = to_fx_pair(sym)
    if not pair:
        return None
    base, quote = pair
    start = (datetime.now(UTC).date() - timedelta(days=400)).isoformat()

    async def _go() -> list[tuple[int, float]] | None:
        try:
            resp = await http.get(f"https://api.frankfurter.app/{start}..", params={"from": base, "to": quote})
            if resp.status_code != 200:
                return None
            rates = (resp.json() or {}).get("rates") or {}
            series = [
                (int(datetime.fromisoformat(d).replace(tzinfo=UTC).timestamp()), float(v[quote]))
                for d, v in sorted(rates.items())
                if quote in v
            ]
            return series or None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return None

    return await cached_call(f"f:d:{base}{quote}", QUOTE_TTL_SEC * 5, _go)


async def stooq_daily_bars(http: httpx.AsyncClient, sym: str, days: int = 400) -> list[dict[str, Any]] | None:
    stq = to_stooq_symbol(sym)
    if not stq:
        return None
    d2 = datetime.now(UTC).date()
    d1 = d2 - timedelta(days=days)

    async def _go() -> list[dict[str, Any]] | None:
        try:
            resp = await http.get(
                "https://stooq.com/q/d/l/",
                params={"s": stq, "i": "d", "d1": d1.strftime("%Y%m%d"), "d2": d2.strftime("%Y%m%d")},
            )
            if resp.status_code != 200:
                return None
            lines = resp.text.strip().splitlines()
            if len(lines) < 2 or not lines[0].lower().startswith("date"):
                return None
            bars: list[dict[str, Any]] = []
            for line in lines[1:]:
                parts = line.split(",")
                if len(parts) < 5:
                    continue
                try:
                    day = date.fromisoformat(parts[0])
                    bars.append(
                        {
                            "time": int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()),
                            "open": float(parts[1]),
                            "high": float(parts[2]),
                            "low": float(parts[3]),
                            "close": float(parts[4]),
                            "volume": float(parts[5]) if len(parts) > 5 and parts[5] else 0.0,
                        }
                    )
                except ValueError:
                    continue
            return bars or None
        except httpx.HTTPError:
            return None

    return await cached_call(f"s:d:{stq}:{days}", QUOTE_TTL_SEC * 5, _go)


async def fallback_quote(http: httpx.AsyncClient, sym: str, period: str) -> dict[str, Any] | None:
    """Try Binance (crypto) -> Frankfurter (FX) -> Stooq (everything else)."""
    series: list[tuple[int, float]] | None = None
    source = ""
    if to_binance_symbol(sym):
        series = await binance_daily_series(http, sym)
        source = "binance"
    if not series and to_fx_pair(sym):
        series = await frankfurter_daily_series(http, sym)
        source = "frankfurter"
    if not series:
        bars = await stooq_daily_bars(http, sym)
        if bars:
            series = [(b["time"], b["close"]) for b in bars]
            source = "stooq"
    if not series:
        return None
    out = change_from_series(series, period)
    if out["price"] is None:
        return None
    return {
        "name": sym,
        "price": out["price"],
        "change_pct": out["change_pct"],
        "market_cap": None,
        "volume": None,
        "live": True,
        "source": source,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_quotes(
    tickers: list[str],
    period: str = "1D",
    *,
    stale: dict[str, dict[str, Any]] | None = None,
    http: httpx.AsyncClient | None = None,
    concurrency: int = 6,
) -> dict[str, dict[str, Any]]:
    """Return {TICKER: quote} with real price & period % change; never raises.

    Resolution order per ticker: Yahoo batch (1D) -> Yahoo chart -> Binance/Frankfurter/Stooq -> stale cache.
    """
    uniq = list(dict.fromkeys(t.strip().upper() for t in tickers if t and t.strip()))
    result: dict[str, dict[str, Any]] = {}
    if not uniq:
        return result
    owns = http is None
    client = http or new_client()
    try:
        if period == "1D":
            result.update(await _yahoo_batch_quotes(client, uniq))

        sem = asyncio.Semaphore(concurrency)

        async def _resolve(sym: str) -> None:
            async with sem:
                q = None
                if not yahoo_in_cooldown():
                    q = await _yahoo_quote_via_chart(client, sym, period)
                if q is None or q.get("change_pct") is None:
                    fb = await fallback_quote(client, sym, period)
                    if fb:
                        if q:
                            fb["name"] = q.get("name") or fb["name"]
                        q = fb
                if q:
                    existing = result.get(sym) or {}
                    if existing.get("name") and q.get("name") in (None, sym):
                        q["name"] = existing["name"]
                    for k in ("market_cap", "volume"):
                        if q.get(k) is None and existing.get(k) is not None:
                            q[k] = existing[k]
                    result[sym] = q

        missing = [s for s in uniq if s not in result or result[s].get("change_pct") is None]
        await asyncio.gather(*[_resolve(s) for s in missing])
    finally:
        if owns:
            await client.aclose()

    for sym in uniq:
        if sym not in result and stale and stale.get(sym) and stale[sym].get("price") is not None:
            cached = dict(stale[sym])
            cached["live"] = False
            cached["source"] = "cache"
            result[sym] = cached
    return result


_TF_TO_BINANCE: dict[str, str] = {
    "M1": "1m",
    "M5": "5m",
    "M15": "15m",
    "M30": "30m",
    "H1": "1h",
    "H4": "4h",
    "D1": "1d",
    "W1": "1w",
}


async def binance_bars(
    http: httpx.AsyncClient, sym: str, timeframe: str, limit: int = 500
) -> list[dict[str, Any]] | None:
    pair = to_binance_symbol(sym)
    interval = _TF_TO_BINANCE.get(timeframe)
    if not pair or not interval:
        return None

    async def _go() -> list[dict[str, Any]] | None:
        try:
            resp = await http.get(
                "https://api.binance.com/api/v3/klines",
                params={"symbol": pair, "interval": interval, "limit": limit},
            )
            if resp.status_code != 200:
                return None
            return [
                {
                    "time": int(r[0]) // 1000,
                    "open": float(r[1]),
                    "high": float(r[2]),
                    "low": float(r[3]),
                    "close": float(r[4]),
                    "volume": float(r[5]),
                }
                for r in resp.json()
            ] or None
        except (httpx.HTTPError, ValueError, IndexError, TypeError):
            return None

    return await cached_call(f"b:bars:{pair}:{interval}:{limit}", CHART_TTL_SEC, _go)


async def fetch_chart_with_fallback(
    yahoo_sym: str, timeframe: str, interval: str, rng: str, *, http: httpx.AsyncClient | None = None
) -> dict[str, Any] | None:
    """Return {"bars","price","prev_close","name","currency","source","timeframe"} or None if all providers fail."""
    owns = http is None
    client = http or new_client()
    try:
        parsed = await yahoo_chart(client, yahoo_sym, interval, rng) if not yahoo_in_cooldown() else None
        if parsed:
            bars: list[dict[str, Any]] = []
            for idx, ts in enumerate(parsed["timestamps"]):
                try:
                    o, h, lo, c = (parsed[k][idx] for k in ("open", "high", "low", "close"))
                except IndexError:
                    continue
                if None in (o, h, lo, c):
                    continue
                vols = parsed["volume"]
                bars.append(
                    {
                        "time": int(ts),
                        "open": float(o),
                        "high": float(h),
                        "low": float(lo),
                        "close": float(c),
                        "volume": float(vols[idx] or 0) if idx < len(vols) else 0.0,
                    }
                )
            if bars:
                meta = parsed["meta"]
                return {
                    "bars": bars,
                    "price": float(meta.get("regularMarketPrice") or bars[-1]["close"]),
                    "prev_close": float(meta.get("chartPreviousClose") or meta.get("previousClose") or 0) or None,
                    "name": meta.get("longName") or meta.get("shortName"),
                    "currency": meta.get("currency"),
                    "source": "yahoo",
                    "timeframe": timeframe,
                }

        bars = await binance_bars(client, yahoo_sym, timeframe)
        source, effective_tf = "binance", timeframe
        if not bars:
            bars = await stooq_daily_bars(client, yahoo_sym)
            source, effective_tf = "stooq", "D1"
        if not bars:
            fx = await frankfurter_daily_series(client, yahoo_sym)
            if fx:
                bars = [{"time": t, "open": c, "high": c, "low": c, "close": c, "volume": 0.0} for t, c in fx]
                source, effective_tf = "frankfurter", "D1"
        if not bars:
            return None
        prev = bars[-2]["close"] if len(bars) >= 2 else None
        return {
            "bars": bars[-500:],
            "price": bars[-1]["close"],
            "prev_close": prev,
            "name": None,
            "currency": None,
            "source": source,
            "timeframe": effective_tf,
        }
    finally:
        if owns:
            await client.aclose()
