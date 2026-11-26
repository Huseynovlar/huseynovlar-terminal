import { useEffect, useMemo, useRef, useState } from "react";

import { Activity, BookOpen, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveEvents } from "@/framework/use-live-socket";

interface DepthLevel {
  price: number;
  qty: number;
}

interface TickPoint {
  ts: number;
  price: number;
  side: "buy" | "sell";
}

function mapSymbolToBinanceStream(rawSymbol: string): { streamSym: string; label: string } | null {
  const s = rawSymbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");
  if (s === "BTCUSD" || s === "BTCUSDT" || s === "BTC") return { streamSym: "btcusdt", label: "Binance BTC/USDT" };
  if (s === "ETHUSD" || s === "ETHUSDT" || s === "ETH") return { streamSym: "ethusdt", label: "Binance ETH/USDT" };
  if (s === "SOLUSD" || s === "SOLUSDT" || s === "SOL") return { streamSym: "solusdt", label: "Binance SOL/USDT" };
  if (s === "BNBUSD" || s === "BNBUSDT" || s === "BNB") return { streamSym: "bnbusdt", label: "Binance BNB/USDT" };
  if (s === "XRPUSD" || s === "XRPUSDT" || s === "XRP") return { streamSym: "xrpusdt", label: "Binance XRP/USDT" };
  if (s === "XAUUSD" || s === "XAU" || s === "GOLD") return { streamSym: "paxgusdt", label: "PAXG/USDT (Gold DOM)" };
  if (s === "EURUSD") return { streamSym: "eurusdt", label: "Binance EUR/USDT" };
  return null;
}

/**
 * Real-time Order Book (DOM) + Live Tick Chart (#27, #28).
 * Zero polling: streams directly over WebSocket (Exness/MT5 terminal WS + free Binance public WS).
 */
export function OrderBookAndTicks({ symbol }: { symbol: string }) {
  const [bids, setBids] = useState<DepthLevel[]>([]);
  const [asks, setAsks] = useState<DepthLevel[]>([]);
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [feedLabel, setFeedLabel] = useState<string>("Terminal WS");
  const [feedLive, setFeedLive] = useState(false);

  const normSym = useMemo(
    () =>
      symbol
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .replace(/(C|M|RAW|PRO)$/, ""),
    [symbol],
  );

  const ticksRef = useRef<TickPoint[]>([]);

  // 1. Listen to our own Terminal WebSocket for Exness / MT5 live ticks & orderbook pushes
  useLiveEvents(["tick", "orderbook", "bar_update"], (evt) => {
    const d = (evt.data ?? {}) as Record<string, unknown>;
    const evtSym = String(d.symbol ?? d.asset_code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/(C|M|RAW|PRO)$/, "");
    if (evtSym && evtSym !== normSym) return;

    if (evt.type === "tick" || evt.type === "bar_update") {
      const price = Number(d.bid ?? d.price ?? d.close ?? 0);
      if (price > 0) {
        const prev = ticksRef.current[ticksRef.current.length - 1]?.price ?? price;
        const next: TickPoint = { ts: Date.now(), price, side: price >= prev ? "buy" : "sell" };
        const arr = [...ticksRef.current.slice(-79), next];
        ticksRef.current = arr;
        setTicks(arr);
        setFeedLabel("Exness / MT5 Live WS");
        setFeedLive(true);
      }
    }
    if (evt.type === "orderbook") {
      const rawBids = Array.isArray(d.bids) ? (d.bids as Array<[number, number]>) : [];
      const rawAsks = Array.isArray(d.asks) ? (d.asks as Array<[number, number]>) : [];
      if (rawBids.length > 0) setBids(rawBids.slice(0, 10).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      if (rawAsks.length > 0) setAsks(rawAsks.slice(0, 10).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      setFeedLabel("Exness / MT5 Live WS");
      setFeedLive(true);
    }
  });

  // 2. Connect directly to free Binance Public WebSocket (L2 Depth10 @ 100ms + AggTrade ticks)
  useEffect(() => {
    const mapped = mapSymbolToBinanceStream(symbol);
    setBids([]);
    setAsks([]);
    setTicks([]);
    ticksRef.current = [];
    if (!mapped) {
      setFeedLabel("Terminal WS (MT5 / Exness)");
      setFeedLive(false);
      return;
    }

    let disposed = false;
    let ws: WebSocket | null = null;
    setFeedLabel(`${mapped.label} WS`);

    try {
      ws = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${mapped.streamSym}@depth10@100ms/${mapped.streamSym}@aggTrade`,
      );
      ws.onopen = () => {
        if (!disposed) setFeedLive(true);
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(ev.data) as { stream?: string; data?: Record<string, unknown> };
          const payload = msg.data;
          if (!payload) return;
          if (msg.stream?.includes("@depth")) {
            const b = Array.isArray(payload.bids) ? (payload.bids as Array<[string, string]>) : [];
            const a = Array.isArray(payload.asks) ? (payload.asks as Array<[string, string]>) : [];
            setBids(b.slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
            setAsks(a.slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
          } else if (msg.stream?.includes("@aggTrade")) {
            const price = Number(payload.p ?? 0);
            if (price > 0) {
              const side: "buy" | "sell" = payload.m ? "sell" : "buy";
              const next: TickPoint = { ts: Number(payload.T ?? Date.now()), price, side };
              const arr = [...ticksRef.current.slice(-79), next];
              ticksRef.current = arr;
              setTicks(arr);
            }
          }
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (!disposed) setFeedLive(false);
      };
    } catch {
      setFeedLive(false);
    }

    return () => {
      disposed = true;
      if (ws && ws.readyState < WebSocket.CLOSING) {
        ws.close();
      }
    };
  }, [symbol]);

  const maxQty = useMemo(() => {
    const all = [...bids, ...asks].map((l) => l.qty);
    return Math.max(0.0001, ...all);
  }, [bids, asks]);

  const { bidSum, askSum, spread, spreadBps } = useMemo(() => {
    const bSum = bids.reduce((acc, l) => acc + l.qty, 0);
    const aSum = asks.reduce((acc, l) => acc + l.qty, 0);
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const sp = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
    const bps = bestBid > 0 && sp > 0 ? (sp / bestBid) * 10000 : 0;
    return { bidSum: bSum, askSum: aSum, spread: sp, spreadBps: bps };
  }, [bids, asks]);

  const buyPressurePct = bidSum + askSum > 0 ? Math.round((bidSum / (bidSum + askSum)) * 100) : 50;

  // Build SVG polyline for real-time tick chart
  const tickSvg = useMemo(() => {
    if (ticks.length < 2) return null;
    const prices = ticks.map((t) => t.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const span = Math.max(maxP - minP, 1e-6);
    const w = 480;
    const h = 150;
    const pts = ticks
      .map((t, i) => {
        const x = (i / Math.max(1, ticks.length - 1)) * w;
        const y = h - 12 - ((t.price - minP) / span) * (h - 24);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const last = ticks[ticks.length - 1];
    const first = ticks[0];
    const isUp = last.price >= first.price;
    return { pts, minP, maxP, last, isUp, w, h };
  }, [ticks]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* Live Order Book (DOM) */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Layers className="size-4 text-primary" />
            Стакан цен (DOM) — {symbol.toUpperCase()}
          </CardTitle>
          <Badge
            variant="outline"
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${
              feedLive ? "border-emerald-500/40 text-emerald-500" : "text-muted-foreground"
            }`}
          >
            <span className={`size-1.5 rounded-full ${feedLive ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`} />
            {feedLabel}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {bids.length === 0 && asks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              <BookOpen className="mx-auto mb-1.5 size-4 opacity-70" />
              Ожидание L2-стакана по WebSocket для <span className="font-mono font-semibold">{symbol.toUpperCase()}</span>.
              Для XAUUSD / BTC / ETH / SOL / EURUSD поток подключается автоматически.
            </div>
          ) : (
            <>
              {/* Buy / Sell Imbalance Bar */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="text-emerald-500">Bids {buyPressurePct}%</span>
                  <span>
                    Spread: {spread.toFixed(2)} ({spreadBps.toFixed(1)} bps)
                  </span>
                  <span className="text-rose-500">Asks {100 - buyPressurePct}%</span>
                </div>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/30">
                  <div className="bg-emerald-500 transition-all duration-150" style={{ width: `${buyPressurePct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                {/* Bids */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Qty</span>
                    <span>Bid</span>
                  </div>
                  {bids.map((lvl, idx) => (
                    <div key={`b-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 bg-emerald-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(3)}</span>
                      <span className="relative font-semibold text-emerald-500">{lvl.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Asks */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Ask</span>
                    <span>Qty</span>
                  </div>
                  {asks.map((lvl, idx) => (
                    <div key={`a-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 bg-rose-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative font-semibold text-rose-500">{lvl.price.toFixed(2)}</span>
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Live Tick Chart */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Activity className="size-4 text-emerald-500" />
            Тиковый график (Real-Time)
          </CardTitle>
          {tickSvg ? (
            <span
              className={`font-mono text-sm font-bold tabular-nums ${
                tickSvg.isUp ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {tickSvg.last.price.toFixed(2)}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">{ticks.length} ticks</span>
          )}
        </CardHeader>
        <CardContent>
          {tickSvg ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20 p-2">
                <svg viewBox={`0 0 ${tickSvg.w} ${tickSvg.h}`} className="h-40 w-full">
                  <polyline
                    fill="none"
                    stroke={tickSvg.isUp ? "#10b981" : "#f43f5e"}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={tickSvg.pts}
                  />
                </svg>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
                <span>Low: {tickSvg.minP.toFixed(2)}</span>
                <span>Buffer: {ticks.length} ticks (WS push)</span>
                <span>High: {tickSvg.maxP.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mb-1.5 size-4 animate-pulse opacity-70" />
              Ожидание тиков в реальном времени по WebSocket...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
