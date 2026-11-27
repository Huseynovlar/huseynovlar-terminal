import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, RefreshCw, Search } from "lucide-react";

import {
  CotNetPositionChart,
  type CotPoint,
} from "@/components/institutional/InstitutionalCharts";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/ownership/")({
  component: InstitutionalFlowsPage,
});

interface CotResponse {
  contract: string;
  cftc_name: string;
  linked_symbol: string;
  source: string;
  latest: CotPoint & {
    comm_long: number;
    comm_short: number;
    mm_net_delta_1w: number;
    comm_net_delta_1w: number;
    oi_delta_1w: number;
  };
  series: CotPoint[];
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

type ContractKey = "GOLD" | "USTEC" | "SP500" | "WTI" | "EUR" | "JPY";

const CONTRACTS: Array<{ id: ContractKey; label: string }> = [
  { id: "GOLD", label: "Gold / XAUUSD" },
  { id: "USTEC", label: "Nasdaq 100 / USTEC" },
  { id: "SP500", label: "S&P 500" },
  { id: "WTI", label: "WTI Oil" },
  { id: "EUR", label: "EUR" },
  { id: "JPY", label: "JPY" },
];

function fmtSignedInt(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US")}`;
}

function InstitutionalFlowsPage() {
  const [tab, setTab] = useState<"cot" | "sec">("cot");
  const [contract, setContract] = useState<ContractKey>("GOLD");
  const [cotData, setCotData] = useState<CotResponse | null>(null);
  const [cotLoading, setCotLoading] = useState(true);

  const [secQuery, setSecQuery] = useState("NVDA");
  const [secInput, setSecInput] = useState("NVDA");
  const [secData, setSecData] = useState<SecResponse | null>(null);
  const [secLoading, setSecLoading] = useState(false);

  const loadCot = useCallback(async (c: ContractKey, silent = false) => {
    if (!silent) setCotLoading(true);
    try {
      const res = await apiRequest<CotResponse>(`/institutional/cot?contract=${encodeURIComponent(c)}`);
      setCotData(res);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки COT", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setCotLoading(false);
    }
  }, []);

  const loadSec = useCallback(async (q: string, silent = false) => {
    if (!silent) setSecLoading(true);
    try {
      const res = await apiRequest<SecResponse>(`/institutional/sec?q=${encodeURIComponent(q)}`);
      setSecData(res);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки SEC EDGAR", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setSecLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCot(contract, cotData !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  useEffect(() => {
    if (tab === "sec") {
      void loadSec(secQuery, secData !== null && secData.query === secQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, secQuery]);

  function handleSecSearch(e: FormEvent) {
    e.preventDefault();
    const clean = secInput.trim().toUpperCase();
    if (clean) setSecQuery(clean);
  }

  return (
    <TerminalPageShell
      title="Институционалы и потоки"
      subtitle="CFTC Commitments of Traders (COT) · SEC EDGAR 13F-HR & Form 4 Insiders"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab("cot")}
              className={`rounded-[3px] px-2.5 py-1 font-medium ${
                tab === "cot"
                  ? "bg-[var(--accent-blue)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              CFTC COT
            </button>
            <button
              type="button"
              onClick={() => setTab("sec")}
              className={`rounded-[3px] px-2.5 py-1 font-medium ${
                tab === "sec"
                  ? "bg-[var(--accent-blue)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              SEC 13F / Инсайдеры
            </button>
          </div>
          <button
            type="button"
            onClick={() => (tab === "cot" ? void loadCot(contract, false) : void loadSec(secQuery, false))}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      }
    >
      {tab === "cot" ? (
        <div className="space-y-3">
          {/* Contract Selector */}
          <div className="flex flex-wrap items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1.5">
            {CONTRACTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setContract(c.id)}
                className={`rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  contract === c.id
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {cotLoading && !cotData ? (
            <PageSkeleton />
          ) : cotData ? (
            <>
              <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                <div className="mb-2 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                      {cotData.cftc_name}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Чистая позиция Non-Commercial / Managed Money (Long − Short) и Open Interest
                    </div>
                  </div>
                  <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
                    Отчёт: {cotData.latest.date}
                  </span>
                </div>
                <CotNetPositionChart series={cotData.series} />
              </div>

              {/* COT Breakdown Table */}
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                <table className="w-full border-collapse text-left text-[12px] tabular-nums">
                  <thead>
                    <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                      <th className="px-3">Категория участников</th>
                      <th className="px-3 text-right">Long</th>
                      <th className="px-3 text-right">Short</th>
                      <th className="px-3 text-right">Net Position</th>
                      <th className="px-3 text-right">Δ за неделю</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    <tr className="h-9 hover:bg-[var(--bg-elevated)]/50">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">
                        Non-Commercial / Managed Money
                      </td>
                      <td className="px-3 text-right text-[var(--bull)]">
                        {cotData.latest.mm_long.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 text-right text-[var(--bear)]">
                        {cotData.latest.mm_short.toLocaleString("en-US")}
                      </td>
                      <td
                        className="px-3 text-right font-semibold"
                        style={{ color: cotData.latest.mm_net >= 0 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {fmtSignedInt(cotData.latest.mm_net)}
                      </td>
                      <td
                        className="px-3 text-right font-medium"
                        style={{
                          color: cotData.latest.mm_net_delta_1w >= 0 ? "var(--bull)" : "var(--bear)",
                        }}
                      >
                        {fmtSignedInt(cotData.latest.mm_net_delta_1w)}
                      </td>
                    </tr>
                    <tr className="h-9 hover:bg-[var(--bg-elevated)]/50">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">
                        Commercials / Producers
                      </td>
                      <td className="px-3 text-right text-[var(--text-secondary)]">
                        {cotData.latest.comm_long.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 text-right text-[var(--text-secondary)]">
                        {cotData.latest.comm_short.toLocaleString("en-US")}
                      </td>
                      <td
                        className="px-3 text-right font-semibold"
                        style={{ color: cotData.latest.comm_net >= 0 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {fmtSignedInt(cotData.latest.comm_net)}
                      </td>
                      <td
                        className="px-3 text-right font-medium"
                        style={{
                          color: cotData.latest.comm_net_delta_1w >= 0 ? "var(--bull)" : "var(--bear)",
                        }}
                      >
                        {fmtSignedInt(cotData.latest.comm_net_delta_1w)}
                      </td>
                    </tr>
                    <tr className="h-9 bg-[var(--bg-canvas)]/50">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">Open Interest (Всего)</td>
                      <td className="px-3 text-right text-[var(--text-muted)]">—</td>
                      <td className="px-3 text-right text-[var(--text-muted)]">—</td>
                      <td className="px-3 text-right font-semibold text-[var(--text-primary)]">
                        {cotData.latest.open_interest.toLocaleString("en-US")}
                      </td>
                      <td
                        className="px-3 text-right font-medium"
                        style={{
                          color: cotData.latest.oi_delta_1w >= 0 ? "var(--bull)" : "var(--bear)",
                        }}
                      >
                        {fmtSignedInt(cotData.latest.oi_delta_1w)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        /* TAB 2: SEC EDGAR 13F & Form 4 Insiders */
        <div className="space-y-3">
          <form
            onSubmit={handleSecSearch}
            className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2"
          >
            <div className="relative w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                value={secInput}
                onChange={(e) => setSecInput(e.target.value)}
                placeholder="Тикер или фонд (NVDA, AAPL, MSFT, BERKSHIRE)..."
                className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-8 text-xs"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-medium text-white hover:opacity-90"
            >
              Поиск SEC EDGAR
            </button>
            <div className="flex flex-wrap items-center gap-1">
              {["NVDA", "AAPL", "MSFT", "TSLA", "BERKSHIRE"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setSecInput(preset);
                    setSecQuery(preset);
                  }}
                  className={`rounded-[3px] border px-2 py-1 text-[10px] font-semibold ${
                    secQuery === preset
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </form>

          {secLoading && !secData ? (
            <PageSkeleton />
          ) : secData ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              {/* Form 4 Insiders Table */}
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-7">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                    SEC Form 4 — Инсайдеры ({secData.entity_name} · CIK {secData.cik})
                  </span>
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Дата</th>
                      <th className="px-2">Тикер</th>
                      <th className="px-2">Инсайдер / Описание</th>
                      <th className="px-3 text-right">Документ SEC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {secData.form4.map((f, idx) => (
                      <tr key={idx} className="h-9 hover:bg-[var(--bg-elevated)]/50">
                        <td className="px-3 text-[var(--text-secondary)]">{f.date}</td>
                        <td className="px-2 font-semibold text-[var(--text-primary)]">{f.ticker}</td>
                        <td className="px-2">
                          <div className="font-medium text-[var(--text-primary)]">{f.insider}</div>
                          <div className="truncate text-[10px] text-[var(--text-muted)]">
                            {f.description}
                          </div>
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={f.sec_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-blue)] hover:bg-[var(--bg-elevated)]"
                          >
                            SEC Filing
                            <ExternalLink className="size-2.5" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 13F Top Institutional Holders */}
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  SEC 13F-HR — Топ-держатели и фонды
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Фонд / Форма</th>
                      <th className="px-2 text-right">Доля %</th>
                      <th className="px-2 text-right">Δ Кв.</th>
                      <th className="px-3 text-right">SEC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {secData.holders_13f.map((h, idx) => (
                      <tr key={idx} className="h-9 hover:bg-[var(--bg-elevated)]/50">
                        <td className="px-3">
                          <div className="font-semibold text-[var(--text-primary)]">{h.holder}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {h.form} · {h.date}
                          </div>
                        </td>
                        <td className="px-2 text-right text-[var(--text-secondary)]">
                          {h.weight_pct != null ? `${h.weight_pct.toFixed(2)}%` : "—"}
                        </td>
                        <td
                          className="px-2 text-right font-medium"
                          style={{
                            color:
                              h.qoq_change_pct == null
                                ? "var(--text-muted)"
                                : h.qoq_change_pct >= 0
                                  ? "var(--bull)"
                                  : "var(--bear)",
                          }}
                        >
                          {h.qoq_change_pct != null
                            ? `${h.qoq_change_pct >= 0 ? "+" : ""}${h.qoq_change_pct.toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={h.sec_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--accent-blue)] hover:underline"
                          >
                            13F <ExternalLink className="size-2.5" />
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
