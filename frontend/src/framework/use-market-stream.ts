import { useEffect, useRef, useState } from "react";

import { getAccessToken } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";

export type MarketFeedHealth = "connecting" | "live" | "reconnecting" | "stale";

export interface MarketTickEvent {
  symbol: string;
  bid: number;
  ask: number;
  price: number;
  bid_size?: number;
  ask_size?: number;
  side?: "buy" | "sell";
  source: string;
  ts_ms: number;
}

export interface MarketOrderbookEvent {
  symbol: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  source: string;
}

export interface MarketLiquidationEvent {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  usd_value: number;
  source: string;
  ts_ms: number;
}

export interface UseMarketStreamOptions {
  symbol: string;
  onTick?: (tick: MarketTickEvent) => void;
  onOrderbook?: (ob: MarketOrderbookEvent) => void;
  onLiquidation?: (liq: MarketLiquidationEvent) => void;
}

/**
 * Dedicated subscription-based WebSocket hook for `/api/v1/ws/market`.
 * - Sends explicit `subscribe` for the active canonical symbol
 * - Immediately sends `unsubscribe` on symbol change or component unmount
 * - Strictly ignores any MT5 Bridge ticks (`source === "mt5_live"`)
 * - Tracks live RTT latency & auto-transitions to `stale` if silent for >10s
 */
export function useMarketStream({ symbol, onTick, onOrderbook, onLiquidation }: UseMarketStreamOptions) {
  const canonSym = canonicalMarketSymbol(symbol);
  const [health, setHealth] = useState<MarketFeedHealth>("connecting");
  const [provider, setProvider] = useState<string>("Market WS");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const onTickRef = useRef(onTick);
  const onOrderbookRef = useRef(onOrderbook);
  const onLiquidationRef = useRef(onLiquidation);
  onTickRef.current = onTick;
  onOrderbookRef.current = onOrderbook;
  onLiquidationRef.current = onLiquidation;

  useEffect(() => {
    if (typeof window === "undefined" || !canonSym) return;

    let ws: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    let staleTimer: number | undefined;
    let pingSentAt: number | null = null;
    let lastFrameAt = Date.now();
    let attempt = 0;

    const buildUrl = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = getAccessToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      return `${proto}//${window.location.host}/api/v1/ws/market${qs}`;
    };

    const connect = () => {
      if (disposed) return;
      setHealth(attempt === 0 ? "connecting" : "reconnecting");
      try {
        const socket = new WebSocket(buildUrl());
        ws = socket;

        socket.onopen = () => {
          if (disposed) {
            socket.close();
            return;
          }
          attempt = 0;
          lastFrameAt = Date.now();
          setHealth("live");
          try {
            socket.send(JSON.stringify({ type: "subscribe", channel: "market", symbol: canonSym }));
            pingSentAt = performance.now();
            socket.send(JSON.stringify({ type: "ping", client_ts: Date.now() }));
          } catch {
            // ignore
          }
          pingTimer = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              pingSentAt = performance.now();
              try {
                socket.send(JSON.stringify({ type: "ping", client_ts: Date.now() }));
              } catch {
                // ignore
              }
            }
          }, 12_000);
        };

        socket.onmessage = (msg) => {
          try {
            const raw = JSON.parse(msg.data) as Record<string, unknown>;
            const type = String(raw.type || "");
            lastFrameAt = Date.now();

            if (type === "pong") {
              if (pingSentAt !== null) {
                setLatencyMs(Math.max(1, Math.round(performance.now() - pingSentAt)));
                pingSentAt = null;
              }
              setHealth("live");
              return;
            }
            if (type === "welcome" || type === "heartbeat" || type === "subscribed") {
              setHealth("live");
              return;
            }

            const d = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
            const src = String(d.source || "");
            if (src === "mt5_live") return;

            const evtSym = canonicalMarketSymbol(String(d.symbol || d.asset_code || ""));
            if (evtSym && evtSym !== canonSym) return;

            if (src) setProvider(formatProviderLabel(src));
            setHealth("live");

            if (type === "tick") {
              const bid = Number(d.bid ?? d.price ?? 0);
              const ask = Number(d.ask ?? bid);
              if (bid > 0) {
                onTickRef.current?.({
                  symbol: canonSym,
                  bid,
                  ask: ask >= bid ? ask : bid,
                  price: Number(d.price ?? (bid + (ask >= bid ? ask : bid)) / 2),
                  bid_size: Number(d.bid_size ?? 1),
                  ask_size: Number(d.ask_size ?? 1),
                  side: d.side === "sell" ? "sell" : "buy",
                  source: src || "market_ws",
                  ts_ms: Number(d.ts_ms ?? Date.now()),
                });
              }
            } else if (type === "orderbook") {
              const bids = Array.isArray(d.bids) ? (d.bids as Array<[number, number]>) : [];
              const asks = Array.isArray(d.asks) ? (d.asks as Array<[number, number]>) : [];
              if (bids.length > 0 || asks.length > 0) {
                onOrderbookRef.current?.({
                  symbol: canonSym,
                  bids,
                  asks,
                  source: src || "market_ws",
                });
              }
            } else if (type === "liquidation") {
              const price = Number(d.price ?? 0);
              const qty = Number(d.qty ?? 0);
              if (price > 0) {
                onLiquidationRef.current?.({
                  symbol: canonSym,
                  side: String(d.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
                  price,
                  qty,
                  usd_value: Number(d.usd_value ?? price * qty),
                  source: src || "market_ws",
                  ts_ms: Number(d.ts_ms ?? Date.now()),
                });
              }
            }
          } catch {
            // ignore malformed frame
          }
        };

        socket.onclose = () => {
          if (pingTimer !== undefined) window.clearInterval(pingTimer);
          if (!disposed) {
            attempt += 1;
            setHealth("reconnecting");
            const backoff = Math.min(12_000, 1500 * Math.min(attempt, 6));
            reconnectTimer = window.setTimeout(connect, backoff);
          }
        };

        socket.onerror = () => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        };
      } catch {
        attempt += 1;
        setHealth("reconnecting");
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };

    connect();

    staleTimer = window.setInterval(() => {
      if (Date.now() - lastFrameAt > 15_000) {
        setHealth((prev) => (prev === "live" ? "stale" : prev));
      }
    }, 5_000);

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      if (staleTimer !== undefined) window.clearInterval(staleTimer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "unsubscribe", channel: "market", symbol: canonSym }));
        } catch {
          // ignore
        }
        ws.close();
      }
    };
  }, [canonSym]);

  return { health, provider, latencyMs };
}

export function formatProviderLabel(src: string): string {
  const s = src.toLowerCase();
  if (s.includes("binance")) return "Binance WS";
  if (s.includes("bybit")) return "Bybit WS";
  if (s.includes("exness")) return "Exness API";
  if (s.includes("tiingo")) return "Tiingo FX";
  if (s.includes("biquote")) return "biquote WS";
  if (s.includes("alpaca")) return "Alpaca IEX";
  if (s.includes("deriv")) return "Deriv WS";
  if (s.includes("yahoo")) return "Yahoo Direct";
  if (s.includes("market_history")) return "Market Feed";
  return src || "Market WS";
}
