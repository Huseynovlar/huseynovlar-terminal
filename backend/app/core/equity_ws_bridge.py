from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import datetime
from typing import Any

from app.core.config import Settings
from app.core.ws_hub import ws_hub

logger = logging.getLogger(__name__)

DEFAULT_US_EQUITIES: tuple[str, ...] = (
    "AAPL",
    "NVDA",
    "TSLA",
    "MSFT",
    "AMZN",
    "META",
    "GOOGL",
    "SPY",
    "QQQ",
    "AMD",
    "NFLX",
    "COIN",
)

ALPACA_IEX_WS_URL = "wss://stream.data.alpaca.markets/v2/iex"


def _iso_to_unix_sec(raw: Any) -> int:
    if isinstance(raw, (int, float)):
        return int(raw // 1000 if raw > 1e12 else raw)
    if isinstance(raw, str) and raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return int(dt.timestamp())
        except ValueError:
            pass
    return int(time.time())


class EquityStreamBridge:
    """Server-side real-time US Equities WebSocket stream (Alpaca IEX primary, Finnhub fallback).

    Pushes NBBO quotes, trades (`tick`), and 1m bars/updatedBars (`bar_update`) directly
    into `ws_hub` (Redis Pub/Sub -> all connected browsers), with per-symbol throttling
    and automatic exponential-backoff reconnect.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._last_tick_emit: dict[str, float] = {}
        self._active_provider: str | None = None
        self._symbols: list[str] = list(DEFAULT_US_EQUITIES)

    @property
    def active_provider(self) -> str | None:
        return self._active_provider

    def _should_emit_tick(self, symbol: str, min_interval_sec: float = 0.2) -> bool:
        now = time.monotonic()
        prev = self._last_tick_emit.get(symbol, 0.0)
        if now - prev < min_interval_sec:
            return False
        self._last_tick_emit[symbol] = now
        return True

    async def start(self, settings: Settings, symbols: list[str] | None = None) -> None:
        if self._task is not None:
            return
        has_alpaca = bool(settings.alpaca_api_key and settings.alpaca_api_secret)
        has_finnhub = bool(settings.finnhub_api_key)
        if not has_alpaca and not has_finnhub:
            logger.info("equity_ws_bridge: no Alpaca or Finnhub keys configured; skipping server equity stream")
            return
        if symbols:
            merged = list(dict.fromkeys([*DEFAULT_US_EQUITIES, *[s.upper() for s in symbols if s]]))
            self._symbols = merged[:45]
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(settings))

    async def stop(self) -> None:
        self._stop_event.set()
        task = self._task
        self._task = None
        self._active_provider = None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _run_loop(self, settings: Settings) -> None:
        backoff = 2.0
        while not self._stop_event.is_set():
            try:
                if settings.alpaca_api_key and settings.alpaca_api_secret:
                    await self._run_alpaca_iex(settings.alpaca_api_key, settings.alpaca_api_secret)
                elif settings.finnhub_api_key:
                    await self._run_finnhub(settings.finnhub_api_key)
                backoff = 2.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._active_provider = None
                logger.warning("equity_ws_bridge: stream error (%s); reconnecting in %.0fs", exc, backoff)
                # If Alpaca failed and Finnhub is available, try Finnhub once before sleeping
                if settings.alpaca_api_key and settings.finnhub_api_key:
                    try:
                        await self._run_finnhub(settings.finnhub_api_key)
                        backoff = 2.0
                        continue
                    except asyncio.CancelledError:
                        raise
                    except Exception as fh_exc:
                        logger.warning("equity_ws_bridge: Finnhub fallback also failed (%s)", fh_exc)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
                backoff = min(30.0, backoff * 2.0)

    async def _run_alpaca_iex(self, api_key: str, api_secret: str) -> None:
        import websockets

        logger.info("equity_ws_bridge: connecting to Alpaca IEX WS (%d symbols)", len(self._symbols))
        async with websockets.connect(ALPACA_IEX_WS_URL, ping_interval=20, ping_timeout=20) as ws:
            # 1. Read welcome message
            _ = await asyncio.wait_for(ws.recv(), timeout=10.0)
            # 2. Authenticate
            await ws.send(json.dumps({"action": "auth", "key": api_key, "secret": api_secret}))
            auth_raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            auth_msgs = json.loads(auth_raw)
            if isinstance(auth_msgs, list) and any(m.get("T") == "error" for m in auth_msgs if isinstance(m, dict)):
                raise RuntimeError(f"Alpaca auth failed: {auth_msgs}")

            # 3. Subscribe to trades, NBBO quotes, bars & updatedBars
            await ws.send(
                json.dumps(
                    {
                        "action": "subscribe",
                        "trades": self._symbols,
                        "quotes": self._symbols,
                        "bars": self._symbols,
                        "updatedBars": self._symbols,
                    }
                )
            )
            self._active_provider = "alpaca_iex"
            logger.info("equity_ws_bridge: Alpaca IEX live stream active for %s", ",".join(self._symbols))

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
                for msg in frames:
                    if not isinstance(msg, dict):
                        continue
                    msg_type = msg.get("T")
                    sym = str(msg.get("S") or "").upper()
                    if not sym:
                        continue

                    if msg_type == "q":
                        bp = float(msg.get("bp") or 0.0)
                        ap = float(msg.get("ap") or 0.0)
                        if bp > 0 and ap > 0 and self._should_emit_tick(sym):
                            await ws_hub.broadcast(
                                "tick",
                                {
                                    "symbol": sym,
                                    "bid": bp,
                                    "ask": ap,
                                    "bid_size": float(msg.get("bs") or 1.0),
                                    "ask_size": float(msg.get("as") or 1.0),
                                    "price": round((bp + ap) / 2.0, 4),
                                    "source": "alpaca_iex",
                                },
                            )
                    elif msg_type == "t":
                        price = float(msg.get("p") or 0.0)
                        if price > 0 and self._should_emit_tick(sym):
                            await ws_hub.broadcast(
                                "tick",
                                {
                                    "symbol": sym,
                                    "price": price,
                                    "qty": float(msg.get("s") or 1.0),
                                    "source": "alpaca_iex",
                                },
                            )
                    elif msg_type in ("b", "u"):
                        close = float(msg.get("c") or 0.0)
                        if close > 0:
                            await ws_hub.broadcast(
                                "bar_update",
                                {
                                    "symbol": sym,
                                    "time": _iso_to_unix_sec(msg.get("t")),
                                    "open": float(msg.get("o") or close),
                                    "high": float(msg.get("h") or close),
                                    "low": float(msg.get("l") or close),
                                    "close": close,
                                    "volume": float(msg.get("v") or 0.0),
                                    "source": "alpaca_iex",
                                },
                            )

    async def _run_finnhub(self, api_key: str) -> None:
        import websockets

        url = f"wss://ws.finnhub.io?token={api_key}"
        logger.info("equity_ws_bridge: connecting to Finnhub WS (%d symbols)", len(self._symbols))
        async with websockets.connect(url, ping_interval=25, ping_timeout=20) as ws:
            for sym in self._symbols:
                await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
            self._active_provider = "finnhub"
            logger.info("equity_ws_bridge: Finnhub live stream active for %s", ",".join(self._symbols))

            async for raw in ws:
                if self._stop_event.is_set():
                    break
                if not isinstance(raw, str):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") != "trade":
                    continue
                for tr in msg.get("data") or []:
                    sym = str(tr.get("s") or "").upper()
                    price = float(tr.get("p") or 0.0)
                    if sym and price > 0 and self._should_emit_tick(sym):
                        await ws_hub.broadcast(
                            "tick",
                            {
                                "symbol": sym,
                                "price": price,
                                "bid": price,
                                "ask": price,
                                "qty": float(tr.get("v") or 1.0),
                                "source": "finnhub",
                            },
                        )


equity_ws_bridge = EquityStreamBridge()
