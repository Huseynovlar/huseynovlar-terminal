from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "terminal:live"


class LiveWebSocketHub:
    """Broadcasts live ticks, equity updates, trades, and alerts via Redis Pub/Sub with local fallback."""

    def __init__(self, channel: str = REDIS_CHANNEL) -> None:
        self._channel = channel
        self._instance_id = uuid.uuid4().hex[:12]
        self._connections: set[WebSocket] = set()
        self._conn_channels: dict[WebSocket, set[str]] = {}
        self._conn_market_symbols: dict[WebSocket, set[str]] = {}
        self._lock = asyncio.Lock()
        self._redis: Any = None
        self._pubsub: Any = None
        self._listener_task: asyncio.Task[None] | None = None
        self._redis_connected = False

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    @property
    def redis_connected(self) -> bool:
        return self._redis_connected

    async def start_redis_bridge(self, redis_url: str) -> None:
        """Connect to Redis Pub/Sub channel `terminal:live` for multi-worker & worker->backend fanout."""
        if not redis_url or self._listener_task is not None:
            return
        try:
            import redis.asyncio as aioredis

            client = aioredis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2.0)
            await client.ping()
            pubsub = client.pubsub()
            await pubsub.subscribe(self._channel)
            self._redis = client
            self._pubsub = pubsub
            self._redis_connected = True
            self._listener_task = asyncio.create_task(self._listen_redis())
            logger.info("ws_hub: connected to Redis Pub/Sub channel %s", self._channel)
        except Exception as exc:
            self._redis_connected = False
            logger.warning("ws_hub: Redis unavailable (%s); falling back to local broadcast", exc)

    async def stop_redis_bridge(self) -> None:
        task = self._listener_task
        self._listener_task = None
        self._redis_connected = False
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.unsubscribe(self._channel)
                await self._pubsub.close()
            self._pubsub = None
        if self._redis is not None:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
            self._redis = None

    async def _listen_redis(self) -> None:
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                if not isinstance(raw, str):
                    continue
                try:
                    envelope = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if envelope.get("_origin") == self._instance_id:
                    continue
                event_type = envelope.get("type")
                data = envelope.get("data")
                if isinstance(event_type, str) and isinstance(data, dict):
                    await self._fanout_local({"type": event_type, "data": data})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._redis_connected = False
            logger.warning("ws_hub: Redis listener stopped (%s)", exc)

    async def connect(
        self,
        ws: WebSocket,
        *,
        send_welcome: bool = True,
        portfolio: dict[str, Any] | None = None,
        channels: set[str] | None = None,
    ) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
            if channels is not None:
                self._conn_channels[ws] = set(channels)
                if "market" in channels:
                    self._conn_market_symbols[ws] = set()
        if send_welcome:
            now = datetime.now(UTC)
            welcome: dict[str, Any] = {
                "type": "welcome",
                "ts": now.isoformat(),
                "server_time_msc": int(time.time() * 1000),
                "redis_bridge": self._redis_connected,
            }
            if portfolio is not None:
                welcome["portfolio"] = portfolio
            with contextlib.suppress(Exception):
                await ws.send_json(welcome)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
            self._conn_channels.pop(ws, None)
            self._conn_market_symbols.pop(ws, None)

    async def send_heartbeat(self, ws: WebSocket) -> bool:
        now = datetime.now(UTC)
        payload = {
            "type": "heartbeat",
            "ts": now.isoformat(),
            "server_time_msc": int(time.time() * 1000),
        }
        try:
            await ws.send_json(payload)
            return True
        except Exception:
            await self.disconnect(ws)
            return False

    async def _dispatch_rpc(self, ws: WebSocket, parsed: dict[str, Any]) -> None:
        """Execute an internal API call over WebSocket (zero HTTP fetch from browser) via in-memory ASGI."""
        req_id = str(parsed.get("id") or "")
        if not req_id:
            return
        method = str(parsed.get("method") or "GET").upper()
        raw_path = str(parsed.get("path") or "/")
        if not raw_path.startswith("/api/"):
            raw_path = f"/api/v1{raw_path if raw_path.startswith('/') else '/' + raw_path}"

        req_headers: dict[str, str] = {}
        client_headers = parsed.get("headers")
        if isinstance(client_headers, dict):
            for k, v in client_headers.items():
                if isinstance(k, str) and isinstance(v, str):
                    req_headers[k] = v

        # Forward cookies & Bearer token from the authenticated WebSocket if not overridden
        cookie_header = ws.headers.get("cookie")
        if cookie_header and "cookie" not in {k.lower() for k in req_headers}:
            req_headers["cookie"] = cookie_header
        if "authorization" not in {k.lower() for k in req_headers}:
            ws_token = ws.cookies.get("ht_access_token") or ws.query_params.get("token")
            if ws_token:
                req_headers["Authorization"] = f"Bearer {ws_token}"

        body_raw = parsed.get("body")
        content_bytes: bytes | None = None
        if isinstance(body_raw, str):
            content_bytes = body_raw.encode("utf-8")
            if "content-type" not in {k.lower() for k in req_headers}:
                req_headers["Content-Type"] = "application/json"
        elif body_raw is not None:
            content_bytes = json.dumps(body_raw, ensure_ascii=False).encode("utf-8")
            req_headers["Content-Type"] = "application/json"

        try:
            import httpx

            client_host = ws.client.host if ws.client else "127.0.0.1"
            transport = httpx.ASGITransport(app=ws.app, client=(client_host, 0))
            async with httpx.AsyncClient(transport=transport, base_url="http://ws.internal") as client:
                resp = await client.request(
                    method=method,
                    url=raw_path,
                    headers=req_headers,
                    content=content_bytes,
                )

            out_headers = {
                k.lower(): v
                for k, v in resp.headers.items()
                if k.lower() in ("x-total-count", "content-type", "retry-after")
            }
            data: Any = None
            if resp.status_code != 204 and resp.content:
                try:
                    data = resp.json()
                except Exception:
                    data = resp.text

            reply = {
                "type": "rpc_response",
                "id": req_id,
                "status": resp.status_code,
                "ok": 200 <= resp.status_code < 300,
                "headers": out_headers,
                "data": data,
            }
        except Exception as exc:
            reply = {
                "type": "rpc_response",
                "id": req_id,
                "status": 500,
                "ok": False,
                "headers": {},
                "data": {"detail": str(exc)},
            }

        with contextlib.suppress(Exception):
            await ws.send_json(reply)

    async def handle_client_message(self, ws: WebSocket, raw_text: str) -> None:
        """Handle client ping frames and multiplexed RPC requests over WebSocket."""
        text = raw_text.strip()
        if not text:
            return
        client_ts: Any = None
        msg_type = text.lower()
        parsed: dict[str, Any] | None = None
        if text.startswith("{"):
            try:
                obj = json.loads(text)
                if isinstance(obj, dict):
                    parsed = obj
                    msg_type = str(obj.get("type", "")).lower()
                    client_ts = obj.get("ts") or obj.get("client_ts")
            except json.JSONDecodeError:
                return
        if msg_type == "ping":
            now = datetime.now(UTC)
            pong: dict[str, Any] = {
                "type": "pong",
                "ts": now.isoformat(),
                "server_time_msc": int(time.time() * 1000),
            }
            if client_ts is not None:
                pong["client_ts"] = client_ts
            with contextlib.suppress(Exception):
                await ws.send_json(pong)
        elif msg_type == "rpc" and parsed is not None:
            asyncio.create_task(self._dispatch_rpc(ws, parsed))
        elif msg_type == "subscribe" and parsed is not None:
            ch = str(parsed.get("channel") or "").strip().lower()
            sym = str(parsed.get("symbol") or "").strip().upper()
            async with self._lock:
                if ch:
                    self._conn_channels.setdefault(ws, set()).add(ch)
                if sym:
                    self._conn_market_symbols.setdefault(ws, set()).add(sym)
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "subscribed", "channel": ch or "all", "symbol": sym or None})
        elif msg_type == "unsubscribe" and parsed is not None:
            ch = str(parsed.get("channel") or "").strip().lower()
            sym = str(parsed.get("symbol") or "").strip().upper()
            async with self._lock:
                if sym and ws in self._conn_market_symbols:
                    self._conn_market_symbols[ws].discard(sym)
                elif ch and ws in self._conn_channels:
                    self._conn_channels[ws].discard(ch)
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "unsubscribed", "channel": ch or "all", "symbol": sym or None})

    async def run_heartbeat_loop(self, ws: WebSocket, interval_sec: float = 10.0) -> None:
        while True:
            await asyncio.sleep(interval_sec)
            ok = await self.send_heartbeat(ws)
            if not ok:
                break

    def active_market_symbols(self) -> set[str]:
        out: set[str] = set()
        for syms in self._conn_market_symbols.values():
            out.update(syms)
        return out

    def has_market_subscriber(self, symbol: str) -> bool:
        sym = symbol.strip().upper()
        if not sym:
            return False
        return any(sym in syms for syms in self._conn_market_symbols.values())

    @staticmethod
    def _event_channel(event_type: str) -> str:
        if event_type in ("tick", "orderbook", "bar_update", "liquidation", "macro_quotes"):
            return "market"
        if event_type in ("breaking_news", "calendar_alert"):
            return "news"
        return "account"

    def _should_deliver(self, ws: WebSocket, event_type: str, data: dict[str, Any]) -> bool:
        channels = self._conn_channels.get(ws)
        evt_ch = self._event_channel(event_type)
        if channels is not None and evt_ch not in channels:
            return False
        if event_type in ("tick", "orderbook", "bar_update", "liquidation"):
            # Never stream MT5 bridge ticks to dedicated /ws/market subscribers
            if channels is not None and str(data.get("source") or "") == "mt5_live":
                return False
            # Strictly deliver ONLY to clients explicitly subscribed to this symbol (zero all-market flood on /ws/live)
            syms = self._conn_market_symbols.get(ws)
            if not syms:
                return False
            ev_sym = str(data.get("symbol") or data.get("asset_code") or "").strip().upper()
            if not ev_sym or ev_sym not in syms:
                return False
        return True

    async def _fanout_local(self, payload: dict[str, Any]) -> None:
        event_type = str(payload.get("type") or "")
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        async with self._lock:
            targets = [ws for ws in self._connections if self._should_deliver(ws, event_type, data)]
        if not targets:
            return
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)
                    self._conn_channels.pop(ws, None)
                    self._conn_market_symbols.pop(ws, None)

    async def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        payload = {"type": event_type, "data": data}
        await self._fanout_local(payload)

        if self._redis is not None and self._redis_connected:
            envelope = {"type": event_type, "data": data, "_origin": self._instance_id}
            try:
                await self._redis.publish(self._channel, json.dumps(envelope))
            except Exception as exc:
                logger.warning("ws_hub: Redis publish failed (%s)", exc)


ws_hub = LiveWebSocketHub()
