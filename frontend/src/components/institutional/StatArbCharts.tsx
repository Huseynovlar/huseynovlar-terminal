import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

function useEChartsPalette() {
  const [light, setLight] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") === "light" : false,
  );
  useEffect(() => {
    const sync = () => setLight(document.documentElement.getAttribute("data-theme") === "light");
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);

  return {
    isLight: light,
    bg: light ? "#FFFFFF" : "#11161F",
    text: light ? "#0F172A" : "#E2E8F0",
    muted: light ? "#64748B" : "#94A3B8",
    grid: light ? "#E2E8F0" : "#1E2634",
    blue: "#3B82F6",
    amber: "#F59E0B",
    bull: "#22C55E",
    bear: "#EF4444",
    purple: "#A855F7",
  };
}

function useSyncedChart(groupId?: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    if (groupId) {
      chart.group = groupId;
      echarts.connect(groupId);
    }
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [groupId]);

  return { ref, chartRef };
}

/** Окно А — Живой график Z-Score спреда с ±1σ / ±2σ / ±3σ и маркерами бэктеста */
export function ZScoreSpreadChart({
  timestamps,
  zSeries,
  entryZ,
  stopZ,
  markers,
}: {
  timestamps: string[];
  zSeries: number[];
  entryZ: number;
  stopZ: number;
  markers: Array<{ ts: string; z: number; side: string; action: string }>;
}) {
  const { ref, chartRef } = useSyncedChart("stat-arb-sync");
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const markPoints = markers.map((m) => ({
      coord: [m.ts, m.z],
      value: m.action === "ENTRY" ? (m.side === "LONG" ? "L" : "S") : m.action === "STOP" ? "X" : "✓",
      itemStyle: {
        color:
          m.action === "STOP"
            ? p.bear
            : m.action === "EXIT"
              ? p.amber
              : m.side === "LONG"
                ? p.bull
                : p.bear,
      },
    }));

    chart.setOption(
      {
        backgroundColor: p.bg,
        animation: false,
        tooltip: {
          trigger: "axis",
          backgroundColor: p.bg,
          borderColor: p.grid,
          textStyle: { color: p.text, fontSize: 11 },
        },
        grid: { left: 42, right: 16, top: 14, bottom: 22 },
        xAxis: {
          type: "category",
          data: timestamps,
          axisLine: { lineStyle: { color: p.grid } },
          axisLabel: { color: p.muted, fontSize: 10 },
        },
        yAxis: {
          type: "value",
          min: (v: { min: number }) => Math.min(-stopZ - 0.5, Math.floor(v.min - 0.5)),
          max: (v: { max: number }) => Math.max(stopZ + 0.5, Math.ceil(v.max + 0.5)),
          splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
          axisLabel: { color: p.muted, fontSize: 10, formatter: "{value}σ" },
        },
        series: [
          {
            name: "Z-Score",
            type: "line",
            data: zSeries,
            showSymbol: false,
            lineStyle: { width: 1.8, color: p.blue },
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 9, color: p.muted },
              data: [
                { yAxis: 0, lineStyle: { color: p.muted, type: "solid", width: 1 } },
                { yAxis: 1, lineStyle: { color: p.grid, type: "dotted" } },
                { yAxis: -1, lineStyle: { color: p.grid, type: "dotted" } },
                { yAxis: entryZ, lineStyle: { color: p.bear, type: "dashed", width: 1 } },
                { yAxis: -entryZ, lineStyle: { color: p.bull, type: "dashed", width: 1 } },
                { yAxis: stopZ, lineStyle: { color: p.bear, type: "dotted", width: 1.2 } },
                { yAxis: -stopZ, lineStyle: { color: p.bear, type: "dotted", width: 1.2 } },
              ],
            },
            markArea: {
              silent: true,
              data: [
                [{ yAxis: entryZ, itemStyle: { color: "rgba(239,68,68,0.08)" } }, { yAxis: stopZ }],
                [{ yAxis: -stopZ, itemStyle: { color: "rgba(34,197,94,0.08)" } }, { yAxis: -entryZ }],
              ],
            },
            markPoint: {
              symbolSize: 22,
              label: { fontSize: 9, color: "#fff", fontWeight: 700 },
              data: markPoints,
            },
          },
        ],
      },
      { lazyUpdate: true },
    );
  }, [timestamps, zSeries, entryZ, stopZ, markers, p, chartRef]);

  return <div ref={ref} className="h-[220px] w-full" />;
}

/** Окно Б — Наложенный график цен Asset A vs Asset B (Base = 100) */
export function OverlayPricesChart({
  timestamps,
  assetA,
  assetB,
  normA,
  normB,
}: {
  timestamps: string[];
  assetA: string;
  assetB: string;
  normA: number[];
  normB: number[];
}) {
  const { ref, chartRef } = useSyncedChart("stat-arb-sync");
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        backgroundColor: p.bg,
        animation: false,
        tooltip: {
          trigger: "axis",
          backgroundColor: p.bg,
          borderColor: p.grid,
          textStyle: { color: p.text, fontSize: 11 },
        },
        legend: {
          top: 0,
          right: 8,
          textStyle: { color: p.muted, fontSize: 10 },
        },
        grid: { left: 46, right: 16, top: 24, bottom: 22 },
        xAxis: {
          type: "category",
          data: timestamps,
          axisLine: { lineStyle: { color: p.grid } },
          axisLabel: { color: p.muted, fontSize: 10 },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
          axisLabel: { color: p.muted, fontSize: 10 },
        },
        series: [
          {
            name: `${assetA} (Base=100)`,
            type: "line",
            data: normA,
            showSymbol: false,
            lineStyle: { width: 1.8, color: p.blue },
          },
          {
            name: `${assetB} (Base=100)`,
            type: "line",
            data: normB,
            showSymbol: false,
            lineStyle: { width: 1.8, color: p.amber },
          },
        ],
      },
      { lazyUpdate: true },
    );
  }, [timestamps, assetA, assetB, normA, normB, p, chartRef]);

  return <div ref={ref} className="h-[200px] w-full" />;
}

/** Окно В — Динамический Hedge Ratio (β) и Rolling Correlation */
export function RollingBetaCorrChart({
  timestamps,
  rollingCorr,
  rollingBeta,
}: {
  timestamps: string[];
  rollingCorr: Array<number | null>;
  rollingBeta: Array<number | null>;
}) {
  const { ref, chartRef } = useSyncedChart("stat-arb-sync");
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        backgroundColor: p.bg,
        animation: false,
        tooltip: {
          trigger: "axis",
          backgroundColor: p.bg,
          borderColor: p.grid,
          textStyle: { color: p.text, fontSize: 11 },
        },
        legend: {
          top: 0,
          right: 8,
          textStyle: { color: p.muted, fontSize: 10 },
        },
        grid: { left: 42, right: 44, top: 24, bottom: 22 },
        xAxis: {
          type: "category",
          data: timestamps,
          axisLine: { lineStyle: { color: p.grid } },
          axisLabel: { color: p.muted, fontSize: 10 },
        },
        yAxis: [
          {
            type: "value",
            min: -1,
            max: 1,
            splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
            axisLabel: { color: p.muted, fontSize: 10 },
          },
          {
            type: "value",
            scale: true,
            splitLine: { show: false },
            axisLabel: { color: p.purple, fontSize: 10 },
          },
        ],
        series: [
          {
            name: "Rolling Corr",
            type: "line",
            yAxisIndex: 0,
            data: rollingCorr,
            showSymbol: false,
            lineStyle: { width: 1.8, color: p.bull },
            markLine: {
              silent: true,
              symbol: "none",
              data: [{ yAxis: 0.6, lineStyle: { color: p.bear, type: "dashed" } }],
            },
          },
          {
            name: "Hedge Ratio (β)",
            type: "line",
            yAxisIndex: 1,
            data: rollingBeta,
            showSymbol: false,
            lineStyle: { width: 1.5, color: p.purple },
          },
        ],
      },
      { lazyUpdate: true },
    );
  }, [timestamps, rollingCorr, rollingBeta, p, chartRef]);

  return <div ref={ref} className="h-[190px] w-full" />;
}

/** Окно Г — Распределение Z-Score (Histogram) или Кривая Эквити Бэктеста */
export function DistributionEquityChart({
  mode,
  histogram,
  equityCurve,
}: {
  mode: "equity" | "histogram";
  histogram: { bins: string[]; counts: number[]; current_bin: number; percentile: number };
  equityCurve: Array<{ ts: string; equity: number }>;
}) {
  const { ref, chartRef } = useSyncedChart();
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (mode === "histogram") {
      chart.setOption(
        {
          backgroundColor: p.bg,
          animation: false,
          tooltip: {
            trigger: "axis",
            backgroundColor: p.bg,
            borderColor: p.grid,
            textStyle: { color: p.text, fontSize: 11 },
          },
          grid: { left: 36, right: 12, top: 14, bottom: 24 },
          xAxis: {
            type: "category",
            data: histogram.bins,
            axisLine: { lineStyle: { color: p.grid } },
            axisLabel: { color: p.muted, fontSize: 9 },
          },
          yAxis: {
            type: "value",
            splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
            axisLabel: { color: p.muted, fontSize: 10 },
          },
          series: [
            {
              type: "bar",
              data: histogram.counts.map((val, idx) => ({
                value: val,
                itemStyle: {
                  color: idx === histogram.current_bin ? p.amber : p.blue,
                  borderRadius: [2, 2, 0, 0],
                },
              })),
            },
          ],
        },
        true,
      );
    } else {
      chart.setOption(
        {
          backgroundColor: p.bg,
          animation: false,
          tooltip: {
            trigger: "axis",
            backgroundColor: p.bg,
            borderColor: p.grid,
            textStyle: { color: p.text, fontSize: 11 },
          },
          grid: { left: 42, right: 12, top: 14, bottom: 24 },
          xAxis: {
            type: "category",
            data: equityCurve.map((pt) => pt.ts),
            axisLine: { lineStyle: { color: p.grid } },
            axisLabel: { color: p.muted, fontSize: 9 },
          },
          yAxis: {
            type: "value",
            scale: true,
            splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
            axisLabel: { color: p.muted, fontSize: 10 },
          },
          series: [
            {
              name: "Spread Equity",
              type: "line",
              data: equityCurve.map((pt) => pt.equity),
              showSymbol: false,
              lineStyle: { width: 1.8, color: p.bull },
              areaStyle: { color: "rgba(34,197,94,0.12)" },
            },
          ],
        },
        true,
      );
    }
  }, [mode, histogram, equityCurve, p, chartRef]);

  return <div ref={ref} className="h-[190px] w-full" />;
}

/** Mini Z-Score Chart for Multi-Chart 4-Grid */
export function MiniZScoreSparkChart({
  values,
  entryZ,
  stopZ,
}: {
  values: number[];
  entryZ: number;
  stopZ: number;
}) {
  const { ref, chartRef } = useSyncedChart();
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        backgroundColor: p.bg,
        animation: false,
        grid: { left: 28, right: 8, top: 8, bottom: 16 },
        xAxis: { type: "category", show: false, data: values.map((_, i) => i) },
        yAxis: {
          type: "value",
          min: -stopZ - 0.5,
          max: stopZ + 0.5,
          splitLine: { show: false },
          axisLabel: { color: p.muted, fontSize: 9 },
        },
        series: [
          {
            type: "line",
            data: values,
            showSymbol: false,
            lineStyle: { width: 1.6, color: p.blue },
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              data: [
                { yAxis: 0, lineStyle: { color: p.grid, type: "solid" } },
                { yAxis: entryZ, lineStyle: { color: p.bear, type: "dashed" } },
                { yAxis: -entryZ, lineStyle: { color: p.bull, type: "dashed" } },
                { yAxis: stopZ, lineStyle: { color: p.bear, type: "dotted" } },
                { yAxis: -stopZ, lineStyle: { color: p.bear, type: "dotted" } },
              ],
            },
          },
        ],
      },
      { lazyUpdate: true },
    );
  }, [values, entryZ, stopZ, p, chartRef]);

  return <div ref={ref} className="h-[135px] w-full" />;
}

/** Interactive N x N Correlation / Cointegration / |Z-Score| Matrix */
export function StatArbMatrixChart({
  assets,
  cells,
  mode,
  onSelectPair,
}: {
  assets: string[];
  cells: Array<[number, number, number]>;
  mode: "correlation" | "cointegration" | "abs_zscore";
  onSelectPair: (assetA: string, assetB: string) => void;
}) {
  const { ref, chartRef } = useSyncedChart();
  const onSelectRef = useRef(onSelectPair);
  onSelectRef.current = onSelectPair;
  const p = useEChartsPalette();

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.off("click");
    chart.on("click", (params: unknown) => {
      const pr = params as { value?: [number, number, number] };
      if (Array.isArray(pr.value) && pr.value.length >= 2) {
        const [i, j] = pr.value;
        if (i !== j && assets[i] && assets[j]) {
          onSelectRef.current(assets[i], assets[j]);
        }
      }
    });

    const visualCfg =
      mode === "correlation"
        ? { min: -1, max: 1, inRange: { color: ["#B91C1C", "#1E293B", "#15803D"] } }
        : mode === "cointegration"
          ? { min: 0, max: 0.25, inRange: { color: ["#15803D", "#F59E0B", "#1E293B"] } }
          : { min: 0, max: 3.5, inRange: { color: ["#1E293B", "#3B82F6", "#F59E0B", "#DC2626"] } };

    chart.setOption(
      {
        backgroundColor: p.bg,
        animation: false,
        tooltip: {
          position: "top",
          backgroundColor: p.bg,
          borderColor: p.grid,
          textStyle: { color: p.text, fontSize: 11 },
          formatter: (params: unknown) => {
            const pr = params as { value?: [number, number, number] };
            const [i, j, v] = pr.value ?? [0, 0, 0];
            const lbl =
              mode === "correlation" ? "Pearson Corr" : mode === "cointegration" ? "ADF p-value" : "|Z-Score|";
            return `<b>${assets[i]} / ${assets[j]}</b><br/>${lbl}: <b>${v}</b><br/><span style="color:#3B82F6">Клик — открыть анализ пары</span>`;
          },
        },
        grid: { left: 68, right: 16, top: 14, bottom: 54 },
        xAxis: {
          type: "category",
          data: assets,
          splitArea: { show: false },
          axisLabel: { color: p.muted, fontSize: 10, rotate: 35 },
        },
        yAxis: {
          type: "category",
          data: assets,
          splitArea: { show: false },
          axisLabel: { color: p.muted, fontSize: 10 },
        },
        visualMap: {
          ...visualCfg,
          calculable: false,
          show: false,
        },
        series: [
          {
            type: "heatmap",
            data: cells,
            label: {
              show: assets.length <= 14,
              fontSize: 9,
              color: "#F8FAFC",
              formatter: (params: unknown) => {
                const pr = params as { value?: [number, number, number] };
                const v = pr.value?.[2] ?? 0;
                return mode === "cointegration" ? v.toFixed(2) : v.toFixed(2);
              },
            },
            itemStyle: {
              borderColor: p.bg,
              borderWidth: 1,
            },
          },
        ],
      },
      true,
    );
  }, [assets, cells, mode, p, chartRef]);

  return <div ref={ref} className="h-[460px] w-full" />;
}
