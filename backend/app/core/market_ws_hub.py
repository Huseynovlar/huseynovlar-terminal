from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time

from app.core.config import Settings
from app.core.ws_hub import ws_hub

logger = logging.getLogger(__name__)

# Binance Vision public endpoint (never geo-blocked on cloud VPS IPs, unlike stream.binance.com:9443)
BINANCE_VISION_WS_BASE = "wss://data-stream.binance.vision/stream?streams="

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


class ServerMarketWsHub:
    """Server-side real-time WebSocket collector:
    - Tiingo FX WS -> real-time Spot Gold (XAUUSD), Silver (XAGUSD), and 13 Forex pairs
    - Binance Vision WS -> real-time Crypto ticks + L2 orderbook
    """

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task[None]] = []
        self._stop_event = asyncio.Event()
        self._last_emit: dict[str, float] = {}
        self._prev_mid: dict[str, float] = {}
        self._tiingo_key: str = ""

    def _allow_emit(self, key: str, min_interval: float = 0.2) -> bool:
        if ws_hub.connection_count == 0:
            return False
        now = time.monotonic()
        prev = self._last_emit.get(key, 0.0)
        if now - prev < min_interval:
            return False
        self._last_emit[key] = now
        return True

    async def start(self, settings: Settings | None = None) -> None:
        if self._tasks:
            return
        self._tiingo_key = (settings.tiingo_api_key if settings else "").strip()
        self._stop_event.clear()
        self._tasks = [asyncio.create_task(self._run_binance_vision_loop())]
        if self._tiingo_key:
            self._tasks.append(asyncio.create_task(self._run_tiingo_fx_loop(self._tiingo_key)))
            logger.info("market_ws_hub: started Binance Vision + Tiingo FX real-time WS collectors")
        else:
            logger.info("market_ws_hub: started Binance Vision real-time WS collector (TIINGO_API_KEY not set)")

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
                            if bid > 0 and ask > 0:
                                for canon in targets:
                                    if self._allow_emit(f"tk:{canon}", 0.2):
                                        mid = (bid + ask) / 2.0
                                        prev = self._prev_mid.get(canon, mid)
                                        side = "buy" if mid >= prev else "sell"
                                        self._prev_mid[canon] = mid
                                        await ws_hub.broadcast(
                                            "tick",
                                            {
                                                "symbol": canon,
                                                "bid": bid,
                                                "ask": ask,
                                                "price": mid,
                                                "bid_size": float(data.get("B") or 1.0),
                                                "ask_size": float(data.get("A") or 1.0),
                                                "side": side,
                                                "source": "binance_vision",
                                            },
                                        )
                        elif "@depth" in stream:
                            raw_bids = data.get("bids") or []
                            raw_asks = data.get("asks") or []
                            if raw_bids or raw_asks:
                                for canon in targets:
                                    if self._allow_emit(f"ob:{canon}", 0.4):
                                        await ws_hub.broadcast(
                                            "orderbook",
                                            {
                                                "symbol": canon,
                                                "bids": [[float(p), float(q)] for p, q in raw_bids[:8]],
                                                "asks": [[float(p), float(q)] for p, q in raw_asks[:8]],
                                                "source": "binance_vision",
                                            },
                                        )
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
                        # Format: ["Q", ticker, iso_ts, bid_size, bid_price, mid_price, ask_size, ask_price]
                        if not isinstance(arr, list) or len(arr) < 8 or arr[0] != "Q":
                            continue
                        tk_sym = str(arr[1] or "").lower()
                        canon = TIINGO_FX_TICKERS.get(tk_sym)
                        if not canon:
                            continue
                        bid_sz = float(arr[3] or 1.0)
                        bid = float(arr[4] or 0.0)
                        mid = float(arr[5] or 0.0)
                        ask_sz = float(arr[6] or 1.0)
                        ask = float(arr[7] or 0.0)
                        if bid > 0 and ask > 0 and self._allow_emit(f"tk:{canon}", 0.18):
                            eff_mid = mid if mid > 0 else (bid + ask) / 2.0
                            prev = self._prev_mid.get(canon, eff_mid)
                            side = "buy" if eff_mid >= prev else "sell"
                            self._prev_mid[canon] = eff_mid
                            await ws_hub.broadcast(
                                "tick",
                                {
                                    "symbol": canon,
                                    "bid": bid,
                                    "ask": ask,
                                    "price": eff_mid,
                                    "bid_size": bid_sz,
                                    "ask_size": ask_sz,
                                    "side": side,
                                    "source": "tiingo_fx",
                                },
                            )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Tiingo FX WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)


market_ws_hub = ServerMarketWsHub()
