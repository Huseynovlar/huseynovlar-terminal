from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from app.core.ws_hub import ws_hub

logger = logging.getLogger(__name__)

# Map Binance stream symbol -> canonical terminal symbol
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
}

# Map Deriv Public WS symbol -> canonical terminal symbol
DERIV_STREAMS: dict[str, str] = {
    "frxXAUUSD": "XAUUSD",
    "frxXAGUSD": "XAGUSD",
    "OTC_NDX": "USTEC",
    "OTC_SPC": "US500",
    "OTC_DJI": "US30",
    "frxEURUSD": "EURUSD",
    "frxGBPUSD": "GBPUSD",
    "frxUSDJPY": "USDJPY",
    "frxUSDCHF": "USDCHF",
    "frxUSDCAD": "USDCAD",
    "frxAUDUSD": "AUDUSD",
    "frxNZDUSD": "NZDUSD",
}

DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089"


class ServerMarketWsHub:
    """Server-side real-time public WebSocket collector (Binance Spot + Deriv Public WS).

    Runs on the backend so browsers receive ALL live ticks and L2 orderbooks over the
    same-origin `/api/v1/ws/live` WebSocket — 100% immune to browser CSP/CORS restrictions.
    """

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task[None]] = []
        self._stop_event = asyncio.Event()
        self._last_emit: dict[str, float] = {}
        self._prev_mid: dict[str, float] = {}

    def _allow_emit(self, key: str, min_interval: float = 0.25) -> bool:
        if ws_hub.connection_count == 0:
            return False
        now = time.monotonic()
        prev = self._last_emit.get(key, 0.0)
        if now - prev < min_interval:
            return False
        self._last_emit[key] = now
        return True

    async def start(self) -> None:
        if self._tasks:
            return
        self._stop_event.clear()
        self._tasks = [
            asyncio.create_task(self._run_binance_loop()),
            asyncio.create_task(self._run_deriv_loop()),
        ]
        logger.info("market_ws_hub: started server-side Binance + Deriv real-time WS collectors")

    async def stop(self) -> None:
        self._stop_event.set()
        tasks = list(self._tasks)
        self._tasks.clear()
        for t in tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t

    async def _run_binance_loop(self) -> None:
        import websockets

        stream_parts: list[str] = []
        for s in BINANCE_STREAMS:
            stream_parts.append(f"{s}@bookTicker")
            stream_parts.append(f"{s}@depth10@100ms")
        url = f"wss://stream.binance.com:9443/stream?streams={'/'.join(stream_parts)}"

        backoff = 2.0
        while not self._stop_event.is_set():
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    logger.info("market_ws_hub: connected to Binance Spot WS (%d symbols)", len(BINANCE_STREAMS))
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
                        canon = BINANCE_STREAMS.get(base_sym)
                        if not canon:
                            continue

                        if stream.endswith("@bookTicker"):
                            bid = float(data.get("b") or 0.0)
                            ask = float(data.get("a") or 0.0)
                            if bid > 0 and ask > 0 and self._allow_emit(f"tk:{canon}", 0.25):
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
                                        "source": "binance",
                                    },
                                )
                        elif "@depth" in stream and self._allow_emit(f"ob:{canon}", 0.45):
                            raw_bids = data.get("bids") or []
                            raw_asks = data.get("asks") or []
                            if raw_bids or raw_asks:
                                await ws_hub.broadcast(
                                    "orderbook",
                                    {
                                        "symbol": canon,
                                        "bids": [[float(p), float(q)] for p, q in raw_bids[:8]],
                                        "asks": [[float(p), float(q)] for p, q in raw_asks[:8]],
                                        "source": "binance",
                                    },
                                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Binance WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)

    async def _run_deriv_loop(self) -> None:
        import websockets

        backoff = 2.0
        while not self._stop_event.is_set():
            ping_task: asyncio.Task[None] | None = None
            try:
                async with websockets.connect(DERIV_WS_URL, ping_interval=None) as ws:
                    logger.info("market_ws_hub: connected to Deriv Public WS (%d symbols)", len(DERIV_STREAMS))
                    backoff = 2.0
                    for deriv_sym in DERIV_STREAMS:
                        await ws.send(json.dumps({"ticks": deriv_sym, "subscribe": 1}))

                    async def _deriv_ping(sock: Any) -> None:
                        while not self._stop_event.is_set():
                            await asyncio.sleep(25.0)
                            with contextlib.suppress(Exception):
                                await sock.send(json.dumps({"ping": 1}))

                    ping_task = asyncio.create_task(_deriv_ping(ws))
                    async for raw in ws:
                        if self._stop_event.is_set():
                            break
                        if not isinstance(raw, str):
                            continue
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        tk = msg.get("tick")
                        if not isinstance(tk, dict):
                            continue
                        deriv_sym = str(tk.get("symbol") or "")
                        canon = DERIV_STREAMS.get(deriv_sym)
                        if not canon:
                            continue
                        quote = float(tk.get("quote") or 0.0)
                        bid = float(tk.get("bid") or quote)
                        ask = float(tk.get("ask") or quote)
                        if bid > 0 and ask > 0 and self._allow_emit(f"tk:{canon}", 0.25):
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
                                    "price": quote or mid,
                                    "side": side,
                                    "source": "deriv",
                                },
                            )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("market_ws_hub: Deriv WS error (%s); reconnecting in %.0fs", exc, backoff)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)
            finally:
                if ping_task is not None:
                    ping_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await ping_task


market_ws_hub = ServerMarketWsHub()
