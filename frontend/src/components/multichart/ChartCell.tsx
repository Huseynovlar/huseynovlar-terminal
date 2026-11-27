import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Chart, dispose, init, type KLineData } from "klinecharts";
import { BellPlus, Layers, Maximize2, Minimize2, X } from "lucide-react";

import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { soundEngine } from "@/framework/sound-engine";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export type ChartTimeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";

export interface ChartCellConfig {
  id: string;
  symbol: string;
  timeframe: ChartTimeframe;
  indicators: string[];
  showMt5Zones: boolean;
}

export interface LiveQuoteSnapshot {
  price?: number | null;
  changePct?: number | null;
  source?: string | null;
}

export interface PaperTradeOverlay {
  side: "BUY" | "SELL";
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
}

export interface CrosshairSyncEvent {
  sourceId: string;
  timestamp: number;
}

export interface ZoomSyncEvent {
  sourceId: string;
  barSpace: number;
  timestamp?: number;
}

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
const TF_SECONDS: Record<ChartTimeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};

export const MULTICHART_TICKERS = [
  "XAUUSD",
  "XAGUSD",
  "USTEC",
  "US500",
  "US30",
  "DXY",
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "BNBUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USOIL",
];

function getPrecision(sym: string): number {
  const s = sym.toUpperCase();
  if (s.endsWith("JPY")) return 3;
  if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"].includes(s)) return 5;
  return 2;
}

function buildThemeStyles(isDark: boolean) {
  const grid = isDark ? "#151C28" : "#E2E8F0";
  const axis = isDark ? "#1E2634" : "#CBD5E1";
  const text = isDark ? "#94A3B8" : "#475569";
  const bull = isDark ? "#10B981" : "#059669";
  const bear = isDark ? "#F43F5E" : "#E11D48";
  return {
    grid: {
      show: true,
      horizontal: { show: true, size: 1, color: grid, style: "solid" as const },
      vertical: { show: true, size: 1, color: grid, style: "solid" as const },
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
        high: { show: true, color: text, textSize: 9, textFamily: "IBM Plex Mono, monospace" },
        low: { show: true, color: text, textSize: 9, textFamily: "IBM Plex Mono, monospace" },
        last: {
          show: true,
          upColor: bull,
          downColor: bear,
          noChangeColor: "#64748B",
          line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1 },
          text: {
            show: true,
            size: 10,
            family: "IBM Plex Mono, monospace",
            color: isDark ? "#0B0E14" : "#FFFFFF",
          },
        },
      },
      tooltip: {
        showRule: "follow_cross" as const,
        showType: "standard" as const,
      },
    },
    xAxis: {
      axisLine: { show: true, color: axis, size: 1 },
      tickText: { show: true, color: text, family: "IBM Plex Mono, monospace", size: 9 },
    },
    yAxis: {
      axisLine: { show: true, color: axis, size: 1 },
      tickText: { show: true, color: text, family: "IBM Plex Mono, monospace", size: 9 },
    },
    crosshair: {
      show: true,
      horizontal: {
        show: true,
        line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1, color: "#3B82F6" },
      },
      vertical: {
        show: true,
        line: { show: true, style: "dashed" as const, dashedValue: [3, 3], size: 1, color: "#3B82F6" },
      },
    },
  };
}

interface RawBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface Mt5ZonePoint {
  fair_px?: number | null;
  buy_zone?: number | null;
  sell_zone?: number | null;
}

interface ChartCellProps {
  cell: ChartCellConfig;
  isActive: boolean;
  isMaximized: boolean;
  canClose: boolean;
  liveQuote?: LiveQuoteSnapshot;
  // Sync props
  syncCrosshair: boolean;
  syncZoom: boolean;
  crosshairEvent: CrosshairSyncEvent | null;
  zoomEvent: ZoomSyncEvent | null;
  onBroadcastCrosshair: (ev: CrosshairSyncEvent) => void;
  onBroadcastZoom: (ev: ZoomSyncEvent) => void;
  // Replay props
  replayActive: boolean;
  replayPickingStart: boolean;
  replayCursorTs: number | null;
  paperTrade: PaperTradeOverlay | null;
  onReplayBarsReady?: (cellId: string, bars: KLineData[]) => void;
  onReplayPickStart?: (timestamp: number) => void;
  // Actions
  onSelect: () => void;
  onChangeSymbol: (symbol: string) => void;
  onChangeTimeframe: (tf: ChartTimeframe) => void;
  onToggleIndicator: (ind: string) => void;
  onToggleMt5Zones: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function ChartCell({
  cell,
  isActive,
  isMaximized,
  canClose,
  liveQuote,
  syncCrosshair,
  syncZoom,
  crosshairEvent,
  zoomEvent,
  onBroadcastCrosshair,
  onBroadcastZoom,
  replayActive,
  replayPickingStart,
  replayCursorTs,
  paperTrade,
  onReplayBarsReady,
  onReplayPickStart,
  onSelect,
  onChangeSymbol,
  onChangeTimeframe,
  onToggleIndicator,
  onToggleMt5Zones,
  onToggleMaximize,
  onClose,
}: ChartCellProps) {
  const themeMode = usePreferencesStore((s) => s.values.theme_mode);
  const isDark =
    themeMode === "dark" ||
    (themeMode === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const fullBarsRef = useRef<KLineData[]>([]);
  const activeBarsRef = useRef<KLineData[]>([]);
  const lastBarRef = useRef<KLineData | null>(null);
  const barCallbackRef = useRef<((data: KLineData) => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastZoneAlertRef = useRef<number>(0);

  const [sourceLabel, setSourceLabel] = useState<string>("—");
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<Mt5ZonePoint | null>(null);
  const [syncCrossTs, setSyncCrossTs] = useState<number | null>(null);

  const tickerOptions = useMemo(
    () => MULTICHART_TICKERS.map((s) => ({ value: s, label: s })),
    [],
  );

  const tfToPeriod = useCallback((tf: ChartTimeframe) => {
    switch (tf) {
      case "M1":
        return { span: 1, type: "minute" as const };
      case "M5":
        return { span: 5, type: "minute" as const };
      case "M15":
        return { span: 15, type: "minute" as const };
      case "H1":
        return { span: 1, type: "hour" as const };
      case "H4":
        return { span: 4, type: "hour" as const };
      case "D1":
        return { span: 1, type: "day" as const };
    }
  }, []);

  // Initialize KLineChart v10 instance once with DataLoader
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el, {
      styles: buildThemeStyles(isDark),
    });
    chart?.setTimezone("UTC");
    chart?.setDataLoader({
      getBars: ({ callback }) => {
        callback(activeBarsRef.current, false);
      },
      subscribeBar: ({ callback }) => {
        barCallbackRef.current = callback;
      },
      unsubscribeBar: () => {
        barCallbackRef.current = null;
      },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      chart?.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      barCallbackRef.current = null;
      dispose(el);
      chartRef.current = null;
    };
  }, []);

  // Theme sync
  useEffect(() => {
    chartRef.current?.setStyles(buildThemeStyles(isDark));
  }, [isDark]);

  // Fetch market-only history (strictly bypassing MT5 Bridge for market candles)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest<{
      bars?: RawBar[];
      source?: string;
      mt5_zones_series?: Mt5ZonePoint[];
    }>(`/charts/${encodeURIComponent(cell.symbol)}?timeframe=${cell.timeframe}&limit=400&market_only=true`)
      .then((res) => {
        if (cancelled) return;
        const bars: KLineData[] = (res.bars || [])
          .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
          .map((b) => ({
            timestamp: b.time > 1e12 ? b.time : b.time * 1000,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume ?? 0,
          }))
          .sort((a, b) => a.timestamp - b.timestamp);

        fullBarsRef.current = bars;
        activeBarsRef.current = bars;
        lastBarRef.current = bars.length ? { ...bars[bars.length - 1] } : null;
        setSourceLabel(res.source || "market");

        const zSeries = res.mt5_zones_series || [];
        setZones(zSeries.length ? zSeries[zSeries.length - 1] : null);

        const chart = chartRef.current;
        if (chart) {
          chart.setSymbol({
            ticker: cell.symbol,
            pricePrecision: getPrecision(cell.symbol),
            volumePrecision: 2,
          });
          chart.setPeriod(tfToPeriod(cell.timeframe));
          chart.resetData();
        }
        onReplayBarsReady?.(cell.id, bars);
      })
      .catch(() => {
        if (!cancelled) setSourceLabel("offline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cell.symbol, cell.timeframe, cell.id, tfToPeriod]);

  // Indicators sync (all OFF by default per spec)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const managed = ["EMA", "BOLL", "VOL", "RSI"];
    for (const name of managed) {
      const want = cell.indicators.includes(name);
      const isMain = name === "EMA" || name === "BOLL";
      chart.removeIndicator({ name });
      if (want) {
        chart.createIndicator(isMain ? { name, paneId: "candle_pane" } : name, isMain);
      }
    }
  }, [cell.indicators]);

  // MT5 Zones & Replay Paper Trade overlays
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeOverlay({ groupId: "mt5_zones" });
    chart.removeOverlay({ groupId: "replay_trade" });

    if (cell.showMt5Zones && zones) {
      const addLine = (val: number | null | undefined, color: string, label: string) => {
        if (!val || !Number.isFinite(val)) return;
        chart.createOverlay({
          name: "priceLine",
          groupId: "mt5_zones",
          lock: true,
          points: [{ value: val }],
          extendData: label,
          styles: {
            line: { color, size: 1, style: "dashed" },
            text: { color: "#FFFFFF", backgroundColor: color, size: 10 },
          },
        });
      };
      addLine(zones.fair_px, "#3B82F6", "MT5 FairPx");
      addLine(zones.buy_zone, "#10B981", "MT5 Buy Zone");
      addLine(zones.sell_zone, "#F43F5E", "MT5 Sell Zone");
    }

    if (replayActive && paperTrade && isActive) {
      const addTradeLine = (val: number, color: string, label: string) => {
        if (!Number.isFinite(val) || val <= 0) return;
        chart.createOverlay({
          name: "priceLine",
          groupId: "replay_trade",
          lock: true,
          points: [{ value: val }],
          extendData: label,
          styles: {
            line: { color, size: 1.5, style: "solid" },
            text: { color: "#FFFFFF", backgroundColor: color, size: 10 },
          },
        });
      };
      addTradeLine(paperTrade.entryPrice, "#3B82F6", `REPLAY ${paperTrade.side}`);
      addTradeLine(paperTrade.slPrice, "#F43F5E", "SL");
      addTradeLine(paperTrade.tpPrice, "#10B981", "TP");
    }
  }, [cell.showMt5Zones, zones, replayActive, paperTrade, isActive]);

  // Bar Replay slicing
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || fullBarsRef.current.length === 0) return;
    if (replayActive && replayCursorTs !== null) {
      const sliced = fullBarsRef.current.filter((b) => b.timestamp <= replayCursorTs);
      if (sliced.length > 0) {
        activeBarsRef.current = sliced;
        chart.resetData();
      }
    } else if (!replayActive) {
      activeBarsRef.current = fullBarsRef.current;
      chart.resetData();
    }
  }, [replayActive, replayCursorTs]);

  // Live /ws/market multiplexer tick update via requestAnimationFrame (disabled during Replay)
  useEffect(() => {
    if (replayActive) return;
    const px = liveQuote?.price;
    if (!px || !Number.isFinite(px) || px <= 0) return;

    // MT5 Zone enter audio alert
    if (cell.showMt5Zones && zones) {
      const now = Date.now();
      const nearZone =
        (zones.buy_zone && Math.abs(px - zones.buy_zone) / px < 0.0005) ||
        (zones.sell_zone && Math.abs(px - zones.sell_zone) / px < 0.0005);
      if (nearZone && now - lastZoneAlertRef.current > 30_000) {
        lastZoneAlertRef.current = now;
        soundEngine.play("mt5ZoneEnter");
      }
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const cb = barCallbackRef.current;
      const last = lastBarRef.current;
      if (!cb || !last) return;

      const bucketMs = TF_SECONDS[cell.timeframe] * 1000;
      const nowBucket = Math.floor(Date.now() / bucketMs) * bucketMs;

      if (nowBucket > last.timestamp) {
        const nextBar: KLineData = {
          timestamp: nowBucket,
          open: px,
          high: px,
          low: px,
          close: px,
          volume: 0,
        };
        lastBarRef.current = nextBar;
        cb(nextBar);
      } else {
        const updated: KLineData = {
          ...last,
          high: Math.max(last.high, px),
          low: Math.min(last.low, px),
          close: px,
        };
        lastBarRef.current = updated;
        cb(updated);
      }
    });
  }, [liveQuote?.price, cell.timeframe, cell.showMt5Zones, zones, replayActive]);

  // Subscribe to Crosshair & Zoom events for Multi-Chart Sync & Replay Cut-Point selection
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onCrosshair = (data: unknown) => {
      const payload = data as { kLineData?: KLineData } | null;
      const ts = payload?.kLineData?.timestamp;
      if (!ts) return;
      if (syncCrosshair) {
        onBroadcastCrosshair({ sourceId: cell.id, timestamp: ts });
      }
    };

    const onZoom = () => {
      if (!syncZoom) return;
      const barSpace = chart.getBarSpace();
      const range = chart.getVisibleRange();
      const dataList = chart.getDataList();
      const rightBar = dataList[Math.min(dataList.length - 1, Math.max(0, range.to - 1))];
      onBroadcastZoom({
        sourceId: cell.id,
        barSpace: typeof barSpace === "number" ? barSpace : barSpace.bar,
        timestamp: rightBar?.timestamp,
      });
    };

    chart.subscribeAction("onCrosshairChange", onCrosshair);
    chart.subscribeAction("onZoom", onZoom);
    chart.subscribeAction("onScroll", onZoom);
    return () => {
      chart.unsubscribeAction("onCrosshairChange", onCrosshair);
      chart.unsubscribeAction("onZoom", onZoom);
      chart.unsubscribeAction("onScroll", onZoom);
    };
  }, [cell.id, syncCrosshair, syncZoom, onBroadcastCrosshair, onBroadcastZoom]);

  // Apply incoming Crosshair Sync from sibling cells
  useEffect(() => {
    if (!syncCrosshair || !crosshairEvent || crosshairEvent.sourceId === cell.id) {
      setSyncCrossTs(null);
      return;
    }
    setSyncCrossTs(crosshairEvent.timestamp);
  }, [syncCrosshair, crosshairEvent, cell.id]);

  // Apply incoming Zoom/Scroll Sync from sibling cells
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !syncZoom || !zoomEvent || zoomEvent.sourceId === cell.id) return;
    chart.setBarSpace(zoomEvent.barSpace);
    if (zoomEvent.timestamp) {
      chart.scrollToTimestamp(zoomEvent.timestamp, 0);
    }
  }, [syncZoom, zoomEvent, cell.id]);

  // Click handler for Replay "Выбрать точку старта"
  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onSelect();
      if (!replayActive || !replayPickingStart) return;
      const chart = chartRef.current;
      const el = containerRef.current;
      if (!chart || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const converted = chart.convertFromPixel([{ x, y: e.clientY - rect.top }], { paneId: "candle_pane" });
      const pt = Array.isArray(converted) ? converted[0] : converted;
      if (pt && typeof pt.timestamp === "number" && pt.timestamp > 0) {
        onReplayPickStart?.(pt.timestamp);
        soundEngine.play("levelClick");
      }
    },
    [onSelect, replayActive, replayPickingStart, onReplayPickStart],
  );

  const handleQuickAlert = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const px = liveQuote?.price ?? lastBarRef.current?.close;
    if (!px) return;
    try {
      await apiRequest("/pro/alerts", {
        method: "POST",
        body: JSON.stringify({
          alert_type: "price_cross",
          symbol: cell.symbol,
          condition: "above",
          threshold: Number(px.toFixed(getPrecision(cell.symbol))),
          channel_sound: true,
          channel_telegram: true,
          channel_os: true,
        }),
      });
      soundEngine.play("priceAlert");
      notify.success("Быстрый алерт создан", `${cell.symbol} ≥ ${px.toFixed(getPrecision(cell.symbol))}`);
    } catch (err) {
      notify.error("Ошибка", err instanceof Error ? err.message : String(err));
    }
  };

  const displayPrice = liveQuote?.price ?? lastBarRef.current?.close ?? null;
  const displayPct = liveQuote?.changePct ?? null;
  const srcBadge = liveQuote?.source || sourceLabel;

  return (
    <div
      onMouseDown={onSelect}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[4px] border bg-[var(--bg-surface)] ${
        isActive ? "border-[var(--accent-blue)]" : "border-[var(--border-subtle)]"
      }`}
    >
      {/* Compact 28px Cell Header */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 text-[10.5px]">
        <div className="flex min-w-0 items-center gap-1">
          <div className="w-[94px] shrink-0">
            <SearchSelect
              value={cell.symbol}
              onValueChange={onChangeSymbol}
              options={tickerOptions}
              className="h-5 text-[10.5px] font-mono font-semibold"
            />
          </div>

          <div className="flex items-center gap-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeTimeframe(tf);
                }}
                className={`rounded-[2px] px-1 py-0.5 font-mono text-[9.5px] font-semibold transition-colors ${
                  cell.timeframe === tf
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-1.5 pl-1 font-mono tabular-nums lg:flex">
            <span className="font-semibold text-[var(--text-primary)]">
              {displayPrice !== null ? displayPrice.toFixed(getPrecision(cell.symbol)) : "—"}
            </span>
            {displayPct !== null && (
              <span style={{ color: displayPct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                {displayPct >= 0 ? "+" : ""}
                {displayPct.toFixed(2)}%
              </span>
            )}
            <span className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 text-[9px] uppercase text-[var(--text-muted)]">
              {srcBadge}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Individual Indicator Toggles (default OFF) */}
          <div className="hidden items-center gap-0.5 xl:flex">
            {(["EMA", "BOLL", "VOL", "RSI"] as const).map((ind) => {
              const on = cell.indicators.includes(ind);
              return (
                <button
                  key={ind}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleIndicator(ind);
                  }}
                  className={`rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold ${
                    on
                      ? "bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {ind}
                </button>
              );
            })}
          </div>

          {/* MT5 Zones Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMt5Zones();
            }}
            title="Наложить Зоны MT5 (FairPx / Buy / Sell из ep_ipc)"
            className={`flex h-5 items-center gap-0.5 rounded-[2px] border px-1 text-[9.5px] font-semibold ${
              cell.showMt5Zones
                ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Layers className="size-2.5" />
            <span className="hidden sm:inline">MT5</span>
          </button>

          {/* Quick Alert */}
          <button
            type="button"
            onClick={(e) => void handleQuickAlert(e)}
            title="Быстрый ценовой алерт"
            className="rounded-[2px] p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-amber)]"
          >
            <BellPlus className="size-3" />
          </button>

          {/* Maximize / Restore */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMaximize();
            }}
            title={isMaximized ? "Свернуть в сетку" : "Развернуть на весь экран"}
            className="rounded-[2px] p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {isMaximized ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </button>

          {canClose && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Закрыть окно"
              className="rounded-[2px] p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--bear)]"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* KLineChart Canvas Area */}
      <div
        className={`relative min-h-0 flex-1 ${replayActive && replayPickingStart ? "cursor-crosshair" : ""}`}
        onClick={handleChartClick}
      >
        <div ref={containerRef} className="h-full w-full" />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg-surface)]/70 font-mono text-[11px] text-[var(--text-muted)]">
            Загрузка {cell.symbol} ({cell.timeframe})...
          </div>
        )}
        {syncCrossTs && (
          <div className="pointer-events-none absolute top-1.5 right-14 rounded-[3px] border border-[var(--accent-blue)]/40 bg-[var(--bg-elevated)]/90 px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--accent-blue)] tabular-nums">
            SYNC {new Date(syncCrossTs).toISOString().slice(5, 16).replace("T", " ")} UTC
          </div>
        )}
        {replayActive && replayPickingStart && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-[3px] border border-[var(--accent-amber)] bg-[var(--bg-elevated)] px-2.5 py-1 font-mono text-[10.5px] font-semibold text-[var(--accent-amber)] shadow-lg">
            Кликните на свечу, чтобы обрезать историю (Bar Replay)
          </div>
        )}
      </div>
    </div>
  );
}
