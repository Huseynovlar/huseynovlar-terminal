import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

function getRootFont(): string {
  if (typeof window === "undefined") return "Inter, sans-serif";
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--app-font-sans").trim() ||
    "Inter, sans-serif"
  );
}

export interface YieldCurvePoint {
  tenor: string;
  today: number;
  m1_ago: number;
  y1_ago: number;
}

export function YieldCurveChart({
  points,
  showToday,
  showM1,
  showY1,
}: {
  points: YieldCurvePoint[];
  showToday: boolean;
  showM1: boolean;
  showY1: boolean;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const c = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const font = getRootFont();
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const blue = isDark ? "#2962FF" : "#2563EB";
    const amber = isDark ? "#F59E0B" : "#D97706";
    const slate = isDark ? "#64748B" : "#94A3B8";

    const series: echarts.SeriesOption[] = [];
    if (showToday) {
      series.push({
        name: "Сегодня",
        type: "line",
        smooth: 0.2,
        symbolSize: 5,
        lineStyle: { color: blue, width: 2.2 },
        itemStyle: { color: blue },
        data: points.map((p) => p.today),
      });
    }
    if (showM1) {
      series.push({
        name: "1 мес. назад",
        type: "line",
        smooth: 0.2,
        symbolSize: 4,
        lineStyle: { color: amber, width: 1.5, type: "dashed" },
        itemStyle: { color: amber },
        data: points.map((p) => p.m1_ago),
      });
    }
    if (showY1) {
      series.push({
        name: "1 год назад",
        type: "line",
        smooth: 0.2,
        symbolSize: 4,
        lineStyle: { color: slate, width: 1.4, type: "dotted" },
        itemStyle: { color: slate },
        data: points.map((p) => p.y1_ago),
      });
    }

    c.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        tooltip: {
          trigger: "axis",
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
          valueFormatter: (v: unknown) => `${Number(v ?? 0).toFixed(2)}%`,
        },
        grid: { left: 46, right: 16, top: 18, bottom: 24 },
        xAxis: {
          type: "category",
          data: points.map((p) => p.tenor),
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10 },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
          axisLabel: { color: textMuted, fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
        },
        series,
      },
      true,
    );
  }, [points, showToday, showM1, showY1, isDark]);

  return <div ref={elRef} className="h-[250px] w-full" />;
}

export interface MacroDualSeries {
  series1_name: string;
  series2_name: string;
  dates: string[];
  series1: number[];
  series2: Array<number | null>;
}

export function MacroDualChart({ data }: { data: MacroDualSeries }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const c = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const font = getRootFont();
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const bull = isDark ? "#00D488" : "#00A86B";
    const blue = isDark ? "#2962FF" : "#2563EB";

    c.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        legend: {
          top: 0,
          right: 8,
          textStyle: { color: textMuted, fontSize: 10, fontFamily: font },
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
        },
        grid: { left: 48, right: 48, top: 26, bottom: 24 },
        xAxis: {
          type: "category",
          data: data.dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10, hideOverlap: true },
        },
        yAxis: [
          {
            type: "value",
            scale: true,
            splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
            axisLabel: { color: textMuted, fontSize: 10 },
          },
          {
            type: "value",
            scale: true,
            splitLine: { show: false },
            axisLabel: { color: textMuted, fontSize: 10 },
          },
        ],
        series: [
          {
            name: data.series1_name,
            type: "line",
            yAxisIndex: 0,
            showSymbol: false,
            smooth: 0.15,
            lineStyle: { color: bull, width: 2 },
            itemStyle: { color: bull },
            data: data.series1,
          },
          {
            name: data.series2_name,
            type: "line",
            yAxisIndex: 1,
            showSymbol: false,
            smooth: 0.15,
            lineStyle: { color: blue, width: 1.8 },
            itemStyle: { color: blue },
            data: data.series2,
          },
        ],
      },
      true,
    );
  }, [data, isDark]);

  return <div ref={elRef} className="h-[250px] w-full" />;
}

export interface CotPoint {
  date: string;
  mm_long: number;
  mm_short: number;
  mm_net: number;
  comm_net: number;
  open_interest: number;
}

export function CotNetPositionChart({ series }: { series: CotPoint[] }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const c = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const font = getRootFont();
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const bull = isDark ? "#00D488" : "#00A86B";
    const bear = isDark ? "#FF4757" : "#DC2626";
    const amber = isDark ? "#F59E0B" : "#D97706";

    c.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        legend: {
          top: 0,
          right: 10,
          textStyle: { color: textMuted, fontSize: 10, fontFamily: font },
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
        },
        grid: { left: 60, right: 60, top: 26, bottom: 24 },
        xAxis: {
          type: "category",
          data: series.map((s) => s.date),
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10, hideOverlap: true },
        },
        yAxis: [
          {
            type: "value",
            scale: true,
            splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
            axisLabel: { color: textMuted, fontSize: 10, formatter: (v: number) => `${(v / 1000).toFixed(0)}k` },
          },
          {
            type: "value",
            scale: true,
            splitLine: { show: false },
            axisLabel: { color: textMuted, fontSize: 10, formatter: (v: number) => `${(v / 1000).toFixed(0)}k` },
          },
        ],
        series: [
          {
            name: "Managed Money Net",
            type: "bar",
            yAxisIndex: 0,
            data: series.map((s) => ({
              value: s.mm_net,
              itemStyle: { color: s.mm_net >= 0 ? bull : bear, borderRadius: [2, 2, 0, 0] },
            })),
          },
          {
            name: "Open Interest",
            type: "line",
            yAxisIndex: 1,
            showSymbol: false,
            lineStyle: { color: amber, width: 1.8 },
            itemStyle: { color: amber },
            data: series.map((s) => s.open_interest),
          },
        ],
      },
      true,
    );
  }, [series, isDark]);

  return <div ref={elRef} className="h-[260px] w-full" />;
}

export function StablecoinsMcapChart({
  series,
}: {
  series: Array<{ date: string; mcap_b: number }>;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const c = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const font = getRootFont();
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";
    const bull = isDark ? "#00D488" : "#00A86B";

    c.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        tooltip: {
          trigger: "axis",
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
          valueFormatter: (v: unknown) => `$${Number(v ?? 0).toFixed(2)}B`,
        },
        grid: { left: 54, right: 14, top: 14, bottom: 24 },
        xAxis: {
          type: "category",
          data: series.map((s) => s.date),
          boundaryGap: false,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 10, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
          axisLabel: { color: textMuted, fontSize: 10, formatter: (v: number) => `$${v.toFixed(0)}B` },
        },
        series: [
          {
            name: "Stablecoins MCap",
            type: "line",
            showSymbol: false,
            smooth: 0.2,
            lineStyle: { color: bull, width: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(0,212,136,0.22)" },
                { offset: 1, color: "rgba(0,0,0,0)" },
              ]),
            },
            data: series.map((s) => s.mcap_b),
          },
        ],
      },
      true,
    );
  }, [series, isDark]);

  return <div ref={elRef} className="h-[220px] w-full" />;
}

export function NetLiquidityChart({
  dates,
  walcl,
  tga,
  rrp,
  netLiq,
}: {
  dates: string[];
  walcl: number[];
  tga: number[];
  rrp: number[];
  netLiq: number[];
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  useEffect(() => {
    if (!elRef.current) return;
    const c = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const font = getRootFont();
    const gridColor = isDark ? "#1E2634" : "#E2E8F0";
    const textMuted = isDark ? "#8B949E" : "#475569";

    c.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: { fontFamily: font, color: textMuted },
        legend: {
          top: 0,
          right: 8,
          textStyle: { color: textMuted, fontSize: 10, fontFamily: font },
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: isDark ? "#161C26" : "#FFFFFF",
          borderColor: isDark ? "#2A3446" : "#CBD5E1",
          borderWidth: 1,
          textStyle: { color: isDark ? "#E8EDF5" : "#0F172A", fontSize: 11, fontFamily: font },
        },
        grid: { left: 46, right: 44, top: 26, bottom: 22 },
        xAxis: {
          type: "category",
          data: dates,
          axisLine: { lineStyle: { color: gridColor } },
          axisLabel: { color: textMuted, fontSize: 10 },
        },
        yAxis: [
          {
            type: "value",
            name: "$T",
            scale: true,
            splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
            axisLabel: { color: textMuted, fontSize: 10 },
          },
          {
            type: "value",
            name: "TGA/RRP $T",
            scale: true,
            splitLine: { show: false },
            axisLabel: { color: textMuted, fontSize: 10 },
          },
        ],
        series: [
          {
            name: "Net Liquidity ($T)",
            type: "line",
            yAxisIndex: 0,
            data: netLiq,
            showSymbol: false,
            lineStyle: { width: 2.2, color: "#00D488" },
            areaStyle: { color: "rgba(0,212,136,0.10)" },
          },
          {
            name: "Fed Assets WALCL ($T)",
            type: "line",
            yAxisIndex: 0,
            data: walcl,
            showSymbol: false,
            lineStyle: { width: 1.5, color: "#3B82F6", type: "dashed" },
          },
          {
            name: "TGA ($T)",
            type: "bar",
            yAxisIndex: 1,
            data: tga,
            barMaxWidth: 10,
            itemStyle: { color: "rgba(245,158,11,0.55)" },
          },
          {
            name: "RRP ($T)",
            type: "bar",
            yAxisIndex: 1,
            data: rrp,
            barMaxWidth: 10,
            itemStyle: { color: "rgba(168,85,247,0.55)" },
          },
        ],
      },
      true,
    );
  }, [dates, walcl, tga, rrp, netLiq, isDark]);

  return <div ref={elRef} className="h-[220px] w-full" />;
}
