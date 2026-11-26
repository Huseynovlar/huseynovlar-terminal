import { useEffect, useMemo, useRef, useState } from "react";

import { Activity, BookOpen, Layers, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mapSymbolToOpenWs, normalizeCleanSymbol } from "@/framework/open-market-ws";
import { useLiveEvents } from "@/framework/use-live-socket";

interface DepthLevel {
  price: number;
  qty: number;
}

interface DualTickPoint {
  ts: number;
  bid: number; // Buy / Bid line (emerald)
  ask: number; // Sell / Ask line (rose)
}

interface TradeTapeItem {
  ts: number;
  price: number;
  qty: number;
  side: "buy" | "sell";
}

/**
 * Real-time Order Book (DOM) + Separate Buy (Bid) / Sell (Ask) Tick Chart (#27, #28).
 * Zero polling: streams directly over open WebSocket (Binance @depth10 + @bookTicker + @aggTrade)
 * and Terminal WS (MT5 / Broker tick & orderbook pushes).
 */
export function OrderBookAndTicks({ symbol }: { symbol: string }) {
  const [bids, setBids] = useState<DepthLevel[]>([]);
  const [asks, setAsks] = useState<DepthLevel[]>([]);
  const [ticks, setTicks] = useState<DualTickPoint[]>([]);
  const [tape, setTape] = useState<TradeTapeItem[]>([]);
  const [buyCount, setBuyCount] = useState(0);
  const [sellCount, setSellCount] = useState(0);
  const [feedLabel, setFeedLabel] = useState<string>("Terminal WS");
  const [feedLive, setFeedLive] = useState(false);

  const normSym = useMemo(() => normalizeCleanSymbol(symbol), [symbol]);
  const ticksRef = useRef<DualTickPoint[]>([]);
  const tapeRef = useRef<TradeTapeItem[]>([]);

  const pushDualTick = (bid: number, ask: number, ts: number) => {
    if (!(bid > 0) || !(ask > 0)) return;
    const next: DualTickPoint = { ts, bid, ask };
    const arr = [...ticksRef.current.slice(-89), next];
    ticksRef.current = arr;
    setTicks(arr);
  };

  // 1. Terminal WebSocket (MT5 / Broker ticks & orderbook)
  useLiveEvents(["tick", "orderbook", "bar_update"], (evt) => {
    const d = (evt.data ?? {}) as Record<string, unknown>;
    const evtSym = normalizeCleanSymbol(String(d.symbol ?? d.asset_code ?? ""));
    if (evtSym && evtSym !== normSym) return;

    if (evt.type === "tick" || evt.type === "bar_update") {
      const bid = Number(d.bid ?? d.price ?? d.close ?? 0);
      const ask = Number(d.ask ?? (bid > 0 ? bid * 1.0001 : 0));
      if (bid > 0) {
        pushDualTick(bid, ask > 0 ? ask : bid, Date.now());
        setFeedLabel("Terminal Live WS");
        setFeedLive(true);
      }
    }
    if (evt.type === "orderbook") {
      const rawBids = Array.isArray(d.bids) ? (d.bids as Array<[number, number]>) : [];
      const rawAsks = Array.isArray(d.asks) ? (d.asks as Array<[number, number]>) : [];
      if (rawBids.length > 0) setBids(rawBids.slice(0, 10).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      if (rawAsks.length > 0) setAsks(rawAsks.slice(0, 10).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      setFeedLabel("Terminal Live WS");
      setFeedLive(true);
    }
  });

  // 2. Open Public WebSocket (Binance @depth10@100ms + @bookTicker for separate Bid/Ask + @aggTrade for Buy/Sell tape)
  useEffect(() => {
    const mapped = mapSymbolToOpenWs(symbol);
    setBids([]);
    setAsks([]);
    setTicks([]);
    setTape([]);
    setBuyCount(0);
    setSellCount(0);
    ticksRef.current = [];
    tapeRef.current = [];

    if (!mapped) {
      setFeedLabel("Terminal WS (MT5)");
      setFeedLive(false);
      return;
    }

    let disposed = false;
    let ws: WebSocket | null = null;
    let lastTickEmit = 0;
    setFeedLabel(`${mapped.label}`);

    try {
      ws = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${mapped.streamSym}@depth10@100ms/${mapped.streamSym}@bookTicker/${mapped.streamSym}@aggTrade`,
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
          } else if (msg.stream?.includes("@bookTicker")) {
            const now = Date.now();
            if (now - lastTickEmit < 120) return;
            lastTickEmit = now;
            const bid = Number(payload.b ?? 0);
            const ask = Number(payload.a ?? 0);
            if (bid > 0 && ask > 0) {
              pushDualTick(bid, ask, now);
            }
          } else if (msg.stream?.includes("@aggTrade")) {
            const price = Number(payload.p ?? 0);
            const qty = Number(payload.q ?? 0);
            if (price > 0) {
              const side: "buy" | "sell" = payload.m ? "sell" : "buy";
              if (side === "buy") setBuyCount((c) => c + 1);
              else setSellCount((c) => c + 1);
              const nextItem: TradeTapeItem = { ts: Number(payload.T ?? Date.now()), price, qty, side };
              const nextTape = [nextItem, ...tapeRef.current.slice(0, 7)];
              tapeRef.current = nextTape;
              setTape(nextTape);
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
    const bestBid = bids[0]?.price ?? ticks[ticks.length - 1]?.bid ?? 0;
    const bestAsk = asks[0]?.price ?? ticks[ticks.length - 1]?.ask ?? 0;
    const sp = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
    const bps = bestBid > 0 && sp > 0 ? (sp / bestBid) * 10000 : 0;
    return { bidSum: bSum, askSum: aSum, spread: sp, spreadBps: bps };
  }, [bids, asks, ticks]);

  const buyPressurePct = bidSum + askSum > 0 ? Math.round((bidSum / (bidSum + askSum)) * 100) : 50;

  // Dual SVG polylines: separate BUY (Bid, emerald) and SELL (Ask, rose)
  const tickSvg = useMemo(() => {
    if (ticks.length < 2) return null;
    const allPrices = ticks.flatMap((t) => [t.bid, t.ask]);
    const minP = Math.min(...allPrices);
    const maxP = Math.max(...allPrices);
    const span = Math.max(maxP - minP, 1e-6);
    const w = 480;
    const h = 150;
    const mapY = (p: number) => h - 12 - ((p - minP) / span) * (h - 24);
    const bidPts = ticks
      .map((t, i) => `${((i / Math.max(1, ticks.length - 1)) * w).toFixed(1)},${mapY(t.bid).toFixed(1)}`)
      .join(" ");
    const askPts = ticks
      .map((t, i) => `${((i / Math.max(1, ticks.length - 1)) * w).toFixed(1)},${mapY(t.ask).toFixed(1)}`)
      .join(" ");
    const last = ticks[ticks.length - 1]!;
    return { bidPts, askPts, minP, maxP, last, w, h };
  }, [ticks]);

  const decimals = (tickSvg?.last.bid ?? bids[0]?.price ?? 0) < 10 ? 5 : 2;

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
              Для XAUUSD / BTC / ETH / SOL / EURUSD / GBPUSD / AUDUSD поток подключается автоматически.
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="text-emerald-500">Bids {buyPressurePct}%</span>
                  <span>
                    Spread: {spread.toFixed(decimals)} ({spreadBps.toFixed(1)} bps)
                  </span>
                  <span className="text-rose-500">Asks {100 - buyPressurePct}%</span>
                </div>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/30">
                  <div className="bg-emerald-500 transition-all duration-150" style={{ width: `${buyPressurePct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Qty</span>
                    <span>Buy (Bid)</span>
                  </div>
                  {bids.map((lvl, idx) => (
                    <div key={`b-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 bg-emerald-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(3)}</span>
                      <span className="relative font-semibold text-emerald-500">{lvl.price.toFixed(decimals)}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Sell (Ask)</span>
                    <span>Qty</span>
                  </div>
                  {asks.map((lvl, idx) => (
                    <div key={`a-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 bg-rose-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative font-semibold text-rose-500">{lvl.price.toFixed(decimals)}</span>
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dual Buy (Bid) / Sell (Ask) Real-Time Tick Chart + Live Tape */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Activity className="size-4 text-emerald-500" />
            Тиковый график — Buy / Sell
          </CardTitle>
          {tickSvg ? (
            <div className="flex items-center gap-2 font-mono text-xs font-bold tabular-nums">
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <TrendingUp className="size-3" />
                BUY {tickSvg.last.bid.toFixed(decimals)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="inline-flex items-center gap-1 text-rose-500">
                <TrendingDown className="size-3" />
                SELL {tickSvg.last.ask.toFixed(decimals)}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">{ticks.length} ticks</span>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {tickSvg ? (
            <>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20 p-2">
                <svg viewBox={`0 0 ${tickSvg.w} ${tickSvg.h}`} className="h-36 w-full">
                  {/* Sell / Ask Line (Rose) */}
                  <polyline
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={tickSvg.askPts}
                  />
                  {/* Buy / Bid Line (Emerald) */}
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={tickSvg.bidPts}
                  />
                </svg>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
                <span className="text-emerald-500">BUY ticks: {buyCount}</span>
                <span>
                  Low {tickSvg.minP.toFixed(decimals)} — High {tickSvg.maxP.toFixed(decimals)}
                </span>
                <span className="text-rose-500">SELL ticks: {sellCount}</span>
              </div>
              {tape.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5 border-t border-border/50 pt-2 font-mono text-[10px] tabular-nums">
                  {tape.slice(0, 4).map((tr, i) => (
                    <div
                      key={`${tr.ts}-${i}`}
                      className={`flex items-center justify-between rounded px-1.5 py-0.5 ${
                        tr.side === "buy" ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                      }`}
                    >
                      <span>{tr.side === "buy" ? "BUY" : "SELL"}</span>
                      <span>{tr.price.toFixed(decimals)}</span>
                      <span className="opacity-75">{tr.qty.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mb-1.5 size-4 animate-pulse opacity-70" />
              Ожидание раздельных Buy / Sell тиков по WebSocket...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
