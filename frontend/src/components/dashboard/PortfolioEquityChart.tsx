import { useEffect, useMemo, useRef, useState } from "react";

import * as echarts from "echarts";

import { formatPct, formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export type EquityPeriod = "24H" | "7D" | "30D" | "90D" | "ALL";
export type EquityMetricMode = "equity" | "pnl_usd" | "pnl_pct";

export interface EquityCurvePoint {
  time_sec: number;
  date: string;
  equity_usd: number;
  cum_pnl_usd: number;
  pnl_pct: number;
  dd_pct: number;
}

interface PortfolioEquityChartProps {
  points: EquityCurvePoint[];
  period: EquityPeriod;
  onPeriodChange: (period: EquityPeriod) => void;
  loading?: boolean;
}

const PERIODS: EquityPeriod[] = ["24H", "7D", "30D", "90D", "ALL"];

const MODES: Array<{ id: EquityMetricMode; label: string }> = [
  { id: "equity", label: "Эквити ($)" },
  { id: "pnl_usd", label: "PnL ($)" },
  { id: "pnl_pct", label: "PnL (%)" },
];

export function PortfolioEquityChart({
  points,
  period,
  onPeriodChange,
  loading = false,
}: PortfolioEquityChartProps) {
  const [mode, setMode] = useState<EquityMetricMode>("equity");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const themeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const isDark = themeMode !== "light";

  const summaryDelta = useMemo(() => {
    if (points.length === 0) return { lastEq: 0, pnlUsd: 0, pnlPct: 0, maxDd: 0 };
    const last = points[points.length - 1];
    let maxDd = 0;
    for (const p of points) {
      if (p.dd_pct > maxDd) maxDd = p.dd_pct;
    }
    return {
      lastEq: last.equity_usd,
      pnlUsd: last.cum_pnl_usd,
      pnlPct: last.pnl_pct,
      maxDd,
    };
  }, [points]);

  // Initialize ECharts instance + ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = instance;

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  // Update chart options whenever points, mode, or theme changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const rootFont =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue("--app-font-sans").trim() ||
          "Inter, sans-serif"
        : "Inter, sans-serif";

    const bull = isDark ? "#00D488" : "#00A86B";
    const bear = isDark ? "#FF4757" : "#DC2626";
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const tooltipBg = isDark ? "#161C26" : "#FFFFFF";
    const tooltipBorder = isDark ? "#2A3446" : "#CBD5E1";
    const tooltipText = isDark ? "#E8EDF5" : "#0F172A";

    const values = points.map((p) => {
      if (mode === "equity") return p.equity_usd;
      if (mode === "pnl_usd") return p.cum_pnl_usd;
      return p.pnl_pct;
    });
    const labels = points.map((p) => p.date);

    const isPositive =
      mode === "equity"
        ? (points[points.length - 1]?.cum_pnl_usd ?? 0) >= 0
        : (values[values.length - 1] ?? 0) >= 0;
    const lineColor = isPositive ? bull : bear;

    const areaTop = isPositive
      ? isDark
        ? "rgba(0, 212, 136, 0.22)"
        : "rgba(0, 168, 107, 0.18)"
      : isDark
        ? "rgba(255, 71, 87, 0.22)"
        : "rgba(220, 38, 38, 0.16)";
    const areaBottom = isPositive
      ? isDark
        ? "rgba(0, 212, 136, 0.01)"
        : "rgba(0, 168, 107, 0.01)"
      : isDark
        ? "rgba(255, 71, 87, 0.01)"
        : "rgba(220, 38, 38, 0.01)";

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: "transparent",
      textStyle: {
        fontFamily: rootFont,
        color: textMuted,
      },
      grid: {
        left: 56,
        right: 14,
        top: 14,
        bottom: 24,
        containLabel: false,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: {
          color: tooltipText,
          fontFamily: rootFont,
          fontSize: 11,
        },
        axisPointer: {
          type: "cross",
          lineStyle: { color: isDark ? "#334155" : "#94A3B8", width: 1, type: "dashed" },
          crossStyle: { color: isDark ? "#334155" : "#94A3B8", width: 1, type: "dashed" },
          label: {
            backgroundColor: isDark ? "#1E2634" : "#E2E8F0",
            color: tooltipText,
            fontSize: 10,
            fontFamily: rootFont,
          },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { dataIndex?: number } | undefined;
          const idx = first?.dataIndex ?? -1;
          const pt = points[idx];
          if (!pt) return "";
          const pnlColor = pt.cum_pnl_usd >= 0 ? bull : bear;
          const ddColor = pt.dd_pct > 0 ? bear : textMuted;
          return [
            `<div style="font-weight:600;margin-bottom:4px;font-variant-numeric:tabular-nums;">${pt.date} UTC</div>`,
            `<div style="display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums;">` +
              `<span style="color:${textMuted}">Эквити</span>` +
              `<span style="font-weight:600">${formatUsd(pt.equity_usd)}</span>` +
              `</div>`,
            `<div style="display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums;">` +
              `<span style="color:${textMuted}">Кумул. PnL</span>` +
              `<span style="font-weight:600;color:${pnlColor}">${formatSignedUsd(pt.cum_pnl_usd)} (${formatPct(pt.pnl_pct)})</span>` +
              `</div>`,
            `<div style="display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums;">` +
              `<span style="color:${textMuted}">Просадка</span>` +
              `<span style="font-weight:600;color:${ddColor}">-${pt.dd_pct.toFixed(2)}%</span>` +
              `</div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: {
          color: textMuted,
          fontSize: 10,
          margin: 8,
          hideOverlap: true,
        },
      },
      yAxis: {
        type: "value",
        scale: true,
        min: (ext: { min: number; max: number }) => {
          const span = ext.max - ext.min;
          if (span <= 0) {
            const pad = Math.max(Math.abs(ext.min) * 0.05, mode === "pnl_pct" ? 0.5 : 1);
            return Number((ext.min - pad).toFixed(2));
          }
          return Number((ext.min - span * 0.05).toFixed(2));
        },
        max: (ext: { min: number; max: number }) => {
          const span = ext.max - ext.min;
          if (span <= 0) {
            const pad = Math.max(Math.abs(ext.max) * 0.05, mode === "pnl_pct" ? 0.5 : 1);
            return Number((ext.max + pad).toFixed(2));
          }
          return Number((ext.max + span * 0.05).toFixed(2));
        },
        splitNumber: 4,
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        axisLabel: {
          color: textMuted,
          fontSize: 10,
          formatter: (v: number) => {
            if (mode === "pnl_pct") return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
            if (mode === "pnl_usd") return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
            return `$${v.toFixed(2)}`;
          },
        },
      },
      series: [
        {
          name: mode,
          type: "line",
          data: values,
          smooth: 0.15,
          showSymbol: points.length <= 2,
          symbolSize: 5,
          lineStyle: {
            color: lineColor,
            width: 1.8,
          },
          itemStyle: {
            color: lineColor,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: areaTop },
              { offset: 1, color: areaBottom },
            ]),
          },
          markLine:
            mode !== "equity"
              ? {
                  silent: true,
                  symbol: "none",
                  lineStyle: { color: isDark ? "#334155" : "#94A3B8", width: 1, type: "dashed" },
                  label: { show: false },
                  data: [{ yAxis: 0 }],
                }
              : undefined,
        },
      ],
    };

    chart.setOption(option, true);
  }, [points, mode, isDark]);

  return (
    <div className="flex h-full min-h-[260px] flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      {/* Compact Institutional Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
            Кривая эквити портфеля
          </span>
          <div className="hidden items-center gap-2 text-[11px] tabular-nums sm:flex">
            <span
              className="font-semibold"
              style={{
                color: summaryDelta.pnlUsd >= 0 ? "var(--bull)" : "var(--bear)",
              }}
            >
              {formatSignedUsd(summaryDelta.pnlUsd)} ({formatPct(summaryDelta.pnlPct)})
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">
              Max DD:{" "}
              <span className="text-[var(--text-secondary)]">
                -{summaryDelta.maxDd.toFixed(2)}%
              </span>
            </span>
            <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              без ALLINT
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Metric mode selector */}
          <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`rounded-[3px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Period selector (default 7D) */}
          <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 tabular-nums">
            {PERIODS.map((p) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPeriodChange(p)}
                  className={`rounded-[3px] px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    active
                      ? "bg-[var(--accent-blue)] text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="relative flex-1 min-h-[210px] w-full">
        <div ref={containerRef} className="h-full w-full" />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg-panel)]/50">
            <span className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
              Обновление кривой...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
