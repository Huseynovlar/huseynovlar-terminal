import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  LineSeries,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { Minus, MousePointer2, Percent, RefreshCw, Save, Trash2, TrendingUp } from "lucide-react";

import {
  calcBollinger,
  calcEMA,
  calcRSI,
  calcVWAP,
  type OhlcBar,
} from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { useLiveEvents } from "@/framework/use-live-socket";

export const CHART_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];
type DrawingTool = "cursor" | "hline" | "trendline" | "fib";

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

interface IndicatorConfig {
  zones: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  bb: boolean;
  vwap: boolean;
  rsi: boolean;
}

interface DrawingRecord {
  type: "hline" | "trendline" | "fib";
  price?: number;
  t1?: number;
  p1?: number;
  t2?: number;
  p2?: number;
  high?: number;
  low?: number;
}

interface ChartStatePayload {
  timeframe?: string;
  indicators_json?: Partial<IndicatorConfig>;
  drawings_json?: DrawingRecord[];
  filters_json?: Record<string, unknown>;
  updated_at?: string | null;
}

export interface ChartOpenPosition {
  position_ticket?: number;
  symbol?: string;
  side?: string;
  volume?: number;
  open_price?: number;
  current_price?: number;
  sl?: number;
  tp?: number;
  profit_usd?: number;
}

export interface ChartDealMarkerItem {
  id?: string;
  side?: string;
  entry?: string;
  volume?: number;
  price?: number;
  net_profit_usd?: number;
  time_sec?: number;
}

export interface ChartBundleData {
  asset_code?: string;
  symbol?: string;
  timeframe: string;
  source?: string;
  bars: OhlcBar[];
  chart_state?: ChartStatePayload | null;
  open_positions?: ChartOpenPosition[];
  deals?: ChartDealMarkerItem[];
}

export interface RobotZoneLevels {
  sellZone?: number | null;
  fair?: number | null;
  mean?: number | null;
  buyZone?: number | null;
  label?: string;
}

interface InteractiveChartCanvasProps {
  symbol: string;
  mode?: "hub" | "explore";
  height?: number;
  robotZones?: RobotZoneLevels | null;
  onDataLoaded?: (bundle: ChartBundleData) => void;
}

const DEFAULT_INDICATORS: IndicatorConfig = {
  zones: true,
  ema20: false,
  ema50: false,
  ema200: false,
  bb: true,
  vwap: true,
  rsi: false,
};

function formatSourceBadge(rawSource: string): string {
  if (rawSource === "mt5_merged") return "MT5 + История";
  if (rawSource === "mt5_live" || rawSource === "mt5_db") return "MT5 Поток";
  if (rawSource === "market_history" || rawSource === "yahoo_fallback" || rawSource === "yahoo") {
    return "История + Live WS";
  }
  return rawSource || "Live WS";
}

export function InteractiveChartCanvas({
  symbol,
  mode = "hub",
  height = 460,
  robotZones,
  onDataLoaded,
}: InteractiveChartCanvasProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const lastBarRef = useRef<OhlcBar | null>(null);
  const stateHydratedSymbolRef = useRef<string>("");

  const [timeframe, setTimeframe] = useState<ChartTimeframe>(mode === "hub" ? "M5" : "H1");
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS);
  const [drawings, setDrawings] = useState<DrawingRecord[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null);

  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [openPositions, setOpenPositions] = useState<ChartOpenPosition[]>([]);
  const [dealItems, setDealItems] = useState<ChartDealMarkerItem[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanSymbol = symbol.trim().toUpperCase();
  const canonSymbol = canonicalMarketSymbol(cleanSymbol);

  // Reset per-symbol state cleanly when switching hubs
  useEffect(() => {
    setLivePrice(null);
    stateHydratedSymbolRef.current = "";
  }, [cleanSymbol]);

  // 1. In explore mode only, hydrate saved chart state separately (hub mode receives chart_state inside /charts/{code})
  useEffect(() => {
    if (!cleanSymbol || mode === "hub") return;
    let active = true;
    apiRequest<ChartStatePayload>(`/charts/state/${encodeURIComponent(cleanSymbol)}`)
      .then((state) => {
        if (!active || !state?.updated_at) return;
        if (state.timeframe && (CHART_TIMEFRAMES as readonly string[]).includes(state.timeframe)) {
          setTimeframe(state.timeframe as ChartTimeframe);
        }
        if (state.indicators_json && typeof state.indicators_json === "object") {
          setIndicators({ ...DEFAULT_INDICATORS, ...state.indicators_json });
        }
        if (Array.isArray(state.drawings_json)) {
          setDrawings(state.drawings_json);
        }
      })
      .catch(() => {
        // Keep defaults
      });
    return () => {
      active = false;
    };
  }, [cleanSymbol, mode]);

  // 2. Fetch multi-day OHLC bars + open positions + deals over WebSocket RPC
  const loadBars = useCallback(async () => {
    if (!cleanSymbol) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        mode === "explore"
          ? `/charts/explore?symbol=${encodeURIComponent(cleanSymbol)}&timeframe=${timeframe}`
          : `/charts/${encodeURIComponent(cleanSymbol)}?timeframe=${timeframe}&limit=1000`;
      const res = await apiRequest<ChartBundleData>(endpoint);

      // Hydrate saved state once per symbol from bundle (if user previously saved drawings/indicators)
      if (mode === "hub" && stateHydratedSymbolRef.current !== cleanSymbol) {
        stateHydratedSymbolRef.current = cleanSymbol;
        const st = res.chart_state;
        if (st && st.updated_at) {
          if (st.indicators_json && typeof st.indicators_json === "object") {
            setIndicators({
              ...DEFAULT_INDICATORS,
              ...st.indicators_json,
              // Ensure MT5 zones remain visible unless explicitly toggled off
              zones: st.indicators_json.zones ?? true,
            });
          }
          if (Array.isArray(st.drawings_json)) {
            setDrawings(st.drawings_json);
          }
          if (
            st.timeframe &&
            (CHART_TIMEFRAMES as readonly string[]).includes(st.timeframe) &&
            st.timeframe !== timeframe
          ) {
            setTimeframe(st.timeframe as ChartTimeframe);
            return;
          }
        }
      }

      // Deduplicate timestamps strictly so Lightweight Charts never receives duplicate bar times
      const byTime = new Map<number, OhlcBar>();
      if (Array.isArray(res.bars)) {
        for (const b of res.bars) {
          const bt = Number(b.time);
          const cl = Number(b.close);
          if (Number.isFinite(bt) && bt > 0 && Number.isFinite(cl) && cl > 0) {
            byTime.set(bt, {
              time: bt,
              open: Number(b.open ?? cl),
              high: Number(b.high ?? cl),
              low: Number(b.low ?? cl),
              close: cl,
              volume: Number(b.volume ?? 0),
            });
          }
        }
      }
      const validBars = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
      setBars(validBars);
      setOpenPositions(Array.isArray(res.open_positions) ? res.open_positions : []);
      setDealItems(Array.isArray(res.deals) ? res.deals : []);
      setSourceLabel(formatSourceBadge(res.source ?? ""));
      onDataLoaded?.(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setBars([]);
    } finally {
      setLoading(false);
    }
  }, [cleanSymbol, mode, onDataLoaded, timeframe]);

  useEffect(() => {
    void loadBars();
  }, [loadBars]);

  // 3. Real-time live candle updates via /api/v1/ws/live (Tiingo FX, Binance Vision, Alpaca IEX, MT5 Bridge)
  useLiveEvents(["tick", "bar_update", "snapshot"], (evt) => {
    const payload = (evt.data ?? {}) as Record<string, unknown>;
    const evtSym = canonicalMarketSymbol(String(payload.symbol ?? payload.asset_code ?? ""));
    if (!evtSym || evtSym !== canonSymbol) return;

    if (evt.type === "tick" || evt.type === "snapshot") {
      const bid = Number(payload.bid ?? 0);
      const ask = Number(payload.ask ?? 0);
      const price = Number(payload.price ?? (bid > 0 && ask > 0 ? (bid + ask) / 2 : bid) ?? payload.close ?? 0);
      if (!(price > 0)) return;
      setLivePrice(price);

      const last = lastBarRef.current;
      const series = candleSeriesRef.current;
      if (last && series) {
        // Avoid splicing spot tick onto an unaligned futures price if basis > 5%
        if (Math.abs(price - last.close) / Math.max(last.close, 1e-6) > 0.05) {
          return;
        }
        const tfSec = TF_SECONDS[timeframe] ?? 300;
        const nowBucket = Math.floor(Date.now() / 1000 / tfSec) * tfSec;
        const nextCandle: OhlcBar =
          nowBucket > last.time
            ? {
                time: nowBucket,
                open: last.close,
                high: Math.max(last.close, price),
                low: Math.min(last.close, price),
                close: price,
                volume: 1,
              }
            : {
                ...last,
                close: price,
                high: Math.max(last.high, price),
                low: Math.min(last.low, price),
                volume: (last.volume ?? 0) + 1,
              };
        lastBarRef.current = nextCandle;
        try {
          series.update({
            time: nextCandle.time as Time,
            open: nextCandle.open,
            high: nextCandle.high,
            low: nextCandle.low,
            close: nextCandle.close,
          });
        } catch {
          // ignore out-of-order timestamp
        }
      }
      return;
    }

    // Handle bar_update (both top-level and nested payload.bar formats)
    if (payload.timeframe && String(payload.timeframe) !== timeframe) return;
    const barObj =
      payload.bar && typeof payload.bar === "object"
        ? (payload.bar as Record<string, unknown>)
        : payload;
    const barTime = Number(barObj.time ?? 0);
    const close = Number(barObj.close ?? 0);
    if (!barTime || !close) return;
    setLivePrice(close);
    const nextBar: OhlcBar = {
      time: barTime,
      open: Number(barObj.open ?? close),
      high: Number(barObj.high ?? close),
      low: Number(barObj.low ?? close),
      close,
      volume: Number(barObj.volume ?? 0),
    };
    const last = lastBarRef.current;
    const series = candleSeriesRef.current;
    if (last && series && nextBar.time >= last.time) {
      lastBarRef.current = nextBar;
      try {
        series.update({
          time: nextBar.time as Time,
          open: nextBar.open,
          high: nextBar.high,
          low: nextBar.low,
          close: nextBar.close,
        });
      } catch {
        // ignore
      }
    }
  });

  // 4. Persist chart state to server over WebSocket RPC
  const persistState = useCallback(
    async (
      nextTf: ChartTimeframe,
      nextInd: IndicatorConfig,
      nextDrawings: DrawingRecord[],
      showToast = false,
    ) => {
      if (!cleanSymbol) return;
      setSaving(true);
      try {
        await apiRequest(`/charts/state/${encodeURIComponent(cleanSymbol)}`, {
          method: "PUT",
          body: JSON.stringify({
            timeframe: nextTf,
            indicators_json: nextInd,
            drawings_json: nextDrawings,
            filters_json: {},
          }),
        });
        if (showToast) {
          notify.success(t.charts.stateSaved, `${cleanSymbol} • ${nextTf}`);
        }
      } catch (err) {
        if (showToast) {
          notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
        }
      } finally {
        setSaving(false);
      }
    },
    [cleanSymbol, t.charts.stateSaved, t.common.errorTitle],
  );

  // 5. Render institutional candlestick canvas (attributionLogo: false — zero TradingView branding!)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || loading || bars.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const refClose = bars[bars.length - 1]?.close ?? 100;
    const pricePrecision = refClose < 10 ? 5 : refClose < 100 ? 3 : 2;
    const minMove = Number((10 ** -pricePrecision).toFixed(pricePrecision));

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderUpColor: "#10b981",
      borderDownColor: "#f43f5e",
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      priceFormat: { type: "price", precision: pricePrecision, minMove },
    });
    candleSeries.setData(
      bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    candleSeriesRef.current = candleSeries;
    lastBarRef.current = bars[bars.length - 1] ?? null;

    // Plot MT5 Strategy Zones (SELL ZONE / FAIR / MEAN / BUY ZONE)
    const showBands = indicators.zones || indicators.bb;
    const showFair = indicators.zones || indicators.vwap;

    if (showBands) {
      const bb = calcBollinger(bars, 20, 2);
      const u = chart.addSeries(LineSeries, {
        color: "#f43f5e",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "SELL ZONE",
      });
      const m = chart.addSeries(LineSeries, {
        color: "rgba(148, 163, 184, 0.8)",
        lineWidth: 1,
        lineStyle: 3,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "MEAN",
      });
      const l = chart.addSeries(LineSeries, {
        color: "#10b981",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "BUY ZONE",
      });
      u.setData(bb.upper.map((p) => ({ time: p.time as Time, value: p.value })));
      m.setData(bb.middle.map((p) => ({ time: p.time as Time, value: p.value })));
      l.setData(bb.lower.map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (showFair) {
      const s = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "FAIR",
      });
      s.setData(calcVWAP(bars).map((p) => ({ time: p.time as Time, value: p.value })));
    }

    if (indicators.ema20) {
      const s = chart.addSeries(LineSeries, { color: "#eab308", lineWidth: 1, priceLineVisible: false, title: "EMA20" });
      s.setData(calcEMA(bars, 20).map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.ema50) {
      const s = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, priceLineVisible: false, title: "EMA50" });
      s.setData(calcEMA(bars, 50).map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.ema200) {
      const s = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, priceLineVisible: false, title: "EMA200" });
      s.setData(calcEMA(bars, 200).map((p) => ({ time: p.time as Time, value: p.value })));
    }

    // Live Robot EA Telemetry Exact Price Levels (SELL ZONE / FAIR / MEAN / BUY ZONE)
    if (robotZones && indicators.zones) {
      if (robotZones.sellZone && robotZones.sellZone > 0) {
        candleSeries.createPriceLine({
          price: robotZones.sellZone,
          color: "#f43f5e",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "EA SELL",
        });
      }
      if (robotZones.fair && robotZones.fair > 0) {
        candleSeries.createPriceLine({
          price: robotZones.fair,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "EA FAIR",
        });
      }
      if (robotZones.mean && robotZones.mean > 0) {
        candleSeries.createPriceLine({
          price: robotZones.mean,
          color: "#94a3b8",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: "EA MEAN",
        });
      }
      if (robotZones.buyZone && robotZones.buyZone > 0) {
        candleSeries.createPriceLine({
          price: robotZones.buyZone,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "EA BUY",
        });
      }
    }

    // MT5 Live Open Position Lines (ENTRY / SL / TP)
    for (const pos of openPositions) {
      const side = String(pos.side ?? "BUY").toUpperCase();
      const vol = Number(pos.volume ?? 0);
      const entryPrice = Number(pos.open_price ?? 0);
      const sl = Number(pos.sl ?? 0);
      const tp = Number(pos.tp ?? 0);
      if (entryPrice > 0) {
        candleSeries.createPriceLine({
          price: entryPrice,
          color: side === "BUY" ? "#22c55e" : "#ef4444",
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `${side} ${vol > 0 ? vol.toFixed(2) : ""}`.trim(),
        });
      }
      if (sl > 0) {
        candleSeries.createPriceLine({
          price: sl,
          color: "#f43f5e",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "SL",
        });
      }
      if (tp > 0) {
        candleSeries.createPriceLine({
          price: tp,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "TP",
        });
      }
    }

    // MT5 Historical Deal Markers (BUY / SELL Entry & Exit Arrows aligned to bars)
    if (dealItems.length > 0 && bars.length > 1) {
      const tfSec = TF_SECONDS[timeframe] ?? 300;
      const firstT = bars[0]!.time;
      const lastT = bars[bars.length - 1]!.time + tfSec;
      const rawMarkers: Array<SeriesMarker<Time> & { sortTime: number }> = [];
      for (const d of dealItems.slice(0, 80)) {
        const tSec = Number(d.time_sec ?? 0);
        if (!tSec || tSec < firstT || tSec > lastT) continue;
        // Snap deal timestamp to nearest candle bar <= tSec
        let snapped = bars[0]!.time;
        for (let i = bars.length - 1; i >= 0; i--) {
          if (bars[i]!.time <= tSec) {
            snapped = bars[i]!.time;
            break;
          }
        }
        const isBuy = String(d.side ?? "BUY").toUpperCase() === "BUY";
        const pnl = Number(d.net_profit_usd ?? 0);
        const entryTag = String(d.entry ?? "IN");
        const label =
          entryTag === "OUT" && pnl !== 0
            ? `${isBuy ? "B" : "S"} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}$`
            : isBuy
              ? "BUY"
              : "SELL";
        rawMarkers.push({
          sortTime: snapped,
          time: snapped as Time,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? "#10b981" : "#f43f5e",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: label,
        });
      }
      if (rawMarkers.length > 0) {
        rawMarkers.sort((a, b) => a.sortTime - b.sortTime);
        createSeriesMarkers(candleSeries, rawMarkers);
      }
    }

    // Apply saved user drawings (hlines, trendlines, fib retracements)
    for (const d of drawings) {
      if (d.type === "hline" && typeof d.price === "number") {
        candleSeries.createPriceLine({
          price: d.price,
          color: "#f97316",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "H-Line",
        });
      } else if (
        d.type === "trendline" &&
        typeof d.t1 === "number" &&
        typeof d.p1 === "number" &&
        typeof d.t2 === "number" &&
        typeof d.p2 === "number"
      ) {
        const pts =
          d.t1 <= d.t2
            ? [
                { time: d.t1 as Time, value: d.p1 },
                { time: d.t2 as Time, value: d.p2 },
              ]
            : [
                { time: d.t2 as Time, value: d.p2 },
                { time: d.t1 as Time, value: d.p1 },
              ];
        if (pts[0]!.time !== pts[1]!.time) {
          const tl = chart.addSeries(LineSeries, { color: "#facc15", lineWidth: 2, title: "Trend" });
          tl.setData(pts);
        }
      } else if (d.type === "fib" && typeof d.high === "number" && typeof d.low === "number") {
        const diff = d.high - d.low;
        for (const ratio of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
          candleSeries.createPriceLine({
            price: Number((d.high - diff * ratio).toFixed(4)),
            color: ratio === 0.618 || ratio === 0.5 ? "#f59e0b" : "rgba(148, 163, 184, 0.5)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Fib ${(ratio * 100).toFixed(1)}%`,
          });
        }
      }
    }

    chart.subscribeClick((param) => {
      if (activeTool === "cursor" || !param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null || !Number.isFinite(price)) return;
      const clickTime = Number(param.time);
      const roundedPrice = Number(price.toFixed(4));

      if (activeTool === "hline") {
        const next = [...drawings, { type: "hline" as const, price: roundedPrice }];
        setDrawings(next);
        void persistState(timeframe, indicators, next, true);
      } else if (activeTool === "trendline") {
        if (!pendingPoint) {
          setPendingPoint({ time: clickTime, price: roundedPrice });
        } else {
          const next = [
            ...drawings,
            {
              type: "trendline" as const,
              t1: pendingPoint.time,
              p1: pendingPoint.price,
              t2: clickTime,
              p2: roundedPrice,
            },
          ];
          setPendingPoint(null);
          setDrawings(next);
          void persistState(timeframe, indicators, next, true);
        }
      } else if (activeTool === "fib") {
        if (!pendingPoint) {
          setPendingPoint({ time: clickTime, price: roundedPrice });
        } else {
          const high = Math.max(pendingPoint.price, roundedPrice);
          const low = Math.min(pendingPoint.price, roundedPrice);
          const next = [...drawings, { type: "fib" as const, high, low }];
          setPendingPoint(null);
          setDrawings(next);
          void persistState(timeframe, indicators, next, true);
        }
      }
    });

    // Show comfortable recent window (~180 candles) while keeping full multi-day history scrollable to the left!
    if (bars.length > 200) {
      chart.timeScale().setVisibleLogicalRange({
        from: bars.length - 180,
        to: bars.length + 6,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [
    activeTool,
    bars,
    dealItems,
    drawings,
    height,
    indicators,
    loading,
    openPositions,
    pendingPoint,
    persistState,
    robotZones,
    timeframe,
  ]);

  const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const firstBar = bars.length > 0 ? bars[0] : null;
  const displayPrice = livePrice ?? latestBar?.close ?? null;
  const changePct =
    displayPrice !== null && firstBar && firstBar.open > 0
      ? ((displayPrice - firstBar.open) / firstBar.open) * 100
      : null;

  const latestRsi = useMemo(() => {
    if (!indicators.rsi || bars.length < 15) return null;
    const pts = calcRSI(bars, 14);
    return pts.length > 0 ? pts[pts.length - 1]!.value : null;
  }, [bars, indicators.rsi]);

  const toggleIndicator = (key: keyof IndicatorConfig) => {
    const next = { ...indicators, [key]: !indicators[key] };
    setIndicators(next);
    void persistState(timeframe, next, drawings, false);
  };

  const handleTimeframeChange = (tf: ChartTimeframe) => {
    setTimeframe(tf);
    void persistState(tf, indicators, drawings, false);
  };

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <AssetLogo symbol={cleanSymbol} size={28} />
          <CardTitle className="font-mono text-base font-bold">{cleanSymbol}</CardTitle>
          {displayPrice !== null ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums">
              <span
                className={`size-2 rounded-full ${
                  livePrice !== null ? "animate-pulse bg-emerald-500" : "bg-primary/70"
                }`}
                title="Поток в реальном времени (WebSocket)"
              />
              {displayPrice.toLocaleString("en-US", { maximumFractionDigits: 5 })}
            </span>
          ) : null}
          {changePct !== null ? (
            <Badge
              variant="outline"
              className={`font-mono text-[11px] ${
                changePct >= 0
                  ? "border-emerald-500/40 text-emerald-500"
                  : "border-rose-500/40 text-rose-500"
              }`}
            >
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%
            </Badge>
          ) : null}
          {sourceLabel ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {sourceLabel} • {bars.length} баров
            </Badge>
          ) : null}
          {latestRsi !== null ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              RSI(14): {latestRsi.toFixed(1)}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-border/60 bg-muted/40 p-0.5">
            {CHART_TIMEFRAMES.map((tf) => (
              <Button
                key={tf}
                size="sm"
                variant={timeframe === tf ? "secondary" : "ghost"}
                className="h-6 px-2 font-mono text-[11px]"
                onClick={() => handleTimeframeChange(tf)}
              >
                {tf}
              </Button>
            ))}
          </div>
          <AsyncButton
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            loading={saving}
            loadingText={t.common.saving}
            onClick={() => void persistState(timeframe, indicators, drawings, true)}
          >
            <Save className="mr-1 size-3.5" />
            {t.charts.saveState}
          </AsyncButton>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void loadBars()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/50 py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">{t.charts.indicators}:</span>
            {(
              [
                ["zones", "Зоны MT5 (SELL/FAIR/BUY)"],
                ["ema20", "EMA20"],
                ["ema50", "EMA50"],
                ["ema200", "EMA200"],
                ["rsi", "RSI(14)"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={indicators[key] ? "default" : "outline"}
                className="h-6 px-2 font-mono text-[10px]"
                onClick={() => toggleIndicator(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">{t.charts.drawings}:</span>
            <Button
              size="sm"
              variant={activeTool === "cursor" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setActiveTool("cursor");
                setPendingPoint(null);
              }}
            >
              <MousePointer2 className="mr-1 size-3" />
              {t.charts.cursor}
            </Button>
            <Button
              size="sm"
              variant={activeTool === "hline" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setActiveTool("hline");
                setPendingPoint(null);
              }}
            >
              <Minus className="mr-1 size-3" />
              {t.charts.hline}
            </Button>
            <Button
              size="sm"
              variant={activeTool === "trendline" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setActiveTool("trendline");
                setPendingPoint(null);
              }}
            >
              <TrendingUp className="mr-1 size-3" />
              {t.charts.trendline}
            </Button>
            <Button
              size="sm"
              variant={activeTool === "fib" ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setActiveTool("fib");
                setPendingPoint(null);
              }}
            >
              <Percent className="mr-1 size-3" />
              {t.charts.fib}
            </Button>
            {drawings.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] text-destructive"
                onClick={() => {
                  setDrawings([]);
                  setPendingPoint(null);
                  void persistState(timeframe, indicators, [], true);
                }}
              >
                <Trash2 className="mr-1 size-3" />
                {t.charts.clearDrawings} ({drawings.length})
              </Button>
            ) : null}
          </div>
        </div>

        {indicators.zones ? (
          <div className="flex flex-wrap items-center gap-3 px-1 font-mono text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-rose-500">
              <span className="inline-block h-0.5 w-3 bg-rose-500" /> SELL ZONE (Upper BB)
            </span>
            <span className="inline-flex items-center gap-1 text-amber-500">
              <span className="inline-block h-0.5 w-3 border-t border-dashed border-amber-500" /> FAIR (VWAP)
            </span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <span className="inline-block h-0.5 w-3 border-t border-dotted border-slate-400" /> MEAN (Mid)
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <span className="inline-block h-0.5 w-3 bg-emerald-500" /> BUY ZONE (Lower BB)
            </span>
            <span className="ml-auto hidden sm:inline">Прокрутите влево для просмотра истории за прошлые дни/недели</span>
          </div>
        ) : null}

        {loading ? (
          <ChartSkeleton height={height} />
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground"
            style={{ minHeight: height }}
          >
            <p className="font-mono text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void loadBars()}>
              <RefreshCw className="mr-1.5 size-3.5" />
              {t.common.refresh}
            </Button>
          </div>
        ) : bars.length === 0 ? (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground"
            style={{ minHeight: height }}
          >
            {t.common.noData}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="w-full [&_a[href*='tradingview']]:!hidden"
            style={{ height }}
          />
        )}
      </CardContent>
    </Card>
  );
}
