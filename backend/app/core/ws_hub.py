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
    ) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
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

    async def handle_client_message(self, ws: WebSocket, raw_text: str) -> None:
        """Handle client ping frames and reply with pong + server timestamp for RTT calculation."""
        text = raw_text.strip()
        if not text:
            return
        client_ts: Any = None
        msg_type = text.lower()
        if text.startswith("{"):
            try:
                parsed = json.loads(text)
                msg_type = str(parsed.get("type", "")).lower()
                client_ts = parsed.get("ts") or parsed.get("client_ts")
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

    async def run_heartbeat_loop(self, ws: WebSocket, interval_sec: float = 10.0) -> None:
        while True:
            await asyncio.sleep(interval_sec)
            ok = await self.send_heartbeat(ws)
            if not ok:
                break

    async def _fanout_local(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            targets = list(self._connections)
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
