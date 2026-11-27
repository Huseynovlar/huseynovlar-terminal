import { useCallback, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import {
  MacroDualChart,
  type MacroDualSeries,
  NetLiquidityChart,
  YieldCurveChart,
  type YieldCurvePoint,
} from "@/components/institutional/InstitutionalCharts";
import { PolymarketMacroCard } from "@/components/institutional/PolymarketMacroCard";
import { SearchSelect } from "@/components/ui/search-select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/macro/")({
  component: MacroYieldPage,
});

interface MacroOverviewResponse {
  updated_at_utc: string;
  kpis: {
    fed_funds_rate: number;
    us10y_yield: number;
    us2y_yield: number;
    spread_10y_2y: number;
    spread_10y_3m: number;
    is_inverted: boolean;
    us_cpi_yoy: number;
    core_pce_yoy: number;
    real_yield_10y_tips: number;
    us_unemployment: number;
    dxy_index: number;
  };
  yield_curve: YieldCurvePoint[];
  macro_chart: MacroDualSeries;
  net_liquidity: {
    dates: string[];
    walcl_t: number[];
    tga_t: number[];
    rrp_t: number[];
    net_liquidity_t: number[];
    latest_t: number;
  };
  inflation_labor: Array<{
    name: string;
    latest: string;
    previous: string;
    delta: string;
    date: string;
  }>;
  fed_policy_path: {
    effr_pct: number;
    us2y_pct: number;
    implied_delta_bps: number;
    implied_25bp_moves: number;
    bias: string;
  };
  countries: Array<{
    code: string;
    country: string;
    policy_rate_pct: number;
    cpi_yoy_pct: number;
    real_rate_pct: number;
    bond_10y_pct: number;
    gdp_yoy_pct: number;
    unemployment_pct: number;
    debt_to_gdp_pct: number;
    next_meeting: string;
  }>;
}

const FRED_SERIES_OPTIONS = [
  { id: "CPI_FED", label: "CPI YoY vs Fed Funds Rate" },
  { id: "M2_DXY", label: "M2 Money Supply vs DXY Index" },
  { id: "TGA_LIQ", label: "TGA Treasury Cash vs Fed Funds" },
] as const;

const HORIZON_OPTIONS = ["1Y", "5Y", "10Y", "MAX"] as const;

function MacroYieldPage() {
  const [data, setData] = useState<MacroOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<string>("CPI_FED");
  const [horizon, setHorizon] = useState<string>("5Y");
  const [showToday, setShowToday] = useState(true);
  const [show1m, setShow1m] = useState(true);
  const [show1y, setShow1y] = useState(true);

  const loadMacro = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiRequest<MacroOverviewResponse>(
          `/institutional/macro?series=${encodeURIComponent(series)}&horizon=${encodeURIComponent(horizon)}`,
        );
        setData(res);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки макро-данных", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [horizon, series],
  );

  useEffect(() => {
    void loadMacro(false);
  }, [loadMacro]);

  const k = data?.kpis;

  return (
    <TerminalPageShell
      title="Макроэкономика и доходности"
      subtitle="U.S. Treasury Yield Curve · FRED Macro · US Net Liquidity (WALCL - TGA - RRP) · 11 Economies Matrix"
      badge={k?.is_inverted ? "10Y-2Y INVERTED" : "FRED + TREASURY"}
      actions={
        <button
          type="button"
          onClick={() => void loadMacro(false)}
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
          {/* Expanded 10-Cell Institutional KPI Strip */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-5">
            {[
              { label: "Fed Funds Rate", val: `${k.fed_funds_rate.toFixed(2)}%`, color: "var(--text-primary)" },
              { label: "US 10Y Yield", val: `${k.us10y_yield.toFixed(2)}%`, color: "var(--text-primary)" },
              { label: "US 2Y Yield", val: `${k.us2y_yield.toFixed(2)}%`, color: "var(--text-primary)" },
              {
                label: "10Y-2Y Spread",
                val: `${k.spread_10y_2y >= 0 ? "+" : ""}${k.spread_10y_2y.toFixed(2)}%`,
                color: k.spread_10y_2y < 0 ? "var(--bear)" : "var(--bull)",
              },
              {
                label: "10Y-3M Spread",
                val: `${k.spread_10y_3m >= 0 ? "+" : ""}${k.spread_10y_3m.toFixed(2)}%`,
                color: k.spread_10y_3m < 0 ? "var(--bear)" : "var(--bull)",
              },
              { label: "US CPI YoY", val: `${k.us_cpi_yoy.toFixed(2)}%`, color: "var(--accent-amber)" },
              { label: "Core PCE YoY", val: `${k.core_pce_yoy.toFixed(2)}%`, color: "var(--accent-amber)" },
              { label: "Real Yield 10Y (TIPS)", val: `${k.real_yield_10y_tips.toFixed(2)}%`, color: "var(--text-primary)" },
              { label: "US Unemployment", val: `${k.us_unemployment.toFixed(1)}%`, color: "var(--text-primary)" },
              { label: "DXY Index", val: k.dxy_index.toFixed(2), color: "var(--accent-blue)" },
            ].map((cell) => (
              <div key={cell.label} className="flex h-[52px] flex-col justify-center bg-[var(--bg-panel)] px-3">
                <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  {cell.label}
                </span>
                <span className="text-[15px] font-semibold tabular-nums" style={{ color: cell.color }}>
                  {cell.val}
                </span>
              </div>
            ))}
          </div>

          {/* Row 1: Yield Curve + FRED Dual Series (with custom SearchSelect, zero native <select>) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Кривая доходности США (1M → 30Y)
                </span>
                <div className="flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
                  <label className="flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={showToday} onChange={(e) => setShowToday(e.target.checked)} />
                    Сегодня
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={show1m} onChange={(e) => setShow1m(e.target.checked)} />
                    1 мес
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={show1y} onChange={(e) => setShow1y(e.target.checked)} />
                    1 год
                  </label>
                </div>
              </div>
              <YieldCurveChart points={data.yield_curve} showToday={showToday} showM1={show1m} showY1={show1y} />
            </div>

            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
                <div className="w-56">
                  <SearchSelect
                    value={series}
                    onChange={(e) => setSeries(e.target.value)}
                    className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-primary)]"
                  >
                    {FRED_SERIES_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </SearchSelect>
                </div>
                <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px]">
                  {HORIZON_OPTIONS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHorizon(h)}
                      className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                        horizon === h ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <MacroDualChart data={data.macro_chart} />
            </div>
          </div>

          {/* Row 2: US Net Liquidity Chart + Implied Fed Policy Path + Inflation & Labor Components */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-7">
              <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                <div className="mb-2 flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                    Чистая ликвидность США (Net Liquidity = WALCL − TGA − RRP)
                  </span>
                  <span className="text-xs font-bold tabular-nums text-[var(--bull)]">
                    ${data.net_liquidity.latest_t.toFixed(2)}T
                  </span>
                </div>
                <NetLiquidityChart
                  dates={data.net_liquidity.dates}
                  walcl={data.net_liquidity.walcl_t}
                  tga={data.net_liquidity.tga_t}
                  rrp={data.net_liquidity.rrp_t}
                  netLiq={data.net_liquidity.net_liquidity_t}
                />
              </div>

              {/* Implied Fed Policy Path */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
                <div className="bg-[var(--bg-panel)] p-2.5 tabular-nums">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Текущая EFFR</div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {data.fed_policy_path.effr_pct.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-[var(--bg-panel)] p-2.5 tabular-nums">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Рынок (US 2Y)</div>
                  <div className="text-[14px] font-semibold text-[var(--accent-blue)]">
                    {data.fed_policy_path.us2y_pct.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-[var(--bg-panel)] p-2.5 tabular-nums">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Ожидание (bps)</div>
                  <div
                    className="text-[14px] font-semibold"
                    style={{ color: data.fed_policy_path.implied_delta_bps < 0 ? "var(--bull)" : "var(--bear)" }}
                  >
                    {data.fed_policy_path.implied_delta_bps >= 0 ? "+" : ""}
                    {data.fed_policy_path.implied_delta_bps} bps ({data.fed_policy_path.implied_25bp_moves}×25bp)
                  </div>
                </div>
                <div className="bg-[var(--bg-panel)] p-2.5">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Implied Policy Bias</div>
                  <div className="text-[12px] font-semibold text-[var(--accent-amber)]">
                    {data.fed_policy_path.bias}
                  </div>
                </div>
              </div>
            </div>

            {/* Inflation & Labor Components Table */}
            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Компоненты инфляции и рынка труда (FRED)
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Показатель</th>
                    <th className="px-2 text-right">Последнее</th>
                    <th className="px-2 text-right">Пред.</th>
                    <th className="px-3 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.inflation_labor.map((row) => (
                    <tr key={row.name} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                      <td className="px-3 font-medium text-[var(--text-primary)]">{row.name}</td>
                      <td className="px-2 text-right font-semibold text-[var(--text-primary)]">{row.latest}</td>
                      <td className="px-2 text-right text-[var(--text-muted)]">{row.previous}</td>
                      <td
                        className="px-3 text-right font-semibold"
                        style={{ color: row.delta.startsWith("-") ? "var(--bull)" : "var(--accent-amber)" }}
                      >
                        {row.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Row 3: Expanded 11-Economy Macro Matrix */}
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Глобальная матрица экономик и Центральных банков ({data.countries.length} стран)
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="px-3">Страна / ЦБ</th>
                  <th className="px-2 text-right">Ставка</th>
                  <th className="px-2 text-right">CPI YoY</th>
                  <th className="px-2 text-right">Реальная ставка</th>
                  <th className="px-2 text-right">10Y Yield</th>
                  <th className="px-2 text-right">ВВП YoY</th>
                  <th className="px-2 text-right">Безраб.</th>
                  <th className="px-2 text-right">Debt/GDP</th>
                  <th className="px-3 text-right">Заседание ЦБ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.countries.map((c) => (
                  <tr key={c.code} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                    <td className="px-3 font-semibold text-[var(--text-primary)]">{c.country}</td>
                    <td className="px-2 text-right font-semibold text-[var(--accent-blue)]">
                      {c.policy_rate_pct.toFixed(2)}%
                    </td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">{c.cpi_yoy_pct.toFixed(2)}%</td>
                    <td
                      className="px-2 text-right font-semibold"
                      style={{ color: c.real_rate_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                    >
                      {c.real_rate_pct >= 0 ? "+" : ""}
                      {c.real_rate_pct.toFixed(2)}%
                    </td>
                    <td className="px-2 text-right text-[var(--text-primary)]">{c.bond_10y_pct.toFixed(2)}%</td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">{c.gdp_yoy_pct.toFixed(1)}%</td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">{c.unemployment_pct.toFixed(1)}%</td>
                    <td className="px-2 text-right text-[var(--text-muted)]">{c.debt_to_gdp_pct.toFixed(1)}%</td>
                    <td className="px-3 text-right text-[var(--text-muted)]">{c.next_meeting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PolymarketMacroCard />
        </div>
      ) : null}
    </TerminalPageShell>
  );
}
