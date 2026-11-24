import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  LineSeries,
  type Time,
} from "lightweight-charts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Layers,
  Minus,
  MousePointer2,
  Percent,
  Search,
  ShieldAlert,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/framework/api-client";
import { useTerminalStore } from "@/framework/terminal-store";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type DrawingTool = "cursor" | "hline" | "trendline" | "fib";

interface SavedDrawings {
  hlines: number[];
  trendlines: { t1: number; p1: number; t2: number; p2: number }[];
  fibs: { high: number; low: number }[];
}

function calcEMA(bars: ChartBar[], period: number) {
  const out: { time: Time; value: number }[] = [];
  if (bars.length < period) return out;
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time as Time, value: Number(ema.toFixed(4)) });
  }
  return out;
}

function calcBollinger(bars: ChartBar[], period = 20, mult = 2) {
  const upper: { time: Time; value: number }[] = [];
  const lower: { time: Time; value: number }[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, b) => s + b.close, 0) / period;
    const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push({ time: bars[i].time as Time, value: Number((mean + mult * std).toFixed(4)) });
    lower.push({ time: bars[i].time as Time, value: Number((mean - mult * std).toFixed(4)) });
  }
  return { upper, lower };
}

interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OpenPos {
  position_ticket: number;
  account_id: string;
  account_name: string;
  currency: string;
  magic_number: number;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit_usd: number;
  mae_usd: number;
  mfe_usd: number;
  open_time: number;
}

interface DealItem {
  mt5_deal_ticket: number;
  account_id: string;
  account_name: string;
  currency: string;
  position_id: number;
  magic_number: number;
  symbol: string;
  side: "BUY" | "SELL";
  entry: "IN" | "OUT" | "INOUT";
  volume: number;
  price: number;
  net_profit_usd: number;
  time_sec: number;
}

interface ChartBundle {
  asset_code: string;
  timeframe: string;
  bars: ChartBar[];
  open_positions: OpenPos[];
  deals: DealItem[];
}

function buildPreviewBundle(asset: string, tf: Timeframe): ChartBundle {
  const stepSec =
    tf === "M1" ? 60 : tf === "M5" ? 300 : tf === "M15" ? 900 : tf === "M30" ? 1800 : tf === "H1" ? 3600 : 14400;
  const base = asset === "USTEC" ? 20810 : 2635;
  const vol = asset === "USTEC" ? 22 : 2.8;
  const now = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
  const bars: ChartBar[] = [];
  let price = base;
  for (let i = 100; i >= 0; i--) {
    const t = now - i * stepSec;
    const wave = Math.sin(i * 0.27) * vol * 0.6 + Math.cos(i * 0.11) * vol * 0.5;
    const open = Number(price.toFixed(2));
    const close = Number((open + wave).toFixed(2));
    const high = Number((Math.max(open, close) + vol * 0.45).toFixed(2));
    const low = Number((Math.min(open, close) - vol * 0.45).toFixed(2));
    bars.push({ time: t, open, high, low, close, volume: 350 + ((i * 37) % 450) });
    price = close;
  }
  const last = bars[bars.length - 1];
  const entryIdx = bars.length - 18;
  const exitIdx = bars.length - 8;
  return {
    asset_code: asset,
    timeframe: tf,
    bars,
    open_positions: [
      {
        position_ticket: 90124,
        account_id: "usd-1",
        account_name: `${asset} Pro USD`,
        currency: "USD",
        magic_number: 77701,
        symbol: asset,
        side: "BUY",
        volume: 0.25,
        open_price: Number((last.close - vol * 1.4).toFixed(2)),
        current_price: last.close,
        sl: Number((last.close - vol * 3.2).toFixed(2)),
        tp: Number((last.close + vol * 2.8).toFixed(2)),
        profit_usd: asset === "USTEC" ? 184.5 : 96.4,
        mae_usd: -28.0,
        mfe_usd: 118.2,
        open_time: bars[bars.length - 12].time,
      },
      {
        position_ticket: 90125,
        account_id: "usc-1",
        account_name: `${asset} Cent USC`,
        currency: "USC",
        magic_number: 77702,
        symbol: `${asset}c`,
        side: "BUY",
        volume: 1.5,
        open_price: Number((last.close - vol * 0.9).toFixed(2)),
        current_price: last.close,
        sl: Number((last.close - vol * 2.9).toFixed(2)),
        tp: Number((last.close + vol * 2.2).toFixed(2)),
        profit_usd: 34.2,
        mae_usd: -9.5,
        mfe_usd: 41.0,
        open_time: bars[bars.length - 7].time,
      },
    ],
    deals: [
      {
        mt5_deal_ticket: 88001,
        account_id: "usd-1",
        account_name: `${asset} Pro USD`,
        currency: "USD",
        position_id: 88001,
        magic_number: 77701,
        symbol: asset,
        side: "BUY",
        entry: "IN",
        volume: 0.3,
        price: bars[entryIdx].open,
        net_profit_usd: 0,
        time_sec: bars[entryIdx].time,
      },
      {
        mt5_deal_ticket: 88002,
        account_id: "usd-1",
        account_name: `${asset} Pro USD`,
        currency: "USD",
        position_id: 88001,
        magic_number: 77701,
        symbol: asset,
        side: "SELL",
        entry: "OUT",
        volume: 0.3,
        price: bars[exitIdx].close,
        net_profit_usd: asset === "USTEC" ? 312.8 : 148.6,
        time_sec: bars[exitIdx].time,
      },
    ],
  };
}

export function LiveAssetChart() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const currencyMode = useTerminalStore((s) => s.currencyMode);

  const [asset, setAsset] = useState<string>("XAUUSD");
  const [searchInput, setSearchInput] = useState("");
  const [isExplorerMode, setIsExplorerMode] = useState(false);
  const [explorerMeta, setExplorerMeta] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("M5");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [bundle, setBundle] = useState<ChartBundle>(() => buildPreviewBundle("XAUUSD", "M5"));
  const [isLiveSource, setIsLiveSource] = useState(false);

  // Pro Drawing Tools & Technical Indicators
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null);
  const [drawings, setDrawings] = useState<SavedDrawings>({ hlines: [], trendlines: [], fibs: [] });
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(false);
  const [showEma200, setShowEma200] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const activeToolRef = useRef<DrawingTool>(activeTool);
  const pendingPointRef = useRef<{ time: number; price: number } | null>(pendingPoint);
  activeToolRef.current = activeTool;
  pendingPointRef.current = pendingPoint;

  // Load saved drawings per symbol from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ht_drawings_${asset}`);
      if (raw) {
        setDrawings(JSON.parse(raw) as SavedDrawings);
      } else {
        setDrawings({ hlines: [], trendlines: [], fibs: [] });
      }
    } catch {
      setDrawings({ hlines: [], trendlines: [], fibs: [] });
    }
    setPendingPoint(null);
  }, [asset]);

  function updateDrawings(updater: (prev: SavedDrawings) => SavedDrawings) {
    setDrawings((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(`ht_drawings_${asset}`, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  }

  // Hotkeys 1..8 switch timeframes M1..W1
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < TIMEFRAMES.length) {
        setTimeframe(TIMEFRAMES[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load real chart bundle from backend (tracked MT5 asset OR instant any-symbol market explorer)
  useEffect(() => {
    let cancelled = false;
    const endpoint = isExplorerMode
      ? `/charts/explore?symbol=${encodeURIComponent(asset)}&timeframe=${timeframe}`
      : `/charts/${encodeURIComponent(asset)}?timeframe=${timeframe}`;

    apiRequest<ChartBundle & { name?: string; change_pct?: number }>(endpoint)
      .then((res) => {
        if (!cancelled && res.bars && res.bars.length > 0) {
          setBundle(res);
          setIsLiveSource(true);
          setExplorerMeta(res.name ? `${res.name} (${res.change_pct ?? 0}%)` : null);
        } else if (!cancelled && !isExplorerMode) {
          setBundle(buildPreviewBundle(asset, timeframe));
          setIsLiveSource(false);
          setExplorerMeta(null);
        }
      })
      .catch(() => {
        if (!cancelled && !isExplorerMode) {
          setBundle(buildPreviewBundle(asset, timeframe));
          setIsLiveSource(false);
          setExplorerMeta(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset, timeframe, isExplorerMode]);

  function handleExploreSearch(e: FormEvent) {
    e.preventDefault();
    const sym = searchInput.trim().toUpperCase();
    if (!sym) return;
    setAsset(sym);
    setIsExplorerMode(true);
    setAccountFilter("ALL");
  }

  const filteredPositions = useMemo(
    () =>
      accountFilter === "ALL"
        ? bundle.open_positions
        : bundle.open_positions.filter((p) => p.account_id === accountFilter),
    [bundle.open_positions, accountFilter],
  );

  const filteredDeals = useMemo(
    () => (accountFilter === "ALL" ? bundle.deals : bundle.deals.filter((d) => d.account_id === accountFilter)),
    [bundle.deals, accountFilter],
  );

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of bundle.open_positions) map.set(p.account_id, `${p.account_name} (${p.currency})`);
    for (const d of bundle.deals) map.set(d.account_id, `${d.account_name} (${d.currency})`);
    return Array.from(map.entries());
  }, [bundle]);

  // Mount TradingView Lightweight Charts with indicators, interactive drawings, Entry/SL/TP lines, and markers
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
      timeScale: { borderColor: "rgba(255,255,255,0.12)", timeVisible: true, secondsVisible: false },
      height: 450,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    candleSeries.setData(
      bundle.bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // Technical Indicators
    if (showEma20) {
      const s = chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, title: "EMA 20" });
      s.setData(calcEMA(bundle.bars, 20));
    }
    if (showEma50) {
      const s = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, title: "EMA 50" });
      s.setData(calcEMA(bundle.bars, 50));
    }
    if (showEma200) {
      const s = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, title: "EMA 200" });
      s.setData(calcEMA(bundle.bars, 200));
    }
    if (showBollinger) {
      const bb = calcBollinger(bundle.bars, 20, 2);
      const u = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.6)", lineWidth: 1, lineStyle: 2, title: "BB+" });
      const l = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.6)", lineWidth: 1, lineStyle: 2, title: "BB-" });
      u.setData(bb.upper);
      l.setData(bb.lower);
    }

    // User Drawings: Horizontal S/R lines
    for (const price of drawings.hlines) {
      candleSeries.createPriceLine({
        price,
        color: "#eab308",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "S/R",
      });
    }

    // User Drawings: Trendlines
    for (const tl of drawings.trendlines) {
      const pts = [
        { time: tl.t1 as Time, value: tl.p1 },
        { time: tl.t2 as Time, value: tl.p2 },
      ].sort((a, b) => Number(a.time) - Number(b.time));
      if (pts[0].time !== pts[1].time) {
        const line = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2 });
        line.setData(pts);
      }
    }

    // User Drawings: Fibonacci Retracement levels
    const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    for (const fib of drawings.fibs) {
      const diff = fib.high - fib.low;
      for (const lvl of FIB_LEVELS) {
        const p = Number((fib.high - diff * lvl).toFixed(2));
        candleSeries.createPriceLine({
          price: p,
          color: lvl === 0.618 || lvl === 0.5 ? "#f59e0b" : "#94a3b8",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `Fib ${(lvl * 100).toFixed(1)}%`,
        });
      }
    }

    // Interactive click-to-draw handler
    chart.subscribeClick((param) => {
      const tool = activeToolRef.current;
      if (tool === "cursor" || !param.point) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null || price === undefined) return;
      const roundedPrice = Number(price.toFixed(2));
      const timeSec = typeof param.time === "number" ? param.time : (bundle.bars[bundle.bars.length - 1]?.time ?? 0);

      if (tool === "hline") {
        updateDrawings((prev) => ({ ...prev, hlines: [...prev.hlines, roundedPrice] }));
        setActiveTool("cursor");
        return;
      }

      const first = pendingPointRef.current;
      if (!first) {
        setPendingPoint({ time: timeSec, price: roundedPrice });
      } else {
        if (tool === "trendline") {
          updateDrawings((prev) => ({
            ...prev,
            trendlines: [...prev.trendlines, { t1: first.time, p1: first.price, t2: timeSec, p2: roundedPrice }],
          }));
        } else if (tool === "fib") {
          updateDrawings((prev) => ({
            ...prev,
            fibs: [...prev.fibs, { high: Math.max(first.price, roundedPrice), low: Math.min(first.price, roundedPrice) }],
          }));
        }
        setPendingPoint(null);
        setActiveTool("cursor");
      }
    });

    // Draw live open positions (Entry, SL, TP) directly on chart
    for (const pos of filteredPositions) {
      candleSeries.createPriceLine({
        price: pos.open_price,
        color: pos.side === "BUY" ? "#3b82f6" : "#f97316",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `${pos.side} ${pos.volume} (${pos.currency})`,
      });
      if (pos.sl > 0) {
        candleSeries.createPriceLine({
          price: pos.sl,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `SL #${pos.position_ticket}`,
        });
      }
      if (pos.tp > 0) {
        candleSeries.createPriceLine({
          price: pos.tp,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `TP #${pos.position_ticket}`,
        });
      }
    }

    // Draw historical deal entries & exits on candles
    const sortedDeals = [...filteredDeals].sort((a, b) => a.time_sec - b.time_sec);
    if (sortedDeals.length > 0) {
      createSeriesMarkers(
        candleSeries,
        sortedDeals.map((d) => ({
          time: d.time_sec as Time,
          position: d.entry === "IN" ? "belowBar" : "aboveBar",
          color: d.entry === "IN" ? "#3b82f6" : d.net_profit_usd >= 0 ? "#10b981" : "#ef4444",
          shape: d.entry === "IN" ? "arrowUp" : "arrowDown",
          text:
            d.entry === "IN"
              ? `${d.side} ${d.volume}`
              : `${d.net_profit_usd >= 0 ? "+" : ""}$${d.net_profit_usd.toFixed(1)}`,
        })),
      );
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [bundle.bars, filteredPositions, filteredDeals, drawings, showEma20, showEma50, showEma200, showBollinger]);

  const lastBar = bundle.bars[bundle.bars.length - 1];
  const spread = asset === "USTEC" ? 1.2 : 0.22;
  const bid = lastBar ? lastBar.close : 0;
  const ask = Number((bid + spread).toFixed(2));
  const totalFloating = filteredPositions.reduce((acc, p) => acc + p.profit_usd, 0);

  const fmtMoney = (usd: number) => {
    if (privacyMode) return "••••";
    const val = currencyMode === "USC" ? usd * 100 : usd;
    const prefix = currencyMode === "USC" ? "¢" : "$";
    return `${val >= 0 ? "+" : ""}${prefix}${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  function focusTimeOnChart(timeSec: number) {
    if (!chartRef.current) return;
    chartRef.current.timeScale().setVisibleRange({
      from: (timeSec - 3600) as Time,
      to: (timeSec + 3600) as Time,
    });
  }

  return (
    <div className="space-y-4">
      {/* Asset, Instant Any-Symbol Search & Multi-Account Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["XAUUSD", "USTEC"] as const).map((code) => (
            <Button
              key={code}
              size="sm"
              variant={!isExplorerMode && asset === code ? "default" : "outline"}
              onClick={() => {
                setAsset(code);
                setIsExplorerMode(false);
                setAccountFilter("ALL");
              }}
              className="font-mono text-xs"
            >
              {code}
            </Button>
          ))}

          {/* Instant Search ANY global symbol without adding to DB */}
          <form onSubmit={handleExploreSearch} className="flex items-center gap-1">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Поиск любого актива (EURUSD, BTCUSD, NVDA...)"
              className="h-8 w-56 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary" className="h-8 gap-1 px-2.5 text-xs">
              <Search className="size-3.5" />
              Найти
            </Button>
          </form>

          <div className="bg-muted/50 flex items-center gap-1 rounded-md border border-border/60 p-0.5">
            {TIMEFRAMES.map((tf, idx) => (
              <Button
                key={tf}
                size="sm"
                variant={timeframe === tf ? "secondary" : "ghost"}
                onClick={() => setTimeframe(tf)}
                className="h-6 px-2 font-mono text-[11px]"
                title={`Хоткей: клавиша ${idx + 1}`}
              >
                {tf}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isExplorerMode ? (
            <select
              className="bg-background rounded-md border border-border px-2.5 py-1 text-xs"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="ALL">Все счета по {asset} (USD + USC)</option>
              {accountOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}

          <Badge variant={isLiveSource ? "default" : "secondary"} className="font-mono text-[11px]">
            {isExplorerMode
              ? `EXPLORER: ${explorerMeta || asset}`
              : isLiveSource
                ? "MT5 LIVE"
                : "DEMO PREVIEW (ЖДЁТ MT5 BRIDGE)"}
          </Badge>
        </div>
      </div>

      {/* Pro Drawing Tools & Technical Indicators Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground mr-1 text-[11px] font-medium">Рисование:</span>
          <Button
            size="sm"
            variant={activeTool === "cursor" ? "default" : "ghost"}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => {
              setActiveTool("cursor");
              setPendingPoint(null);
            }}
          >
            <MousePointer2 className="size-3" />
            Курсор
          </Button>
          <Button
            size="sm"
            variant={activeTool === "hline" ? "default" : "ghost"}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => {
              setActiveTool("hline");
              setPendingPoint(null);
            }}
          >
            <Minus className="size-3" />
            Уровень S/R
          </Button>
          <Button
            size="sm"
            variant={activeTool === "trendline" ? "default" : "ghost"}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => {
              setActiveTool("trendline");
              setPendingPoint(null);
            }}
          >
            <TrendingUp className="size-3" />
            Тренд (2 клика)
          </Button>
          <Button
            size="sm"
            variant={activeTool === "fib" ? "default" : "ghost"}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => {
              setActiveTool("fib");
              setPendingPoint(null);
            }}
          >
            <Percent className="size-3" />
            Фибоначчи (2 клика)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-[11px] text-rose-500"
            onClick={() => updateDrawings(() => ({ hlines: [], trendlines: [], fibs: [] }))}
          >
            <Trash2 className="size-3" />
            Очистить
          </Button>
          {pendingPoint ? (
            <Badge variant="outline" className="ml-1 animate-pulse font-mono text-[10px] text-amber-500">
              Кликните 2-ю точку на графике...
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground mr-1 text-[11px] font-medium">Индикаторы:</span>
          <Button
            size="sm"
            variant={showEma20 ? "secondary" : "ghost"}
            className="h-6 px-2 font-mono text-[11px] text-cyan-400"
            onClick={() => setShowEma20((v) => !v)}
          >
            EMA20
          </Button>
          <Button
            size="sm"
            variant={showEma50 ? "secondary" : "ghost"}
            className="h-6 px-2 font-mono text-[11px] text-amber-400"
            onClick={() => setShowEma50((v) => !v)}
          >
            EMA50
          </Button>
          <Button
            size="sm"
            variant={showEma200 ? "secondary" : "ghost"}
            className="h-6 px-2 font-mono text-[11px] text-purple-400"
            onClick={() => setShowEma200((v) => !v)}
          >
            EMA200
          </Button>
          <Button
            size="sm"
            variant={showBollinger ? "secondary" : "ghost"}
            className="h-6 px-2 font-mono text-[11px]"
            onClick={() => setShowBollinger((v) => !v)}
          >
            BB(20,2)
          </Button>
        </div>
      </div>

      {/* Main Chart + Order Flow / DOM Side Panel */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-9">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="font-mono text-base">{asset}</CardTitle>
              <span className="font-mono text-sm text-emerald-500">BID {bid.toFixed(2)}</span>
              <span className="font-mono text-sm text-rose-500">ASK {ask.toFixed(2)}</span>
              <span className="text-muted-foreground font-mono text-xs">Spread {spread}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-muted-foreground">Floating:</span>
              <span className={totalFloating >= 0 ? "text-emerald-500" : "text-rose-500"}>
                {fmtMoney(totalFloating)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            <div ref={containerRef} className="w-full" />
          </CardContent>
        </Card>

        {/* DOM / Supply & Demand & Live Pressure Panel */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="size-4 text-amber-500" />
              Спрос / Предложение (DOM)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground flex justify-between font-mono text-[11px]">
                <span>SUPPLY (ASK)</span>
                <span>LIQUIDITY</span>
              </div>
              {[3, 2, 1].map((lvl) => (
                <div key={`ask-${lvl}`} className="relative flex justify-between rounded px-2 py-1 font-mono">
                  <div
                    className="absolute inset-y-0 right-0 rounded bg-rose-500/15"
                    style={{ width: `${30 + lvl * 20}%` }}
                  />
                  <span className="relative text-rose-400">{(ask + lvl * spread * 1.5).toFixed(2)}</span>
                  <span className="relative text-muted-foreground">{(lvl * 14.5).toFixed(1)} lots</span>
                </div>
              ))}
            </div>

            <div className="border-y border-border/60 py-1.5 text-center font-mono text-sm font-semibold">
              {bid.toFixed(2)} <span className="text-muted-foreground text-[11px]">/ {ask.toFixed(2)}</span>
            </div>

            <div className="space-y-1">
              <div className="text-muted-foreground flex justify-between font-mono text-[11px]">
                <span>DEMAND (BID)</span>
                <span>LIQUIDITY</span>
              </div>
              {[1, 2, 3].map((lvl) => (
                <div key={`bid-${lvl}`} className="relative flex justify-between rounded px-2 py-1 font-mono">
                  <div
                    className="absolute inset-y-0 right-0 rounded bg-emerald-500/15"
                    style={{ width: `${28 + lvl * 22}%` }}
                  />
                  <span className="relative text-emerald-400">{(bid - lvl * spread * 1.5).toFixed(2)}</span>
                  <span className="relative text-muted-foreground">{(lvl * 16.2).toFixed(1)} lots</span>
                </div>
              ))}
            </div>

            <div className="bg-muted/40 space-y-1 rounded-lg border border-border/60 p-2.5">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1">
                  <Activity className="size-3.5 text-emerald-500" />
                  Session POC
                </span>
                <span className="font-mono">{(bid - spread * 2).toFixed(2)}</span>
              </div>
              <div className="text-muted-foreground flex justify-between text-[11px]">
                <span>Buy Pressure: 62%</span>
                <span>Sell: 38%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Synchronized Open Positions & Order History Table (Click row -> focus on chart) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Открытые ордера ({filteredPositions.length})</span>
              <span className="text-muted-foreground text-xs font-normal">Отображаются линиями на графике</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground border-y border-border/60">
                <tr>
                  <th className="px-3 py-2">Счёт</th>
                  <th className="px-3 py-2">Тип / Лот</th>
                  <th className="px-3 py-2">Entry / SL / TP</th>
                  <th className="px-3 py-2 text-right">PnL ({currencyMode})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {filteredPositions.map((p) => (
                  <tr
                    key={p.position_ticket}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => focusTimeOnChart(p.open_time)}
                  >
                    <td className="px-3 py-2 font-sans">
                      <div className="font-medium">{p.account_name}</div>
                      <div className="text-muted-foreground text-[10px]">Magic #{p.magic_number}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={p.side === "BUY" ? "default" : "destructive"} className="text-[10px]">
                        {p.side} {p.volume}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <div>{p.open_price.toFixed(2)}</div>
                      <div className="text-muted-foreground text-[10px]">
                        SL {p.sl.toFixed(2)} • TP {p.tp.toFixed(2)}
                      </div>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        p.profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {fmtMoney(p.profit_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>История входов и выходов ({filteredDeals.length})</span>
              <span className="text-muted-foreground text-xs font-normal">Клик по строке → фокус на графике</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground border-y border-border/60">
                <tr>
                  <th className="px-3 py-2">Счёт / Робот</th>
                  <th className="px-3 py-2">Событие</th>
                  <th className="px-3 py-2">Цена</th>
                  <th className="px-3 py-2 text-right">Net PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {filteredDeals.map((d) => (
                  <tr
                    key={d.mt5_deal_ticket}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => focusTimeOnChart(d.time_sec)}
                  >
                    <td className="px-3 py-2 font-sans">
                      <div className="font-medium">{d.account_name}</div>
                      <div className="text-muted-foreground text-[10px]">Magic #{d.magic_number}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        {d.entry === "IN" ? (
                          <ArrowUpRight className="size-3.5 text-blue-500" />
                        ) : (
                          <ArrowDownRight className="size-3.5 text-emerald-500" />
                        )}
                        {d.entry} {d.side} {d.volume}
                      </span>
                    </td>
                    <td className="px-3 py-2">{d.price.toFixed(2)}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        d.entry === "IN"
                          ? "text-muted-foreground"
                          : d.net_profit_usd >= 0
                            ? "text-emerald-500"
                            : "text-rose-500"
                      }`}
                    >
                      {d.entry === "IN" ? "—" : fmtMoney(d.net_profit_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {!isLiveSource ? (
        <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <ShieldAlert className="size-4 text-amber-500" />
          <span>
            Сейчас показан предпросмотр на демо-свечах. Как только подключите <code>ExnessPanelBridge.mq5</code> к
            счёту Exness, график автоматически переключится на 100% живые котировки и ордера вашего MT5.
          </span>
        </div>
      ) : null}
    </div>
  );
}
