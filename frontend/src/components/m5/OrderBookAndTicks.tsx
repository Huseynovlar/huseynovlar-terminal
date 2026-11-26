import { useEffect, useMemo, useRef, useState } from "react";

import { Activity, BookOpen, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { useLiveEvents } from "@/framework/use-live-socket";

interface DepthLevel {
  price: number;
  qty: number;
}

interface CombinedTickPoint {
  ts: number;
  bid: number; // BUY / Bid line (green #10b981)
  ask: number; // SELL / Ask line (red #f43f5e)
  side: "buy" | "sell";
}

interface TradeTapeItem {
  ts: number;
  price: number;
  qty: number;
  side: "buy" | "sell";
}

function sourceDisplayName(src: string): string {
  if (src === "tiingo_fx") return "Tiingo FX Live WS";
  if (src === "mt5_live") return "MT5 Live Stream";
  if (src === "binance_vision" || src === "binance") return "Binance Live WS";
  if (src === "alpaca_iex") return "Alpaca IEX WS";
  if (src === "finnhub") return "Finnhub WS";
  return "Live WebSocket";
}

/**
 * Real-time Order Book (DOM) + ONE Unified Combined Buy (Green) / Sell (Red) Tick Chart (#25).
 * 100% same-origin via `/api/v1/ws/live` (Tiingo FX + Binance Vision + Alpaca IEX + MT5 Bridge).
 */
export function OrderBookAndTicks({
  symbol,
  initialPrice,
}: {
  symbol: string;
  initialPrice?: number | null;
}) {
  const [bids, setBids] = useState<DepthLevel[]>([]);
  const [asks, setAsks] = useState<DepthLevel[]>([]);
  const [ticks, setTicks] = useState<CombinedTickPoint[]>([]);
  const [tape, setTape] = useState<TradeTapeItem[]>([]);
  const [buyCount, setBuyCount] = useState(0);
  const [sellCount, setSellCount] = useState(0);
  const [feedLabel, setFeedLabel] = useState<string>("Live WebSocket");
  const [feedLive, setFeedLive] = useState(false);

  const canonSym = useMemo(() => canonicalMarketSymbol(symbol), [symbol]);
  const ticksRef = useRef<CombinedTickPoint[]>([]);
  const tapeRef = useRef<TradeTapeItem[]>([]);
  const hasL2Ref = useRef(false);
  const bidLadderRef = useRef<Map<string, DepthLevel>>(new Map());
  const askLadderRef = useRef<Map<string, DepthLevel>>(new Map());

  // Reset buffers when switching symbol
  useEffect(() => {
    setBids([]);
    setAsks([]);
    setTicks([]);
    setTape([]);
    setBuyCount(0);
    setSellCount(0);
    setFeedLive(false);
    setFeedLabel("Live WebSocket");
    ticksRef.current = [];
    tapeRef.current = [];
    hasL2Ref.current = false;
    bidLadderRef.current.clear();
    askLadderRef.current.clear();
  }, [canonSym]);

  // Seed initial point from latest known price if no WS tick arrived yet
  useEffect(() => {
    if (initialPrice && initialPrice > 0 && ticksRef.current.length === 0) {
      const seed: CombinedTickPoint = {
        ts: Date.now(),
        bid: initialPrice,
        ask: initialPrice,
        side: "buy",
      };
      ticksRef.current = [seed];
      setTicks([seed]);
      if (!hasL2Ref.current) {
        setBids([{ price: initialPrice, qty: 1 }]);
        setAsks([{ price: initialPrice, qty: 1 }]);
      }
    }
  }, [initialPrice]);

  // Listen to same-origin /api/v1/ws/live events pushed by backend Market WS Hub & MT5 Bridge
  useLiveEvents(["tick", "orderbook", "bar_update", "snapshot"], (evt) => {
    const d = (evt.data ?? {}) as Record<string, unknown>;
    const evtSym = canonicalMarketSymbol(String(d.symbol ?? d.asset_code ?? ""));
    if (!evtSym || evtSym !== canonSym) return;

    const src = String(d.source ?? (evt.type === "snapshot" ? "mt5_live" : ""));
    if (src) setFeedLabel(sourceDisplayName(src));
    setFeedLive(true);

    if (evt.type === "orderbook") {
      const rawBids = Array.isArray(d.bids) ? (d.bids as Array<[number, number]>) : [];
      const rawAsks = Array.isArray(d.asks) ? (d.asks as Array<[number, number]>) : [];
      if (rawBids.length > 0) {
        hasL2Ref.current = true;
        setBids(rawBids.slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      }
      if (rawAsks.length > 0) {
        hasL2Ref.current = true;
        setAsks(rawAsks.slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
      }
      return;
    }

    const barObj =
      d.bar && typeof d.bar === "object" ? (d.bar as Record<string, unknown>) : d;
    const rawBid = Number(d.bid ?? d.price ?? barObj.close ?? 0);
    const rawAsk = Number(d.ask ?? (rawBid > 0 ? rawBid : 0));
    if (!(rawBid > 0)) return;

    const bid = rawBid;
    const effAsk = rawAsk >= bid ? rawAsk : bid;
    const bidSz = Math.max(0.01, Number(d.bid_size ?? d.qty ?? 1));
    const askSz = Math.max(0.01, Number(d.ask_size ?? d.qty ?? 1));
    const now = Date.now();

    const prevLast = ticksRef.current[ticksRef.current.length - 1];
    const mid = (bid + effAsk) / 2;
    const prevMid = prevLast ? (prevLast.bid + prevLast.ask) / 2 : mid;
    const side: "buy" | "sell" =
      d.side === "sell" ? "sell" : d.side === "buy" ? "buy" : mid >= prevMid ? "buy" : "sell";

    const next: CombinedTickPoint = { ts: now, bid, ask: effAsk, side };
    const arr = [...ticksRef.current.slice(-119), next];
    ticksRef.current = arr;
    setTicks(arr);

    // Build live observed L1/Quote liquidity ladder when exchange doesn't push full L2 book
    if (!hasL2Ref.current) {
      const dec = bid < 10 ? 5 : 2;
      const bKey = bid.toFixed(dec);
      const aKey = effAsk.toFixed(dec);

      // Prune stale crossed levels
      for (const [k, v] of bidLadderRef.current.entries()) {
        if (v.price > effAsk) bidLadderRef.current.delete(k);
      }
      for (const [k, v] of askLadderRef.current.entries()) {
        if (v.price < bid) askLadderRef.current.delete(k);
      }

      bidLadderRef.current.set(bKey, { price: bid, qty: bidSz });
      askLadderRef.current.set(aKey, { price: effAsk, qty: askSz });

      const sortedBids = Array.from(bidLadderRef.current.values())
        .sort((a, b) => b.price - a.price)
        .slice(0, 8);
      const sortedAsks = Array.from(askLadderRef.current.values())
        .sort((a, b) => a.price - b.price)
        .slice(0, 8);

      bidLadderRef.current = new Map(sortedBids.map((x) => [x.price.toFixed(dec), x]));
      askLadderRef.current = new Map(sortedAsks.map((x) => [x.price.toFixed(dec), x]));

      setBids(sortedBids);
      setAsks(sortedAsks);
    }

    if (side === "buy") setBuyCount((c) => c + 1);
    else setSellCount((c) => c + 1);

    const nextItem: TradeTapeItem = {
      ts: now,
      price: side === "buy" ? effAsk : bid,
      qty: Number(d.qty ?? (side === "buy" ? askSz : bidSz)),
      side,
    };
    const nextTape = [nextItem, ...tapeRef.current.slice(0, 5)];
    tapeRef.current = nextTape;
    setTape(nextTape);
  });

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

  // Unified Single Tick Chart SVG: BOTH BUY (green #10b981) and SELL (red #f43f5e) together in one chart!
  const tickChart = useMemo(() => {
    if (ticks.length === 0) return null;
    const pts = ticks.length === 1 ? [ticks[0]!, ticks[0]!] : ticks;
    const allPrices = pts.flatMap((t) => [t.bid, t.ask]);
    let minP = Math.min(...allPrices);
    let maxP = Math.max(...allPrices);
    if (maxP - minP < 1e-6) {
      const pad = Math.max(minP * 0.0002, 0.05);
      minP -= pad;
      maxP += pad;
    } else {
      const pad = (maxP - minP) * 0.12;
      minP -= pad;
      maxP += pad;
    }
    const span = Math.max(maxP - minP, 1e-6);
    const w = 520;
    const h = 168;
    const leftPad = 6;
    const rightPad = 62;
    const plotW = w - leftPad - rightPad;

    const mapX = (i: number) => leftPad + (i / Math.max(1, pts.length - 1)) * plotW;
    const mapY = (p: number) => h - 14 - ((p - minP) / span) * (h - 28);

    const bidCoords = pts.map((t, i) => ({ x: mapX(i), y: mapY(t.bid), side: t.side }));
    const askCoords = pts.map((t, i) => ({ x: mapX(i), y: mapY(t.ask), side: t.side }));

    const bidPolyline = bidCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const askPolyline = askCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const spreadArea = [
      ...askCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`),
      ...[...bidCoords].reverse().map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`),
    ].join(" ");

    const last = pts[pts.length - 1]!;
    const lastBidY = mapY(last.bid);
    const lastAskY = mapY(last.ask);
    const midP = (minP + maxP) / 2;

    return {
      w,
      h,
      plotEnd: leftPad + plotW,
      bidPolyline,
      askPolyline,
      spreadArea,
      bidCoords,
      askCoords,
      minP,
      midP,
      maxP,
      last,
      lastBidY,
      lastAskY,
    };
  }, [ticks]);

  const refPrice = tickChart?.last.bid ?? bids[0]?.price ?? initialPrice ?? 0;
  const decimals = refPrice > 0 && refPrice < 10 ? 5 : 2;

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
            <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
              <BookOpen className="mx-auto mb-1.5 size-4 opacity-70" />
              Подключение к потоку котировок <span className="font-mono font-semibold">{symbol.toUpperCase()}</span>...
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="text-emerald-500">BUY (Bids) {buyPressurePct}%</span>
                  <span>
                    Спред: {spread.toFixed(decimals)} ({spreadBps.toFixed(1)} bps)
                  </span>
                  <span className="text-rose-500">SELL (Asks) {100 - buyPressurePct}%</span>
                </div>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/30">
                  <div className="bg-emerald-500 transition-all duration-150" style={{ width: `${buyPressurePct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Объём</span>
                    <span className="text-emerald-500">Buy (Bid)</span>
                  </div>
                  {bids.map((lvl, idx) => (
                    <div key={`b-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 bg-emerald-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(2)}</span>
                      <span className="relative font-semibold text-emerald-500">{lvl.price.toFixed(decimals)}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span className="text-rose-500">Sell (Ask)</span>
                    <span>Объём</span>
                  </div>
                  {asks.map((lvl, idx) => (
                    <div key={`a-${idx}`} className="relative flex justify-between overflow-hidden rounded px-1.5 py-0.5">
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 bg-rose-500/15"
                        style={{ width: `${Math.min(100, (lvl.qty / maxQty) * 100)}%` }}
                      />
                      <span className="relative font-semibold text-rose-500">{lvl.price.toFixed(decimals)}</span>
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Unified Single Combined Buy (Green) + Sell (Red) Tick Chart (#25) */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Activity className="size-4 text-emerald-500" />
            Тиковый график (Buy + Sell в одном окне)
          </CardTitle>
          {tickChart ? (
            <div className="flex items-center gap-2.5 font-mono text-xs font-bold tabular-nums">
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <span className="size-2 rounded-full bg-emerald-500" />
                BUY {tickChart.last.bid.toFixed(decimals)}
              </span>
              <span className="inline-flex items-center gap-1 text-rose-500">
                <span className="size-2 rounded-full bg-rose-500" />
                SELL {tickChart.last.ask.toFixed(decimals)}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">0 тиков</span>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {tickChart ? (
            <>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20 p-2">
                <svg viewBox={`0 0 ${tickChart.w} ${tickChart.h}`} className="h-40 w-full">
                  {/* Horizontal gridlines */}
                  {[0.18, 0.5, 0.82].map((r, idx) => {
                    const y = Math.round(tickChart.h * r);
                    const pVal =
                      idx === 0 ? tickChart.maxP : idx === 1 ? tickChart.midP : tickChart.minP;
                    return (
                      <g key={idx}>
                        <line
                          x1={6}
                          y1={y}
                          x2={tickChart.plotEnd}
                          y2={y}
                          stroke="rgba(148,163,184,0.14)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={tickChart.plotEnd + 6}
                          y={y + 3}
                          fill="#94a3b8"
                          fontSize="9.5"
                          fontFamily="ui-monospace, monospace"
                        >
                          {pVal.toFixed(decimals)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Shaded Bid-Ask spread channel */}
                  <polygon points={tickChart.spreadArea} fill="rgba(148, 163, 184, 0.10)" />

                  {/* SELL (Ask) line — RED */}
                  <polyline
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="1.9"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={tickChart.askPolyline}
                  />

                  {/* BUY (Bid) line — GREEN */}
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.1"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={tickChart.bidPolyline}
                  />

                  {/* Individual recent tick dots (green = buy, red = sell) */}
                  {tickChart.bidCoords.slice(-24).map((pt, idx) =>
                    pt.side === "buy" ? (
                      <circle key={`bd-${idx}`} cx={pt.x} cy={pt.y} r="2.1" fill="#10b981" />
                    ) : null,
                  )}
                  {tickChart.askCoords.slice(-24).map((pt, idx) =>
                    pt.side === "sell" ? (
                      <circle key={`ad-${idx}`} cx={pt.x} cy={pt.y} r="2.1" fill="#f43f5e" />
                    ) : null,
                  )}

                  {/* Live pulsing endpoints */}
                  <circle cx={tickChart.plotEnd} cy={tickChart.lastAskY} r="3.5" fill="#f43f5e" />
                  <circle cx={tickChart.plotEnd} cy={tickChart.lastBidY} r="3.5" fill="#10b981" />
                </svg>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
                <span className="text-emerald-500">● Зелёная линия — BUY (Bid): {buyCount} тиков</span>
                <span>Буфер: {ticks.length} тиков</span>
                <span className="text-rose-500">● Красная линия — SELL (Ask): {sellCount} тиков</span>
              </div>
              {tape.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5 border-t border-border/50 pt-2 font-mono text-[10px] tabular-nums">
                  {tape.slice(0, 3).map((tr, i) => (
                    <div
                      key={`${tr.ts}-${i}`}
                      className={`flex items-center justify-between rounded px-1.5 py-0.5 ${
                        tr.side === "buy" ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                      }`}
                    >
                      <span>{tr.side === "buy" ? "BUY" : "SELL"}</span>
                      <span>{tr.price.toFixed(decimals)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mb-1.5 size-4 animate-pulse opacity-70" />
              Подключение единого потока тиков (BUY зелёный / SELL красный)...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
