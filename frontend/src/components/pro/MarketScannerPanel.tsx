import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { Activity, ArrowUpRight, Flame, RefreshCw, TrendingDown, TrendingUp, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiRequest } from "@/framework/api-client";

interface ScannerRow {
  symbol: string;
  exchange_symbol: string;
  price: number;
  change_window_pct: number;
  change_24h_pct: number;
  quote_volume_24h: number;
  rvol: number;
  atr_expansion: number;
  funding_rate_pct: number;
  anomalies: string[];
  anomaly_score: number;
}

interface ScannerResponse {
  window: string;
  status: string;
  updated_at: string;
  summary: {
    rvol_spikes: number;
    atr_expansions: number;
    extreme_funding: number;
    total_scanned: number;
  };
  items: ScannerRow[];
}

type WindowOpt = "5m" | "15m" | "1h" | "24h";
type FilterOpt = "all" | "rvol" | "atr" | "funding" | "gainers" | "losers";

function fmtPrice(v: number): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(6);
}

function fmtVol(v: number): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

export function MarketScannerPanel({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [windowOpt, setWindowOpt] = useState<WindowOpt>("15m");
  const [filterOpt, setFilterOpt] = useState<FilterOpt>("all");
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<ScannerResponse>(`/pro/scanner?window=${windowOpt}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [windowOpt]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const items = data?.items ? [...data.items] : [];
    switch (filterOpt) {
      case "rvol":
        return items.filter((x) => x.rvol >= 2.5).sort((a, b) => b.rvol - a.rvol);
      case "atr":
        return items.filter((x) => x.atr_expansion >= 1.8).sort((a, b) => b.atr_expansion - a.atr_expansion);
      case "funding":
        return items
          .filter((x) => Math.abs(x.funding_rate_pct) >= 0.05)
          .sort((a, b) => Math.abs(b.funding_rate_pct) - Math.abs(a.funding_rate_pct));
      case "gainers":
        return items.sort((a, b) => b.change_window_pct - a.change_window_pct);
      case "losers":
        return items.sort((a, b) => a.change_window_pct - b.change_window_pct);
      default:
        return items;
    }
  }, [data, filterOpt]);

  const openTicker = (sym: string) => {
    void navigate({
      to: "/dashboard/tickers/$symbol" as never,
      params: { symbol: sym } as never,
    });
  };

  return (
    <div className="space-y-3">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
            <Flame className="size-3 text-[var(--accent-amber)]" />
            RVOL ≥ 2.5x
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-[var(--text-primary)]">
            {data?.summary.rvol_spikes ?? 0}
          </div>
        </div>
        <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
            <Activity className="size-3 text-[var(--accent-blue)]" />
            ATR Expansion
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-[var(--text-primary)]">
            {data?.summary.atr_expansions ?? 0}
          </div>
        </div>
        <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
            <Zap className="size-3 text-[var(--bear)]" />
            Extreme Funding (±0.05%)
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-[var(--text-primary)]">
            {data?.summary.extreme_funding ?? 0}
          </div>
        </div>
        <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Просканировано ({windowOpt})
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-[18px] font-bold tabular-nums text-[var(--text-primary)]">
              {data?.summary.total_scanned ?? 0}
            </span>
            <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
              {data?.status === "live" ? "● LIVE" : "○ CACHE"}
            </span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: "all", label: "Все аномалии" },
              { id: "rvol", label: "RVOL ≥ 2.5x" },
              { id: "atr", label: "ATR Expansion" },
              { id: "funding", label: "Extreme Funding" },
              { id: "gainers", label: "Лидеры роста" },
              { id: "losers", label: "Лидеры падения" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterOpt(f.id)}
              className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filterOpt === f.id
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--text-primary)]"
                  : "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            {(["5m", "15m", "1h", "24h"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowOpt(w)}
                className={`rounded-[3px] px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  windowOpt === w
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
      </div>

      {/* Scanner table */}
      <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <th className="px-3 py-2">Тикер</th>
              <th className="px-3 py-2 text-right">Цена</th>
              <th className="px-3 py-2 text-right">Δ ({windowOpt})</th>
              {!compact && <th className="px-3 py-2 text-right">Δ 24ч</th>}
              <th className="px-3 py-2 text-right">RVOL (20p)</th>
              <th className="px-3 py-2 text-right">ATR Exp</th>
              <th className="px-3 py-2 text-right">Funding 8h</th>
              {!compact && <th className="px-3 py-2 text-right">Объём 24ч</th>}
              <th className="px-3 py-2">Сигналы</th>
              <th className="px-3 py-2 text-right">Терминал</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)] font-mono tabular-nums">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={compact ? 8 : 10} className="px-4 py-8 text-center font-sans text-[12px] text-[var(--text-muted)]">
                  {loading ? "Сканирование рыночных аномалий..." : "По выбранному фильтру аномалий не найдено"}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const pos = row.change_window_pct >= 0;
                const pos24 = row.change_24h_pct >= 0;
                const rvolHot = row.rvol >= 2.5;
                const atrHot = row.atr_expansion >= 1.8;
                const fundHot = Math.abs(row.funding_rate_pct) >= 0.05;
                return (
                  <tr
                    key={row.exchange_symbol}
                    onClick={() => openTicker(row.symbol)}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-3 py-2 font-sans font-semibold text-[var(--text-primary)]">
                      {row.symbol}
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-[var(--text-muted)]">
                        {row.exchange_symbol}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--text-primary)]">{fmtPrice(row.price)}</td>
                    <td
                      className="px-3 py-2 text-right font-semibold"
                      style={{ color: pos ? "var(--bull)" : "var(--bear)" }}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {pos ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {pos ? "+" : ""}
                        {row.change_window_pct.toFixed(2)}%
                      </span>
                    </td>
                    {!compact && (
                      <td
                        className="px-3 py-2 text-right"
                        style={{ color: pos24 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {pos24 ? "+" : ""}
                        {row.change_24h_pct.toFixed(2)}%
                      </td>
                    )}
                    <td
                      className="px-3 py-2 text-right font-semibold"
                      style={{ color: rvolHot ? "var(--accent-amber)" : "var(--text-secondary)" }}
                    >
                      {row.rvol.toFixed(2)}x
                    </td>
                    <td
                      className="px-3 py-2 text-right font-semibold"
                      style={{ color: atrHot ? "var(--accent-blue)" : "var(--text-secondary)" }}
                    >
                      {row.atr_expansion.toFixed(2)}x
                    </td>
                    <td
                      className="px-3 py-2 text-right"
                      style={{
                        color: fundHot
                          ? row.funding_rate_pct > 0
                            ? "var(--bear)"
                            : "var(--bull)"
                          : "var(--text-muted)",
                      }}
                    >
                      {row.funding_rate_pct >= 0 ? "+" : ""}
                      {row.funding_rate_pct.toFixed(4)}%
                    </td>
                    {!compact && (
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">
                        {fmtVol(row.quote_volume_24h)}
                      </td>
                    )}
                    <td className="px-3 py-2 font-sans">
                      <div className="flex flex-wrap gap-1">
                        {row.anomalies.length === 0 ? (
                          <span className="text-[10px] text-[var(--text-muted)]">—</span>
                        ) : (
                          row.anomalies.map((tag) => (
                            <span
                              key={tag}
                              className={`rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                                tag === "RVOL_SPIKE"
                                  ? "border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]"
                                  : tag === "ATR_EXPANSION"
                                    ? "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                                    : "border-[var(--bear)]/40 bg-[var(--bear)]/15 text-[var(--bear)]"
                              }`}
                            >
                              {tag}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-0.5 font-sans text-[11px] font-medium text-[var(--accent-blue)]">
                        GP
                        <ArrowUpRight className="size-3" />
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
