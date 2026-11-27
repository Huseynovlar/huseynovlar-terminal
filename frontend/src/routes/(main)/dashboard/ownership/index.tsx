import { useCallback, useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLink, RefreshCw, Search } from "lucide-react";

import { CotNetPositionChart, type CotPoint } from "@/components/institutional/InstitutionalCharts";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/ownership/")({
  component: OwnershipInstitutionalPage,
});

interface CotCategoryRow {
  name: string;
  long: number;
  short: number;
  spreading: number;
  net: number;
  pct_oi: number;
  delta_1w: number;
  cot_index_52w: number | null;
}

interface CotResponse {
  contract: string;
  cftc_code: string;
  cftc_name: string;
  linked_symbol: string;
  report_type: string;
  period: string;
  source: string;
  cot_index_52w: number;
  latest: {
    date: string;
    mm_long: number;
    mm_short: number;
    mm_net: number;
    mm_net_delta_1w: number;
    comm_long: number;
    comm_short: number;
    comm_net: number;
    comm_net_delta_1w: number;
    open_interest: number;
    oi_delta_1w: number;
  };
  categories: CotCategoryRow[];
  series: CotPoint[];
}

interface CotPulseItem {
  contract: string;
  cftc_code: string;
  linked_symbol: string;
  mm_net: number;
  mm_net_delta_1w: number;
  open_interest: number;
  cot_index_52w: number;
  bias: string;
  date: string;
}

interface SecResponse {
  query: string;
  cik: string;
  entity_name: string;
  source: string;
  form4: Array<{
    date: string;
    ticker: string;
    insider: string;
    role: string;
    tx_type: string;
    value_usd: number | null;
    price: number | null;
    accession: string;
    description: string;
    sec_url: string;
  }>;
  holders_13f: Array<{
    holder: string;
    form: string;
    date: string;
    weight_pct: number | null;
    qoq_change_pct: number | null;
    sec_url: string;
  }>;
}

const COT_CONTRACTS = [
  { id: "GOLD", label: "Gold (XAUUSD)" },
  { id: "USTEC", label: "Nasdaq 100" },
  { id: "SP500", label: "S&P 500" },
  { id: "WTI", label: "WTI Oil" },
  { id: "EUR", label: "Euro FX" },
  { id: "JPY", label: "Japanese Yen" },
] as const;

function OwnershipInstitutionalPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"cot" | "sec">("cot");
  const [contract, setContract] = useState("GOLD");
  const [reportType, setReportType] = useState<"disaggregated" | "tff">("disaggregated");
  const [period, setPeriod] = useState<"6M" | "1Y" | "3Y" | "5Y">("1Y");
  const [cot, setCot] = useState<CotResponse | null>(null);
  const [cotPulse, setCotPulse] = useState<CotPulseItem[]>([]);
  const [cotLoading, setCotLoading] = useState(true);

  const [secQuery, setSecQuery] = useState("NVDA");
  const [secInput, setSecInput] = useState("NVDA");
  const [buyOnly, setBuyOnly] = useState(false);
  const [min100k, setMin100k] = useState(false);
  const [sec, setSec] = useState<SecResponse | null>(null);
  const [secLoading, setSecLoading] = useState(false);

  const loadCot = useCallback(async () => {
    setCotLoading(true);
    try {
      const [res, pulse] = await Promise.all([
        apiRequest<CotResponse>(`/institutional/cot?contract=${contract}&report_type=${reportType}&period=${period}`),
        apiRequest<{ items: CotPulseItem[] }>("/institutional/cot/pulse"),
      ]);
      setCot(res);
      setCotPulse(pulse?.items ?? []);
    } catch (err) {
      notify.error("Ошибка загрузки CFTC COT", err instanceof Error ? err.message : String(err));
    } finally {
      setCotLoading(false);
    }
  }, [contract, period, reportType]);

  const loadSec = useCallback(async (q: string, onlyBuy: boolean, over100k: boolean) => {
    setSecLoading(true);
    try {
      const qs = new URLSearchParams({
        q,
        buy_only: String(onlyBuy),
        min_usd: over100k ? "100000" : "0",
      });
      const res = await apiRequest<SecResponse>(`/institutional/sec?${qs.toString()}`);
      setSec(res);
    } catch (err) {
      notify.error("Ошибка загрузки SEC EDGAR", err instanceof Error ? err.message : String(err));
    } finally {
      setSecLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCot();
  }, [loadCot]);

  useEffect(() => {
    if (tab === "sec") void loadSec(secQuery, buyOnly, min100k);
  }, [tab, secQuery, buyOnly, min100k, loadSec]);

  return (
    <TerminalPageShell
      title="Институционалы и потоки"
      subtitle="CFTC COT (Canonical Contract Codes, 5-Category Breakdown, 52W COT Index & All-Assets Pulse) · SEC EDGAR 13F & Form 4"
      badge={cot ? `CFTC #${cot.cftc_code}` : "CFTC + SEC"}
      actions={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab("cot")}
              className={`rounded-[3px] px-3 py-1 font-semibold ${
                tab === "cot" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
              }`}
            >
              CFTC COT
            </button>
            <button
              type="button"
              onClick={() => setTab("sec")}
              className={`rounded-[3px] px-3 py-1 font-semibold ${
                tab === "sec" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
              }`}
            >
              SEC 13F / Form 4
            </button>
          </div>
          <button
            type="button"
            onClick={() => (tab === "cot" ? void loadCot() : void loadSec(secQuery, buyOnly, min100k))}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      }
    >
      {tab === "cot" ? (
        <div className="space-y-3">
          {/* Controls Strip: Contracts + Report Type + Period */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2">
            <div className="flex flex-wrap items-center gap-1">
              {COT_CONTRACTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setContract(c.id)}
                  className={`h-7 rounded-[4px] px-2.5 text-[11px] font-semibold ${
                    contract === c.id
                      ? "bg-[var(--accent-blue)] text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
                {[
                  { id: "disaggregated", label: "Disaggregated" },
                  { id: "tff", label: "TFF" },
                ].map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => setReportType(rt.id as "disaggregated" | "tff")}
                    className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                      reportType === rt.id ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 tabular-nums">
                {(["6M", "1Y", "3Y", "5Y"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                      period === p ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {cotLoading && !cot ? (
            <PageSkeleton />
          ) : cot ? (
            <>
              {/* Smooth COT Net Position Chart */}
              <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5 text-[11px]">
                  <span className="font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                    {cot.cftc_name} (Code #{cot.cftc_code}) · Managed Money Net vs Open Interest
                  </span>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-[var(--text-muted)]">
                      52W COT Index:{" "}
                      <b
                        style={{
                          color:
                            cot.cot_index_52w >= 80
                              ? "var(--bull)"
                              : cot.cot_index_52w <= 20
                                ? "var(--bear)"
                                : "var(--accent-amber)",
                        }}
                      >
                        {cot.cot_index_52w.toFixed(1)}%
                      </b>
                    </span>
                    <span className="text-[var(--text-muted)]">Отчёт: {cot.latest.date}</span>
                  </div>
                </div>
                <CotNetPositionChart series={cot.series} />
              </div>

              {/* Full 5-Category COT Breakdown Table */}
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Полная разбивка позиций CFTC (5 категорий · 52W Percentile)
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Категория участников</th>
                      <th className="px-2 text-right">Long</th>
                      <th className="px-2 text-right">Short</th>
                      <th className="px-2 text-right">Spreading</th>
                      <th className="px-2 text-right">Net</th>
                      <th className="px-2 text-right">% of OI</th>
                      <th className="px-2 text-right">Δ за неделю</th>
                      <th className="px-3 text-right">52W COT Index</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {cot.categories.map((cat) => (
                      <tr key={cat.name} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                        <td className="px-3 font-semibold text-[var(--text-primary)]">{cat.name}</td>
                        <td className="px-2 text-right text-[var(--bull)]">{cat.long.toLocaleString("en-US")}</td>
                        <td className="px-2 text-right text-[var(--bear)]">{cat.short.toLocaleString("en-US")}</td>
                        <td className="px-2 text-right text-[var(--text-muted)]">
                          {cat.spreading > 0 ? cat.spreading.toLocaleString("en-US") : "—"}
                        </td>
                        <td
                          className="px-2 text-right font-semibold"
                          style={{ color: cat.net >= 0 ? "var(--bull)" : "var(--bear)" }}
                        >
                          {cat.net >= 0 ? "+" : ""}
                          {cat.net.toLocaleString("en-US")}
                        </td>
                        <td className="px-2 text-right text-[var(--text-secondary)]">
                          {cat.pct_oi >= 0 ? "+" : ""}
                          {cat.pct_oi.toFixed(1)}%
                        </td>
                        <td
                          className="px-2 text-right font-semibold"
                          style={{ color: cat.delta_1w >= 0 ? "var(--bull)" : "var(--bear)" }}
                        >
                          {cat.delta_1w >= 0 ? "+" : ""}
                          {cat.delta_1w.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 text-right font-semibold text-[var(--accent-amber)]">
                          {cat.cot_index_52w !== null ? `${cat.cot_index_52w.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* All-Assets COT Pulse Table */}
              {cotPulse.length > 0 ? (
                <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                  <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                    COT Pulse — Сводка потоков фондов по всем активам (клик → график)
                  </div>
                  <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                    <thead>
                      <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                        <th className="px-3">Контракт / Тикер</th>
                        <th className="px-2 text-right">Managed Money Net</th>
                        <th className="px-2 text-right">Δ за неделю</th>
                        <th className="px-2 text-right">Open Interest</th>
                        <th className="px-2 text-right">52W COT Index</th>
                        <th className="px-3 text-right">Режим</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {cotPulse.map((p) => (
                        <tr
                          key={p.contract}
                          onClick={() => setContract(p.contract)}
                          className={`h-8 cursor-pointer hover:bg-[var(--bg-elevated)]/50 ${
                            contract === p.contract ? "bg-[var(--bg-elevated)]/70" : ""
                          }`}
                        >
                          <td className="px-3 font-semibold text-[var(--text-primary)]">
                            {p.contract}{" "}
                            <span className="text-[10px] font-normal text-[var(--accent-blue)]">
                              ({p.linked_symbol})
                            </span>
                          </td>
                          <td
                            className="px-2 text-right font-semibold"
                            style={{ color: p.mm_net >= 0 ? "var(--bull)" : "var(--bear)" }}
                          >
                            {p.mm_net >= 0 ? "+" : ""}
                            {p.mm_net.toLocaleString("en-US")}
                          </td>
                          <td
                            className="px-2 text-right font-semibold"
                            style={{ color: p.mm_net_delta_1w >= 0 ? "var(--bull)" : "var(--bear)" }}
                          >
                            {p.mm_net_delta_1w >= 0 ? "+" : ""}
                            {p.mm_net_delta_1w.toLocaleString("en-US")}
                          </td>
                          <td className="px-2 text-right text-[var(--text-secondary)]">
                            {p.open_interest.toLocaleString("en-US")}
                          </td>
                          <td className="px-2 text-right font-semibold text-[var(--accent-amber)]">
                            {p.cot_index_52w.toFixed(1)}%
                          </td>
                          <td className="px-3 text-right">
                            <span
                              className="rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold"
                              style={{
                                backgroundColor: p.bias.includes("LONG") || p.bias === "BULLISH"
                                  ? "color-mix(in srgb, var(--bull) 16%, transparent)"
                                  : "color-mix(in srgb, var(--bear) 16%, transparent)",
                                color: p.bias.includes("LONG") || p.bias === "BULLISH" ? "var(--bull)" : "var(--bear)",
                              }}
                            >
                              {p.bias}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        /* TAB 2: SEC 13F & Form 4 Insiders */
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSecQuery(secInput.trim().toUpperCase() || "NVDA");
            }}
            className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5 text-xs"
          >
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={secInput}
                onChange={(e) => setSecInput(e.target.value)}
                placeholder="Тикер или фонд (NVDA, AAPL, BERKSHIRE, BRIDGEWATER, CITADEL)..."
                className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-2 pl-8 text-xs text-[var(--text-primary)]"
              />
            </div>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-[11px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} />
              Только покупки (Open Market Buy)
            </label>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-[11px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={min100k} onChange={(e) => setMin100k(e.target.checked)} />
              Сумма &gt; $100k
            </label>
            <button
              type="submit"
              className="h-8 rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-semibold text-white"
            >
              Найти в SEC EDGAR
            </button>
          </form>

          {secLoading && !sec ? (
            <PageSkeleton />
          ) : sec ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-7">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  <span>SEC Form 4 — Инсайдерские сделки ({sec.entity_name})</span>
                  <span className="text-[10px] text-[var(--text-muted)]">CIK {sec.cik}</span>
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Дата</th>
                      <th className="px-2">Тикер</th>
                      <th className="px-2">Инсайдер / Описание</th>
                      <th className="px-3 text-right">SEC Filing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {sec.form4.map((f) => (
                      <tr key={f.accession + f.date} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                        <td className="px-3 text-[var(--text-secondary)]">{f.date}</td>
                        <td className="px-2 font-semibold text-[var(--accent-blue)]">
                          <button
                            type="button"
                            onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: f.ticker } })}
                            className="hover:underline"
                          >
                            {f.ticker}
                          </button>
                        </td>
                        <td className="px-2 text-[var(--text-primary)]">
                          <div className="font-medium">{f.insider}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{f.description}</div>
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={f.sec_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-[var(--accent-blue)] hover:underline"
                          >
                            SEC ↗
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  SEC 13F-HR — Крупнейшие фонды и держатели
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Фонд</th>
                      <th className="px-2 text-right">Доля %</th>
                      <th className="px-2 text-right">QoQ Δ</th>
                      <th className="px-3 text-right">13F</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {sec.holders_13f.map((h) => (
                      <tr key={h.holder + h.date} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                        <td className="px-3 font-medium text-[var(--text-primary)]">{h.holder}</td>
                        <td className="px-2 text-right text-[var(--text-secondary)]">
                          {h.weight_pct !== null ? `${h.weight_pct.toFixed(2)}%` : "—"}
                        </td>
                        <td
                          className="px-2 text-right font-semibold"
                          style={{
                            color:
                              h.qoq_change_pct === null
                                ? "var(--text-muted)"
                                : h.qoq_change_pct >= 0
                                  ? "var(--bull)"
                                  : "var(--bear)",
                          }}
                        >
                          {h.qoq_change_pct !== null
                            ? `${h.qoq_change_pct >= 0 ? "+" : ""}${h.qoq_change_pct.toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={h.sec_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-[var(--accent-blue)] hover:underline"
                          >
                            13F ↗
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </TerminalPageShell>
  );
}
