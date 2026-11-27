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
  ChevronsRight,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  Loader2,
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
import { TerminalDropdown } from "@/framework/templates";
import {
  formatProviderLabel,
  type MarketFeedHealth,
  type MarketTickEvent,
} from "@/framework/use-market-stream";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

function getSymbolPricePrecision(sym: string): number {
  const s = sym.trim().toUpperCase();
  const jpyPairs = new Set(["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY", "NZDJPY"]);
  if (jpyPairs.has(s)) return 3;
  const fx5Pairs = new Set([
    "EURUSD",
    "GBPUSD",
    "USDCHF",
    "USDCAD",
    "AUDUSD",
    "NZDUSD",
    "EURGBP",
    "EURAUD",
    "EURCHF",
    "AUDCAD",
    "AUDNZD",
    "GBPCHF",
  ]);
  if (fx5Pairs.has(s)) return 5;
  return 2;
}

function buildKLineChartStyles(isDark: boolean) {
  const gridColor = isDark ? "#151C28" : "#E2E8F0";
  const axisLine = isDark ? "#1E2634" : "#CBD5E1";
  const axisText = isDark ? "#94A3B8" : "#475569";
  const xAxisText = isDark ? "#64748B" : "#475569";
  const bull = isDark ? "#10B981" : "#059669";
  const bear = isDark ? "#F43F5E" : "#E11D48";
  const crossLine = isDark ? "#3B82F6" : "#64748B";
  const crossTextBg = isDark ? "#171E2B" : "#0F172A";
  const crossTextColor = isDark ? "#F1F5F9" : "#FFFFFF";
  const lastPriceText = isDark ? "#0B0E14" : "#FFFFFF";

  return {
    grid: {
      show: true,
      horizontal: { show: true, size: 1, color: gridColor, style: "solid" as const },
      vertical: { show: true, size: 1, color: gridColor, style: "solid" as const },
    },
    candle: {
      type: "candle_solid" as const,
      bar: {
        upColor: bull,
        downColor: bear,
        noChangeColor: "#64748B",
        upBorderColor: bull,
        downBorderColor: bear,
        noChangeBorderColor: "#64748B",
        upWickColor: bull,
        downWickColor: bear,
        noChangeWickColor: "#64748B",
      },
      priceMark: {
        show: true,
        high: { show: true, color: axisText, textSize: 10, textFamily: "IBM Plex Mono, monospace" },
        low: { show: true, color: axisText, textSize: 10, textFamily: "IBM Plex Mono, monospace" },
        last: {
          show: true,
          upColor: bull,
          downColor: bear,
          noChangeColor: "#64748B",
          line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1 },
          text: {
            show: true,
            size: 11,
            family: "IBM Plex Mono, monospace",
            color: lastPriceText,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 2,
          },
        },
      },
      tooltip: {
        showRule: "always" as const,
        showType: "standard" as const,
        legend: {
          size: 11,
          family: "IBM Plex Mono, monospace",
          color: axisText,
        },
      },
    },
    xAxis: {
      axisLine: { show: true, color: axisLine, size: 1 },
      tickLine: { show: true, size: 1, length: 3, color: axisLine },
      tickText: { show: true, color: xAxisText, family: "IBM Plex Mono, monospace", size: 10 },
    },
    yAxis: {
      axisLine: { show: true, color: axisLine, size: 1 },
      tickLine: { show: true, size: 1, length: 3, color: axisLine },
      tickText: { show: true, color: axisText, family: "IBM Plex Mono, monospace", size: 10 },
    },
    separator: { size: 1, color: axisLine, fill: true, activeBackgroundColor: "rgba(59,130,246,0.2)" },
    crosshair: {
      show: true,
      horizontal: {
        show: true,
        line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1, color: crossLine },
        text: {
          show: true,
          color: crossTextColor,
          size: 10,
          family: "IBM Plex Mono, monospace",
          backgroundColor: crossTextBg,
          borderColor: axisLine,
          borderSize: 1,
          borderRadius: 2,
        },
      },
      vertical: {
        show: true,
        line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1, color: crossLine },
        text: {
          show: true,
          color: crossTextColor,
          size: 10,
          family: "IBM Plex Mono, monospace",
          backgroundColor: crossTextBg,
          borderColor: axisLine,
          borderSize: 1,
          borderRadius: 2,
        },
      },
    },
  };
}

export type ChartTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";

export interface Mt5ZoneLevels {
  sellZone: number | null;
  fair: number | null;
  mean: number | null;
  buyZone: number | null;
  label?: string;
}

export interface Mt5ZonePoint {
  bar_time: number;
  sell: number | null;
  mean: number | null;
  fair: number | null;
  buy: number | null;
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
  has_more?: boolean;
  mt5_zones_series?: Mt5ZonePoint[];
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
  { id: "auto", label: "Auto (Лучший)" },
  { id: "binance", label: "Binance Vision" },
  { id: "tiingo", label: "Tiingo FX" },
  { id: "alpaca", label: "Alpaca IEX" },
  { id: "yahoo", label: "Yahoo Finance" },
  { id: "stooq", label: "Stooq Daily" },
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

const INDICATORS_STORAGE_KEY = "ht_chart_indicators_v1";
const ALLOWED_INDICATORS = new Set(["EMA", "MA", "BOLL", "VOL", "RSI", "MACD"]);

function loadSavedIndicators(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INDICATORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && ALLOWED_INDICATORS.has(x));
  } catch {
    return [];
  }
}

function saveIndicators(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INDICATORS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage quota / private mode
  }
}

interface Mt5ZonesExtendData {
  levels?: Mt5ZoneLevels | null;
  series?: Mt5ZonePoint[];
}

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
        { style: "solid", smooth: false, size: 1.5, dashedValue: [2, 2], color: "#F43F5E" },
        { style: "dashed", smooth: false, size: 1, dashedValue: [2, 3], color: "#F59E0B" },
        { style: "dashed", smooth: false, size: 1, dashedValue: [6, 4], color: "#94A3B8" },
        { style: "solid", smooth: false, size: 1.5, dashedValue: [2, 2], color: "#10B981" },
      ],
      lastValueMark: {
        show: true,
        text: {
          show: true,
          color: "#FFFFFF",
          size: 10,
          family: "IBM Plex Mono, monospace",
          weight: "normal",
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
          borderRadius: 2,
        },
      },
    },
    calc: (dataList, indicator) => {
      const ext = (indicator.extendData ?? {}) as Mt5ZonesExtendData;
      const levels = ext.levels ?? null;
      const series = ext.series ?? [];

      if (series.length > 0) {
        const sorted = [...series].sort((a, b) => a.bar_time - b.bar_time);
        let cursor = 0;
        let lastMatched: Mt5ZonePoint | null = null;
        return dataList.map((bar) => {
          const barSec = Math.floor(bar.timestamp / 1000);
          while (cursor < sorted.length && sorted[cursor]!.bar_time <= barSec) {
            lastMatched = sorted[cursor]!;
            cursor += 1;
          }
          if (lastMatched) {
            return {
              sell: lastMatched.sell ?? undefined,
              fair: lastMatched.fair ?? undefined,
              mean: lastMatched.mean ?? undefined,
              buy: lastMatched.buy ?? undefined,
            };
          }
          return {
            sell: undefined,
            fair: undefined,
            mean: undefined,
            buy: undefined,
          };
        });
      }

      if (levels && (levels.sellZone || levels.fair || levels.mean || levels.buyZone)) {
        return dataList.map(() => ({
          sell: levels.sellZone ?? undefined,
          fair: levels.fair ?? undefined,
          mean: levels.mean ?? undefined,
          buy: levels.buyZone ?? undefined,
        }));
      }

      return dataList.map(() => ({}));
    },
  });
}

interface KLineChartProProps {
  symbol: string;
  mode: "portfolio" | "market";
  mt5Zones?: Mt5ZoneLevels | null;
  mt5ZonesSeries?: Mt5ZonePoint[];
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
  mt5ZonesSeries,
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
  // Clean chart by default (zero built-in EMA/VOL unless explicitly enabled by user in localStorage)
  const [activeIndicators, setActiveIndicators] = useState<string[]>(() => loadSavedIndicators());
  const [showMt5Zones, setShowMt5Zones] = useState<boolean>(mode === "portfolio");
  const [showDealMarkers, setShowDealMarkers] = useState<boolean>(mode === "portfolio");
  const [bundleDeals, setBundleDeals] = useState<NonNullable<ChartBundleResponse["deals"]>>([]);
  const [bundleZoneSeries, setBundleZoneSeries] = useState<Mt5ZonePoint[]>([]);
  const [resolvedSource, setResolvedSource] = useState<string>("");
  const [bundleLatencyMs, setBundleLatencyMs] = useState<number | null>(null);
  const [loadingBars, setLoadingBars] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const dealOverlayIdsRef = useRef<string[]>([]);

  const onBundleLoadedRef = useRef(onBundleLoaded);
  onBundleLoadedRef.current = onBundleLoaded;

  const resolvedThemeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const isDark = resolvedThemeMode !== "light";

  // Initialize KLineChart v10 instance once (clean candles only, restoring user-saved indicators if any)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    ensureMt5ZonesIndicator();

    const chart = init(el, {
      styles: buildKLineChartStyles(isDark),
    });

    if (!chart) return;
    chartRef.current = chart;
    chart.setTimezone("UTC");

    // Protect against dragging too far forward into empty future space or past oldest bar
    chart.setOffsetRightDistance(64);
    chart.setMaxOffsetRightDistance(120);
    chart.setMaxOffsetLeftDistance(80);

    const handleVisibleRangeChange = (range: unknown) => {
      const r = range as { from?: number; to?: number } | null;
      const total = chart.getDataList().length;
      if (!r || typeof r.to !== "number" || total === 0) {
        setScrolledAway(false);
        return;
      }
      setScrolledAway(r.to < total - 3);
    };
    chart.subscribeAction("onVisibleRangeChange", handleVisibleRangeChange);

    const saved = loadSavedIndicators();
    for (const name of saved) {
      const isMainOverlay = name === "EMA" || name === "MA" || name === "BOLL";
      chart.createIndicator(isMainOverlay ? { name, paneId: "candle_pane" } : name, isMainOverlay);
    }

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(el);

    return () => {
      chart.unsubscribeAction("onVisibleRangeChange", handleVisibleRangeChange);
      ro.disconnect();
      liveCallbackRef.current = null;
      chartRef.current = null;
      dispose(el);
    };
  }, []);

  // Dynamically repaint KLineChart v10 whenever Light/Dark theme switches
  useEffect(() => {
    chartRef.current?.setStyles(buildKLineChartStyles(isDark));
  }, [isDark]);

  // Configure DataLoader with initial load + dynamic older-history scroll pagination (type === "forward")
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !symbol) return;

    const precision = getSymbolPricePrecision(symbol);
    setLoadingBars(true);
    setLoadingOlder(false);

    chart.setDataLoader({
      getBars: async ({ type, timestamp, callback }) => {
        if (type === "backward") {
          callback([], { forward: true, backward: false });
          return;
        }
        const isOlderChunk = type === "forward" && typeof timestamp === "number" && timestamp > 0;
        if (isOlderChunk) {
          setLoadingOlder(true);
        } else {
          setLoadingBars(true);
        }
        try {
          const qs = new URLSearchParams({
            timeframe,
            limit: "1000",
            market_only: "true",
            provider,
          });
          if (isOlderChunk) {
            qs.set("before", String(Math.floor(timestamp / 1000)));
          }
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

          if (!isOlderChunk) {
            lastBarRef.current = klineBars.length > 0 ? { ...klineBars[klineBars.length - 1]! } : null;
            setResolvedSource(bundle.market_stats?.provider || bundle.source || "market_ws");
            setBundleLatencyMs(bundle.market_stats?.latency_ms ?? null);
            setBundleDeals(Array.isArray(bundle.deals) ? bundle.deals : []);
            setBundleZoneSeries(Array.isArray(bundle.mt5_zones_series) ? bundle.mt5_zones_series : []);
            onBundleLoadedRef.current?.(bundle);
          }

          const hasMore = Boolean(bundle.has_more && klineBars.length > 0);
          callback(klineBars, { forward: hasMore, backward: false });
        } catch {
          callback([], { forward: false, backward: false });
        } finally {
          if (isOlderChunk) {
            setLoadingOlder(false);
          } else {
            setLoadingBars(false);
          }
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

  // Sync MT5 Zones custom indicator in portfolio mode (supports both continuous series & scalar levels)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const mergedMap = new Map<number, Mt5ZonePoint>();
    for (const pt of bundleZoneSeries) {
      mergedMap.set(pt.bar_time, pt);
    }
    for (const pt of mt5ZonesSeries ?? []) {
      mergedMap.set(pt.bar_time, pt);
    }
    const mergedSeries = Array.from(mergedMap.values()).sort((a, b) => a.bar_time - b.bar_time);
    const hasLevels =
      mode === "portfolio" &&
      showMt5Zones &&
      (mergedSeries.length > 0 ||
        Boolean(mt5Zones && (mt5Zones.sellZone || mt5Zones.fair || mt5Zones.mean || mt5Zones.buyZone)));

    chart.removeIndicator({ name: "MT5_ZONES" });
    if (hasLevels) {
      chart.createIndicator(
        {
          name: "MT5_ZONES",
          paneId: "candle_pane",
          extendData: { levels: mt5Zones ?? null, series: mergedSeries } satisfies Mt5ZonesExtendData,
        },
        true,
      );
    }
  }, [mode, showMt5Zones, mt5Zones, mt5ZonesSeries, bundleZoneSeries]);

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
      setActiveIndicators((prev) => {
        const next = prev.filter((x) => x !== name);
        saveIndicators(next);
        return next;
      });
    } else {
      const isMainOverlay = name === "EMA" || name === "MA" || name === "BOLL";
      chart.createIndicator(isMainOverlay ? { name, paneId: "candle_pane" } : name, isMainOverlay);
      setActiveIndicators((prev) => {
        const next = [...prev, name];
        saveIndicators(next);
        return next;
      });
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
    resolvedSource
      ? formatProviderLabel(resolvedSource)
      : provider !== "auto"
        ? MARKET_PROVIDERS.find((p) => p.id === provider)?.label || provider
        : feedProvider !== "Market WS"
          ? feedProvider
          : "Market WS";
  const effectiveLatency = feedLatencyMs ?? bundleLatencyMs;

  const dotColor =
    feedHealth === "live"
      ? "bg-[var(--bull)]"
      : feedHealth === "reconnecting" || feedHealth === "connecting"
        ? "bg-[var(--accent-amber)]"
        : "bg-[var(--bear)]";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--bg-canvas)]">
      {/* CHART BAR (36px) */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`h-6 shrink-0 whitespace-nowrap rounded-[3px] px-2 font-mono text-[11px] font-medium transition-colors duration-75 ${
                timeframe === tf
                  ? "bg-[var(--bg-elevated)] text-[var(--accent-blue)] border border-[var(--border-strong)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tf}
            </button>
          ))}

          <div className="mx-1.5 h-4 w-px shrink-0 bg-[var(--border-subtle)]" />

          {/* Indicators dropdown (Portal-based: never clipped by overflow-x-auto) */}
          <TerminalDropdown
            open={indicatorsMenuOpen}
            onOpenChange={setIndicatorsMenuOpen}
            align="left"
            widthClassName="w-44"
            trigger={
              <button
                type="button"
                onClick={() => setIndicatorsMenuOpen((v) => !v)}
                className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-[3px] px-2 text-[11px] text-[var(--text-secondary)] transition-colors duration-75 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <SlidersHorizontal className="size-3 shrink-0" />
                + Индикаторы{activeIndicators.length > 0 ? ` (${activeIndicators.length})` : ""}
              </button>
            }
          >
            {["EMA", "MA", "BOLL", "VOL", "RSI", "MACD"].map((ind) => {
              const on = activeIndicators.includes(ind);
              return (
                <button
                  key={ind}
                  type="button"
                  onClick={() => toggleIndicator(ind)}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                >
                  <span>{ind}</span>
                  <span className={on ? "text-[var(--bull)]" : "text-[var(--text-muted)]"}>{on ? "ON" : "OFF"}</span>
                </button>
              );
            })}
            {mode === "portfolio" ? (
              <button
                type="button"
                onClick={() => setShowMt5Zones((v) => !v)}
                className="mt-1 flex w-full items-center justify-between border-t border-[var(--border-subtle)] px-2 py-1 pt-1.5 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              >
                <span>Зоны MT5</span>
                <span className={showMt5Zones ? "text-[var(--bull)]" : "text-[var(--text-muted)]"}>
                  {showMt5Zones ? "ON" : "OFF"}
                </span>
              </button>
            ) : null}
          </TerminalDropdown>

          {mode === "portfolio" && mt5Zones && (mt5Zones.sellZone || mt5Zones.buyZone) ? (
            <button
              type="button"
              onClick={() => setShowMt5Zones((v) => !v)}
              className={`ml-1 inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-[3px] border px-2 font-mono text-[10px] transition-colors duration-75 ${
                showMt5Zones
                  ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--accent-amber)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title="Зоны MT5 (SELL / FAIR / MEAN / BUY)"
            >
              <Layers className="size-3 shrink-0" />
              Зоны MT5
            </button>
          ) : null}

          {mode === "portfolio" && bundleDeals.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowDealMarkers((v) => !v)}
              className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-[3px] border px-2 font-mono text-[10px] transition-colors duration-75 ${
                showDealMarkers
                  ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--bull)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title="Показать / скрыть маркеры сделок на графике"
            >
              Сделки ({bundleDeals.length})
            </button>
          ) : null}
        </div>

        {/* Right side: Single API Provider selector + live status dot (Portal-based) */}
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {loadingBars ? (
            <span className="h-2.5 w-12 shrink-0 rounded-[2px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
          ) : null}
          <TerminalDropdown
            open={providerMenuOpen}
            onOpenChange={setProviderMenuOpen}
            align="right"
            widthClassName="w-44"
            trigger={
              <button
                type="button"
                onClick={() => setProviderMenuOpen((v) => !v)}
                className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-mono text-[10px] text-[var(--text-secondary)] transition-colors duration-75 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                title="Переключить API-источник графика"
              >
                <span className={`inline-block size-1.5 shrink-0 rounded-full ${dotColor}`} />
                <span>{effectiveProviderLabel}</span>
                {effectiveLatency !== null ? (
                  <span className="text-[var(--text-muted)] tabular-nums">· {effectiveLatency}ms</span>
                ) : null}
              </button>
            }
          >
            <div className="px-2 py-1 text-[10px] text-[var(--text-muted)]">Провайдер графика</div>
            {MARKET_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProvider(p.id);
                  setProviderMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-[2px] px-2 py-1 font-mono text-[11px] hover:bg-[var(--bg-elevated)] ${
                  provider === p.id ? "text-[var(--accent-blue)]" : "text-[var(--text-primary)]"
                }`}
              >
                <span>{p.label}</span>
                {provider === p.id ? <span className="text-[10px]">●</span> : null}
              </button>
            ))}
          </TerminalDropdown>
        </div>
      </div>

      {/* BODY: LEFT DRAWING TOOLBAR (40px) + KLINECHART CANVAS */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] py-1.5">
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

          <div className="my-1 h-px w-6 bg-[var(--border-subtle)]" />

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

          <div className="my-1 h-px w-6 bg-[var(--border-subtle)]" />

          <ToolButton active={false} title="Отменить (Undo)" onClick={handleUndo}>
            <Undo2 className="size-3.5" />
          </ToolButton>
          <ToolButton active={false} title="Повторить (Redo)" onClick={handleRedo}>
            <Redo2 className="size-3.5" />
          </ToolButton>
          <ToolButton active={false} title="Очистить все объекты" onClick={handleClearDrawings}>
            <Trash2 className="size-3.5 text-[var(--bear)]" />
          </ToolButton>
        </div>

        {/* KLineChart v10 Canvas */}
        <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
          <div ref={containerRef} className="h-full w-full" />

          {/* Subtle chart-level pill when dynamically loading older history */}
          {loadingOlder ? (
            <div className="pointer-events-none absolute bottom-10 left-3 z-20 inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)]/95 px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
              <Loader2 className="size-3 animate-spin text-[var(--accent-blue)]" />
              Подгрузка истории...
            </div>
          ) : null}

          {/* Jump back to latest live candle button (appears when user scrolls into history) */}
          {scrolledAway ? (
            <button
              type="button"
              onClick={() => {
                chartRef.current?.scrollToRealTime(200);
                setScrolledAway(false);
              }}
              className="absolute right-[72px] bottom-10 z-20 inline-flex h-7 items-center gap-1 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)]/95 px-2.5 font-mono text-[11px] font-medium text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
              title="Вернуться к последней live-свече"
            >
              <span>К текущим</span>
              <ChevronsRight className="size-3.5" />
            </button>
          ) : null}
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
          ? "border border-[var(--accent-blue)] bg-[var(--bg-elevated)] text-[var(--accent-blue)]"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}
