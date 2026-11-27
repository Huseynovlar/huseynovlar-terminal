import { useCallback, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import {
  MacroDualChart,
  type MacroDualSeries,
  YieldCurveChart,
  type YieldCurvePoint,
} from "@/components/institutional/InstitutionalCharts";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/macro/")({
  component: MacroYieldPage,
});

interface MacroResponse {
  updated_at_utc: string;
  kpis: {
    fed_funds_rate: number;
    us10y_yield: number;
    us2y_yield: number;
    spread_10y_2y: number;
    is_inverted: boolean;
    us_cpi_yoy: number;
  };
  yield_curve: YieldCurvePoint[];
  macro_chart: MacroDualSeries;
  countries: Array<{
    code: string;
    country: string;
    policy_rate_pct: number;
    cpi_yoy_pct: number;
    gdp_yoy_pct: number;
    unemployment_pct: number;
    next_meeting: string;
  }>;
}

type SeriesKey = "CPI_FED" | "M2_DXY" | "TGA_LIQ";
type RangeKey = "1Y" | "5Y" | "10Y" | "MAX";

function MacroYieldPage() {
  const [series, setSeries] = useState<SeriesKey>("CPI_FED");
  const [rangeKey, setRangeKey] = useState<RangeKey>("5Y");
  const [showToday, setShowToday] = useState(true);
  const [showM1, setShowM1] = useState(true);
  const [showY1, setShowY1] = useState(true);

  const [data, setData] = useState<MacroResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest<MacroResponse>(
        `/institutional/macro?series=${encodeURIComponent(series)}&range=${encodeURIComponent(rangeKey)}`,
      );
      setData(res);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки макроданных", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [series, rangeKey]);

  useEffect(() => {
    void loadData(data !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, rangeKey]);

  const k = data?.kpis;

  return (
    <TerminalPageShell
      title="Макроэкономика и доходности"
      subtitle="U.S. Treasury Yield Curve · FRED Macro Series · World Bank Indicators (серверный кэш)"
      actions={
        <button
          type="button"
          onClick={() => void loadData(false)}
          className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Обновить
        </button>
      }
    >
      {loading && !data ? (
        <PageSkeleton />
      ) : data && k ? (
        <div className="space-y-3">
          {/* 5-Cell KPI Strip */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Fed Funds Rate
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.fed_funds_rate.toFixed(2)}%
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                US 10Y Yield
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.us10y_yield.toFixed(2)}%
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                US 2Y Yield
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.us2y_yield.toFixed(2)}%
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  10Y–2Y Spread
                </span>
                {k.is_inverted && (
                  <span className="rounded-[2px] border border-[var(--bear)]/50 bg-[var(--bear)]/15 px-1 text-[9px] font-semibold text-[var(--bear)]">
                    ИНВЕРСИЯ
                  </span>
                )}
              </div>
              <span
                className="text-[16px] font-semibold tabular-nums"
                style={{ color: k.is_inverted ? "var(--bear)" : "var(--bull)" }}
              >
                {k.spread_10y_2y >= 0 ? "+" : ""}
                {k.spread_10y_2y.toFixed(2)}%
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                US CPI YoY
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.us_cpi_yoy.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* 50/50 Charts Row */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Left: U.S. Treasury Yield Curve */}
            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Кривая доходности США (1M → 30Y)
                </span>
                <div className="flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={showToday} onChange={(e) => setShowToday(e.target.checked)} />
                    Сегодня
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={showM1} onChange={(e) => setShowM1(e.target.checked)} />
                    1М назад
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={showY1} onChange={(e) => setShowY1(e.target.checked)} />
                    1Г назад
                  </label>
                </div>
              </div>
              <YieldCurveChart
                points={data.yield_curve}
                showToday={showToday}
                showM1={showM1}
                showY1={showY1}
              />
            </div>

            {/* Right: FRED Macro Multi-Chart */}
            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                <select
                  value={series}
                  onChange={(e) => setSeries(e.target.value as SeriesKey)}
                  className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-primary)]"
                >
                  <option value="CPI_FED">CPI YoY vs Fed Funds</option>
                  <option value="M2_DXY">M2 Money Supply vs DXY</option>
                  <option value="TGA_LIQ">TGA Liquidity ($B) vs Fed Funds</option>
                </select>
                <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px] tabular-nums">
                  {(["1Y", "5Y", "10Y", "MAX"] as RangeKey[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRangeKey(r)}
                      className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                        rangeKey === r
                          ? "bg-[var(--accent-blue)] text-white"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <MacroDualChart data={data.macro_chart} />
            </div>
          </div>

          {/* Bottom Country Comparison Table (World Bank + Central Banks) */}
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Межстрановое сравнение (World Bank + Центральные банки)
            </div>
            <table className="w-full border-collapse text-left text-[12px] tabular-nums">
              <thead>
                <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                  <th className="px-3">Страна</th>
                  <th className="px-3 text-right">Ключевая ставка</th>
                  <th className="px-3 text-right">Инфляция YoY</th>
                  <th className="px-3 text-right">ВВП YoY</th>
                  <th className="px-3 text-right">Безработица</th>
                  <th className="px-3 text-right">Заседание ЦБ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.countries.map((c) => (
                  <tr key={c.code} className="h-9 hover:bg-[var(--bg-elevated)]/50">
                    <td className="px-3 font-semibold text-[var(--text-primary)]">{c.country}</td>
                    <td className="px-3 text-right font-semibold text-[var(--accent-blue)]">
                      {c.policy_rate_pct.toFixed(2)}%
                    </td>
                    <td className="px-3 text-right text-[var(--text-secondary)]">
                      {c.cpi_yoy_pct.toFixed(2)}%
                    </td>
                    <td
                      className="px-3 text-right font-medium"
                      style={{ color: c.gdp_yoy_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                    >
                      {c.gdp_yoy_pct >= 0 ? "+" : ""}
                      {c.gdp_yoy_pct.toFixed(2)}%
                    </td>
                    <td className="px-3 text-right text-[var(--text-secondary)]">
                      {c.unemployment_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 text-right text-[11px] text-[var(--text-muted)]">
                      {c.next_meeting}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </TerminalPageShell>
  );
}
