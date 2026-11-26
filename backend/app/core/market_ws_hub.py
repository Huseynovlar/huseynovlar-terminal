from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import deque
from typing import Any

import httpx

from app.core.config import Settings
from app.core.symbols import canonical_asset_code
from app.core.ws_hub import ws_hub

logger = logging.getLogger(__name__)

# Binance Vision public endpoint (never geo-blocked on cloud VPS IPs, unlike stream.binance.com:9443)
BINANCE_VISION_WS_BASE = "wss://data-stream.binance.vision/stream?streams="
ALPACA_IEX_WS_URL = "wss://stream.data.alpaca.markets/v2/iex"

BINANCE_STREAMS: dict[str, str] = {
    "btcusdt": "BTCUSD",
    "ethusdt": "ETHUSD",
    "solusdt": "SOLUSD",
    "bnbusdt": "BNBUSD",
    "xrpusdt": "XRPUSD",
    "adausdt": "ADAUSD",
    "dogeusdt": "DOGEUSD",
    "tonusdt": "TONUSD",
    "ltcusdt": "LTCUSD",
    "paxgusdt": "PAXGUSD",
}

TIINGO_FX_WS_URL = "wss://api.tiingo.com/fx"

TIINGO_FX_TICKERS: dict[str, str] = {
    "xauusd": "XAUUSD",
    "xagusd": "XAGUSD",
    "eurusd": "EURUSD",
    "gbpusd": "GBPUSD",
    "usdjpy": "USDJPY",
    "usdchf": "USDCHF",
    "usdcad": "USDCAD",
    "audusd": "AUDUSD",
    "nzdusd": "NZDUSD",
    "eurgbp": "EURGBP",
    "eurjpy": "EURJPY",
    "gbpjpy": "GBPJPY",
    "audjpy": "AUDJPY",
    "euraud": "EURAUD",
    "eurchf": "EURCHF",
}

_YAHOO_QUOTE_MAP: dict[str, str] = {
    "XAUUSD": "GC=F",
    "XAGUSD": "SI=F",
    "USTEC": "^NDX",
    "US500": "^GSPC",
    "US30": "^DJI",
    "DE40": "^GDAXI",
    "UK100": "^FTSE",
    "JP225": "^N225",
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "VIX": "^VIX",
    "USOIL": "CL=F",
    "UKOIL": "BZ=F",
    "NGAS": "NG=F",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "NZDUSD": "NZDUSD=X",
}

_CRYPTO_CANON_SET = set(BINANCE_STREAMS.values())
_FX_METAL_SET = set(TIINGO_FX_TICKERS.values())
_INDEX_COMMODITY_SET = {
    "USTEC",
    "US500",
    "US30",
    "DE40",
    "UK100",
    "JP225",
    "DXY",
    "US10Y",
    "VIX",
    "USOIL",
    "UKOIL",
    "NGAS",
}

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}


def _is_us_equity_symbol(sym: str) -> bool:
    if sym in _CRYPTO_CANON_SET or sym in _FX_METAL_SET or sym in _INDEX_COMMODITY_SET:
        return False
    if sym.endswith("USD") or sym.endswith("USDT"):
        return False
    return 1 <= len(sym) <= 5 and sym.isalpha()


def _estimate_half_spread(sym: str, price: float) -> float:
    if price <= 0:
        return 0.0
    if sym in ("XAUUSD", "XAGUSD"):
        return max(0.01, round(price * 0.00004, 4))
    if sym in _INDEX_COMMODITY_SET:
        return max(0.01, round(price * 0.00005, 4))
    if price < 10:
        return 0.00005
    return max(0.01, round(price * 0.0001, 4))


class ServerMarketWsHub:
    """Subscription-aware multi-asset real-time WebSocket & on-demand market hub:
    - Streams ONLY symbols with active /ws/market subscribers (zero all-market flood)
    - Binance Vision WS + Futures Liquidations -> Crypto (ticks, L2 DOM, liquidations)
    - Tiingo FX WS -> Spot Metals (XAUUSD, XAGUSD) & 13 Forex pairs
    - Alpaca IEX WS -> US Equities & ETFs (AAPL, NVDA, TSLA, SPY, QQQ, etc.)
    - On-demand real-time quote streamer -> Indices (USTEC, US500, US30, DE40), Commodities (USOIL, UKOIL, NGAS),
      Metals, and after-hours/weekend Equities via Alpaca REST / Finnhub / Binance Vision / Yahoo
    """

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task[None]] = []
        self._stop_event = asyncio.Event()
        self._last_emit: dict[str, float] = {}
        self._last_ring: dict[str, float] = {}
        self._last_live_tick_at: dict[str, float] = {}
        self._prev_mid: dict[str, float] = {}
        self._tick_ring: dict[str, deque[dict[str, Any]]] = {}
        self._orderbook_cache: dict[str, dict[str, Any]] = {}
        self._tiingo_key: str = ""
        self._alpaca_key: str = ""
        self._alpaca_secret: str = ""
        self._finnhub_key: str = ""

    def _allow_emit(self, key: str, symbol: str, min_interval: float = 0.2) -> bool:
        if not ws_hub.has_market_subscriber(symbol):
            return False
        now = time.monotonic()
        prev = self._last_emit.get(key, 0.0)
        if now - prev < min_interval:
            return False
        self._last_emit[key] = now
        return True

    def record_tick(
        self,
        symbol: str,
        bid: float,
        ask: float,
        *,
        bid_size: float = 1.0,
        ask_size: float = 1.0,
        source: str = "live",
        min_interval: float = 0.22,
        ts_ms: int | None = None,
    ) -> dict[str, Any] | None:
        canon = canonical_asset_code(symbol) or symbol.strip().upper()
        if not canon or bid <= 0:
            return None
        eff_ask = ask if ask >= bid else bid
        now_mono = time.monotonic()
        if min_interval > 0:
            if now_mono - self._last_ring.get(canon, 0.0) < min_interval:
                return None
            self._last_ring[canon] = now_mono

        if source != "mt5_live":
            self._last_live_tick_at[canon] = now_mono

        mid = (bid + eff_ask) / 2.0
        prev = self._prev_mid.get(canon, mid)
        side = "buy" if mid >= prev else "sell"
        self._prev_mid[canon] = mid

        entry = {
            "ts_ms": int(ts_ms) if ts_ms and ts_ms > 0 else int(time.time() * 1000),
            "symbol": canon,
            "bid": bid,
            "ask": eff_ask,
            "price": round(mid, 5),
            "bid_size": bid_size,
            "ask_size": ask_size,
            "side": side,
            "source": source,
        }
        buf = self._tick_ring.get(canon)
        if buf is None:
            buf = deque(maxlen=500)
            self._tick_ring[canon] = buf
        buf.append(entry)
        return entry

    def get_recent_ticks(self, symbol: str, limit: int = 160) -> list[dict[str, Any]]:
        canon = canonical_asset_code(symbol) or symbol.strip().upper()
        buf = self._tick_ring.get(canon)
        if not buf:
            return []
        return list(buf)[-limit:]

    def get_latest_orderbook(self, symbol: str) -> dict[str, Any] | None:
        canon = canonical_asset_code(symbol) or symbol.strip().upper()
        return self._orderbook_cache.get(canon)

    async def start(self, settings: Settings | None = None) -> None:
        if self._tasks:
            return
        self._tiingo_key = (settings.tiingo_api_key if settings else "").strip()
        self._alpaca_key = (settings.alpaca_api_key if settings else "").strip()
        self._alpaca_secret = (settings.alpaca_api_secret if settings else "").strip()
        self._finnhub_key = (settings.finnhub_api_key if settings else "").strip()
        self._stop_event.clear()
        self._tasks = [
            asyncio.create_task(self._run_binance_vision_loop()),
            asyncio.create_task(self._run_binance_liquidations_loop()),
            asyncio.create_task(self._run_on_demand_quote_loop()),
        ]
        if self._tiingo_key:
            self._tasks.append(asyncio.create_task(self._run_tiingo_fx_loop(self._tiingo_key)))
        if self._alpaca_key and self._alpaca_secret:
            self._tasks.append(asyncio.create_task(self._run_alpaca_iex_ws_loop(self._alpaca_key, self._alpaca_secret)))
        logger.info(
            "market_ws_hub: started collectors (binance=on, liq=on, on_demand=on, tiingo=%s, alpaca=%s, finnhub=%s)",
            bool(self._tiingo_key),
            bool(self._alpaca_key and self._alpaca_secret),
            bool(self._finnhub_key),
        )

    async def stop(self) -> None:
        self._stop_event.set()
        tasks = list(self._tasks)
        self._tasks.clear()
        for t in tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t

    async def _run_binance_vision_loop(self) -> None:
        import websockets

        stream_parts: list[str] = []
        for s in BINANCE_STREAMS:
            stream_parts.append(f"{s}@bookTicker")
            stream_parts.append(f"{s}@depth10@100ms")
        url = f"{BINANCE_VISION_WS_BASE}{'/'.join(stream_parts)}"

        backoff = 2.0
        while not self._stop_event.is_set():
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    logger.info("market_ws_hub: connected to Binance Vision WS (%d symbols)", len(BINANCE_STREAMS))
                    backoff = 2.0
                    async for raw in ws:
                        if self._stop_event.is_set():
                            break
                        if not isinstance(raw, str):
                            continue
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        stream = str(msg.get("stream") or "")
                        data = msg.get("data")
                        if not isinstance(data, dict) or "@" not in stream:
                            continue
                        base_sym = stream.split("@", 1)[0].lower()
                        mapped = BINANCE_STREAMS.get(base_sym)
                        if not mapped:
                            continue

                        targets = [mapped]
                        if mapped == "PAXGUSD" and not self._tiingo_key:
                            targets.append("XAUUSD")

                        if stream.endswith("@bookTicker"):
                            bid = float(data.get("b") or 0.0)
                            ask = float(data.get("a") or 0.0)
                            bid_sz = float(data.get("B") or 1.0)
                            ask_sz = float(data.get("A") or 1.0)
                            if bid > 0 and ask > 0:
                                for canon in targets:
                                    entry = self.record_tick(
                                        canon,
                                        bid,
                                        ask,
                                        bid_size=bid_sz,
                                        ask_size=ask_sz,
                                        source="binance_vision",
                                    )
                                    if entry and self._allow_emit(f"tk:{canon}", canon, 0.2):
                                        await ws_hub.broadcast("tick", entry)
                        elif "@depth" in stream:
                            raw_bids = data.get("bids") or []
                            raw_asks = data.get("asks") or []
                            if raw_bids or raw_asks:
                                bids_list = [[float(p), float(q)] for p, q in raw_bids[:8]]
                                asks_list = [[float(p), float(q)] for p, q in raw_asks[:8]]
                                for canon in targets:
                                    ob_payload = {
                                        "symbol": canon,
                                        "bids": bids_list,
                                        "asks": asks_list,
                                        "source": "binance_vision",
                                    }
                                    self._orderbook_cache[canon] = ob_payload
                                    if self._allow_emit(f"ob:{canon}", canon, 0.4):
                                        await ws_hub.broadcast("orderbook", ob_payload)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Binance Vision WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)

    async def _run_tiingo_fx_loop(self, api_key: str) -> None:
        import websockets

        backoff = 2.0
        tickers = list(TIINGO_FX_TICKERS.keys())
        while not self._stop_event.is_set():
            try:
                async with websockets.connect(TIINGO_FX_WS_URL, ping_interval=25, ping_timeout=20) as ws:
                    await ws.send(
                        json.dumps(
                            {
                                "eventName": "subscribe",
                                "authorization": api_key,
                                "eventData": {"thresholdLevel": 5, "tickers": tickers},
                            }
                        )
                    )
                    logger.info("market_ws_hub: connected to Tiingo FX Live WS (%d FX/Metals symbols)", len(tickers))
                    backoff = 2.0
                    async for raw in ws:
                        if self._stop_event.is_set():
                            break
                        if not isinstance(raw, str):
                            continue
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if msg.get("messageType") != "A":
                            continue
                        arr = msg.get("data")
                        if not isinstance(arr, list) or len(arr) < 8 or arr[0] != "Q":
                            continue
                        tk_sym = str(arr[1] or "").lower()
                        canon = TIINGO_FX_TICKERS.get(tk_sym)
                        if not canon:
                            continue
                        bid_sz = float(arr[3] or 1.0)
                        bid = float(arr[4] or 0.0)
                        ask_sz = float(arr[6] or 1.0)
                        ask = float(arr[7] or 0.0)
                        if bid > 0 and ask > 0:
                            entry = self.record_tick(
                                canon,
                                bid,
                                ask,
                                bid_size=bid_sz,
                                ask_size=ask_sz,
                                source="tiingo_fx",
                                min_interval=0.18,
                            )
                            if entry and self._allow_emit(f"tk:{canon}", canon, 0.18):
                                await ws_hub.broadcast("tick", entry)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Tiingo FX WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)

    async def _run_alpaca_iex_ws_loop(self, api_key: str, api_secret: str) -> None:
        """Dynamic on-demand Alpaca IEX WebSocket for currently opened US Equities / ETFs."""
        import websockets

        backoff = 3.0
        while not self._stop_event.is_set():
            # Only connect to Alpaca WS while at least one equity symbol is actively subscribed
            active_eq = {s for s in ws_hub.active_market_symbols() if _is_us_equity_symbol(s)}
            if not active_eq:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=1.5)
                continue

            try:
                async with websockets.connect(ALPACA_IEX_WS_URL, ping_interval=20, ping_timeout=20) as ws:
                    await ws.send(json.dumps({"action": "auth", "key": api_key, "secret": api_secret}))
                    subscribed: set[str] = set()
                    backoff = 3.0

                    async def _sync_subs(sock: Any, subs: set[str]) -> None:
                        while not self._stop_event.is_set():
                            wanted = {s for s in ws_hub.active_market_symbols() if _is_us_equity_symbol(s)}
                            to_add = sorted(wanted - subs)
                            to_rem = sorted(subs - wanted)
                            if to_add:
                                await sock.send(json.dumps({"action": "subscribe", "quotes": to_add, "trades": to_add}))
                                subs.update(to_add)
                            if to_rem:
                                await sock.send(
                                    json.dumps({"action": "unsubscribe", "quotes": to_rem, "trades": to_rem})
                                )
                                subs.difference_update(to_rem)
                            await asyncio.sleep(1.0)

                    sync_task = asyncio.create_task(_sync_subs(ws, subscribed))
                    try:
                        async for raw in ws:
                            if self._stop_event.is_set():
                                break
                            if not isinstance(raw, str):
                                continue
                            try:
                                frames = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            if not isinstance(frames, list):
                                continue
                            for item in frames:
                                if not isinstance(item, dict):
                                    continue
                                t_type = item.get("T")
                                sym = str(item.get("S") or "").strip().upper()
                                if not sym:
                                    continue
                                if t_type == "q":
                                    bid = float(item.get("bp") or 0.0)
                                    ask = float(item.get("ap") or bid)
                                    bsz = float(item.get("bs") or 1.0)
                                    asz = float(item.get("as") or 1.0)
                                    if bid > 0:
                                        entry = self.record_tick(
                                            sym,
                                            bid,
                                            ask if ask >= bid else bid,
                                            bid_size=bsz,
                                            ask_size=asz,
                                            source="alpaca_iex",
                                            min_interval=0.15,
                                        )
                                        if entry and self._allow_emit(f"tk:{sym}", sym, 0.15):
                                            await ws_hub.broadcast("tick", entry)
                                elif t_type == "t":
                                    px = float(item.get("p") or 0.0)
                                    sz = float(item.get("s") or 1.0)
                                    if px > 0:
                                        hs = _estimate_half_spread(sym, px)
                                        entry = self.record_tick(
                                            sym,
                                            round(px - hs, 4),
                                            round(px + hs, 4),
                                            bid_size=sz,
                                            ask_size=sz,
                                            source="alpaca_iex",
                                            min_interval=0.15,
                                        )
                                        if entry and self._allow_emit(f"tk:{sym}", sym, 0.15):
                                            await ws_hub.broadcast("tick", entry)
                    finally:
                        sync_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await sync_task
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Alpaca IEX WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)

    async def _fetch_on_demand_quote(
        self,
        http: httpx.AsyncClient,
        sym: str,
    ) -> tuple[float, float, float, float, str] | None:
        """Fetch latest Bid/Ask for ANY subscribed symbol (Equities, Indices, Metals, Commodities, Crypto)."""
        # 1. US Equities via Alpaca Latest Quote REST (works even during pre/after-hours)
        if _is_us_equity_symbol(sym) and self._alpaca_key and self._alpaca_secret:
            try:
                r = await http.get(
                    f"https://data.alpaca.markets/v2/stocks/{sym}/quotes/latest",
                    headers={
                        "APCA-API-KEY-ID": self._alpaca_key,
                        "APCA-API-SECRET-KEY": self._alpaca_secret,
                    },
                )
                if r.status_code == 200:
                    q = r.json().get("quote") or {}
                    bp = float(q.get("bp") or 0.0)
                    ap = float(q.get("ap") or bp)
                    if bp > 0:
                        return bp, max(bp, ap), float(q.get("bs") or 1.0), float(q.get("as") or 1.0), "alpaca_iex"
            except Exception:
                pass

        # 2. US Equities via Finnhub REST quote
        if _is_us_equity_symbol(sym) and self._finnhub_key:
            try:
                r = await http.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": sym, "token": self._finnhub_key},
                )
                if r.status_code == 200:
                    px = float(r.json().get("c") or 0.0)
                    if px > 0:
                        hs = _estimate_half_spread(sym, px)
                        return round(px - hs, 4), round(px + hs, 4), 1.0, 1.0, "finnhub"
            except Exception:
                pass

        # 3. Any non-top-10 Crypto pair via Binance Vision bookTicker REST
        if sym.endswith("USD") and sym not in _FX_METAL_SET and sym not in _CRYPTO_CANON_SET:
            pair = f"{sym[:-3]}USDT"
            try:
                r = await http.get("https://data-api.binance.vision/api/v3/ticker/bookTicker", params={"symbol": pair})
                if r.status_code == 200:
                    d = r.json()
                    bp = float(d.get("bidPrice") or 0.0)
                    ap = float(d.get("askPrice") or bp)
                    if bp > 0:
                        return (
                            bp,
                            max(bp, ap),
                            float(d.get("bidQty") or 1.0),
                            float(d.get("askQty") or 1.0),
                            "binance_vision",
                        )
            except Exception:
                pass

        # 4. Universal fallback for Indices (USTEC, US500, US30, DE40), Commodities (USOIL, UKOIL, NGAS),
        #    Metals (XAUUSD, XAGUSD), and Equities via Yahoo v8 fast meta quote
        y_sym = _YAHOO_QUOTE_MAP.get(sym, sym)
        try:
            r = await http.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{y_sym}",
                params={"interval": "1m", "range": "1d"},
                headers=_HTTP_HEADERS,
            )
            if r.status_code == 200:
                res = (r.json().get("chart") or {}).get("result") or []
                if res:
                    meta = res[0].get("meta") or {}
                    px = float(meta.get("regularMarketPrice") or 0.0)
                    if px > 0:
                        hs = _estimate_half_spread(sym, px)
                        return round(px - hs, 5), round(px + hs, 5), 1.0, 1.0, "yahoo_live"
        except Exception:
            pass
        return None

    async def _run_on_demand_quote_loop(self) -> None:
        """Streams live ticks ONLY for currently subscribed symbols that have no active WS tick in last 2s."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0)) as http:
            while not self._stop_event.is_set():
                active_syms = ws_hub.active_market_symbols()
                if not active_syms:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
                    continue

                now_mono = time.monotonic()
                for sym in list(active_syms):
                    if self._stop_event.is_set():
                        break
                    # Skip if a direct WS stream (Binance / Tiingo / Alpaca WS) already delivered a tick < 2.2s ago
                    if now_mono - self._last_live_tick_at.get(sym, 0.0) < 2.2:
                        continue
                    quote = await self._fetch_on_demand_quote(http, sym)
                    if quote is not None:
                        bid, ask, bsz, asz, src = quote
                        entry = self.record_tick(
                            sym,
                            bid,
                            ask,
                            bid_size=bsz,
                            ask_size=asz,
                            source=src,
                            min_interval=0.5,
                        )
                        if entry and ws_hub.has_market_subscriber(sym):
                            await ws_hub.broadcast("tick", entry)

                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=2.0)

    async def _run_binance_liquidations_loop(self) -> None:
        import websockets

        url = "wss://fstream.binance.com/ws/!forceOrder@arr"
        backoff = 3.0
        while not self._stop_event.is_set():
            try:
                async with websockets.connect(url, ping_interval=25, ping_timeout=20) as ws:
                    logger.info("market_ws_hub: connected to Binance Futures Liquidations WS")
                    backoff = 3.0
                    async for raw in ws:
                        if self._stop_event.is_set():
                            break
                        if not isinstance(raw, str):
                            continue
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        order = msg.get("o")
                        if not isinstance(order, dict):
                            continue
                        sym_low = str(order.get("s") or "").lower()
                        canon = BINANCE_STREAMS.get(sym_low)
                        if not canon or not ws_hub.has_market_subscriber(canon):
                            continue
                        price = float(order.get("ap") or order.get("p") or 0.0)
                        qty = float(order.get("q") or 0.0)
                        if price <= 0 or qty <= 0:
                            continue
                        side = str(order.get("S") or "SELL").upper()
                        await ws_hub.broadcast(
                            "liquidation",
                            {
                                "symbol": canon,
                                "side": "BUY" if side == "BUY" else "SELL",
                                "price": price,
                                "qty": qty,
                                "usd_value": round(price * qty, 2),
                                "source": "binance_futures",
                                "ts_ms": int(order.get("T") or time.time() * 1000),
                            },
                        )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Binance Liquidations WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)


market_ws_hub = ServerMarketWsHub()
