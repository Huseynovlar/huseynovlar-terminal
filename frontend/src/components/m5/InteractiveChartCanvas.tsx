import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  LineSeries,
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

interface IndicatorConfig {
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

interface ChartStateResponse {
  symbol: string;
  timeframe: string;
  indicators_json: Partial<IndicatorConfig>;
  drawings_json: DrawingRecord[];
  filters_json: Record<string, unknown>;
}

export interface ChartBundleData {
  asset_code?: string;
  symbol?: string;
  timeframe: string;
  source?: string;
  bars: OhlcBar[];
  open_positions?: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
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
  ema20: false,
  ema50: false,
  ema200: false,
  bb: true,
  vwap: true,
  rsi: false,
};

export function InteractiveChartCanvas({
  symbol,
  mode = "hub",
  height = 420,
  robotZones,
  onDataLoaded,
}: InteractiveChartCanvasProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const lastBarRef = useRef<OhlcBar | null>(null);

  const [timeframe, setTimeframe] = useState<ChartTimeframe>("H1");
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS);
  const [drawings, setDrawings] = useState<DrawingRecord[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null);

  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanSymbol = symbol.trim().toUpperCase();
  const canonSymbol = canonicalMarketSymbol(cleanSymbol);

  // 1. Load persisted chart state from PostgreSQL (GET /api/v1/charts/state/{symbol})
  useEffect(() => {
    if (!cleanSymbol) return;
    let active = true;
    apiRequest<ChartStateResponse>(`/charts/state/${encodeURIComponent(cleanSymbol)}`)
      .then((state) => {
        if (!active) return;
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
        // Keep defaults if state does not exist yet
      });
    return () => {
      active = false;
    };
  }, [cleanSymbol]);

  // 2. Fetch real OHLC bars from backend
  const loadBars = useCallback(async () => {
    if (!cleanSymbol) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        mode === "explore"
          ? `/charts/explore?symbol=${encodeURIComponent(cleanSymbol)}&timeframe=${timeframe}`
          : `/charts/${encodeURIComponent(cleanSymbol)}?timeframe=${timeframe}`;
      const res = await apiRequest<ChartBundleData>(endpoint);
      const validBars = Array.isArray(res.bars)
        ? res.bars
            .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
            .sort((a, b) => a.time - b.time)
        : [];
      setBars(validBars);
      setSourceLabel(res.source ?? (mode === "explore" ? "Yahoo Finance" : "MT5 / Market"));
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

  // 3. Subscribe to live same-origin /api/v1/ws/live bar_update & tick events (Binance, Deriv, Alpaca, Finnhub, MT5)
  useLiveEvents(["bar_update", "tick"], (evt) => {
    const payload = evt.data ?? {};
    const evtSym = canonicalMarketSymbol(String(payload.symbol ?? payload.asset_code ?? ""));
    if (!evtSym || evtSym !== canonSymbol) return;

    if (evt.type === "tick") {
      const price = Number(payload.price ?? payload.bid ?? payload.close ?? 0);
      if (!(price > 0)) return;
      setLivePrice(price);
      const last = lastBarRef.current;
      const series = candleSeriesRef.current;
      if (last && series) {
        const updated: OhlcBar = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };
        lastBarRef.current = updated;
        try {
          series.update({
            time: updated.time as Time,
            open: updated.open,
            high: updated.high,
            low: updated.low,
            close: updated.close,
          });
        } catch {
          // ignore out-of-order timestamp
        }
      }
      return;
    }

    const barTime = Number(payload.time ?? 0);
    const close = Number(payload.close ?? 0);
    if (!barTime || !close) return;
    setLivePrice(close);
    const nextBar: OhlcBar = {
      time: barTime,
      open: Number(payload.open ?? close),
      high: Number(payload.high ?? close),
      low: Number(payload.low ?? close),
      close,
      volume: Number(payload.volume ?? 0),
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

  // 4. Persist chart state to server (PUT /api/v1/charts/state/{symbol})
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

  // 5. Render Lightweight Charts v5 canvas
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
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.16)" },
      timeScale: { borderColor: "rgba(148, 163, 184, 0.16)", timeVisible: true },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderUpColor: "#10b981",
      borderDownColor: "#f43f5e",
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
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

    if (indicators.ema20) {
      const s = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, title: "EMA20" });
      s.setData(calcEMA(bars, 20).map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.ema50) {
      const s = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, title: "EMA50" });
      s.setData(calcEMA(bars, 50).map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.ema200) {
      const s = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, title: "EMA200" });
      s.setData(calcEMA(bars, 200).map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.bb) {
      const bb = calcBollinger(bars, 20, 2);
      const u = chart.addSeries(LineSeries, { color: "#f43f5e", lineWidth: 2, title: "SELL ZONE" });
      const m = chart.addSeries(LineSeries, { color: "rgba(148, 163, 184, 0.7)", lineWidth: 1, lineStyle: 3, title: "MEAN" });
      const l = chart.addSeries(LineSeries, { color: "#10b981", lineWidth: 2, title: "BUY ZONE" });
      u.setData(bb.upper.map((p) => ({ time: p.time as Time, value: p.value })));
      m.setData(bb.middle.map((p) => ({ time: p.time as Time, value: p.value })));
      l.setData(bb.lower.map((p) => ({ time: p.time as Time, value: p.value })));
    }
    if (indicators.vwap) {
      const s = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, lineStyle: 2, title: "FAIR" });
      s.setData(calcVWAP(bars).map((p) => ({ time: p.time as Time, value: p.value })));
    }

    // Live Robot Strategy Zone Price Lines from MT5 EA Telemetry (SELL ZONE / FAIR / MEAN / BUY ZONE)
    if (robotZones) {
      if (robotZones.sellZone && robotZones.sellZone > 0) {
        candleSeries.createPriceLine({
          price: robotZones.sellZone,
          color: "#f43f5e",
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: "SELL ZONE",
        });
      }
      if (robotZones.fair && robotZones.fair > 0) {
        candleSeries.createPriceLine({
          price: robotZones.fair,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "FAIR",
        });
      }
      if (robotZones.mean && robotZones.mean > 0) {
        candleSeries.createPriceLine({
          price: robotZones.mean,
          color: "#94a3b8",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: "MEAN",
        });
      }
      if (robotZones.buyZone && robotZones.buyZone > 0) {
        candleSeries.createPriceLine({
          price: robotZones.buyZone,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: "BUY ZONE",
        });
      }
    }

    // Apply saved drawings (hlines, trendlines, fib retracements)
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

    chart.timeScale().fitContent();

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
    };
  }, [activeTool, bars, drawings, height, indicators, loading, pendingPoint, persistState, timeframe]);

  const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const firstBar = bars.length > 0 ? bars[0] : null;
  const changePct =
    latestBar && firstBar && firstBar.open > 0
      ? ((latestBar.close - firstBar.open) / firstBar.open) * 100
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
          <AssetLogo symbol={cleanSymbol} size={26} />
          <CardTitle className="font-mono text-base font-bold">{cleanSymbol}</CardTitle>
          {livePrice !== null || latestBar ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
              {livePrice !== null ? (
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" title="Live WS tick" />
              ) : null}
              {(livePrice ?? latestBar?.close ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}
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
              {sourceLabel}
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
                ["ema20", "EMA20"],
                ["ema50", "EMA50"],
                ["ema200", "EMA200"],
                ["bb", "BB(20)"],
                ["vwap", "VWAP"],
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
          <div ref={containerRef} className="w-full" style={{ height }} />
        )}
      </CardContent>
    </Card>
  );
}
