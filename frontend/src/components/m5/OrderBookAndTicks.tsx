import { useEffect, useMemo, useRef, useState } from "react";

import { Activity, BookOpen, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { useLiveEvents } from "@/framework/use-live-socket";

interface DepthLevel {
  price: number;
  qty: number;
}

interface CombinedTickPoint {
  ts: number;
  bid: number; // BUY / Bid line (green #10b981)
  ask: number; // SELL / Ask line (red #ef4444)
  side: "buy" | "sell";
}

interface TicksHistoryResponse {
  symbol: string;
  ticks?: Array<{
    ts_ms?: number;
    bid?: number;
    ask?: number;
    price?: number;
    side?: string;
    source?: string;
  }>;
  orderbook?: {
    bids?: Array<[number, number]>;
    asks?: Array<[number, number]>;
    source?: string;
  } | null;
}

function sourceDisplayName(src: string): string {
  if (src === "tiingo_fx") return "Tiingo FX Live WS";
  if (src === "mt5_live") return "MT5 Live Stream";
  if (src === "binance_vision" || src === "binance") return "Binance Live WS";
  if (src === "alpaca_iex") return "Alpaca IEX WS";
  if (src === "finnhub") return "Finnhub WS";
  return "Live WebSocket";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatMt5Date(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}`;
}

function formatMt5TimeShort(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatMt5TimeSec(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * Real-time Order Book (DOM) + MetaTrader 5 Style Unified Tick Chart (#25):
 * Plots RED (Ask / Sell) and GREEN (Bid / Buy) lines together in ONE chart with
 * right-axis floating price badges, dashed grid, and bottom UTC time scale.
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
  const [buyCount, setBuyCount] = useState(0);
  const [sellCount, setSellCount] = useState(0);
  const [feedLabel, setFeedLabel] = useState<string>("Live WebSocket");
  const [feedLive, setFeedLive] = useState(false);

  const canonSym = useMemo(() => canonicalMarketSymbol(symbol), [symbol]);
  const ticksRef = useRef<CombinedTickPoint[]>([]);
  const hasL2Ref = useRef(false);
  const bidLadderRef = useRef<Map<string, DepthLevel>>(new Map());
  const askLadderRef = useRef<Map<string, DepthLevel>>(new Map());

  // 1. Reset & immediately hydrate recent buffered ticks over WebSocket RPC (GET /charts/ticks/{symbol})
  useEffect(() => {
    let active = true;
    setBids([]);
    setAsks([]);
    setTicks([]);
    setBuyCount(0);
    setSellCount(0);
    setFeedLive(false);
    setFeedLabel("Live WebSocket");
    ticksRef.current = [];
    hasL2Ref.current = false;
    bidLadderRef.current.clear();
    askLadderRef.current.clear();

    apiRequest<TicksHistoryResponse>(`/charts/ticks/${encodeURIComponent(canonSym)}?limit=140`)
      .then((res) => {
        if (!active) return;
        const rawList = Array.isArray(res.ticks) ? res.ticks : [];
        const hydrated: CombinedTickPoint[] = [];
        let bCnt = 0;
        let sCnt = 0;
        let lastSrc = "";
        for (const item of rawList) {
          const bid = Number(item.bid ?? item.price ?? 0);
          const ask = Number(item.ask ?? bid);
          if (!(bid > 0)) continue;
          const effAsk = ask >= bid ? ask : bid;
          const side: "buy" | "sell" = item.side === "sell" ? "sell" : "buy";
          if (side === "buy") bCnt += 1;
          else sCnt += 1;
          if (item.source && item.source !== "history_seed") lastSrc = item.source;
          hydrated.push({
            ts: Number(item.ts_ms ?? Date.now()),
            bid,
            ask: effAsk,
            side,
          });
        }
        if (hydrated.length > 0 && ticksRef.current.length === 0) {
          ticksRef.current = hydrated;
          setTicks(hydrated);
          setBuyCount(bCnt);
          setSellCount(sCnt);
          if (lastSrc) {
            setFeedLabel(sourceDisplayName(lastSrc));
            setFeedLive(true);
          }
          // Populate initial DOM ladder from observed Bid/Ask levels
          const dec = hydrated[hydrated.length - 1]!.bid < 10 ? 5 : 2;
          for (const pt of hydrated.slice(-24)) {
            bidLadderRef.current.set(pt.bid.toFixed(dec), { price: pt.bid, qty: 1 });
            askLadderRef.current.set(pt.ask.toFixed(dec), { price: pt.ask, qty: 1 });
          }
          setBids(
            Array.from(bidLadderRef.current.values())
              .sort((a, b) => b.price - a.price)
              .slice(0, 8),
          );
          setAsks(
            Array.from(askLadderRef.current.values())
              .sort((a, b) => a.price - b.price)
              .slice(0, 8),
          );
        }
        if (res.orderbook?.bids?.length || res.orderbook?.asks?.length) {
          hasL2Ref.current = true;
          setBids((res.orderbook.bids ?? []).slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
          setAsks((res.orderbook.asks ?? []).slice(0, 8).map(([p, q]) => ({ price: Number(p), qty: Number(q) })));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [canonSym]);

  // Seed fallback if neither buffer nor WS has delivered a point yet
  useEffect(() => {
    if (initialPrice && initialPrice > 0 && ticksRef.current.length === 0) {
      const sp = initialPrice < 10 ? 0.0001 : initialPrice > 1000 ? 0.16 : 0.02;
      const seed: CombinedTickPoint = {
        ts: Date.now(),
        bid: Number((initialPrice - sp / 2).toFixed(5)),
        ask: Number((initialPrice + sp / 2).toFixed(5)),
        side: "buy",
      };
      ticksRef.current = [seed];
      setTicks([seed]);
    }
  }, [initialPrice]);

  // 2. Append live real-time ticks & L2 depth from /api/v1/ws/live
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

    const barObj = d.bar && typeof d.bar === "object" ? (d.bar as Record<string, unknown>) : d;
    const rawBid = Number(d.bid ?? d.price ?? barObj.close ?? 0);
    const rawAsk = Number(d.ask ?? (rawBid > 0 ? rawBid : 0));
    if (!(rawBid > 0)) return;

    const bid = rawBid;
    const effAsk = rawAsk >= bid ? rawAsk : bid;
    const bidSz = Math.max(0.01, Number(d.bid_size ?? d.qty ?? 1));
    const askSz = Math.max(0.01, Number(d.ask_size ?? d.qty ?? 1));
    const now = Number(d.ts_ms ?? Date.now());

    const prevLast = ticksRef.current[ticksRef.current.length - 1];
    const mid = (bid + effAsk) / 2;
    const prevMid = prevLast ? (prevLast.bid + prevLast.ask) / 2 : mid;
    const side: "buy" | "sell" =
      d.side === "sell" ? "sell" : d.side === "buy" ? "buy" : mid >= prevMid ? "buy" : "sell";

    const next: CombinedTickPoint = { ts: now, bid, ask: effAsk, side };
    const arr = [...ticksRef.current.slice(-139), next];
    ticksRef.current = arr;
    setTicks(arr);

    if (!hasL2Ref.current) {
      const dec = bid < 10 ? 5 : 2;
      for (const [k, v] of bidLadderRef.current.entries()) {
        if (v.price > effAsk) bidLadderRef.current.delete(k);
      }
      for (const [k, v] of askLadderRef.current.entries()) {
        if (v.price < bid) askLadderRef.current.delete(k);
      }
      bidLadderRef.current.set(bid.toFixed(dec), { price: bid, qty: bidSz });
      askLadderRef.current.set(effAsk.toFixed(dec), { price: effAsk, qty: askSz });

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
  const refPrice = ticks[ticks.length - 1]?.bid ?? bids[0]?.price ?? initialPrice ?? 0;
  const decimals = refPrice > 0 && refPrice < 10 ? 5 : 3;
  const domDecimals = refPrice > 0 && refPrice < 10 ? 5 : 2;

  // MT5 Market Watch Style Combined Tick Chart Geometry
  const mt5TickSvg = useMemo(() => {
    if (ticks.length === 0) return null;
    const pts = ticks.length === 1 ? [ticks[0]!, ticks[0]!] : ticks;
    const allPrices = pts.flatMap((t) => [t.bid, t.ask]);
    let minP = Math.min(...allPrices);
    let maxP = Math.max(...allPrices);
    if (maxP - minP < 1e-6) {
      const pad = Math.max(minP * 0.0003, 0.15);
      minP -= pad;
      maxP += pad;
    } else {
      const pad = (maxP - minP) * 0.09;
      minP -= pad;
      maxP += pad;
    }
    const span = Math.max(maxP - minP, 1e-6);

    const w = 580;
    const h = 236;
    const padLeft = 8;
    const padTop = 10;
    const padBottom = 22;
    const axisRightW = 68;
    const plotRight = w - axisRightW;
    const plotW = plotRight - padLeft;
    const plotH = h - padTop - padBottom;
    // Leave small MT5 right margin before axis so horizontal current-price lines extend cleanly
    const traceWidth = plotW * 0.94;

    const mapX = (i: number) => padLeft + (i / Math.max(1, pts.length - 1)) * traceWidth;
    const mapY = (p: number) => padTop + ((maxP - p) / span) * plotH;

    const bidPoints = pts.map((t, i) => `${mapX(i).toFixed(1)},${mapY(t.bid).toFixed(1)}`).join(" ");
    const askPoints = pts.map((t, i) => `${mapX(i).toFixed(1)},${mapY(t.ask).toFixed(1)}`).join(" ");

    const last = pts[pts.length - 1]!;
    const lastX = mapX(pts.length - 1);
    const lastAskY = mapY(last.ask);
    const lastBidY = mapY(last.bid);

    // Prevent Ask & Bid right-axis pills from overlapping when spread is very tight
    let askBadgeY = lastAskY;
    let bidBadgeY = lastBidY;
    if (Math.abs(bidBadgeY - askBadgeY) < 15) {
      const midY = (askBadgeY + bidBadgeY) / 2;
      askBadgeY = midY - 8;
      bidBadgeY = midY + 8;
    }

    // 7 horizontal price grid levels (like MT5)
    const yTicks = Array.from({ length: 7 }, (_, idx) => {
      const ratio = idx / 6;
      const y = padTop + ratio * plotH;
      const price = maxP - ratio * span;
      return { y, price };
    });

    // 6 vertical time grid columns + bottom time labels
    const xTicks = Array.from({ length: 6 }, (_, idx) => {
      const ratio = idx / 5;
      const x = padLeft + ratio * plotW;
      const ptIdx = Math.min(pts.length - 1, Math.round(ratio * (pts.length - 1)));
      const ts = pts[ptIdx]!.ts;
      const label =
        idx === 0
          ? formatMt5Date(ts)
          : idx === 5
            ? formatMt5TimeSec(last.ts)
            : formatMt5TimeShort(ts);
      return { x, label };
    });

    return {
      w,
      h,
      padLeft,
      padTop,
      plotRight,
      plotBottom: padTop + plotH,
      bidPoints,
      askPoints,
      last,
      lastX,
      lastAskY,
      lastBidY,
      askBadgeY,
      bidBadgeY,
      yTicks,
      xTicks,
    };
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
            <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
              <BookOpen className="mx-auto mb-1.5 size-4 opacity-70" />
              Подключение стакана котировок <span className="font-mono font-semibold">{symbol.toUpperCase()}</span>...
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="text-emerald-500">BUY (Bid) {buyPressurePct}%</span>
                  <span>
                    Спред: {spread.toFixed(domDecimals)} ({spreadBps.toFixed(1)} bps)
                  </span>
                  <span className="text-rose-500">SELL (Ask) {100 - buyPressurePct}%</span>
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
                      <span className="relative font-semibold text-emerald-500">{lvl.price.toFixed(domDecimals)}</span>
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
                      <span className="relative font-semibold text-rose-500">{lvl.price.toFixed(domDecimals)}</span>
                      <span className="relative text-muted-foreground">{lvl.qty.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* MetaTrader 5 Style Unified Tick Chart: RED (Ask / Sell) + GREEN (Bid / Buy) in ONE window */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Activity className="size-4 text-emerald-500" />
            Тиковый график MT5 — Ask (красный) / Bid (зелёный)
          </CardTitle>
          {mt5TickSvg ? (
            <div className="flex items-center gap-2 font-mono text-xs font-bold tabular-nums">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-500">
                BID {mt5TickSvg.last.bid.toFixed(decimals)}
              </span>
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                ASK {mt5TickSvg.last.ask.toFixed(decimals)}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">Загрузка тиков…</span>
          )}
        </CardHeader>
        <CardContent className="space-y-1.5">
          {mt5TickSvg ? (
            <>
              <div className="overflow-hidden rounded-md border border-zinc-800 bg-[#1c1d21]">
                <svg viewBox={`0 0 ${mt5TickSvg.w} ${mt5TickSvg.h}`} className="h-56 w-full select-none">
                  {/* Plot Frame */}
                  <rect
                    x={mt5TickSvg.padLeft}
                    y={mt5TickSvg.padTop}
                    width={mt5TickSvg.plotRight - mt5TickSvg.padLeft}
                    height={mt5TickSvg.plotBottom - mt5TickSvg.padTop}
                    fill="#1c1d21"
                    stroke="rgba(161, 161, 170, 0.28)"
                    strokeWidth="1"
                  />

                  {/* Vertical Dashed Time Grid + Bottom Timestamps */}
                  {mt5TickSvg.xTicks.map((xt, idx) => (
                    <g key={`xg-${idx}`}>
                      {idx > 0 && idx < mt5TickSvg.xTicks.length - 1 ? (
                        <line
                          x1={xt.x}
                          y1={mt5TickSvg.padTop}
                          x2={xt.x}
                          y2={mt5TickSvg.plotBottom}
                          stroke="rgba(161, 161, 170, 0.16)"
                          strokeDasharray="3 3"
                        />
                      ) : null}
                      <text
                        x={idx === 0 ? xt.x : idx === mt5TickSvg.xTicks.length - 1 ? xt.x - 4 : xt.x}
                        y={mt5TickSvg.h - 6}
                        textAnchor={idx === 0 ? "start" : idx === mt5TickSvg.xTicks.length - 1 ? "end" : "middle"}
                        fill="#d4d4d8"
                        fontSize="9.5"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {xt.label}
                      </text>
                    </g>
                  ))}

                  {/* Horizontal Dashed Price Grid + Right Axis Labels */}
                  {mt5TickSvg.yTicks.map((yt, idx) => (
                    <g key={`yg-${idx}`}>
                      <line
                        x1={mt5TickSvg.padLeft}
                        y1={yt.y}
                        x2={mt5TickSvg.plotRight}
                        y2={yt.y}
                        stroke="rgba(161, 161, 170, 0.16)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={mt5TickSvg.plotRight + 5}
                        y={yt.y + 3}
                        fill="#d4d4d8"
                        fontSize="9.5"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {yt.price.toFixed(decimals)}
                      </text>
                    </g>
                  ))}

                  {/* SELL / Ask Tick Line (RED) */}
                  <polyline
                    fill="none"
                    stroke="#f87171"
                    strokeWidth="1.45"
                    strokeLinejoin="miter"
                    points={mt5TickSvg.askPoints}
                  />

                  {/* BUY / Bid Tick Line (GREEN) */}
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="1.45"
                    strokeLinejoin="miter"
                    points={mt5TickSvg.bidPoints}
                  />

                  {/* Horizontal current-price extension lines to right axis (exact MT5 look) */}
                  <line
                    x1={mt5TickSvg.lastX}
                    y1={mt5TickSvg.lastAskY}
                    x2={mt5TickSvg.plotRight}
                    y2={mt5TickSvg.lastAskY}
                    stroke="#ef4444"
                    strokeWidth="1.2"
                  />
                  <line
                    x1={mt5TickSvg.lastX}
                    y1={mt5TickSvg.lastBidY}
                    x2={mt5TickSvg.plotRight}
                    y2={mt5TickSvg.lastBidY}
                    stroke="#10b981"
                    strokeWidth="1.2"
                  />

                  {/* Right-Axis Floating ASK Pill (RED) */}
                  <g transform={`translate(${mt5TickSvg.plotRight + 1}, ${mt5TickSvg.askBadgeY - 7.5})`}>
                    <rect width={64} height={15} rx={2} fill="#ef4444" />
                    <text
                      x={32}
                      y={10.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9.5"
                      fontWeight="700"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {mt5TickSvg.last.ask.toFixed(decimals)}
                    </text>
                  </g>

                  {/* Right-Axis Floating BID Pill (GREEN) */}
                  <g transform={`translate(${mt5TickSvg.plotRight + 1}, ${mt5TickSvg.bidBadgeY - 7.5})`}>
                    <rect width={64} height={15} rx={2} fill="#10b981" />
                    <text
                      x={32}
                      y={10.5}
                      textAnchor="middle"
                      fill="#042f2e"
                      fontSize="9.5"
                      fontWeight="700"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {mt5TickSvg.last.bid.toFixed(decimals)}
                    </text>
                  </g>
                </svg>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
                <span className="text-emerald-500">● Зелёная — Bid / Buy ({buyCount})</span>
                <span>Окно: {ticks.length} тиков</span>
                <span className="text-rose-500">● Красная — Ask / Sell ({sellCount})</span>
              </div>
            </>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mb-1.5 size-4 animate-pulse opacity-70" />
              Загрузка тикового графика MT5...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
