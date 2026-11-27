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
  const [tickWindow, setTickWindow] = useState<10 | 50 | 100 | 250>(50);
  const [hasTicks, setHasTicks] = useState(false);

  const [rawBids, setRawBids] = useState<Array<[number, number]>>([]);
  const [rawAsks, setRawAsks] = useState<Array<[number, number]>>([]);
  const [tapeRows, setTapeRows] = useState<TickPoint[]>([]);
  const [serverSpread, setServerSpread] = useState<{ usd: number; bps: number }>({ usd: 0, bps: 0 });

  const ticksRef = useRef<TickPoint[]>([]);
  const tickWindowRef = useRef<number>(tickWindow);
  tickWindowRef.current = tickWindow;
  const hasL2Ref = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dirtyRef = useRef(true);
  const lastUiSyncRef = useRef(0);

  void feedHealth;
  void feedProvider;
  void feedLatencyMs;

  // Hydrate initial ticks & orderbook strictly from direct market sources (`market_only=true`)
  useEffect(() => {
    let active = true;
    setRawBids([]);
    setRawAsks([]);
    setTapeRows([]);
    setHasTicks(false);
    ticksRef.current = [];
    hasL2Ref.current = false;
    dirtyRef.current = true;

    apiRequest<TicksApiResponse>(`/charts/ticks/${encodeURIComponent(canonSym)}?limit=250&market_only=true`)
      .then((res) => {
        if (!active) return;
        const list = Array.isArray(res.ticks) ? res.ticks : [];
        const hydrated: TickPoint[] = [];
        for (const item of list) {
          if (item.source === "mt5_live") continue;
          const bid = Number(item.bid ?? item.price ?? 0);
          const ask = Number(item.ask ?? bid);
          if (!(bid > 0)) continue;
          hydrated.push({
            ts: Number(item.ts_ms ?? Date.now()),
            bid,
            ask: ask >= bid ? ask : bid,
            side: item.side === "sell" ? "sell" : "buy",
            qty: Number(item.bid_size ?? 1),
          });
        }
        if (hydrated.length > 0 && ticksRef.current.length === 0) {
          ticksRef.current = hydrated.slice(-300);
          setTapeRows([...ticksRef.current].reverse().slice(0, 30));
          setHasTicks(true);
          dirtyRef.current = true;
        }
        if (res.orderbook?.bids?.length || res.orderbook?.asks?.length) {
          hasL2Ref.current = true;
          setRawBids((res.orderbook.bids ?? []).slice(0, 10));
          setRawAsks((res.orderbook.asks ?? []).slice(0, 10));
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
      setTapeRows([pt]);
      setHasTicks(true);
      dirtyRef.current = true;
    }
  }, [initialPrice]);

  // Append real-time tick from /ws/market — zero-lag ref push + throttled Tape/DOM sync
  useEffect(() => {
    if (!latestTick || latestTick.source === "mt5_live") return;
    const pt: TickPoint = {
      ts: latestTick.ts_ms,
      bid: latestTick.bid,
      ask: latestTick.ask >= latestTick.bid ? latestTick.ask : latestTick.bid,
      side: latestTick.side ?? "buy",
      qty: latestTick.bid_size ?? 1,
    };
    const arr = ticksRef.current;
    arr.push(pt);
    if (arr.length > 300) arr.shift();
    dirtyRef.current = true;
    if (!hasTicks) setHasTicks(true);

    const now = performance.now();
    if (now - lastUiSyncRef.current >= 120) {
      lastUiSyncRef.current = now;
      if (topTab === "tape") {
        setTapeRows([...arr].reverse().slice(0, 30));
      }
      if (!hasL2Ref.current) {
        const step = pt.bid < 10 ? 0.00005 : pt.bid > 1000 ? 0.1 : 0.01;
        const synBids: Array<[number, number]> = [];
        const synAsks: Array<[number, number]> = [];
        for (let i = 0; i < 6; i += 1) {
          synBids.push([pt.bid - i * step, Math.max(0.01, (pt.qty || 1) * (1 + i * 0.35))]);
          synAsks.push([pt.ask + i * step, Math.max(0.01, (pt.qty || 1) * (1 + i * 0.35))]);
        }
        setRawBids(synBids);
        setRawAsks(synAsks);
      }
    }
  }, [latestTick, hasTicks, topTab]);

  // Mark canvas dirty when tickWindow changes
  useEffect(() => {
    dirtyRef.current = true;
  }, [tickWindow]);

  // Refresh tape immediately when switching to Tape tab
  useEffect(() => {
    if (topTab === "tape" && ticksRef.current.length > 0) {
      setTapeRows([...ticksRef.current].reverse().slice(0, 30));
    }
  }, [topTab]);

  // Apply real-time L2 orderbook from /ws/market
  useEffect(() => {
    if (!latestOrderbook || latestOrderbook.source === "mt5_live") return;
    hasL2Ref.current = true;
    if (latestOrderbook.bids.length > 0) setRawBids(latestOrderbook.bids.slice(0, 10));
    if (latestOrderbook.asks.length > 0) setRawAsks(latestOrderbook.asks.slice(0, 10));
    void formatProviderLabel;
  }, [latestOrderbook]);

  // Hardware-accelerated requestAnimationFrame Canvas Tick Chart (60 FPS, zero React lag)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;

    const draw = () => {
      rafId = window.requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const W = Math.max(120, Math.floor(rect.width));
      const H = Math.max(70, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const all = ticksRef.current;
      const win = tickWindowRef.current;
      const visible = all.length > win ? all.slice(-win) : all;
      if (visible.length === 0) {
        ctx.restore();
        return;
      }

      const cs = getComputedStyle(document.documentElement);
      const bull = cs.getPropertyValue("--bull").trim() || "#00D488";
      const bear = cs.getPropertyValue("--bear").trim() || "#FF4757";
      const borderCol = cs.getPropertyValue("--border-subtle").trim() || "#1E2634";
      const fontFam = cs.getPropertyValue("--app-font-sans").trim() || "Inter, sans-serif";

      const PAD_R = 58;
      const PAD_T = 10;
      const PAD_B = 10;
      const plotW = W - PAD_R;
      const plotH = H - PAD_T - PAD_B;

      let minP = Infinity;
      let maxP = -Infinity;
      for (let i = 0; i < visible.length; i += 1) {
        const p = visible[i]!;
        if (p.bid < minP) minP = p.bid;
        if (p.ask > maxP) maxP = p.ask;
      }
      const span = Math.max(maxP - minP, minP * 0.00015 || 0.0001);
      const lo = minP - span * 0.14;
      const hi = maxP + span * 0.14;

      const toY = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;
      const denom = Math.max(1, visible.length - 1);
      const toX = (i: number) => (visible.length === 1 ? plotW : (i / denom) * plotW);

      // Dashed horizontal grid
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const r of [0.2, 0.5, 0.8]) {
        const y = Math.round(PAD_T + plotH * r) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Ask line (red)
      ctx.strokeStyle = bear;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < visible.length; i += 1) {
        const x = toX(i);
        const y = toY(visible[i]!.ask);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Bid line (green)
      ctx.strokeStyle = bull;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < visible.length; i += 1) {
        const x = toX(i);
        const y = toY(visible[i]!.bid);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Live pulsing endpoint dots
      const last = visible[visible.length - 1]!;
      const lastX = toX(visible.length - 1);
      const lastAskY = toY(last.ask);
      const lastBidY = toY(last.bid);

      ctx.fillStyle = bear;
      ctx.beginPath();
      ctx.arc(lastX, lastAskY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = bull;
      ctx.beginPath();
      ctx.arc(lastX, lastBidY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Right-axis Ask & Bid price badges (non-overlapping)
      const tagW = PAD_R - 4;
      const tagH = 14;
      let askTagY = Math.max(2, Math.min(H - tagH * 2 - 4, lastAskY - tagH / 2));
      let bidTagY = Math.max(askTagY + tagH + 2, Math.min(H - tagH - 2, lastBidY - tagH / 2));
      if (bidTagY - askTagY < tagH + 2) {
        askTagY = Math.max(2, bidTagY - tagH - 2);
      }

      ctx.font = `600 9px ${fontFam}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = bear;
      ctx.fillRect(plotW + 2, askTagY, tagW, tagH);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(formatPrice(last.ask), plotW + 2 + tagW / 2, askTagY + tagH / 2 + 0.5);

      ctx.fillStyle = bull;
      ctx.fillRect(plotW + 2, bidTagY, tagW, tagH);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(formatPrice(last.bid), plotW + 2 + tagW / 2, bidTagY + tagH / 2 + 0.5);

      ctx.restore();
    };

    const ro = new ResizeObserver(() => {
      dirtyRef.current = true;
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    rafId = window.requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(rafId);
    };
  }, [hasTicks]);

  // Symmetric top-6 Asks & top-6 Bids around the spread so Bids are ALWAYS visible
  const { asksWithCum, bidsWithCum, maxCum, spreadUsd, spreadBps } = useMemo(() => {
    const sortedAsks = [...rawAsks].sort((a, b) => a[0] - b[0]).slice(0, 6);
    const sortedBids = [...rawBids].sort((a, b) => b[0] - a[0]).slice(0, 6);

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
      asksWithCum: asksRows.reverse(),
      bidsWithCum: bidsRows,
      maxCum: maxC,
      spreadUsd: spUsd,
      spreadBps: spBps,
    };
  }, [rawAsks, rawBids, serverSpread]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-panel)] font-sans">
      {/* TOP HALF (58%): SYMMETRIC DOM / TAPE / LIQUIDATIONS */}
      <div className="flex min-h-0 flex-[58] flex-col border-b border-[var(--border-subtle)]">
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

        {topTab === "dom" ? (
          /* Locked symmetric 50/50 split: Asks anchored bottom + Spread center + Bids anchored top */
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1 text-[11px] tabular-nums">
            <div className="grid shrink-0 grid-cols-3 pb-1 text-[10px] text-[var(--text-muted)]">
              <span className="text-left">Цена</span>
              <span className="text-right">Объём</span>
              <span className="text-right">Сумм.</span>
            </div>

            {/* ASKS (Top half, aligned down toward Spread) */}
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-0.5 overflow-hidden">
              {asksWithCum.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={`ask-sk-${i}`} className="grid h-[18px] shrink-0 grid-cols-3 items-center gap-2 px-1">
                    <div className="h-2.5 w-14 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    <div className="ml-auto h-2.5 w-10 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    <div className="ml-auto h-2.5 w-12 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                  </div>
                ))
              ) : (
                asksWithCum.map((row) => {
                  const pct = Math.min(100, (row.cum / maxCum) * 100);
                  return (
                    <div key={`a-${row.price}`} className="relative grid h-[18px] shrink-0 grid-cols-3 items-center px-1">
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

            {/* SPREAD DIVIDER (Always centered) */}
            <div className="my-1 flex shrink-0 items-center justify-between whitespace-nowrap border-y border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px]">
              <span className="text-[var(--text-muted)]">Спред</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatSpreadUsd(spreadUsd)}{" "}
                <span className="font-normal text-[var(--text-secondary)]">
                  · {spreadBps > 0 ? `${spreadBps.toFixed(1)} bps` : "0.0 bps"}
                </span>
              </span>
            </div>

            {/* BIDS (Bottom half, aligned up toward Spread) */}
            <div className="flex min-h-0 flex-1 flex-col justify-start gap-0.5 overflow-hidden">
              {bidsWithCum.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={`bid-sk-${i}`} className="grid h-[18px] shrink-0 grid-cols-3 items-center gap-2 px-1">
                    <div className="h-2.5 w-14 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    <div className="ml-auto h-2.5 w-10 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                    <div className="ml-auto h-2.5 w-12 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
                  </div>
                ))
              ) : (
                bidsWithCum.map((row) => {
                  const pct = Math.min(100, (row.cum / maxCum) * 100);
                  return (
                    <div key={`b-${row.price}`} className="relative grid h-[18px] shrink-0 grid-cols-3 items-center px-1">
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
        ) : (
          <div className="pro-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1 text-[11px] tabular-nums">
            {topTab === "tape" ? (
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
        )}
      </div>

      {/* BOTTOM HALF (42%): SMOOTH 60-FPS CANVAS TICK CHART (10 | 50 | 100 | 250) */}
      <div className="flex min-h-0 flex-[42] flex-col bg-[var(--bg-panel)]">
        <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Тиковый график</span>
            <span className="text-[10px] font-semibold text-[var(--bull)]">Bid</span>
            <span className="text-[10px] font-semibold text-[var(--bear)]">Ask</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 tabular-nums">
            {([10, 50, 100, 250] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTickWindow(w)}
                className={`h-5 rounded-[2px] px-1.5 text-[10px] font-semibold transition-colors duration-75 ${
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

        <div className="relative min-h-0 flex-1 overflow-hidden p-1">
          {hasTicks ? (
            <canvas ref={canvasRef} className="block h-full w-full select-none" />
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
