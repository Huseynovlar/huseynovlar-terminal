import { useCallback, useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, FileSpreadsheet, RefreshCw, Sparkles } from "lucide-react";

import {
  type AnalyticsDrawdownPt,
  type AnalyticsEquityPt,
  type DailyPnlPt,
  HourlyWeekdayCharts,
  type HourlyPnlPt,
  PnlCalendarHeatmap,
  SyncedEquityDrawdownCharts,
  type WeekdayPnlPt,
} from "@/components/analytics/AnalyticsCharts";
import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/analytics")({
  component: AnalyticsLabPage,
});

interface TradeStats {
  total_trades: number;
  win_rate_pct: number;
  profit_factor: number;
  net_pnl_usd: number;
  expectancy_usd: number;
  avg_win_usd: number;
  avg_loss_usd: number;
  max_drawdown_pct: number;
  max_drawdown_usd: number;
  max_consecutive_wins: number;
  max_consecutive_losses: number;
  recovery_factor: number;
  sharpe_ratio: number;
  sortino_ratio?: number;
  calmar_ratio?: number;
  daily_var_95_usd?: number;
  twr_pct?: number;
  profit_share_pct?: number;
}

interface AnalyticsOverview {
  portfolio: {
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    accounts_count: number;
  };
  metrics: TradeStats;
  equity_curve: AnalyticsEquityPt[];
  drawdown_curve: AnalyticsDrawdownPt[];
  daily_pnl: DailyPnlPt[];
  hourly_pnl: HourlyPnlPt[];
  weekday_pnl?: WeekdayPnlPt[];
  by_symbol: Array<{ symbol: string } & TradeStats>;
  by_robot: Array<{ robot_name: string; magic_number: number } & TradeStats>;
}

interface AiReviewResponse {
  provider: string;
  generated_at_utc: string;
  review: string;
}

function renderAiReviewBlocks(text: string) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return null;
        if (line.startsWith("### ") || line.startsWith("## ")) {
          return (
            <h4
              key={idx}
              className="pt-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-primary)] first:pt-0"
            >
              {line.replace(/^#{2,3}\s+/, "")}
            </h4>
          );
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent-blue)]" />
              <span>{line.replace(/^[-•]\s+/, "")}</span>
            </div>
          );
        }
        return <p key={idx}>{line}</p>;
      })}
    </div>
  );
}

function AnalyticsLabPage() {
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [days, setDays] = useState("90");
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("");

  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mt5_login: string }>>(
    [],
  );
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  // AI Review state (60s timeout, provider-agnostic, strictly NO tables)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReview, setAiReview] = useState<AiReviewResponse | null>(null);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string; mt5_login: string }>>("/accounts")
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadAnalytics = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({ days });
        if (accountId) qs.set("account_id", accountId);
        if (symbol.trim()) qs.set("symbol", symbol.trim().toUpperCase());
        if (side) qs.set("side", side);
        const res = await apiRequest<AnalyticsOverview>(`/analytics/overview?${qs.toString()}`);
        setData(res);
      } catch (err) {
        if (!silent)
          notify.error("Ошибка загрузки аналитики", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [days, accountId, symbol, side],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadAnalytics(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [loadAnalytics]);

  // Zero REST polling — silent refresh on /ws/account trade_event
  useLiveEvents(
    ["trade_event"],
    useCallback(() => {
      void loadAnalytics(true);
    }, [loadAnalytics]),
  );

  async function handleRunAiReview() {
    setAiLoading(true);
    try {
      const res = await apiRequest<AiReviewResponse>("/analytics/ai-review", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId || null,
          symbol: symbol.trim() ? symbol.trim().toUpperCase() : null,
          side: side || null,
          days: Number(days) || 90,
        }),
      });
      setAiReview(res);
    } catch (err) {
      notify.error("Ошибка AI Обзора", err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleExport(fmt: "csv" | "xlsx") {
    setExporting(fmt);
    try {
      const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
      const fn = await apiDownload(
        `/analytics/statement.${fmt}${qs}`,
        `huseynovlar_analytics.${fmt}`,
      );
      notify.success("Отчёт экспортирован", fn);
    } catch (err) {
      notify.error("Ошибка экспорта", err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }

  const mask = (v: string) => (privacyMode ? "••••••" : v);
  const m = data?.metrics;

  return (
    <TerminalPageShell
      title="Аналитика и риски"
      subtitle="Apache ECharts v6 · синхронизированная просадка · расчёты в USD (USC ÷ 100) строго без ALLINT"
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={exporting === "csv"}
            loadingText="CSV..."
            onClick={() => void handleExport("csv")}
          >
            <Download className="mr-1.5 size-3.5" />
            CSV
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={exporting === "xlsx"}
            loadingText="XLSX..."
            onClick={() => void handleExport("xlsx")}
          >
            <FileSpreadsheet className="mr-1.5 size-3.5" />
            XLSX
          </AsyncButton>
          <button
            type="button"
            onClick={() => void loadAnalytics(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </button>
        </>
      }
    >
      {/* Compact Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs">
        <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px] tabular-nums">
          {[
            { d: "7", l: "7D" },
            { d: "30", l: "30D" },
            { d: "90", l: "90D" },
            { d: "365", l: "1Y" },
            { d: "3650", l: "ALL" },
          ].map((item) => (
            <button
              key={item.d}
              type="button"
              onClick={() => setDays(item.d)}
              className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                days === item.d
                  ? "bg-[var(--accent-blue)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {item.l}
            </button>
          ))}
        </div>

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-primary)]"
        >
          <option value="">Все счета</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} (#{a.mt5_login})
            </option>
          ))}
        </select>

        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Тикер (XAUUSD...)"
          className="h-7 w-36 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[11px]"
        />

        <select
          value={side}
          onChange={(e) => setSide(e.target.value)}
          className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-primary)]"
        >
          <option value="">Все стороны</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
      </div>

      {loading && !data ? (
        <PageSkeleton />
      ) : data && m ? (
        <div className="space-y-3">
          {/* 2x4 Institutional Risk Metrics Grid */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
            {[
              { label: "Sharpe Ratio", value: m.sharpe_ratio.toFixed(2) },
              { label: "Sortino Ratio", value: (m.sortino_ratio ?? 0).toFixed(2) },
              { label: "Calmar Ratio", value: (m.calmar_ratio ?? 0).toFixed(2) },
              { label: "Profit Factor", value: m.profit_factor.toFixed(2) },
              {
                label: "Expectancy ($)",
                value: mask(formatSignedUsd(m.expectancy_usd)),
                color: m.expectancy_usd >= 0 ? "var(--bull)" : "var(--bear)",
              },
              {
                label: "Max Consec W / L",
                value: `${m.max_consecutive_wins} / ${m.max_consecutive_losses}`,
              },
              { label: "Recovery Factor", value: m.recovery_factor.toFixed(2) },
              {
                label: "Daily VaR (95%)",
                value: mask(formatSignedUsd(m.daily_var_95_usd ?? 0)),
                color: (m.daily_var_95_usd ?? 0) < 0 ? "var(--bear)" : "var(--text-primary)",
              },
            ].map((cell) => (
              <div
                key={cell.label}
                className="flex h-[52px] flex-col justify-center bg-[var(--bg-panel)] px-3"
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-muted)]">
                  {cell.label}
                </span>
                <span
                  className="text-[15px] font-semibold tabular-nums"
                  style={{ color: cell.color ?? "var(--text-primary)" }}
                >
                  {cell.value}
                </span>
              </div>
            ))}
          </div>

          {/* Synchronized Equity / TWR + Underwater Drawdown */}
          <SyncedEquityDrawdownCharts
            equityCurve={data.equity_curve}
            drawdownCurve={data.drawdown_curve}
          />

          {/* Calendar Heatmap */}
          <PnlCalendarHeatmap
            daily={data.daily_pnl}
            onSelectDate={() => void navigate({ to: "/dashboard/journal" })}
          />

          {/* Hourly (UTC) & Weekday Attribution */}
          <HourlyWeekdayCharts
            hourly={data.hourly_pnl}
            weekday={data.weekday_pnl ?? []}
          />

          {/* Attribution Tables: By Symbol & By Robot vs Manual */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* By Ticker */}
            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Атрибуция по тикерам
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Тикер</th>
                    <th className="px-2 text-right">Сделок</th>
                    <th className="px-2 text-right">WR %</th>
                    <th className="px-2 text-right">PF</th>
                    <th className="px-2 text-right">Доля %</th>
                    <th className="px-3 text-right">Net PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.by_symbol.map((s) => (
                    <tr key={s.symbol} className="h-8 hover:bg-[var(--bg-elevated)]/50">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">{s.symbol}</td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {s.total_trades}
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {s.win_rate_pct.toFixed(1)}%
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {s.profit_factor.toFixed(2)}
                      </td>
                      <td className="px-2 text-right text-[var(--text-muted)]">
                        {(s.profit_share_pct ?? 0).toFixed(1)}%
                      </td>
                      <td
                        className="px-3 text-right font-semibold"
                        style={{ color: s.net_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {mask(formatSignedUsd(s.net_pnl_usd))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By Robot vs Manual */}
            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Атрибуция по роботам и ручной торговле
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Робот / Magic</th>
                    <th className="px-2 text-right">Сделок</th>
                    <th className="px-2 text-right">WR %</th>
                    <th className="px-2 text-right">PF</th>
                    <th className="px-3 text-right">Net PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.by_robot.map((r, idx) => (
                    <tr key={`${r.magic_number}-${idx}`} className="h-8 hover:bg-[var(--bg-elevated)]/50">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">
                        {r.robot_name || (r.magic_number === 0 ? "Manual" : `EA #${r.magic_number}`)}
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {r.total_trades}
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {r.win_rate_pct.toFixed(1)}%
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {r.profit_factor.toFixed(2)}
                      </td>
                      <td
                        className="px-3 text-right font-semibold"
                        style={{ color: r.net_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {mask(formatSignedUsd(r.net_pnl_usd))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Обзор Panel (Section 5.3 — 60s timeout, NO Markdown tables) */}
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[var(--accent-blue)]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  AI Обзор рисков и эффективности
                </span>
                {aiReview && (
                  <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    {aiReview.provider}
                  </span>
                )}
              </div>
              <AsyncButton
                size="sm"
                loading={aiLoading}
                loadingText="Анализ метрик (до 60s)..."
                onClick={() => void handleRunAiReview()}
              >
                <Sparkles className="mr-1.5 size-3.5" />
                Сформировать AI Обзор
              </AsyncButton>
            </div>

            <div className="pt-3">
              {aiLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-blue)]" />
                  Выполняется детерминированный разбор риск-метрик...
                </div>
              ) : aiReview ? (
                renderAiReviewBlocks(aiReview.review)
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  Нажмите «Сформировать AI Обзор» для получения структурированной диагностики
                  сильных сторон, уязвимостей риска и рекомендаций по параметрам (без таблиц, на
                  основе текущего среза метрик).
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </TerminalPageShell>
  );
}
