import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export interface RobotEquityPoint {
  time_sec: number;
  date: string;
  cum_pnl_usd: number;
}

interface RobotEquityMiniChartProps {
  points: RobotEquityPoint[];
  magicNumber: number;
}

export function RobotEquityMiniChart({
  points,
  magicNumber,
}: RobotEquityMiniChartProps) {
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
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const tooltipBg = isDark ? "#161C26" : "#FFFFFF";
    const tooltipBorder = isDark ? "#2A3446" : "#CBD5E1";
    const tooltipText = isDark ? "#E8EDF5" : "#0F172A";

    const lastVal = points[points.length - 1]?.cum_pnl_usd ?? 0;
    const lineColor = lastVal >= 0 ? bull : bear;

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: rootFont, color: textMuted },
      grid: { left: 48, right: 10, top: 10, bottom: 20 },
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipText, fontSize: 11, fontFamily: rootFont },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { dataIndex?: number } | undefined;
          const pt = points[first?.dataIndex ?? -1];
          if (!pt) return "";
          return `<div style="font-variant-numeric:tabular-nums;"><strong>Magic #${magicNumber}</strong><br/>${pt.date} UTC<br/><span style="color:${pt.cum_pnl_usd >= 0 ? bull : bear};font-weight:600">${formatSignedUsd(pt.cum_pnl_usd)}</span></div>`;
        },
      },
      xAxis: {
        type: "category",
        data: points.map((p) => p.date),
        boundaryGap: false,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: textMuted, fontSize: 9, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 3,
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        axisLabel: {
          color: textMuted,
          fontSize: 9,
          formatter: (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(1)}`,
        },
      },
      series: [
        {
          type: "line",
          data: points.map((p) => p.cum_pnl_usd),
          smooth: 0.15,
          showSymbol: points.length <= 2,
          lineStyle: { color: lineColor, width: 1.6 },
          itemStyle: { color: lineColor },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              {
                offset: 0,
                color: lastVal >= 0 ? "rgba(0,212,136,0.2)" : "rgba(255,71,87,0.2)",
              },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ]),
          },
        },
      ],
    };

    chart.setOption(option, true);
  }, [points, magicNumber, isDark]);

  if (points.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[11px] text-[var(--text-muted)]">
        Нет закрытых сделок по Magic #{magicNumber}
      </div>
    );
  }

  return (
    <div className="h-[160px] w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
