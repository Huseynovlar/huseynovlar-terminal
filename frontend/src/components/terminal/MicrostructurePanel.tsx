import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import {
  formatProviderLabel,
  type MarketFeedHealth,
  type MarketLiquidationEvent,
  type MarketOrderbookEvent,
  type MarketTickEvent,
} from "@/framework/use-market-stream";

interface DepthRow {
  price: number;
  qty: number;
  cum: number;
}

interface TickPoint {
  ts: number;
  bid: number;
  ask: number;
  side: "buy" | "sell";
  qty: number;
}

interface TicksApiResponse {
  symbol: string;
  ticks?: Array<{
    ts_ms?: number;
    bid?: number;
    ask?: number;
    price?: number;
    bid_size?: number;
    side?: string;
    source?: string;
  }>;
  orderbook?: {
    bids?: Array<[number, number]>;
    asks?: Array<[number, number]>;
    source?: string;
  } | null;
  spread_usd?: number;
  spread_bps?: number;
}

/**
 * Dynamic volume formatter: NEVER renders "0.00" or scientific notation ("9.00e-5") on non-zero quantities.
 */
export function formatDynamicVolume(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "—";
  if (qty >= 1_000_000) return `${(qty / 1_000_000).toFixed(2)}M`;
  if (qty >= 10_000) return `${(qty / 1_000).toFixed(1)}K`;
  if (qty >= 100) return qty.toFixed(2);
  if (qty >= 1) return qty.toFixed(3);
  if (qty >= 0.01) return qty.toFixed(4);
  return qty.toFixed(5);
}

function formatSpreadUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 10) return p.toFixed(5);
  if (p < 100) return p.toFixed(3);
  return p.toFixed(2);
}

function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface MicrostructurePanelProps {
  symbol: string;
  initialPrice?: number | null;
  latestTick: MarketTickEvent | null;
  latestOrderbook: MarketOrderbookEvent | null;
  liquidations: MarketLiquidationEvent[];
  feedHealth: MarketFeedHealth;
  feedProvider: string;
  feedLatencyMs: number | null;
}

export function MicrostructurePanel({
  symbol,
  initialPrice,
  latestTick,
  latestOrderbook,
  liquidations,
  feedHealth,
  feedProvider,
  feedLatencyMs,
}: MicrostructurePanelProps) {
  const canonSym = useMemo(() => canonicalMarketSymbol(symbol), [symbol]);
  const [topTab, setTopTab] = useState<"dom" | "tape" | "liq">("dom");
  const [tickWindow, setTickWindow] = useState<100 | 250 | 500>(250);

  const [rawBids, setRawBids] = useState<Array<[number, number]>>([]);
  const [rawAsks, setRawAsks] = useState<Array<[number, number]>>([]);
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [serverSpread, setServerSpread] = useState<{ usd: number; bps: number }>({ usd: 0, bps: 0 });
  const [resolvedProvider, setResolvedProvider] = useState<string>("Market WS");

  const ticksRef = useRef<TickPoint[]>([]);
  const hasL2Ref = useRef(false);

  // Hydrate initial ticks & orderbook strictly from direct market sources (`market_only=true`)
  useEffect(() => {
    let active = true;
    setRawBids([]);
    setRawAsks([]);
    setTicks([]);
    ticksRef.current = [];
    hasL2Ref.current = false;

    apiRequest<TicksApiResponse>(`/charts/ticks/${encodeURIComponent(canonSym)}?limit=500&market_only=true`)
      .then((res) => {
        if (!active) return;
        const list = Array.isArray(res.ticks) ? res.ticks : [];
        const hydrated: TickPoint[] = [];
        let lastSrc = "";
        for (const item of list) {
          if (item.source === "mt5_live") continue;
          const bid = Number(item.bid ?? item.price ?? 0);
          const ask = Number(item.ask ?? bid);
          if (!(bid > 0)) continue;
          if (item.source && item.source !== "history_seed") lastSrc = item.source;
          hydrated.push({
            ts: Number(item.ts_ms ?? Date.now()),
            bid,
            ask: ask >= bid ? ask : bid,
            side: item.side === "sell" ? "sell" : "buy",
            qty: Number(item.bid_size ?? 1),
          });
        }
        if (hydrated.length > 0 && ticksRef.current.length === 0) {
          ticksRef.current = hydrated.slice(-500);
          setTicks(ticksRef.current);
          if (lastSrc) setResolvedProvider(formatProviderLabel(lastSrc));
        }
        if (res.orderbook?.bids?.length || res.orderbook?.asks?.length) {
          hasL2Ref.current = true;
          setRawBids((res.orderbook.bids ?? []).slice(0, 10));
          setRawAsks((res.orderbook.asks ?? []).slice(0, 10));
          if (res.orderbook.source) setResolvedProvider(formatProviderLabel(res.orderbook.source));
        }
        if (typeof res.spread_usd === "number" && typeof res.spread_bps === "number") {
          setServerSpread({ usd: res.spread_usd, bps: res.spread_bps });
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [canonSym]);

  // Seed 1 tick if completely empty and chart has initialPrice
  useEffect(() => {
    if (initialPrice && initialPrice > 0 && ticksRef.current.length === 0) {
      const sp = initialPrice < 10 ? 0.0001 : initialPrice > 1000 ? 0.12 : 0.02;
      const pt: TickPoint = {
        ts: Date.now(),
        bid: initialPrice - sp / 2,
        ask: initialPrice + sp / 2,
        side: "buy",
        qty: 1,
      };
      ticksRef.current = [pt];
      setTicks([pt]);
    }
  }, [initialPrice]);

  // Append real-time tick from /ws/market
  useEffect(() => {
    if (!latestTick || latestTick.source === "mt5_live") return;
    const pt: TickPoint = {
      ts: latestTick.ts_ms,
      bid: latestTick.bid,
      ask: latestTick.ask >= latestTick.bid ? latestTick.ask : latestTick.bid,
      side: latestTick.side ?? "buy",
      qty: latestTick.bid_size ?? 1,
    };
    const next = [...ticksRef.current.slice(-499), pt];
    ticksRef.current = next;
    setTicks(next);
    if (latestTick.source) setResolvedProvider(formatProviderLabel(latestTick.source));

    if (!hasL2Ref.current) {
      const step = pt.bid < 10 ? 0.00005 : pt.bid > 1000 ? 0.1 : 0.01;
      const synBids: Array<[number, number]> = [];
      const synAsks: Array<[number, number]> = [];
      for (let i = 0; i < 8; i += 1) {
        synBids.push([pt.bid - i * step, Math.max(0.01, (pt.qty || 1) * (1 + i * 0.35))]);
        synAsks.push([pt.ask + i * step, Math.max(0.01, (pt.qty || 1) * (1 + i * 0.35))]);
      }
      setRawBids(synBids);
      setRawAsks(synAsks);
    }
  }, [latestTick]);

  // Apply real-time L2 orderbook from /ws/market
  useEffect(() => {
    if (!latestOrderbook || latestOrderbook.source === "mt5_live") return;
    hasL2Ref.current = true;
    if (latestOrderbook.bids.length > 0) setRawBids(latestOrderbook.bids.slice(0, 10));
    if (latestOrderbook.asks.length > 0) setRawAsks(latestOrderbook.asks.slice(0, 10));
    if (latestOrderbook.source) setResolvedProvider(formatProviderLabel(latestOrderbook.source));
  }, [latestOrderbook]);

  const { asksWithCum, bidsWithCum, maxCum, spreadUsd, spreadBps } = useMemo(() => {
    const sortedAsks = [...rawAsks].sort((a, b) => a[0] - b[0]).slice(0, 8);
    const sortedBids = [...rawBids].sort((a, b) => b[0] - a[0]).slice(0, 8);

    let aCum = 0;
    const asksRows: DepthRow[] = sortedAsks.map(([p, q]) => {
      aCum += q;
      return { price: p, qty: q, cum: aCum };
    });

    let bCum = 0;
    const bidsRows: DepthRow[] = sortedBids.map(([p, q]) => {
      bCum += q;
      return { price: p, qty: q, cum: bCum };
    });

    const maxC = Math.max(aCum, bCum, 0.0001);
    let spUsd = serverSpread.usd;
    let spBps = serverSpread.bps;
    if (sortedAsks.length > 0 && sortedBids.length > 0) {
      const bestAsk = sortedAsks[0]![0];
      const bestBid = sortedBids[0]![0];
      if (bestBid > 0 && bestAsk >= bestBid) {
        spUsd = bestAsk - bestBid;
        spBps = (spUsd / ((bestAsk + bestBid) / 2)) * 10_000;
      }
    }
    return {
      asksWithCum: asksRows.reverse(), // highest ask at top, best ask right above spread
      bidsWithCum: bidsRows,
      maxCum: maxC,
      spreadUsd: spUsd,
      spreadBps: spBps,
    };
  }, [rawAsks, rawBids, serverSpread]);

  const visibleTicks = useMemo(() => ticks.slice(-tickWindow), [ticks, tickWindow]);
  const tapeRows = useMemo(() => [...ticks].reverse().slice(0, 30), [ticks]);
  void resolvedProvider;
  void feedHealth;
  void feedProvider;
  void feedLatencyMs;

  // Build SVG polyline paths for the Tick Chart (Bid green + Ask red)
  const tickSvg = useMemo(() => {
    const W = 320;
    const H = 140;
    const PAD_R = 54;
    const PAD_T = 10;
    const PAD_B = 14;
    const plotW = W - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    if (visibleTicks.length === 0) return null;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const pt of visibleTicks) {
      if (pt.bid < minP) minP = pt.bid;
      if (pt.ask > maxP) maxP = pt.ask;
    }
    const range = Math.max(maxP - minP, minP * 0.0002 || 0.0001);
    const padRange = range * 0.12;
    const lo = minP - padRange;
    const hi = maxP + padRange;

    const toY = (val: number) => PAD_T + plotH - ((val - lo) / (hi - lo)) * plotH;
    const toX = (i: number) =>
      visibleTicks.length === 1 ? plotW : (i / (visibleTicks.length - 1)) * plotW;

    const bidPoints = visibleTicks.map((pt, i) => `${toX(i).toFixed(1)},${toY(pt.bid).toFixed(1)}`).join(" ");
    const askPoints = visibleTicks.map((pt, i) => `${toX(i).toFixed(1)},${toY(pt.ask).toFixed(1)}`).join(" ");
    const last = visibleTicks[visibleTicks.length - 1]!;

    return {
      W,
      H,
      plotW,
      bidPoints,
      askPoints,
      lastBid: last.bid,
      lastAsk: last.ask,
      lastBidY: toY(last.bid),
      lastAskY: toY(last.ask),
      gridLines: [0.2, 0.5, 0.8].map((r) => PAD_T + plotH * r),
    };
  }, [visibleTicks]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-panel)]">
      {/* TOP HALF (55%): DOM / TAPE / LIQUIDATIONS */}
      <div className="flex min-h-0 flex-[55] flex-col border-b border-[var(--border-subtle)]">
        {/* Header with underline tabs (API source + status dot lives exclusively in Chart Bar) */}
        <div className="flex h-8 shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
          <div className="flex h-full min-w-0 items-center gap-3 overflow-x-auto">
            {(
              [
                { id: "dom", label: "Стакан (DOM)" },
                { id: "tape", label: "Лента" },
                { id: "liq", label: "Ликвидации" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTopTab(tab.id)}
                className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-[11px] font-medium transition-colors duration-75 ${
                  topTab === tab.id
                    ? "border-[var(--accent-blue)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="pro-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px] tabular-nums">
          {topTab === "dom" ? (
            <div className="flex h-full flex-col justify-between">
              <div className="grid grid-cols-3 pb-1 text-[10px] text-[var(--text-muted)]">
                <span className="text-left">Цена</span>
                <span className="text-right">Объём</span>
                <span className="text-right">Сумм.</span>
              </div>

              {/* Asks */}
              <div className="space-y-0.5">
                {asksWithCum.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={`ask-sk-${i}`} className="grid h-5 grid-cols-3 items-center gap-2 px-1">
                      <div className="h-2.5 w-14 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                      <div className="ml-auto h-2.5 w-10 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                      <div className="ml-auto h-2.5 w-12 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    </div>
                  ))
                ) : (
                  asksWithCum.map((row) => {
                    const pct = Math.min(100, (row.cum / maxCum) * 100);
                    return (
                      <div key={`a-${row.price}`} className="relative grid h-5 grid-cols-3 items-center px-1">
                        <div
                          className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--bear-bg)]"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative text-left text-[var(--bear)]">{formatPrice(row.price)}</span>
                        <span className="relative text-right text-[var(--text-primary)]">{formatDynamicVolume(row.qty)}</span>
                        <span className="relative text-right text-[var(--text-muted)]">{formatDynamicVolume(row.cum)}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Spread divider */}
              <div className="my-1 flex items-center justify-between whitespace-nowrap border-y border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-1 text-[10px]">
                <span className="text-[var(--text-muted)]">Спред</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {formatSpreadUsd(spreadUsd)}{" "}
                  <span className="font-normal text-[var(--text-secondary)]">
                    · {spreadBps > 0 ? `${spreadBps.toFixed(1)} bps` : "0.0 bps"}
                  </span>
                </span>
              </div>

              {/* Bids */}
              <div className="space-y-0.5">
                {bidsWithCum.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={`bid-sk-${i}`} className="grid h-5 grid-cols-3 items-center gap-2 px-1">
                      <div className="h-2.5 w-14 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                      <div className="ml-auto h-2.5 w-10 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                      <div className="ml-auto h-2.5 w-12 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    </div>
                  ))
                ) : (
                  bidsWithCum.map((row) => {
                    const pct = Math.min(100, (row.cum / maxCum) * 100);
                    return (
                      <div key={`b-${row.price}`} className="relative grid h-5 grid-cols-3 items-center px-1">
                        <div
                          className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--bull-bg)]"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative text-left text-[var(--bull)]">{formatPrice(row.price)}</span>
                        <span className="relative text-right text-[var(--text-primary)]">{formatDynamicVolume(row.qty)}</span>
                        <span className="relative text-right text-[var(--text-muted)]">{formatDynamicVolume(row.cum)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : topTab === "tape" ? (
            <div>
              <div className="sticky top-0 grid grid-cols-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] pb-1 text-[10px] text-[var(--text-muted)]">
                <span className="text-left">Время</span>
                <span className="text-right">Цена</span>
                <span className="text-right">Объём</span>
              </div>
              {tapeRows.length === 0 ? (
                <div className="py-6 text-center text-[10px] text-[var(--text-muted)]">Нет тиков в потоке</div>
              ) : (
                tapeRows.map((t, idx) => (
                  <div
                    key={`${t.ts}-${idx}`}
                    className="grid h-6 grid-cols-3 items-center border-b border-[var(--border-subtle)]/40 hover:bg-[var(--bg-elevated)]"
                  >
                    <span className="text-left text-[var(--text-muted)]">{formatUtcTime(t.ts)}</span>
                    <span className={`text-right ${t.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {formatPrice(t.side === "buy" ? t.ask : t.bid)}
                    </span>
                    <span className="text-right text-[var(--text-primary)]">{formatDynamicVolume(t.qty)}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div>
              <div className="sticky top-0 grid grid-cols-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] pb-1 text-[10px] text-[var(--text-muted)]">
                <span className="text-left">Сторона</span>
                <span className="text-right">Цена</span>
                <span className="text-right">Объём USD</span>
              </div>
              {liquidations.length === 0 ? (
                <div className="py-6 text-center text-[10px] text-[var(--text-muted)]">
                  Нет крупных ликвидаций по {canonSym}
                </div>
              ) : (
                liquidations.map((liq, idx) => (
                  <div
                    key={`${liq.ts_ms}-${idx}`}
                    className="grid h-6 grid-cols-3 items-center border-b border-[var(--border-subtle)]/40 hover:bg-[var(--bg-elevated)]"
                  >
                    <span className={liq.side === "BUY" ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                      {liq.side === "BUY" ? "SHORT LIQ" : "LONG LIQ"}
                    </span>
                    <span className="text-right text-[var(--text-primary)]">{formatPrice(liq.price)}</span>
                    <span className="text-right text-[var(--accent-amber)]">${formatDynamicVolume(liq.usd_value)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM HALF (45%): TICK CHART (Bid green / Ask red) */}
      <div className="flex min-h-0 flex-[45] flex-col bg-[var(--bg-panel)]">
        <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Тиковый график</span>
            <span className="font-mono text-[10px] text-[var(--bull)]">Bid</span>
            <span className="font-mono text-[10px] text-[var(--bear)]">Ask</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {([100, 250, 500] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTickWindow(w)}
                className={`h-5 rounded-[2px] px-1.5 font-mono text-[10px] transition-colors duration-75 ${
                  tickWindow === w
                    ? "border border-[var(--border-strong)] bg-[var(--bg-panel)] text-[var(--accent-blue)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 p-1">
          {tickSvg ? (
            <svg
              viewBox={`0 0 ${tickSvg.W} ${tickSvg.H}`}
              preserveAspectRatio="none"
              className="h-full w-full select-none"
            >
              {tickSvg.gridLines.map((y, idx) => (
                <line
                  key={idx}
                  x1={0}
                  x2={tickSvg.plotW}
                  y1={y}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              ))}
              <polyline
                fill="none"
                stroke="var(--bear)"
                strokeWidth={1.3}
                points={tickSvg.askPoints}
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                fill="none"
                stroke="var(--bull)"
                strokeWidth={1.3}
                points={tickSvg.bidPoints}
                vectorEffect="non-scaling-stroke"
              />
              {/* Right axis Ask & Bid tags */}
              <rect
                x={tickSvg.plotW + 2}
                y={Math.max(2, Math.min(tickSvg.H - 26, tickSvg.lastAskY - 7))}
                width={50}
                height={13}
                rx={2}
                fill="var(--bear)"
              />
              <text
                x={tickSvg.plotW + 27}
                y={Math.max(11, Math.min(tickSvg.H - 17, tickSvg.lastAskY + 2))}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={8.5}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                {formatPrice(tickSvg.lastAsk)}
              </text>
              <rect
                x={tickSvg.plotW + 2}
                y={Math.max(16, Math.min(tickSvg.H - 14, tickSvg.lastBidY + 1))}
                width={50}
                height={13}
                rx={2}
                fill="var(--bull)"
              />
              <text
                x={tickSvg.plotW + 27}
                y={Math.max(25, Math.min(tickSvg.H - 5, tickSvg.lastBidY + 10))}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={8.5}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                {formatPrice(tickSvg.lastBid)}
              </text>
            </svg>
          ) : (
            <div className="flex h-full w-full items-center gap-2 px-2 py-3">
              <div className="flex h-full flex-1 flex-col justify-between">
                <div className="h-px w-full bg-[var(--border-subtle)]/60" />
                <div className="h-6 w-full rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                <div className="h-px w-full bg-[var(--border-subtle)]/60" />
                <div className="h-4 w-3/4 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                <div className="h-px w-full bg-[var(--border-subtle)]/60" />
              </div>
              <div className="flex h-full w-12 shrink-0 flex-col justify-center gap-2">
                <div className="h-3.5 w-full rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                <div className="h-3.5 w-full rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
