import { useEffect, useMemo, useRef, useState } from "react";

import { getAccessToken } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { formatProviderLabel } from "@/framework/use-market-stream";

export interface LiveRowQuote {
  price: number;
  changePct: number;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  spreadBps: number | null;
  source: string;
  flash: "bull" | "bear" | null;
  spark: number[];
}

function buildMarketWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getAccessToken();
  const base = `${proto}//${window.location.host}/api/v1/ws/market`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * Multi-symbol `/ws/market` live subscriber for list/screener pages.
 * Subscribes only to visible rows, sends explicit `unsubscribe` when rows change or unmount.
 * Zero REST polling.
 */
export function useMarketListStream(rawSymbols: string[]): Record<string, LiveRowQuote> {
  const [quotes, setQuotes] = useState<Record<string, LiveRowQuote>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());

  const symbolsKey = useMemo(() => {
    const uniq = Array.from(
      new Set(rawSymbols.map((s) => canonicalMarketSymbol(s)).filter(Boolean)),
    ).slice(0, 35);
    return uniq.join(",");
  }, [rawSymbols]);

  const targetSymbols = useMemo(
    () => (symbolsKey ? symbolsKey.split(",") : []),
    [symbolsKey],
  );

  // Open single WS connection for the lifetime of the list page
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    let retryTimer: number | null = null;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(buildMarketWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        for (const sym of subscribedRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", channel: "market", symbol: sym }));
        }
      };

      ws.onmessage = (evt) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
          if (msg.type === "tick" && msg.data && typeof msg.data === "object") {
            const d = msg.data as Record<string, unknown>;
            const rawSource = String(d.source ?? "");
            if (rawSource === "mt5_live") return;
            const sym = canonicalMarketSymbol(String(d.symbol ?? ""));
            const bid = Number(d.bid ?? 0);
            const ask = Number(d.ask ?? bid);
            const price = Number(d.price ?? (bid && ask ? (bid + ask) / 2 : bid || ask));
            if (!sym || !(price > 0)) return;
            const spreadBps =
              bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 10_000 : null;
            const src = formatProviderLabel(rawSource || "Market WS");

            setQuotes((prev) => {
              const cur = prev[sym];
              const prevPx = cur?.price ?? price;
              const openPx = cur?.spark[0] ?? price;
              const changePct =
                d.change_pct != null
                  ? Number(d.change_pct)
                  : openPx > 0
                    ? ((price - openPx) / openPx) * 100
                    : 0;
              const flash: "bull" | "bear" | null =
                price > prevPx ? "bull" : price < prevPx ? "bear" : null;
              const nextSpark = cur ? [...cur.spark.slice(-23), price] : [price];
              return {
                ...prev,
                [sym]: {
                  price,
                  changePct,
                  high24h:
                    d.high_24h != null
                      ? Number(d.high_24h)
                      : Math.max(cur?.high24h ?? price, price),
                  low24h:
                    d.low_24h != null
                      ? Number(d.low_24h)
                      : Math.min(cur?.low24h ?? price, price),
                  volume24h: d.volume_24h != null ? Number(d.volume_24h) : (cur?.volume24h ?? null),
                  spreadBps,
                  source: src,
                  flash,
                  spark: nextSpark,
                },
              };
            });
          } else if (msg.type === "orderbook" && msg.data && typeof msg.data === "object") {
            const d = msg.data as Record<string, unknown>;
            const sym = canonicalMarketSymbol(String(d.symbol ?? ""));
            const bids = Array.isArray(d.bids) ? (d.bids as Array<[number, number]>) : [];
            const asks = Array.isArray(d.asks) ? (d.asks as Array<[number, number]>) : [];
            if (!sym || bids.length === 0 || asks.length === 0) return;
            const bestBid = Number(bids[0]?.[0] ?? 0);
            const bestAsk = Number(asks[0]?.[0] ?? 0);
            if (!(bestBid > 0) || !(bestAsk >= bestBid)) return;
            const mid = (bestBid + bestAsk) / 2;
            const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;
            const src = formatProviderLabel(String(d.source ?? "Market WS"));
            setQuotes((prev) => {
              const cur = prev[sym];
              if (!cur) {
                return {
                  ...prev,
                  [sym]: {
                    price: mid,
                    changePct: 0,
                    high24h: mid,
                    low24h: mid,
                    volume24h: null,
                    spreadBps,
                    source: src,
                    flash: null,
                    spark: [mid],
                  },
                };
              }
              return { ...prev, [sym]: { ...cur, spreadBps } };
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!alive) return;
        retryTimer = window.setTimeout(connect, 2500);
      };
    };

    connect();
    return () => {
      alive = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const sym of subscribedRef.current) {
          try {
            ws.send(JSON.stringify({ type: "unsubscribe", channel: "market", symbol: sym }));
          } catch {
            // ignore
          }
        }
      }
      subscribedRef.current.clear();
      ws?.close();
      wsRef.current = null;
    };
  }, []);

  // Diff subscriptions whenever visible symbols change
  useEffect(() => {
    const nextSet = new Set(targetSymbols);
    const prevSet = subscribedRef.current;
    const ws = wsRef.current;

    for (const oldSym of prevSet) {
      if (!nextSet.has(oldSym)) {
        prevSet.delete(oldSym);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe", channel: "market", symbol: oldSym }));
        }
      }
    }
    for (const sym of nextSet) {
      if (!prevSet.has(sym)) {
        prevSet.add(sym);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe", channel: "market", symbol: sym }));
        }
      }
    }
  }, [targetSymbols]);

  return quotes;
}
