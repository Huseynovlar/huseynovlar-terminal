import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

interface Ownership13FGraphProps {
  activeTicker: string;
  onSelectTicker: (ticker: string) => void;
}

const FUNDS = ["BlackRock", "Vanguard", "Berkshire", "Bridgewater", "Citadel"];
const TICKERS = ["NVDA", "AAPL", "MSFT", "AMZN", "META"];

const LINKS: Array<{ source: string; target: string; weight: number }> = [
  { source: "BlackRock", target: "NVDA", weight: 7.4 },
  { source: "BlackRock", target: "AAPL", weight: 6.9 },
  { source: "BlackRock", target: "MSFT", weight: 7.1 },
  { source: "BlackRock", target: "AMZN", weight: 4.2 },
  { source: "BlackRock", target: "META", weight: 3.1 },
  { source: "Vanguard", target: "NVDA", weight: 8.6 },
  { source: "Vanguard", target: "AAPL", weight: 8.4 },
  { source: "Vanguard", target: "MSFT", weight: 8.9 },
  { source: "Vanguard", target: "AMZN", weight: 7.2 },
  { source: "Vanguard", target: "META", weight: 7.5 },
  { source: "Berkshire", target: "AAPL", weight: 26.2 },
  { source: "Berkshire", target: "AMZN", weight: 0.7 },
  { source: "Bridgewater", target: "NVDA", weight: 4.8 },
  { source: "Bridgewater", target: "MSFT", weight: 3.6 },
  { source: "Bridgewater", target: "META", weight: 2.9 },
  { source: "Citadel", target: "NVDA", weight: 3.9 },
  { source: "Citadel", target: "AMZN", weight: 2.8 },
  { source: "Citadel", target: "MSFT", weight: 2.4 },
];

export function Ownership13FGraph({ activeTicker, onSelectTicker }: Ownership13FGraphProps) {
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";
  const [layoutMode, setLayoutMode] = useState<"circular" | "force">("circular");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);

    const textColor = isDark ? "#E2E8F0" : "#0F172A";
    const mutedLine = isDark ? "rgba(148,163,184,0.32)" : "rgba(71,85,105,0.28)";
    const activeLine = "#3B82F6";

    const nodes = [
      ...FUNDS.map((name) => ({
        id: name,
        name,
        category: 0,
        symbolSize: 34,
        itemStyle: { color: "#3B82F6", borderColor: isDark ? "#0B0E14" : "#FFFFFF", borderWidth: 1.5 },
      })),
      ...TICKERS.map((name) => {
        const selected = name === activeTicker.toUpperCase();
        return {
          id: name,
          name,
          category: 1,
          symbolSize: selected ? 40 : 30,
          itemStyle: {
            color: selected ? "#F59E0B" : "#10B981",
            borderColor: isDark ? "#0B0E14" : "#FFFFFF",
            borderWidth: selected ? 2.5 : 1.5,
          },
        };
      }),
    ];

    const links = LINKS.map((l) => {
      const hi = l.target === activeTicker.toUpperCase();
      return {
        source: l.source,
        target: l.target,
        value: l.weight,
        lineStyle: {
          width: Math.max(1.2, Math.min(7, l.weight * 0.55)),
          color: hi ? activeLine : mutedLine,
          curveness: 0.22,
          opacity: hi ? 0.92 : 0.55,
        },
      };
    });

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#11161F" : "#FFFFFF",
        borderColor: isDark ? "#263042" : "#CBD5E1",
        textStyle: { color: textColor, fontSize: 11, fontFamily: "IBM Plex Mono, monospace" },
        formatter: (params: unknown) => {
          const p = params as { dataType?: string; data?: { source?: string; target?: string; value?: number; name?: string } };
          if (p.dataType === "edge" && p.data) {
            return `${p.data.source} → ${p.data.target}<br/>Доля владения: <b>${p.data.value}%</b>`;
          }
          return `<b>${p.data?.name || ""}</b><br/>Кликните для фильтрации 13F / Form 4`;
        },
      },
      legend: {
        bottom: 4,
        textStyle: { color: isDark ? "#94A3B8" : "#475569", fontSize: 10 },
        data: ["Институциональные фонды", "Акции (SEC 13F)"],
      },
      series: [
        {
          type: "graph",
          layout: layoutMode,
          roam: true,
          draggable: true,
          categories: [{ name: "Институциональные фонды" }, { name: "Акции (SEC 13F)" }],
          force: { repulsion: 260, edgeLength: [80, 140] },
          circular: { rotateLabel: false },
          label: {
            show: true,
            position: "right",
            color: textColor,
            fontSize: 11,
            fontFamily: "IBM Plex Mono, monospace",
            fontWeight: 600,
          },
          emphasis: { focus: "adjacency" },
          data: nodes,
          links,
        },
      ],
    });

    chart.on("click", (params: unknown) => {
      const p = params as { dataType?: string; name?: string };
      if (p.dataType === "node" && p.name) {
        if (TICKERS.includes(p.name)) {
          onSelectTicker(p.name);
        } else {
          // Clicking a fund picks its largest holding
          const top = LINKS.filter((l) => l.source === p.name).sort((a, b) => b.weight - a.weight)[0];
          if (top) onSelectTicker(top.target);
        }
      }
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [isDark, layoutMode, activeTicker, onSelectTicker]);

  return (
    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]">
            Граф владений 13F: Фонды ↔ Тикеры
          </h3>
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Толщина ребра = доля портфеля (%). Клик по узлу фильтрует таблицы SEC 13F и Form 4.
          </p>
        </div>
        <div className="flex rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setLayoutMode("circular")}
            className={`rounded-[2px] px-2 py-0.5 font-semibold ${
              layoutMode === "circular" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
            }`}
          >
            Circular
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode("force")}
            className={`rounded-[2px] px-2 py-0.5 font-semibold ${
              layoutMode === "force" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
            }`}
          >
            Force
          </button>
        </div>
      </div>
      <div ref={ref} className="h-[310px] w-full" />
    </div>
  );
}
