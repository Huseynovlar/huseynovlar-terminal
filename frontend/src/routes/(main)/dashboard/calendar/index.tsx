import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, ExternalLink, RefreshCw } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/calendar/")({
  component: CalendarsHubPage,
});

export interface MacroCalendarEvent {
  id: string;
  title: string;
  currency: string;
  impact: string;
  actual?: string;
  forecast: string;
  previous: string;
  surprise?: string;
  surprise_dir?: "better" | "worse" | "neutral";
  event_time: string;
  affected_assets?: string[];
}

interface TokenUnlockItem {
  id: string;
  date: string;
  token: string;
  symbol: string;
  ticker: string;
  event_type: string;
  unlock_tokens: number;
  unlock_usd: number;
  pct_circulating: number;
  source: string;
  source_url: string;
}

interface EarningsItem {
  id: string;
  date: string;
  session: "BMO" | "AMC" | string;
  symbol: string;
  company_name: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate_b: number | null;
  revenue_actual_b: number | null;
  sec_url: string;
}

type CalTab = "macro" | "unlocks" | "earnings";
type PeriodPreset = "today" | "tomorrow" | "this_week" | "next_week" | "month";

const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "today", label: "Сегодня" },
  { id: "tomorrow", label: "Завтра" },
  { id: "this_week", label: "Эта неделя" },
  { id: "next_week", label: "След. неделя" },
  { id: "month", label: "Месяц" },
];

const CURRENCY_FILTERS = ["ALL", "USD", "EUR", "GBP", "JPY", "CNY"] as const;

function getPresetRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

  if (preset === "today") return { from: fmt(utcDayStart), to: fmt(utcDayStart) };
  if (preset === "tomorrow") {
    const t = addDays(utcDayStart, 1);
    return { from: fmt(t), to: fmt(t) };
  }
  if (preset === "this_week") {
    const dow = (utcDayStart.getUTCDay() + 6) % 7;
    const mon = addDays(utcDayStart, -dow);
    return { from: fmt(mon), to: fmt(addDays(mon, 6)) };
  }
  if (preset === "next_week") {
    const dow = (utcDayStart.getUTCDay() + 6) % 7;
    const nextMon = addDays(utcDayStart, 7 - dow);
    return { from: fmt(nextMon), to: fmt(addDays(nextMon, 6)) };
  }
  return { from: fmt(utcDayStart), to: fmt(addDays(utcDayStart, 30)) };
}

/** Crisp inline SVG currency flags — zero emoji */
function CurrencyFlagSvg({ currency }: { currency: string }) {
  const c = currency.toUpperCase();
  if (c === "USD") {
    return (
      <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px]" aria-hidden="true">
        <rect width="18" height="12" fill="#B22234" />
        <rect y="2" width="18" height="1.5" fill="#fff" />
        <rect y="5" width="18" height="1.5" fill="#fff" />
        <rect y="8" width="18" height="1.5" fill="#fff" />
        <rect y="10.5" width="18" height="1.5" fill="#fff" />
        <rect width="8" height="6.5" fill="#3C3B6E" />
      </svg>
    );
  }
  if (c === "EUR") {
    return (
      <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px]" aria-hidden="true">
        <rect width="18" height="12" fill="#003399" />
        <circle cx="9" cy="6" r="3.2" fill="none" stroke="#FFCC00" strokeWidth="1" strokeDasharray="1 1.5" />
      </svg>
    );
  }
  if (c === "GBP") {
    return (
      <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px]" aria-hidden="true">
        <rect width="18" height="12" fill="#012169" />
        <path d="M0 0 L18 12 M18 0 L0 12" stroke="#fff" strokeWidth="2" />
        <path d="M9 0 V12 M0 6 H18" stroke="#fff" strokeWidth="3" />
        <path d="M9 0 V12 M0 6 H18" stroke="#C8102E" strokeWidth="1.6" />
      </svg>
    );
  }
  if (c === "JPY") {
    return (
      <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px] border border-[var(--border-subtle)]" aria-hidden="true">
        <rect width="18" height="12" fill="#ffffff" />
        <circle cx="9" cy="6" r="3.2" fill="#BC002D" />
      </svg>
    );
  }
  if (c === "CNY") {
    return (
      <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px]" aria-hidden="true">
        <rect width="18" height="12" fill="#DE2910" />
        <circle cx="4.5" cy="4" r="1.4" fill="#FFDE00" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 12" className="h-3 w-4.5 shrink-0 rounded-[1px]" aria-hidden="true">
      <rect width="18" height="12" fill="#334155" />
      <rect x="2" y="5" width="14" height="2" fill="#94A3B8" />
    </svg>
  );
}

/** 3-bar institutional impact signal — zero emoji */
function ImpactBars({ impact }: { impact: string }) {
  const lvl = impact.toLowerCase() === "high" ? 3 : impact.toLowerCase() === "medium" ? 2 : 1;
  const activeColor = lvl === 3 ? "var(--bear)" : lvl === 2 ? "var(--accent-amber)" : "var(--text-muted)";
  return (
    <div className="inline-flex items-end gap-[2px]" title={impact}>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className="w-[3px] rounded-[1px]"
          style={{
            height: `${bar * 4 + 2}px`,
            backgroundColor: bar <= lvl ? activeColor : "var(--border-subtle)",
          }}
        />
      ))}
    </div>
  );
}

function fmtUsdCompact(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${usd.toLocaleString("en-US")}`;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const hms = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return days > 0 ? `${days}д ${hms}` : hms;
}

function CalendarsHubPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<CalTab>("macro");
  const [preset, setPreset] = useState<PeriodPreset>("this_week");
  const [currency, setCurrency] = useState<string>("ALL");
  const [highOnly, setHighOnly] = useState(false);

  const [macroEvents, setMacroEvents] = useState<MacroCalendarEvent[]>([]);
  const [unlocks, setUnlocks] = useState<TokenUnlockItem[]>([]);
  const [earnings, setEarnings] = useState<EarningsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 1-second local countdown tick (zero REST polling)
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadMacro = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const range = getPresetRange(preset);
        const qs = new URLSearchParams();
        qs.set("from", range.from);
        qs.set("to", range.to);
        if (currency !== "ALL") qs.set("currency", currency);
        if (highOnly) qs.set("impact", "High");
        const rows = await apiRequest<MacroCalendarEvent[]>(`/intelligence/calendar?${qs.toString()}`);
        setMacroEvents(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки календаря", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [currency, highOnly, preset],
  );

  const loadUnlocks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest<{ items: TokenUnlockItem[] }>("/intelligence/calendar/unlocks");
      setUnlocks(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки анлоков", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadEarnings = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest<{ items: EarningsItem[] }>("/intelligence/calendar/earnings");
      setEarnings(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки отчётности", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "macro") void loadMacro(false);
    else if (tab === "unlocks") void loadUnlocks(false);
    else void loadEarnings(false);
  }, [tab, loadMacro, loadUnlocks, loadEarnings]);

  useLiveEvents("calendar_alert", () => {
    if (tab === "macro") void loadMacro(true);
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      if (tab === "macro") {
        await apiRequest("/intelligence/calendar/refresh", { method: "POST" });
        await loadMacro(true);
      } else if (tab === "unlocks") {
        await loadUnlocks(true);
      } else {
        await loadEarnings(true);
      }
      notify.success("Календарь обновлён");
    } catch (err) {
      notify.error("Ошибка обновления", err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  // Next upcoming High Impact macro event for header countdown
  const nextHighEvent = useMemo(() => {
    const upcoming = macroEvents
      .filter((e) => e.impact.toLowerCase() === "high" && new Date(e.event_time).getTime() > nowMs)
      .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
    return upcoming[0] ?? null;
  }, [macroEvents, nowMs]);

  return (
    <TerminalPageShell
      title="Календари"
      subtitle="Макроэкономика (FOMC / FRED / ForexFactory) · Токен-анлоки (DefiLlama) · Отчётность компаний (SEC / Finnhub)"
      badge={
        nextHighEvent
          ? `До ${nextHighEvent.title.slice(0, 22)}: ${fmtCountdown(new Date(nextHighEvent.event_time).getTime() - nowMs)}`
          : "UTC"
      }
      actions={
        <div className="flex items-center gap-2">
          {nextHighEvent ? (
            <div className="hidden items-center gap-1.5 rounded-[4px] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[var(--accent-amber)] md:inline-flex">
              <Clock className="size-3.5" />
              <span>
                До {nextHighEvent.currency} {nextHighEvent.title.slice(0, 20)}:{" "}
                {fmtCountdown(new Date(nextHighEvent.event_time).getTime() - nowMs)}
              </span>
            </div>
          ) : null}
          <AsyncButton
            size="sm"
            variant="outline"
            loading={refreshing}
            loadingText="Обновление..."
            onClick={() => void handleRefresh()}
            className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </AsyncButton>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 3 Horizontal Tabs + Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-2">
          <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            {[
              { id: "macro", label: "Экономический календарь (Macro)" },
              { id: "unlocks", label: "Токен-анлоки и крипто" },
              { id: "earnings", label: "Отчётность компаний (Earnings)" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as CalTab)}
                className={`h-7 rounded-[3px] px-3 text-[11px] font-semibold transition-colors ${
                  tab === item.id
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "macro" ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Period Presets */}
              <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
                {PERIOD_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className={`h-6 rounded-[3px] px-2 text-[10px] font-medium ${
                      preset === p.id
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Currency Chips */}
              <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
                {CURRENCY_FILTERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    className={`h-6 rounded-[3px] px-2 text-[10px] font-semibold ${
                      currency === c
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {c === "ALL" ? "Все" : c}
                  </button>
                ))}
              </div>

              {/* High Impact Only */}
              <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={highOnly}
                  onChange={(e) => setHighOnly(e.target.checked)}
                  className="accent-[var(--bear)]"
                />
                <span>Только High Impact</span>
              </label>
            </div>
          ) : null}
        </div>

        {/* TAB 1: Macro Economic Calendar */}
        {tab === "macro" ? (
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            {loading && macroEvents.length === 0 ? (
              <div className="p-3">
                <TableSkeleton rows={8} cols={7} />
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Дата / Время (UTC)</th>
                    <th className="px-2">Валюта</th>
                    <th className="px-2 text-center">Важность</th>
                    <th className="px-3">Событие</th>
                    <th className="px-2 text-right">Факт (Actual)</th>
                    <th className="px-2 text-right">Прогноз</th>
                    <th className="px-2 text-right">Пред.</th>
                    <th className="px-3 text-right">Отклонение</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {macroEvents.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs text-[var(--text-muted)]">
                        Нет макро-событий за выбранный период
                      </td>
                    </tr>
                  ) : (
                    macroEvents.map((ev) => {
                      const actualColor =
                        ev.surprise_dir === "better"
                          ? "var(--bull)"
                          : ev.surprise_dir === "worse"
                            ? "var(--bear)"
                            : "var(--text-primary)";
                      return (
                        <tr key={ev.id} className="h-9 hover:bg-[var(--bg-elevated)]/50">
                          <td className="px-3 text-[var(--text-secondary)]">
                            {formatTerminalDateTime(ev.event_time, { timezone: "UTC" })}
                          </td>
                          <td className="px-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                              <CurrencyFlagSvg currency={ev.currency} />
                              <span>{ev.currency}</span>
                            </div>
                          </td>
                          <td className="px-2 text-center">
                            <ImpactBars impact={ev.impact} />
                          </td>
                          <td className="px-3 font-medium text-[var(--text-primary)]">
                            <Link
                              to="/dashboard/calendar/$eventId"
                              params={{ eventId: ev.id }}
                              className="hover:text-[var(--accent-blue)] hover:underline"
                            >
                              {ev.title}
                            </Link>
                          </td>
                          <td className="px-2 text-right font-semibold" style={{ color: actualColor }}>
                            {ev.actual || "—"}
                          </td>
                          <td className="px-2 text-right text-[var(--text-secondary)]">{ev.forecast || "—"}</td>
                          <td className="px-2 text-right text-[var(--text-muted)]">{ev.previous || "—"}</td>
                          <td className="px-3 text-right font-semibold" style={{ color: actualColor }}>
                            {ev.surprise || "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {/* TAB 2: Token Unlocks & Crypto Events */}
        {tab === "unlocks" ? (
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            {loading && unlocks.length === 0 ? (
              <div className="p-3">
                <TableSkeleton rows={8} cols={6} />
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Дата (UTC)</th>
                    <th className="px-3">Токен</th>
                    <th className="px-2">Тип события</th>
                    <th className="px-2 text-right">Объём разлока</th>
                    <th className="px-2 text-right">% от Circulating</th>
                    <th className="px-3 text-right">Источник</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {unlocks.map((u) => {
                    const pctColor =
                      u.pct_circulating >= 5
                        ? "var(--bear)"
                        : u.pct_circulating > 2
                          ? "var(--accent-amber)"
                          : "var(--text-secondary)";
                    return (
                      <tr
                        key={u.id}
                        onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: u.symbol } })}
                        className="h-10 cursor-pointer hover:bg-[var(--bg-elevated)]/50"
                      >
                        <td className="px-3 text-[var(--text-secondary)]">{u.date.slice(0, 10)}</td>
                        <td className="px-3">
                          <div className="flex items-center gap-2">
                            <AssetLogo symbol={u.symbol} size={18} />
                            <div>
                              <div className="font-semibold text-[var(--text-primary)]">{u.ticker}</div>
                              <div className="text-[10px] text-[var(--text-muted)]">{u.token}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2">
                          <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                            {u.event_type}
                          </span>
                        </td>
                        <td className="px-2 text-right">
                          <div className="font-semibold text-[var(--text-primary)]">{fmtUsdCompact(u.unlock_usd)}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {u.unlock_tokens.toLocaleString("en-US")} {u.ticker}
                          </div>
                        </td>
                        <td className="px-2 text-right font-semibold" style={{ color: pctColor }}>
                          {u.pct_circulating.toFixed(2)}%
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={u.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[var(--accent-blue)] hover:underline"
                          >
                            {u.source}
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {/* TAB 3: Company Earnings */}
        {tab === "earnings" ? (
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            {loading && earnings.length === 0 ? (
              <div className="p-3">
                <TableSkeleton rows={8} cols={6} />
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Дата</th>
                    <th className="px-2">Сессия</th>
                    <th className="px-3">Тикер / Компания</th>
                    <th className="px-2 text-right">EPS Прогноз / Факт</th>
                    <th className="px-2 text-right">Выручка Прогноз / Факт</th>
                    <th className="px-3 text-right">SEC EDGAR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {earnings.map((e) => {
                    const epsBeat =
                      e.eps_actual !== null && e.eps_estimate !== null ? e.eps_actual >= e.eps_estimate : null;
                    return (
                      <tr
                        key={e.id}
                        onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: e.symbol } })}
                        className="h-10 cursor-pointer hover:bg-[var(--bg-elevated)]/50"
                      >
                        <td className="px-3 text-[var(--text-secondary)]">{e.date}</td>
                        <td className="px-2">
                          <span
                            className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              backgroundColor:
                                e.session === "BMO"
                                  ? "color-mix(in srgb, var(--accent-amber) 16%, transparent)"
                                  : "color-mix(in srgb, var(--accent-blue) 16%, transparent)",
                              color: e.session === "BMO" ? "var(--accent-amber)" : "var(--accent-blue)",
                            }}
                          >
                            {e.session}
                          </span>
                        </td>
                        <td className="px-3">
                          <div className="flex items-center gap-2">
                            <AssetLogo symbol={e.symbol} size={18} />
                            <div>
                              <div className="font-semibold text-[var(--text-primary)]">{e.symbol}</div>
                              <div className="text-[10px] text-[var(--text-muted)]">{e.company_name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 text-right">
                          <span className="text-[var(--text-muted)]">
                            {e.eps_estimate !== null ? `$${e.eps_estimate.toFixed(2)}` : "—"}
                          </span>
                          <span className="mx-1 text-[var(--text-muted)]">/</span>
                          <span
                            className="font-semibold"
                            style={{
                              color:
                                epsBeat === null
                                  ? "var(--text-primary)"
                                  : epsBeat
                                    ? "var(--bull)"
                                    : "var(--bear)",
                            }}
                          >
                            {e.eps_actual !== null ? `$${e.eps_actual.toFixed(2)}` : "Ожидается"}
                          </span>
                        </td>
                        <td className="px-2 text-right">
                          <span className="text-[var(--text-muted)]">
                            {e.revenue_estimate_b !== null ? `$${e.revenue_estimate_b.toFixed(2)}B` : "—"}
                          </span>
                          <span className="mx-1 text-[var(--text-muted)]">/</span>
                          <span className="font-semibold text-[var(--text-primary)]">
                            {e.revenue_actual_b !== null ? `$${e.revenue_actual_b.toFixed(2)}B` : "Ожидается"}
                          </span>
                        </td>
                        <td className="px-3 text-right">
                          <a
                            href={e.sec_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            className="inline-flex items-center gap-1 font-medium text-[var(--accent-blue)] hover:underline"
                          >
                            10-Q / 8-K
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>
    </TerminalPageShell>
  );
}
