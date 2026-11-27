import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export interface AnalyticsEquityPt {
  date: string;
  cum_pnl_usd: number;
  twr_pct?: number;
  drawdown_usd?: number;
}

export interface AnalyticsDrawdownPt {
  date: string;
  drawdown_pct: number;
  drawdown_usd?: number;
}

export interface DailyPnlPt {
  date: string;
  net_pnl_usd: number;
  trades: number;
}

export interface HourlyPnlPt {
  hour: number;
  net_pnl_usd: number;
  trades: number;
  win_rate_pct: number;
}

export interface WeekdayPnlPt {
  day: string;
  net_pnl_usd: number;
  trades: number;
  wins: number;
}

function getRootFont(): string {
  if (typeof window === "undefined") return "Inter, sans-serif";
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--app-font-sans").trim() ||
    "Inter, sans-serif"
  );
}

/**
 * Synchronized Equity / TWR (%) + Underwater Drawdown (%) via `echarts.connect`.
 */
export function SyncedEquityDrawdownCharts({
  equityCurve,
  drawdownCurve,
}: {
  equityCurve: AnalyticsEquityPt[];
  drawdownCurve: AnalyticsDrawdownPt[];
}) {
  const [mode, setMode] = useState<"pnl" | "twr">("pnl");
  const eqElRef = useRef<HTMLDivElement | null>(null);
  const ddElRef = useRef<HTMLDivElement | null>(null);
  const eqChartRef = useRef<echarts.ECharts | null>(null);
  const ddChartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!eqElRef.current || !ddElRef.current) return;
    const eq = echarts.init(eqElRef.current, undefined, { renderer: "canvas" });
    const dd = echarts.init(ddElRef.current, undefined, { renderer: "canvas" });
    eq.group = "analytics-eq-dd";
    dd.group = "analytics-eq-dd";
    echarts.connect("analytics-eq-dd");
    eqChartRef.current = eq;
    ddChartRef.current = dd;

    const ro = new ResizeObserver(() => {
      eq.resize();
      dd.resize();
    });
    ro.observe(eqElRef.current);
    ro.observe(ddElRef.current);

    return () => {
      ro.disconnect();
      echarts.disconnect("analytics-eq-dd");
      eq.dispose();
      dd.dispose();
      eqChartRef.current = null;
      ddChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const eq = eqChartRef.current;
    const dd = ddChartRef.current;
    if (!eq || !dd) return;

    const font = getRootFont();
    const bull = isDark ? "#00D488" : "#00A86B";
    const bear = isDark ? "#FF4757" : "#DC2626";
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const tooltipBg = isDark ? "#161C26" : "#FFFFFF";
    const tooltipBorder = isDark ? "#2A3446" : "#CBD5E1";
    const tooltipText = isDark ? "#E8EDF5" : "#0F172A";

    const eqVals = equityCurve.map((p) => (mode === "pnl" ? p.cum_pnl_usd : (p.twr_pct ?? 0)));
    const lastVal = eqVals[eqVals.length - 1] ?? 0;
    const eqColor = lastVal >= 0 ? bull : bear;

    eq.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        grid: { left: 56, right: 14, top: 14, bottom: 22 },
        tooltip: {
          trigger: "axis",
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 1,
          textStyle: { color: tooltipText, fontSize: 11, fontFamily: font },
          axisPointer: { type: "cross" },
        },
        xAxis: {
          type: "category",
          data: equityCurve.map((p) => p.date),
          boundaryGap: false,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
          axisLabel: {
            color: textMuted,
            fontSize: 10,
            formatter: (v: number) => (mode === "twr" ? `${v.toFixed(1)}%` : `$${v.toFixed(1)}`),
          },
        },
        series: [
          {
            name: mode === "pnl" ? "Net PnL ($)" : "TWR (%)",
            type: "line",
            data: eqVals,
            smooth: 0.15,
            showSymbol: false,
            lineStyle: { color: eqColor, width: 1.8 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: lastVal >= 0 ? "rgba(0,212,136,0.22)" : "rgba(255,71,87,0.22)" },
                { offset: 1, color: "rgba(0,0,0,0)" },
              ]),
            },
          },
        ],
      },
      true,
    );

    dd.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        grid: { left: 56, right: 14, top: 10, bottom: 22 },
        tooltip: {
          trigger: "axis",
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 1,
          textStyle: { color: tooltipText, fontSize: 11, fontFamily: font },
          axisPointer: { type: "cross" },
        },
        xAxis: {
          type: "category",
          data: drawdownCurve.map((p) => p.date),
          boundaryGap: false,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          max: 0,
          splitNumber: 3,
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
          axisLabel: { color: textMuted, fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
        },
        series: [
          {
            name: "Drawdown (%)",
            type: "line",
            data: drawdownCurve.map((p) => p.drawdown_pct),
            showSymbol: false,
            lineStyle: { color: bear, width: 1.4 },
            areaStyle: { color: isDark ? "rgba(255,71,87,0.20)" : "rgba(220,38,38,0.16)" },
          },
        ],
      },
      true,
    );
  }, [equityCurve, drawdownCurve, mode, isDark]);

  return (
    <div className="space-y-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Кривая доходности и просадка (Synced · без ALLINT)
        </span>
        <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setMode("pnl")}
            className={`rounded-[3px] px-2 py-0.5 font-medium ${
              mode === "pnl"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            Net PnL ($)
          </button>
          <button
            type="button"
            onClick={() => setMode("twr")}
            className={`rounded-[3px] px-2 py-0.5 font-medium ${
              mode === "twr"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            ROI / TWR (%)
          </button>
        </div>
      </div>

      <div ref={eqElRef} className="h-[220px] w-full" />
      <div className="border-t border-[var(--border-subtle)] pt-1.5">
        <div className="mb-0.5 text-[10px] font-medium uppercase text-[var(--text-muted)]">
          Underwater Drawdown (%)
        </div>
        <div ref={ddElRef} className="h-[115px] w-full" />
      </div>
    </div>
  );
}

/**
 * Calendar Heatmap of daily PnL (#EF4444 -> #1E293B -> #10B981). Click opens Journal for that day.
 */
export function PnlCalendarHeatmap({
  daily,
  onSelectDate,
}: {
  daily: DailyPnlPt[];
  onSelectDate?: (date: string) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const instance = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = instance;
    instance.on("click", (params: echarts.ECElementEvent) => {
      const val = params.value as [string, number] | undefined;
      if (val && typeof val[0] === "string" && onSelectDate) {
        onSelectDate(val[0]);
      }
    });
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, [onSelectDate]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const font = getRootFont();
    const textMuted = isDark ? "#8B949E" : "#475569";
    const borderCol = isDark ? "#1E2634" : "#E2E8F0";
    const emptyBg = isDark ? "#11161F" : "#F8FAFC";

    const maxAbs = Math.max(
      1,
      ...daily.map((d) => Math.abs(d.net_pnl_usd)),
    );
    const nowYear = new Date().getUTCFullYear();
    const firstDate = daily[0]?.date ?? `${nowYear}-01-01`;
    const lastDate = daily[daily.length - 1]?.date ?? `${nowYear}-12-31`;

    chart.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        tooltip: {
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
          formatter: (params: unknown) => {
            const val = (params as { value?: [string, number, number] })?.value;
            if (!val) return "";
            return `<div style="font-variant-numeric:tabular-nums;"><strong>${val[0]}</strong><br/>PnL: ${formatSignedUsd(val[1])}<br/>Сделок: ${val[2] ?? 0}</div>`;
          },
        },
        visualMap: {
          min: -maxAbs,
          max: maxAbs,
          show: false,
          inRange: {
            color: ["#EF4444", isDark ? "#1E293B" : "#E2E8F0", "#10B981"],
          },
        },
        calendar: {
          top: 24,
          left: 34,
          right: 14,
          bottom: 10,
          cellSize: ["auto", 15],
          range: [firstDate, lastDate],
          itemStyle: { borderWidth: 1, borderColor: borderCol, color: emptyBg },
          splitLine: { lineStyle: { color: borderCol, width: 1 } },
          yearLabel: { show: false },
          monthLabel: { color: textMuted, fontSize: 10, fontFamily: font },
          dayLabel: { color: textMuted, fontSize: 9, firstDay: 1, fontFamily: font },
        },
        series: [
          {
            type: "heatmap",
            coordinateSystem: "calendar",
            data: daily.map((d) => [d.date, d.net_pnl_usd, d.trades]),
          },
        ],
      },
      true,
    );
  }, [daily, isDark]);

  return (
    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Календарная тепловая карта PnL (клик → Журнал)
        </span>
      </div>
      <div ref={elRef} className="h-[155px] w-full cursor-pointer" />
    </div>
  );
}

/**
 * Hourly (UTC) & Weekday PnL Attribution Bar Charts (ECharts v6).
 */
export function HourlyWeekdayCharts({
  hourly,
  weekday,
}: {
  hourly: HourlyPnlPt[];
  weekday: WeekdayPnlPt[];
}) {
  const hElRef = useRef<HTMLDivElement | null>(null);
  const wElRef = useRef<HTMLDivElement | null>(null);
  const hChartRef = useRef<echarts.ECharts | null>(null);
  const wChartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!hElRef.current || !wElRef.current) return;
    const hc = echarts.init(hElRef.current, undefined, { renderer: "canvas" });
    const wc = echarts.init(wElRef.current, undefined, { renderer: "canvas" });
    hChartRef.current = hc;
    wChartRef.current = wc;
    const ro = new ResizeObserver(() => {
      hc.resize();
      wc.resize();
    });
    ro.observe(hElRef.current);
    ro.observe(wElRef.current);
    return () => {
      ro.disconnect();
      hc.dispose();
      wc.dispose();
    };
  }, []);

  useEffect(() => {
    const hc = hChartRef.current;
    const wc = wChartRef.current;
    if (!hc || !wc) return;
    const font = getRootFont();
    const bull = isDark ? "#00D488" : "#00A86B";
    const bear = isDark ? "#FF4757" : "#DC2626";
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";

    const barOpts = (labels: string[], vals: number[]): echarts.EChartsOption => ({
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: font, color: textMuted },
      grid: { left: 46, right: 10, top: 12, bottom: 22 },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#161C26" : "#FFFFFF",
        borderColor: isDark ? "#2A3446" : "#CBD5E1",
        borderWidth: 1,
        textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: textMuted, fontSize: 9 },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        axisLabel: { color: textMuted, fontSize: 9, formatter: (v: number) => `$${v}` },
      },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? bull : bear, borderRadius: [2, 2, 0, 0] },
          })),
        },
      ],
    });

    hc.setOption(
      barOpts(
        hourly.map((h) => `${String(h.hour).padStart(2, "0")}h`),
        hourly.map((h) => h.net_pnl_usd),
      ),
      true,
    );
    wc.setOption(
      barOpts(
        weekday.map((w) => w.day),
        weekday.map((w) => w.net_pnl_usd),
      ),
      true,
    );
  }, [hourly, weekday, isDark]);

  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Атрибуция по часам дня (UTC)
        </div>
        <div ref={hElRef} className="h-[175px] w-full" />
      </div>
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Атрибуция по дням недели (UTC)
        </div>
        <div ref={wElRef} className="h-[175px] w-full" />
      </div>
    </div>
  );
}
