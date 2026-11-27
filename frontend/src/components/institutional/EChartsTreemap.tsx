import { useEffect, useMemo, useRef, useState } from "react";

import * as echarts from "echarts";

import type { LiveRowQuote } from "@/framework/use-market-list-stream";

export interface TreemapItem {
  ticker: string;
  canonical_symbol?: string;
  name: string;
  price: number | null;
  change_pct: number;
  market_cap: number | null;
  volume: number | null;
  weight: number;
  live: boolean;
}

export interface TreemapSector {
  sector: string;
  items: TreemapItem[];
}

function useIsLightTheme(): boolean {
  const [light, setLight] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") === "light" : false,
  );
  useEffect(() => {
    const sync = () => setLight(document.documentElement.getAttribute("data-theme") === "light");
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

/** Discrete institutional Bloomberg color scale synchronized with dark/light theme */
function getDiscreteTileColor(pct: number, isLight: boolean): string {
  if (pct <= -5) return "#B91C1C";
  if (pct <= -2) return "#DC2626";
  if (pct <= -0.35) return isLight ? "#EF4444" : "#7F1D1D";
  if (pct < 0.35) return isLight ? "#CBD5E1" : "#1E293B";
  if (pct < 2) return isLight ? "#22C55E" : "#14532D";
  if (pct < 5) return "#16A34A";
  return "#15803D";
}

function fmtCompact(val: number | null | undefined): string {
  if (!val || !Number.isFinite(val)) return "—";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString("en-US")}`;
}

export function EChartsTreemap({
  sectors,
  liveQuotes,
  onSelectSymbol,
}: {
  sectors: TreemapSector[];
  liveQuotes: Record<string, LiveRowQuote>;
  onSelectSymbol: (canonicalSymbol: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onSelectRef = useRef(onSelectSymbol);
  onSelectRef.current = onSelectSymbol;
  const isLight = useIsLightTheme();

  // Throttle live WS updates to 3 seconds so tiles never flicker
  const [throttledQuotes, setThrottledQuotes] = useState<Record<string, LiveRowQuote>>(liveQuotes);
  const latestQuotesRef = useRef(liveQuotes);
  latestQuotesRef.current = liveQuotes;
  const lastFlushRef = useRef(0);

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - lastFlushRef.current;
    if (elapsed >= 3000) {
      lastFlushRef.current = now;
      setThrottledQuotes(liveQuotes);
      return;
    }
    const timer = window.setTimeout(() => {
      lastFlushRef.current = performance.now();
      setThrottledQuotes(latestQuotesRef.current);
    }, 3000 - elapsed);
    return () => window.clearTimeout(timer);
  }, [liveQuotes]);

  // Build ECharts hierarchical treemap data
  const treeData = useMemo(() => {
    const borderColor = isLight ? "#FFFFFF" : "#0B0E14";
    const neutralTextColor = isLight ? "#0F172A" : "#E2E8F0";

    return sectors.map((sec) => ({
      name: sec.sector,
      children: sec.items.map((item) => {
        const canon = item.canonical_symbol || item.ticker.replace("-USD", "USD").replace("=X", "").replace("=F", "");
        const lq = throttledQuotes[canon] || throttledQuotes[item.ticker];
        const price = lq?.price ?? item.price;
        const pct = lq && Number.isFinite(lq.changePct) && lq.changePct !== 0 ? lq.changePct : item.change_pct;
        const vol = lq?.volume24h ?? item.volume;
        const bg = getDiscreteTileColor(pct, isLight);
        const isNeutral = Math.abs(pct) < 0.35;

        return {
          name: item.ticker.replace("-USD", "").replace("=X", "").replace("=F", ""),
          value: Math.max(1, Number(item.weight || 10)),
          canonicalSymbol: canon,
          fullName: item.name,
          sectorName: sec.sector,
          price,
          changePct: pct,
          volume: vol,
          marketCap: item.market_cap,
          itemStyle: {
            color: bg,
            borderColor,
            borderWidth: 1,
          },
          label: {
            color: isNeutral ? neutralTextColor : "#F8FAFC",
          },
        };
      }),
    }));
  }, [sectors, throttledQuotes, isLight]);

  // Initialize ECharts instance once + resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chartRef.current = chart;

    chart.on("click", (params: unknown) => {
      const p = params as { data?: { canonicalSymbol?: string } };
      if (p.data?.canonicalSymbol) {
        onSelectRef.current(p.data.canonicalSymbol);
      }
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // In-place lazyUpdate without recreating chart instance
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const bg = isLight ? "#F8FAFC" : "#0B0E14";
    const panelBg = isLight ? "#FFFFFF" : "#11161F";
    const border = isLight ? "#CBD5E1" : "#1E2634";
    const textPrimary = isLight ? "#0F172A" : "#E2E8F0";
    const textMuted = isLight ? "#475569" : "#94A3B8";

    chart.setOption(
      {
        backgroundColor: bg,
        animationDurationUpdate: 250,
        tooltip: {
          confine: true,
          backgroundColor: panelBg,
          borderColor: border,
          borderWidth: 1,
          padding: [8, 10],
          textStyle: {
            color: textPrimary,
            fontSize: 11,
            fontFamily: "var(--app-font-sans, Inter, sans-serif)",
          },
          formatter: (params: unknown) => {
            const p = params as {
              name?: string;
              data?: {
                fullName?: string;
                sectorName?: string;
                price?: number | null;
                changePct?: number;
                volume?: number | null;
                canonicalSymbol?: string;
              };
            };
            const d = p.data;
            if (!d?.canonicalSymbol) {
              return `<div style="font-weight:600">${p.name ?? ""}</div>`;
            }
            const pct = Number(d.changePct ?? 0);
            const pctColor = pct > 0 ? "#22C55E" : pct < 0 ? "#EF4444" : textMuted;
            const pxStr =
              d.price !== null && d.price !== undefined
                ? `$${Number(d.price).toLocaleString("en-US", { maximumFractionDigits: d.price < 10 ? 4 : 2 })}`
                : "—";
            return `
              <div style="min-width:170px;font-variant-numeric:tabular-nums">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:4px">
                  <span style="font-weight:700;font-size:12px">${p.name}</span>
                  <span style="font-weight:700;color:${pctColor}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>
                </div>
                <div style="color:${textMuted};font-size:10px;margin-bottom:6px">${d.fullName ?? ""} · ${d.sectorName ?? ""}</div>
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                  <span style="color:${textMuted}">Цена:</span>
                  <span style="font-weight:600">${pxStr}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px">
                  <span style="color:${textMuted}">Объём 24ч:</span>
                  <span style="font-weight:600">${fmtCompact(d.volume)}</span>
                </div>
                <div style="border-top:1px solid ${border};padding-top:4px;font-size:10px;color:#3B82F6">
                  Клик — открыть график ${d.canonicalSymbol}
                </div>
              </div>
            `;
          },
        },
        series: [
          {
            type: "treemap",
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            left: 2,
            right: 2,
            top: 2,
            bottom: 2,
            label: {
              show: true,
              position: "inside",
              fontFamily: "var(--app-font-sans, Inter, sans-serif)",
              formatter: (params: unknown) => {
                const p = params as { name?: string; data?: { changePct?: number } };
                const pct = Number(p.data?.changePct ?? 0);
                return `{sym|${p.name ?? ""}}\n{pct|${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%}`;
              },
              rich: {
                sym: {
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 16,
                },
                pct: {
                  fontSize: 10,
                  fontWeight: 600,
                  lineHeight: 14,
                },
              },
            },
            upperLabel: {
              show: true,
              height: 18,
              color: textPrimary,
              backgroundColor: panelBg,
              fontSize: 10,
              fontWeight: 700,
              padding: [2, 6],
            },
            itemStyle: {
              borderColor: bg,
              borderWidth: 2,
              gapWidth: 2,
            },
            levels: [
              {
                itemStyle: {
                  borderColor: border,
                  borderWidth: 2,
                  gapWidth: 3,
                },
                upperLabel: { show: false },
              },
              {
                itemStyle: {
                  borderColor: border,
                  borderWidth: 1,
                  gapWidth: 2,
                },
                upperLabel: {
                  show: true,
                  height: 18,
                },
              },
            ],
            data: treeData,
          },
        ],
      },
      { lazyUpdate: true },
    );
  }, [treeData, isLight]);

  return <div ref={containerRef} className="h-full w-full min-h-[480px]" />;
}
