import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export interface CashflowPoint {
  month: string;
  deposits_usd: number;
  withdrawals_usd: number;
  net_invested_cum_usd: number;
}

interface TreasuryCashflowChartProps {
  series: CashflowPoint[];
}

export function TreasuryCashflowChart({ series }: TreasuryCashflowChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const themeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const isDark = themeMode !== "light";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = instance;
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

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
    const blue = isDark ? "#2962FF" : "#2563EB";
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const tooltipBg = isDark ? "#161C26" : "#FFFFFF";
    const tooltipBorder = isDark ? "#2A3446" : "#CBD5E1";
    const tooltipText = isDark ? "#E8EDF5" : "#0F172A";

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: rootFont, color: textMuted },
      legend: {
        top: 2,
        right: 10,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { color: textMuted, fontSize: 10, fontFamily: rootFont },
      },
      grid: { left: 56, right: 16, top: 28, bottom: 24 },
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipText, fontSize: 11, fontFamily: rootFont },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { dataIndex?: number } | undefined;
          const pt = series[first?.dataIndex ?? -1];
          if (!pt) return "";
          return [
            `<div style="font-weight:600;margin-bottom:4px;">${pt.month}</div>`,
            `<div style="font-variant-numeric:tabular-nums;color:${bull}">Депозиты: +${formatUsd(pt.deposits_usd)}</div>`,
            `<div style="font-variant-numeric:tabular-nums;color:${bear}">Выводы: -${formatUsd(pt.withdrawals_usd)}</div>`,
            `<div style="font-variant-numeric:tabular-nums;color:${blue};font-weight:600">Net Invested: ${formatSignedUsd(pt.net_invested_cum_usd)}</div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: series.map((s) => s.month),
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: textMuted, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        axisLabel: {
          color: textMuted,
          fontSize: 10,
          formatter: (v: number) => `$${v}`,
        },
      },
      series: [
        {
          name: "Депозиты",
          type: "bar",
          barMaxWidth: 20,
          itemStyle: { color: bull, borderRadius: [2, 2, 0, 0] },
          data: series.map((s) => s.deposits_usd),
        },
        {
          name: "Выводы",
          type: "bar",
          barMaxWidth: 20,
          itemStyle: { color: bear, borderRadius: [2, 2, 0, 0] },
          data: series.map((s) => -s.withdrawals_usd),
        },
        {
          name: "Накопл. Net Invested",
          type: "line",
          smooth: 0.2,
          symbolSize: 5,
          lineStyle: { color: blue, width: 2 },
          itemStyle: { color: blue },
          data: series.map((s) => s.net_invested_cum_usd),
        },
      ],
    };

    chart.setOption(option, true);
  }, [series, isDark]);

  return (
    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Движение капитала по месяцам (USD · без ALLINT)
        </span>
      </div>
      {series.length > 0 ? (
        <div ref={containerRef} className="h-[220px] w-full" />
      ) : (
        <div className="flex h-[180px] items-center justify-center text-[11px] text-[var(--text-muted)]">
          Нет внешних депозитов или выводов за период
        </div>
      )}
    </div>
  );
}
