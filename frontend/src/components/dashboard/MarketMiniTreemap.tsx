import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate } from "@tanstack/react-router";
import * as echarts from "echarts";

import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export interface TreemapItem {
  name: string;
  sector: string;
  value: number;
  change_pct: number;
  price?: number | null;
}

export interface FearGreedData {
  value: number;
  classification: string;
}

interface MarketMiniTreemapProps {
  usItems: TreemapItem[];
  cryptoItems: TreemapItem[];
  fearGreed: FearGreedData | null;
}

type TreemapCategory = "us" | "crypto";

function tileColor(changePct: number, isDark: boolean): string {
  if (changePct >= 2.5) return isDark ? "#009E65" : "#059669";
  if (changePct >= 0.5) return isDark ? "#0C6B49" : "#10B981";
  if (changePct > 0) return isDark ? "#134736" : "#34D399";
  if (changePct <= -2.5) return isDark ? "#C92A3A" : "#DC2626";
  if (changePct <= -0.5) return isDark ? "#8A2430" : "#EF4444";
  if (changePct < 0) return isDark ? "#522129" : "#F87171";
  return isDark ? "#232B38" : "#94A3B8";
}

function fngColor(val: number): string {
  if (val <= 25) return "var(--bear)";
  if (val <= 45) return "var(--accent-amber)";
  if (val <= 55) return "var(--text-secondary)";
  return "var(--bull)";
}

export function MarketMiniTreemap({
  usItems,
  cryptoItems,
  fearGreed,
}: MarketMiniTreemapProps) {
  const [category, setCategory] = useState<TreemapCategory>(() =>
    usItems.length > 0 ? "us" : "crypto",
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const navigate = useNavigate();
  const themeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const isDark = themeMode !== "light";

  // Auto-switch to non-empty category if initial one has no cached data yet
  useEffect(() => {
    if (category === "us" && usItems.length === 0 && cryptoItems.length > 0) {
      setCategory("crypto");
    } else if (category === "crypto" && cryptoItems.length === 0 && usItems.length > 0) {
      setCategory("us");
    }
  }, [category, usItems.length, cryptoItems.length]);

  const activeItems = useMemo(
    () => (category === "us" ? usItems : cryptoItems).filter((i) => i.name && i.value > 0),
    [category, usItems, cryptoItems],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = instance;

    instance.on("click", (params: echarts.ECElementEvent) => {
      const raw = params.data as { symbol?: string } | null | undefined;
      const sym = raw?.symbol;
      if (sym) {
        void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: sym } });
      }
    });

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, [navigate]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const rootFont =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue("--app-font-sans").trim() ||
          "Inter, sans-serif"
        : "Inter, sans-serif";

    const tooltipBg = isDark ? "#161C26" : "#FFFFFF";
    const tooltipBorder = isDark ? "#2A3446" : "#CBD5E1";
    const tooltipText = isDark ? "#E8EDF5" : "#0F172A";
    const borderCol = isDark ? "#0B0E14" : "#FFFFFF";

    const data = activeItems.map((it) => ({
      name: it.name,
      symbol: it.name,
      sector: it.sector,
      value: it.value,
      change_pct: it.change_pct,
      price: it.price ?? null,
      itemStyle: {
        color: tileColor(it.change_pct, isDark),
        borderColor: borderCol,
        borderWidth: 1,
        gapWidth: 1,
      },
    }));

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [6, 10],
        textStyle: { color: tooltipText, fontFamily: rootFont, fontSize: 11 },
        formatter: (params: unknown) => {
          const d = (params as { data?: (typeof data)[number] })?.data;
          if (!d) return "";
          const sign = d.change_pct >= 0 ? "+" : "";
          const color =
            d.change_pct > 0
              ? isDark
                ? "#00D488"
                : "#00A86B"
              : d.change_pct < 0
                ? isDark
                  ? "#FF4757"
                  : "#DC2626"
                : isDark
                  ? "#8B949E"
                  : "#475569";
          return [
            `<div style="font-weight:600;margin-bottom:2px;">${d.name}${d.sector ? ` · ${d.sector}` : ""}</div>`,
            `<div style="font-variant-numeric:tabular-nums;color:${color};font-weight:600;">${sign}${d.change_pct.toFixed(2)}%</div>`,
            d.price != null
              ? `<div style="font-variant-numeric:tabular-nums;opacity:0.75;">Цена: ${d.price}</div>`
              : "",
          ].join("");
        },
      },
      series: [
        {
          type: "treemap",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            fontFamily: rootFont,
            color: "#FFFFFF",
            formatter: (params: unknown) => {
              const d = (params as { data?: (typeof data)[number] })?.data;
              if (!d) return "";
              const sign = d.change_pct >= 0 ? "+" : "";
              return `{sym|${d.name}}\n{chg|${sign}${d.change_pct.toFixed(1)}%}`;
            },
            rich: {
              sym: {
                fontSize: 11,
                fontWeight: 700,
                color: "#FFFFFF",
                lineHeight: 14,
              },
              chg: {
                fontSize: 10,
                fontWeight: 500,
                color: "rgba(255,255,255,0.88)",
                lineHeight: 13,
              },
            },
          },
          data,
        },
      ],
    };

    chart.setOption(option, true);
  }, [activeItems, isDark]);

  return (
    <div className="flex h-full min-h-[240px] flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            <button
              type="button"
              onClick={() => setCategory("us")}
              className={`rounded-[3px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
                category === "us"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Сектора США
            </button>
            <button
              type="button"
              onClick={() => setCategory("crypto")}
              className={`rounded-[3px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
                category === "crypto"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Крипто Топ
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {fearGreed && (
            <span
              title={`Crypto Fear & Greed Index (Alternative.me): ${fearGreed.classification}`}
              className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            >
              <span className="text-[var(--text-muted)]">F&amp;G</span>
              <span style={{ color: fngColor(fearGreed.value) }}>{fearGreed.value}</span>
            </span>
          )}
          <Link
            to="/dashboard/treemap"
            className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
          >
            Карта рынка →
          </Link>
        </div>
      </div>

      {/* Treemap Body */}
      <div className="relative flex-1 min-h-[185px] p-1.5">
        {activeItems.length > 0 ? (
          <div ref={containerRef} className="h-full w-full cursor-pointer" />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
            Ожидание обновления рыночного кэша...
          </div>
        )}
      </div>
    </div>
  );
}
