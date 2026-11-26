import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Chart,
  dispose,
  init,
  type KLineData,
  type OverlayMode,
  registerIndicator,
} from "klinecharts";
import {
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  Redo2,
  Ruler,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
  Unlock,
} from "lucide-react";

import { apiRequest } from "@/framework/api-client";
import {
  formatProviderLabel,
  type MarketFeedHealth,
  type MarketTickEvent,
} from "@/framework/use-market-stream";

export type ChartTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";

export interface Mt5ZoneLevels {
  sellZone: number | null;
  fair: number | null;
  mean: number | null;
  buyZone: number | null;
  label?: string;
}

export interface ChartMarketStats {
  price: number;
  change_pct: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  spread_usd: number;
  spread_bps: number;
  provider: string;
  latency_ms: number;
}

export interface ChartBundleResponse {
  asset_code: string;
  timeframe: string;
  source: string;
  bars: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
  market_stats?: ChartMarketStats;
  deals?: Array<{
    id: string;
    side: string;
    entry: string;
    price: number;
    time_sec: number;
    net_profit_usd: number;
  }>;
}

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const MARKET_PROVIDERS = [
  { id: "auto", label: "Auto" },
  { id: "exness_api", label: "Exness API" },
  { id: "binance", label: "Binance" },
  { id: "bybit", label: "Bybit" },
  { id: "biquote", label: "biquote" },
  { id: "alpaca", label: "Alpaca" },
] as const;

const TF_TO_PERIOD: Record<ChartTimeframe, { span: number; type: "minute" | "hour" | "day" | "week" }> = {
  M1: { span: 1, type: "minute" },
  M5: { span: 5, type: "minute" },
  M15: { span: 15, type: "minute" },
  M30: { span: 30, type: "minute" },
  H1: { span: 1, type: "hour" },
  H4: { span: 4, type: "hour" },
  D1: { span: 1, type: "day" },
  W1: { span: 1, type: "week" },
};

const TF_SECONDS: Record<ChartTimeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
};

let mt5ZonesRegistered = false;

function ensureMt5ZonesIndicator() {
  if (mt5ZonesRegistered) return;
  mt5ZonesRegistered = true;
  registerIndicator({
    name: "MT5_ZONES",
    shortName: "MT5 ZONES",
    series: "price",
    calcParams: [],
    figures: [
      { key: "sell", title: "SELL: ", type: "line" },
      { key: "fair", title: "FAIR: ", type: "line" },
      { key: "mean", title: "MEAN: ", type: "line" },
      { key: "buy", title: "BUY: ", type: "line" },
    ],
    styles: {
      lines: [
        { style: "solid", smooth: false, size: 1, dashedValue: [2, 2], color: "#F43F5E" },
        { style: "dashed", smooth: false, size: 1, dashedValue: [2, 3], color: "#F59E0B" },
        { style: "dashed", smooth: false, size: 1, dashedValue: [6, 4], color: "#94A3B8" },
        { style: "solid", smooth: false, size: 1, dashedValue: [2, 2], color: "#10B981" },
      ],
    },
    calc: (dataList, indicator) => {
      const ext = (indicator.extendData ?? {}) as Mt5ZoneLevels;
      return dataList.map(() => ({
        sell: ext.sellZone ?? undefined,
        fair: ext.fair ?? undefined,
        mean: ext.mean ?? undefined,
        buy: ext.buyZone ?? undefined,
      }));
    },
  });
}

interface KLineChartProProps {
  symbol: string;
  mode: "portfolio" | "market";
  mt5Zones?: Mt5ZoneLevels | null;
  latestTick?: MarketTickEvent | null;
  feedHealth: MarketFeedHealth;
  feedProvider: string;
  feedLatencyMs: number | null;
  onBundleLoaded?: (bundle: ChartBundleResponse) => void;
}

type DrawingToolId =
  | "cursor"
  | "horizontalStraightLine"
  | "straightLine"
  | "parallelStraightLine"
  | "fibonacciLine"
  | "priceLine"
  | "simpleAnnotation";

export function KLineChartPro({
  symbol,
  mode,
  mt5Zones,
  latestTick,
  feedHealth,
  feedProvider,
  feedLatencyMs,
  onBundleLoaded,
}: KLineChartProProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const liveCallbackRef = useRef<((data: KLineData) => void) | null>(null);
  const lastBarRef = useRef<KLineData | null>(null);
  const overlayStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<Array<{ name: string; points: unknown[] }>>([]);

  const [timeframe, setTimeframe] = useState<ChartTimeframe>("M5");
  const [provider, setProvider] = useState<string>("auto");
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<DrawingToolId>("cursor");
  const [magnetMode, setMagnetMode] = useState<OverlayMode>("normal");
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [indicatorsMenuOpen, setIndicatorsMenuOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<string[]>(["VOL", "EMA"]);
  const [showMt5Zones, setShowMt5Zones] = useState<boolean>(mode === "portfolio");
  const [showDealMarkers, setShowDealMarkers] = useState<boolean>(mode === "portfolio");
  const [bundleDeals, setBundleDeals] = useState<NonNullable<ChartBundleResponse["deals"]>>([]);
  const [resolvedSource, setResolvedSource] = useState<string>("");
  const [bundleLatencyMs, setBundleLatencyMs] = useState<number | null>(null);
  const [loadingBars, setLoadingBars] = useState(true);
  const dealOverlayIdsRef = useRef<string[]>([]);

  const onBundleLoadedRef = useRef(onBundleLoaded);
  onBundleLoadedRef.current = onBundleLoaded;

  // Initialize KLineChart v10 instance once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    ensureMt5ZonesIndicator();

    const chart = init(el, {
      styles: {
        grid: {
          show: true,
          horizontal: { show: true, size: 1, color: "#151C28", style: "solid" },
          vertical: { show: true, size: 1, color: "#151C28", style: "solid" },
        },
        candle: {
          type: "candle_solid",
          bar: {
            upColor: "#10B981",
            downColor: "#F43F5E",
            noChangeColor: "#64748B",
            upBorderColor: "#10B981",
            downBorderColor: "#F43F5E",
            noChangeBorderColor: "#64748B",
            upWickColor: "#10B981",
            downWickColor: "#F43F5E",
            noChangeWickColor: "#64748B",
          },
          priceMark: {
            show: true,
            high: { show: true, color: "#94A3B8", textSize: 10, textFamily: "IBM Plex Mono, monospace" },
            low: { show: true, color: "#94A3B8", textSize: 10, textFamily: "IBM Plex Mono, monospace" },
            last: {
              show: true,
              upColor: "#10B981",
              downColor: "#F43F5E",
              noChangeColor: "#64748B",
              line: { show: true, style: "dashed", dashedValue: [3, 3], size: 1 },
              text: {
                show: true,
                size: 11,
                family: "IBM Plex Mono, monospace",
                color: "#0B0E14",
                paddingLeft: 4,
                paddingRight: 4,
                paddingTop: 2,
                paddingBottom: 2,
                borderRadius: 2,
              },
            },
          },
          tooltip: {
            showRule: "always",
            showType: "standard",
            legend: {
              size: 11,
              family: "IBM Plex Mono, monospace",
              color: "#94A3B8",
            },
          },
        },
        xAxis: {
          axisLine: { show: true, color: "#1E2634", size: 1 },
          tickLine: { show: true, size: 1, length: 3, color: "#1E2634" },
          tickText: { show: true, color: "#64748B", family: "IBM Plex Mono, monospace", size: 10 },
        },
        yAxis: {
          axisLine: { show: true, color: "#1E2634", size: 1 },
          tickLine: { show: true, size: 1, length: 3, color: "#1E2634" },
          tickText: { show: true, color: "#94A3B8", family: "IBM Plex Mono, monospace", size: 10 },
        },
        separator: { size: 1, color: "#1E2634", fill: true, activeBackgroundColor: "rgba(59,130,246,0.2)" },
        crosshair: {
          show: true,
          horizontal: {
            show: true,
            line: { show: true, style: "dashed", dashedValue: [3, 3], size: 1, color: "#3B82F6" },
            text: {
              show: true,
              color: "#F1F5F9",
              size: 10,
              family: "IBM Plex Mono, monospace",
              backgroundColor: "#171E2B",
              borderColor: "#2C3649",
              borderSize: 1,
              borderRadius: 2,
            },
          },
          vertical: {
            show: true,
            line: { show: true, style: "dashed", dashedValue: [3, 3], size: 1, color: "#3B82F6" },
            text: {
              show: true,
              color: "#F1F5F9",
              size: 10,
              family: "IBM Plex Mono, monospace",
              backgroundColor: "#171E2B",
              borderColor: "#2C3649",
              borderSize: 1,
              borderRadius: 2,
            },
          },
        },
      },
    });

    if (!chart) return;
    chartRef.current = chart;
    chart.setTimezone("UTC");
    chart.createIndicator("VOL", false);
    chart.createIndicator({ name: "EMA", paneId: "candle_pane" }, true);

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      liveCallbackRef.current = null;
      chartRef.current = null;
      dispose(el);
    };
  }, []);

  // Configure DataLoader and reload when symbol, timeframe, or provider changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !symbol) return;

    const precision = symbol.length === 6 && !symbol.includes("JPY") && !symbol.startsWith("XAU") ? 5 : 2;
    setLoadingBars(true);

    chart.setDataLoader({
      getBars: async ({ type, callback }) => {
        if (type === "backward") {
          callback([], false);
          return;
        }
        try {
          const qs = new URLSearchParams({
            timeframe,
            limit: "1000",
            market_only: "true",
            provider,
          });
          const bundle = await apiRequest<ChartBundleResponse>(
            `/charts/${encodeURIComponent(symbol)}?${qs.toString()}`,
          );
          const klineBars: KLineData[] = (bundle.bars ?? []).map((b) => ({
            timestamp: Number(b.time) * 1000,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume ?? 0),
          }));
          lastBarRef.current = klineBars.length > 0 ? { ...klineBars[klineBars.length - 1]! } : null;
          setResolvedSource(bundle.market_stats?.provider || bundle.source || "market_ws");
          setBundleLatencyMs(bundle.market_stats?.latency_ms ?? null);
          setBundleDeals(Array.isArray(bundle.deals) ? bundle.deals : []);
          onBundleLoadedRef.current?.(bundle);
          callback(klineBars, false);
        } catch {
          callback([], false);
        } finally {
          setLoadingBars(false);
        }
      },
      subscribeBar: ({ callback }) => {
        liveCallbackRef.current = callback;
      },
      unsubscribeBar: () => {
        liveCallbackRef.current = null;
      },
    });

    chart.setSymbol({
      ticker: symbol,
      pricePrecision: precision,
      volumePrecision: 2,
    });
    chart.setPeriod(TF_TO_PERIOD[timeframe]);
  }, [symbol, timeframe, provider]);

  // Render portfolio BUY/SELL deal entry/exit markers on chart in mode="portfolio"
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const id of dealOverlayIdsRef.current) {
      chart.removeOverlay({ id });
    }
    dealOverlayIdsRef.current = [];

    if (mode !== "portfolio" || !showDealMarkers || bundleDeals.length === 0) return;

    const createdIds: string[] = [];
    for (const d of bundleDeals.slice(0, 60)) {
      if (!d.time_sec || !(d.price > 0)) continue;
      const isBuy = d.side.toUpperCase() === "BUY";
      const label = `${isBuy ? "B" : "S"}${d.entry === "OUT" ? "✕" : ""}`;
      const id = chart.createOverlay({
        name: "simpleAnnotation",
        lock: true,
        points: [{ timestamp: d.time_sec * 1000, value: d.price }],
        extendData: label,
        styles: {
          symbol: {
            color: isBuy ? "#10B981" : "#F43F5E",
            size: 6,
          },
          text: {
            color: "#0B0E14",
            backgroundColor: isBuy ? "#10B981" : "#F43F5E",
            size: 10,
            family: "IBM Plex Mono, monospace",
            borderRadius: 2,
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 1,
            paddingBottom: 1,
          },
        },
      });
      if (typeof id === "string") createdIds.push(id);
    }
    dealOverlayIdsRef.current = createdIds;
  }, [mode, showDealMarkers, bundleDeals, timeframe]);

  // Apply live tick updates from /ws/market directly into KLineChart v10 current bar
  useEffect(() => {
    if (!latestTick || !liveCallbackRef.current) return;
    const price = latestTick.price > 0 ? latestTick.price : latestTick.bid;
    if (!(price > 0)) return;
    const bucketMs = Math.floor(latestTick.ts_ms / (TF_SECONDS[timeframe] * 1000)) * TF_SECONDS[timeframe] * 1000;
    const prev = lastBarRef.current;

    let nextBar: KLineData;
    if (prev && prev.timestamp === bucketMs) {
      nextBar = {
        timestamp: bucketMs,
        open: prev.open,
        high: Math.max(prev.high, price),
        low: Math.min(prev.low, price),
        close: price,
        volume: (prev.volume ?? 0) + (latestTick.bid_size ?? 0),
      };
    } else if (!prev || bucketMs > prev.timestamp) {
      nextBar = {
        timestamp: bucketMs,
        open: prev ? prev.close : price,
        high: price,
        low: price,
        close: price,
        volume: latestTick.bid_size ?? 0,
      };
    } else {
      return;
    }

    lastBarRef.current = nextBar;
    liveCallbackRef.current(nextBar);
  }, [latestTick, timeframe]);

  // Sync MT5 Zones custom indicator in portfolio mode
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const hasLevels =
      mode === "portfolio" &&
      showMt5Zones &&
      mt5Zones &&
      (mt5Zones.sellZone || mt5Zones.fair || mt5Zones.mean || mt5Zones.buyZone);

    chart.removeIndicator({ name: "MT5_ZONES" });
    if (hasLevels && mt5Zones) {
      chart.createIndicator(
        {
          name: "MT5_ZONES",
          paneId: "candle_pane",
          extendData: mt5Zones,
        },
        true,
      );
    }
  }, [mode, showMt5Zones, mt5Zones]);

  // Drawing tool actions
  const activateDrawingTool = useCallback(
    (tool: DrawingToolId) => {
      setActiveTool(tool);
      const chart = chartRef.current;
      if (!chart || tool === "cursor") return;
      const id = chart.createOverlay({
        name: tool,
        mode: magnetMode,
        lock: drawingsLocked,
        visible: !drawingsHidden,
        onDrawEnd: () => {
          setActiveTool("cursor");
        },
      });
      if (typeof id === "string") {
        overlayStackRef.current.push(id);
        redoStackRef.current = [];
      }
    },
    [magnetMode, drawingsLocked, drawingsHidden],
  );

  // Keyboard shortcuts: Esc (cursor), Alt+H (horizontal), Alt+T (trend), Alt+F (fib)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setActiveTool("cursor");
      } else if (e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        activateDrawingTool("horizontalStraightLine");
      } else if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        activateDrawingTool("straightLine");
      } else if (e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        activateDrawingTool("fibonacciLine");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateDrawingTool]);

  const toggleIndicator = (name: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (activeIndicators.includes(name)) {
      chart.removeIndicator({ name });
      setActiveIndicators((prev) => prev.filter((x) => x !== name));
    } else {
      const isMainOverlay = name === "EMA" || name === "MA" || name === "BOLL";
      chart.createIndicator(isMainOverlay ? { name, paneId: "candle_pane" } : name, isMainOverlay);
      setActiveIndicators((prev) => [...prev, name]);
    }
  };

  const handleUndo = () => {
    const chart = chartRef.current;
    if (!chart || overlayStackRef.current.length === 0) return;
    const lastId = overlayStackRef.current.pop();
    if (lastId) {
      const found = chart.getOverlays({ id: lastId })[0];
      if (found) {
        redoStackRef.current.push({ name: found.name, points: found.points });
      }
      chart.removeOverlay({ id: lastId });
    }
  };

  const handleRedo = () => {
    const chart = chartRef.current;
    if (!chart || redoStackRef.current.length === 0) return;
    const item = redoStackRef.current.pop();
    if (item) {
      const id = chart.createOverlay({
        name: item.name,
        points: item.points as never,
        mode: magnetMode,
        lock: drawingsLocked,
        visible: !drawingsHidden,
      });
      if (typeof id === "string") overlayStackRef.current.push(id);
    }
  };

  const handleToggleLock = () => {
    const next = !drawingsLocked;
    setDrawingsLocked(next);
    chartRef.current?.overrideOverlay({ lock: next });
  };

  const handleToggleVisibility = () => {
    const next = !drawingsHidden;
    setDrawingsHidden(next);
    chartRef.current?.overrideOverlay({ visible: !next });
  };

  const handleClearDrawings = () => {
    chartRef.current?.removeOverlay();
    overlayStackRef.current = [];
    redoStackRef.current = [];
    setActiveTool("cursor");
  };

  const cycleMagnet = () => {
    const next: OverlayMode =
      magnetMode === "normal" ? "weak_magnet" : magnetMode === "weak_magnet" ? "strong_magnet" : "normal";
    setMagnetMode(next);
    chartRef.current?.overrideOverlay({ mode: next });
  };

  const effectiveProviderLabel =
    provider !== "auto"
      ? MARKET_PROVIDERS.find((p) => p.id === provider)?.label || provider
      : feedProvider !== "Market WS"
        ? feedProvider
        : formatProviderLabel(resolvedSource || "Market WS");
  const effectiveLatency = feedLatencyMs ?? bundleLatencyMs;

  const dotColor =
    feedHealth === "live"
      ? "bg-[#10B981]"
      : feedHealth === "reconnecting" || feedHealth === "connecting"
        ? "bg-[#F59E0B]"
        : "bg-[#F43F5E]";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#0B0E14]">
      {/* CHART BAR (36px) */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#1E2634] bg-[#11161F] px-2">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`h-6 rounded-[3px] px-2 font-mono text-[11px] font-medium transition-colors duration-75 ${
                timeframe === tf
                  ? "bg-[#171E2B] text-[#3B82F6] border border-[#2C3649]"
                  : "text-[#94A3B8] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
              }`}
            >
              {tf}
            </button>
          ))}

          <div className="mx-1.5 h-4 w-px bg-[#1E2634]" />

          {/* Indicators dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIndicatorsMenuOpen((v) => !v)}
              className="inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[11px] text-[#94A3B8] transition-colors duration-75 hover:bg-[#171E2B] hover:text-[#F1F5F9]"
            >
              <SlidersHorizontal className="size-3" />
              Индикаторы
            </button>
            {indicatorsMenuOpen ? (
              <div className="absolute top-7 left-0 z-40 w-44 rounded-[4px] border border-[#2C3649] bg-[#11161F] p-1">
                {["EMA", "MA", "BOLL", "VOL", "RSI", "MACD"].map((ind) => {
                  const on = activeIndicators.includes(ind);
                  return (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => toggleIndicator(ind)}
                      className="flex w-full items-center justify-between rounded-[2px] px-2 py-1 font-mono text-[11px] text-[#F1F5F9] hover:bg-[#171E2B]"
                    >
                      <span>{ind}</span>
                      <span className={on ? "text-[#10B981]" : "text-[#64748B]"}>{on ? "ON" : "OFF"}</span>
                    </button>
                  );
                })}
                {mode === "portfolio" ? (
                  <button
                    type="button"
                    onClick={() => setShowMt5Zones((v) => !v)}
                    className="mt-1 flex w-full items-center justify-between border-t border-[#1E2634] px-2 py-1 pt-1.5 font-mono text-[11px] text-[#F1F5F9] hover:bg-[#171E2B]"
                  >
                    <span>Зоны MT5</span>
                    <span className={showMt5Zones ? "text-[#10B981]" : "text-[#64748B]"}>
                      {showMt5Zones ? "ON" : "OFF"}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {mode === "portfolio" && mt5Zones && (mt5Zones.sellZone || mt5Zones.buyZone) ? (
            <button
              type="button"
              onClick={() => setShowMt5Zones((v) => !v)}
              className={`ml-1 inline-flex h-6 items-center gap-1 rounded-[3px] border px-2 font-mono text-[10px] transition-colors duration-75 ${
                showMt5Zones
                  ? "border-[#2C3649] bg-[#171E2B] text-[#F59E0B]"
                  : "border-transparent text-[#64748B] hover:text-[#94A3B8]"
              }`}
              title="Зоны MT5 (SELL / FAIR / MEAN / BUY)"
            >
              <Layers className="size-3" />
              Зоны MT5
            </button>
          ) : null}

          {mode === "portfolio" && bundleDeals.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowDealMarkers((v) => !v)}
              className={`inline-flex h-6 items-center gap-1 rounded-[3px] border px-2 font-mono text-[10px] transition-colors duration-75 ${
                showDealMarkers
                  ? "border-[#2C3649] bg-[#171E2B] text-[#10B981]"
                  : "border-transparent text-[#64748B] hover:text-[#94A3B8]"
              }`}
              title="Показать / скрыть маркеры сделок на графике"
            >
              Сделки ({bundleDeals.length})
            </button>
          ) : null}
        </div>

        {/* Right side: Provider selector badge (NEVER MT5 Bridge!) */}
        <div className="relative flex items-center gap-2">
          {loadingBars ? (
            <span className="h-2.5 w-16 rounded-[2px] bg-[#171E2B] ht-shimmer-bar" />
          ) : null}
          <button
            type="button"
            onClick={() => setProviderMenuOpen((v) => !v)}
            className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-[#1E2634] bg-[#0B0E14] px-2 font-mono text-[10px] text-[#94A3B8] transition-colors duration-75 hover:border-[#2C3649] hover:text-[#F1F5F9]"
            title="Источник рыночных котировок (только прямые Market WS)"
          >
            <span className={`inline-block size-1.5 rounded-full ${dotColor}`} />
            <span>{effectiveProviderLabel}</span>
            {effectiveLatency !== null ? (
              <span className="text-[#64748B] tabular-nums">· {effectiveLatency}ms</span>
            ) : null}
          </button>

          {providerMenuOpen ? (
            <div className="absolute top-7 right-0 z-40 w-40 rounded-[4px] border border-[#2C3649] bg-[#11161F] p-1">
              <div className="px-2 py-1 text-[10px] text-[#64748B]">Провайдер графика</div>
              {MARKET_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id);
                    setProviderMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-[2px] px-2 py-1 font-mono text-[11px] hover:bg-[#171E2B] ${
                    provider === p.id ? "text-[#3B82F6]" : "text-[#F1F5F9]"
                  }`}
                >
                  <span>{p.label}</span>
                  {provider === p.id ? <span className="text-[10px]">●</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* BODY: LEFT DRAWING TOOLBAR (40px) + KLINECHART CANVAS */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[#1E2634] bg-[#11161F] py-1.5">
          <ToolButton
            active={activeTool === "cursor"}
            title="Курсор (Esc)"
            onClick={() => activateDrawingTool("cursor")}
          >
            <MousePointer2 className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "horizontalStraightLine"}
            title="Горизонтальный уровень (Alt+H)"
            onClick={() => activateDrawingTool("horizontalStraightLine")}
          >
            <Minus className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "straightLine"}
            title="Линия тренда (Alt+T)"
            onClick={() => activateDrawingTool("straightLine")}
          >
            <TrendingUp className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "parallelStraightLine"}
            title="Параллельный канал"
            onClick={() => activateDrawingTool("parallelStraightLine")}
          >
            <GitBranch className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "fibonacciLine"}
            title="Коррекция Фибоначчи (Alt+F)"
            onClick={() => activateDrawingTool("fibonacciLine")}
          >
            <Layers className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "priceLine"}
            title="Линейка / Ценовой уровень"
            onClick={() => activateDrawingTool("priceLine")}
          >
            <Ruler className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={activeTool === "simpleAnnotation"}
            title="Аннотация / Текст"
            onClick={() => activateDrawingTool("simpleAnnotation")}
          >
            <Type className="size-3.5" />
          </ToolButton>

          <div className="my-1 h-px w-6 bg-[#1E2634]" />

          <ToolButton
            active={magnetMode !== "normal"}
            title={`Магнит: ${magnetMode}`}
            onClick={cycleMagnet}
          >
            <Magnet className="size-3.5" />
          </ToolButton>
          <ToolButton
            active={drawingsLocked}
            title={drawingsLocked ? "Разблокировать объекты" : "Заблокировать объекты"}
            onClick={handleToggleLock}
          >
            {drawingsLocked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </ToolButton>
          <ToolButton
            active={drawingsHidden}
            title={drawingsHidden ? "Показать объекты" : "Скрыть объекты"}
            onClick={handleToggleVisibility}
          >
            {drawingsHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </ToolButton>

          <div className="my-1 h-px w-6 bg-[#1E2634]" />

          <ToolButton active={false} title="Отменить (Undo)" onClick={handleUndo}>
            <Undo2 className="size-3.5" />
          </ToolButton>
          <ToolButton active={false} title="Повторить (Redo)" onClick={handleRedo}>
            <Redo2 className="size-3.5" />
          </ToolButton>
          <ToolButton active={false} title="Очистить все объекты" onClick={handleClearDrawings}>
            <Trash2 className="size-3.5 text-[#F43F5E]" />
          </ToolButton>
        </div>

        {/* KLineChart v10 Canvas */}
        <div className="relative min-h-0 min-w-0 flex-1 bg-[#0B0E14]">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-[3px] transition-colors duration-75 ${
        active
          ? "border border-[#3B82F6] bg-[#171E2B] text-[#3B82F6]"
          : "text-[#64748B] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
      }`}
    >
      {children}
    </button>
  );
}
