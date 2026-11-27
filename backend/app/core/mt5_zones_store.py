"""In-memory + MarketCache persistent store for exact MT5 robot zone series (SELL / MEAN / FAIR / BUY)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.symbols import canonical_asset_code
from app.db.models import MarketCache

MAX_ZONE_POINTS = 2000

# (canonical_symbol, timeframe) -> { bar_time_sec: {bar_time, sell, mean, fair, buy} }
_ZONE_MEM: dict[tuple[str, str], dict[int, dict[str, Any]]] = {}
_LAST_DB_FLUSH: dict[tuple[str, str], float] = {}


def _cache_key(symbol: str, timeframe: str) -> str:
    return f"mt5_zones:{symbol}:{timeframe.upper()}"


def _normalize_tf(timeframe: str | None) -> str:
    tf = (timeframe or "M5").strip().upper()
    if tf in {"M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"}:
        return tf
    return "M5"


async def record_zone_point(
    symbol: str,
    timeframe: str,
    bar_time: int,
    sell: float,
    mean: float,
    fair: float,
    buy: float,
    *,
    db: AsyncSession | None = None,
) -> dict[str, Any] | None:
    """Upsert a single bar's exact MT5 zone point in memory and write-through to MarketCache."""
    canon = canonical_asset_code(symbol) or symbol.strip().upper()
    if not canon or bar_time <= 0:
        return None
    if sell <= 0 and buy <= 0 and mean <= 0 and fair <= 0:
        return None

    tf = _normalize_tf(timeframe)
    key = (canon, tf)
    bucket = _ZONE_MEM.setdefault(key, {})
    point = {
        "bar_time": int(bar_time),
        "sell": round(float(sell), 5) if sell > 0 else None,
        "mean": round(float(mean), 5) if mean > 0 else None,
        "fair": round(float(fair), 5) if fair > 0 else None,
        "buy": round(float(buy), 5) if buy > 0 else None,
    }
    bucket[int(bar_time)] = point

    # Prune oldest beyond MAX_ZONE_POINTS
    if len(bucket) > MAX_ZONE_POINTS:
        for old_t in sorted(bucket.keys())[: len(bucket) - MAX_ZONE_POINTS]:
            bucket.pop(old_t, None)

    # Periodic write-through to MarketCache (at most once every 10s per symbol/tf to stay zero-overhead)
    now_ts = datetime.now(UTC).timestamp()
    if db is not None and (now_ts - _LAST_DB_FLUSH.get(key, 0.0) >= 10.0 or len(bucket) <= 2):
        _LAST_DB_FLUSH[key] = now_ts
        ck = _cache_key(canon, tf)
        series = [bucket[t] for t in sorted(bucket.keys())[-MAX_ZONE_POINTS:]]
        row = (await db.execute(select(MarketCache).where(MarketCache.cache_key == ck))).scalar_one_or_none()
        now_dt = datetime.now(UTC)
        if row is None:
            db.add(
                MarketCache(
                    cache_key=ck,
                    payload_json={"symbol": canon, "timeframe": tf, "points": series},
                    updated_at=now_dt,
                )
            )
        else:
            row.payload_json = {"symbol": canon, "timeframe": tf, "points": series}
            row.updated_at = now_dt

    return {"symbol": canon, "timeframe": tf, **point}


async def get_zone_series(
    symbol: str,
    timeframe: str = "M5",
    *,
    db: AsyncSession | None = None,
) -> list[dict[str, Any]]:
    """Return chronologically sorted MT5 zone points for (symbol, timeframe), hydrating from DB if cold."""
    canon = canonical_asset_code(symbol) or symbol.strip().upper()
    if not canon:
        return []
    tf = _normalize_tf(timeframe)
    key = (canon, tf)

    # Hydrate from MarketCache if memory is cold; also fall back to M5 if requested tf has no points
    if key not in _ZONE_MEM and db is not None:
        for try_tf in (tf, "M5") if tf != "M5" else (tf,):
            ck = _cache_key(canon, try_tf)
            row = (await db.execute(select(MarketCache).where(MarketCache.cache_key == ck))).scalar_one_or_none()
            pts = (row.payload_json or {}).get("points") if row and isinstance(row.payload_json, dict) else None
            if isinstance(pts, list) and pts:
                bucket = _ZONE_MEM.setdefault((canon, try_tf), {})
                for p in pts:
                    if isinstance(p, dict) and p.get("bar_time"):
                        bucket[int(p["bar_time"])] = p
                if try_tf == tf:
                    break

    bucket = _ZONE_MEM.get(key) or _ZONE_MEM.get((canon, "M5")) or {}
    return [bucket[t] for t in sorted(bucket.keys())[-MAX_ZONE_POINTS:]]
