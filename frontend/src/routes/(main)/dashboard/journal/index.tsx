import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUp,
  Download,
  ExternalLink,
  Save,
  Search,
  Star,
  X,
} from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/journal/")({
  component: JournalPage,
});

export interface JournalDeal {
  id: string;
  account_id: string;
  account_name: string;
  currency: string;
  mt5_deal_ticket: number;
  position_id: number;
  magic_number: number;
  robot_name: string;
  symbol: string;
  side: string;
  entry: string;
  volume: number;
  price: number;
  profit_usd: number;
  commission_usd: number;
  swap_usd: number;
  net_profit_usd: number;
  time_sec?: number;
  timestamp?: string;
  notes?: string;
  tags?: string[];
}

interface RoundTripTrade {
  id: string;
  account_id: string;
  account_name: string;
  currency: string;
  position_id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  open_time_utc: string;
  close_time_utc: string;
  close_time_msc: number;
  duration_sec: number;
  volume_lots: number;
  entry_price: number;
  exit_price: number;
  gross_pnl_usd: number;
  commission_usd: number;
  swap_usd: number;
  net_pnl_usd: number;
  magic_number: number;
  robot_name: string;
  notes: string;
  tags: string[];
  rating: number | null;
  comment: string;
}

interface JournalResponse {
  summary: {
    total_trades: number;
    net_pnl_usd: number;
    win_rate_pct: number;
    profit_factor: number;
    avg_win_usd: number;
    avg_loss_usd: number;
    avg_duration_sec: number;
  };
  trades: RoundTripTrade[];
}

type PeriodKey = "TODAY" | "7D" | "30D" | "90D" | "YTD" | "ALL";
type SortField = "close_time_msc" | "symbol" | "volume_lots" | "duration_sec" | "net_pnl_usd";

const QUICK_TAGS = ["#setup-A", "#news", "#overtrade", "#fomo", "#breakeven"];

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "<1m";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function JournalPage() {
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  // Filters (40px bar)
  const [period, setPeriod] = useState<PeriodKey>("30D");
  const [accountId, setAccountId] = useState("");
  const [robotFilter, setRobotFilter] = useState("ALL");
  const [sideFilter, setSideFilter] = useState<"" | "LONG" | "SHORT">("");
  const [resultFilter, setResultFilter] = useState<"" | "WIN" | "LOSS">("");
  const [tagFilter, setTagFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [robots, setRobots] = useState<Array<{ id: string; name: string; magic_number: number }>>([]);
  const [data, setData] = useState<JournalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("close_time_msc");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Right Trade Detail Drawer
  const [selected, setSelected] = useState<RoundTripTrade | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [ratingDraft, setRatingDraft] = useState<number>(0);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string }>>("/accounts")
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    apiRequest<Array<{ id: string; name: string; magic_number: number }>>("/robots")
      .then((rows) => setRobots(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadTrades = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ period });
        if (accountId) params.set("account_id", accountId);
        if (robotFilter !== "ALL") params.set("robot", robotFilter);
        if (sideFilter) params.set("side", sideFilter);
        if (resultFilter) params.set("result", resultFilter);
        if (tagFilter) params.set("tag", tagFilter);
        if (searchQ.trim()) params.set("q", searchQ.trim());
        const res = await apiRequest<JournalResponse>(`/journal/trades?${params.toString()}`);
        setData(res);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки журнала", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [period, accountId, robotFilter, sideFilter, resultFilter, tagFilter, searchQ],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadTrades(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [loadTrades]);

  // Zero REST polling — silent refresh strictly on /ws/account trade_event
  useLiveEvents(
    ["trade_event"],
    useCallback(() => {
      void loadTrades(true);
    }, [loadTrades]),
  );

  const sortedTrades = useMemo(() => {
    const list = [...(data?.trades ?? [])];
    list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const na = Number(av ?? 0);
      const nb = Number(bv ?? 0);
      return sortDir === "asc" ? na - nb : nb - na;
    });
    return list;
  }, [data?.trades, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function openTradeDrawer(tr: RoundTripTrade) {
    setSelected(tr);
    setNotesDraft(tr.notes || "");
    setTagsDraft(tr.tags || []);
    setRatingDraft(tr.rating || 0);
    setCustomTag("");
  }

  function toggleQuickTag(tag: string) {
    setTagsDraft((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  }

  async function handleSaveAnnotation() {
    if (!selected) return;
    setSavingNote(true);
    try {
      const nextTags = [...tagsDraft];
      if (ratingDraft >= 1 && ratingDraft <= 5) {
        nextTags.push(`rating:${ratingDraft}`);
      }
      await apiRequest(`/journal/deals/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes: notesDraft,
          tags: nextTags,
        }),
      });
      notify.success("Заметка и теги сохранены");
      await loadTrades(true);
      setSelected((prev) =>
        prev ? { ...prev, notes: notesDraft, tags: tagsDraft, rating: ratingDraft || null } : null,
      );
    } catch (err) {
      notify.error("Ошибка сохранения", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingNote(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
      const fn = await apiDownload(`/analytics/statement.csv${qs}`, "huseynovlar_journal.csv");
      notify.success("CSV экспортирован", fn);
    } catch (err) {
      notify.error("Ошибка экспорта", err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const mask = (v: string) => (privacyMode ? "••••••" : v);
  const sum = data?.summary;

  return (
    <TerminalPageShell
      title="Журнал сделок"
      subtitle="Склейка IN + OUT по position_id · строгий USD (USC ÷ 100) · без ALLINT и балансовых операций"
      badge={sum ? `${sum.total_trades} сделок` : undefined}
      actions={
        <AsyncButton
          size="sm"
          variant="outline"
          loading={exporting}
          loadingText="Экспорт..."
          onClick={() => void handleExportCsv()}
        >
          <Download className="mr-1.5 size-3.5" />
          Экспорт CSV
        </AsyncButton>
      }
    >
      {/* 1-Row Compact Filter Bar (40px) */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs">
        <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px] tabular-nums">
          {(["TODAY", "7D", "30D", "90D", "YTD", "ALL"] as PeriodKey[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-[3px] px-2 py-0.5 font-semibold transition-colors ${
                period === p
                  ? "bg-[var(--accent-blue)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {p === "TODAY" ? "Сегодня" : p}
            </button>
          ))}
        </div>

        <div className="w-40">
          <SearchSelect value={accountId} onValueChange={setAccountId} className="h-7 text-[11px]">
            <option value="">Все счета</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SearchSelect>
        </div>

        <div className="w-44">
          <SearchSelect value={robotFilter} onValueChange={setRobotFilter} className="h-7 text-[11px]">
            <option value="ALL">Все (EA + Manual)</option>
            <option value="MANUAL">Только ручные</option>
            {robots.map((r) => (
              <option key={r.id} value={String(r.magic_number)}>
                {r.name} (#{r.magic_number})
              </option>
            ))}
          </SearchSelect>
        </div>

        <div className="w-28">
          <SearchSelect
            value={sideFilter}
            onValueChange={(v) => setSideFilter(v as "" | "LONG" | "SHORT")}
            className="h-7 text-[11px]"
          >
            <option value="">Сторона</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </SearchSelect>
        </div>

        <div className="w-28">
          <SearchSelect
            value={resultFilter}
            onValueChange={(v) => setResultFilter(v as "" | "WIN" | "LOSS")}
            className="h-7 text-[11px]"
          >
            <option value="">Результат</option>
            <option value="WIN">Win (+)</option>
            <option value="LOSS">Loss (-)</option>
          </SearchSelect>
        </div>

        <div className="w-32">
          <SearchSelect value={tagFilter} onValueChange={setTagFilter} className="h-7 text-[11px]">
            <option value="">Все теги</option>
            {QUICK_TAGS.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </SearchSelect>
        </div>

        <div className="relative ml-auto w-44">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Тикер, заметка..."
            className="h-7 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-7 text-[11px]"
          />
        </div>
      </div>

      {/* Summary Strip for Current Filter (Server-computed) */}
      {sum && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-6">
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Сделок</span>
            <span className="text-[14px] font-semibold tabular-nums text-[var(--text-primary)]">
              {sum.total_trades}
            </span>
          </div>
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Net PnL</span>
            <span
              className="text-[14px] font-semibold tabular-nums"
              style={{ color: sum.net_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)" }}
            >
              {mask(formatSignedUsd(sum.net_pnl_usd))}
            </span>
          </div>
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Winrate</span>
            <span className="text-[14px] font-semibold tabular-nums text-[var(--text-primary)]">
              {sum.win_rate_pct.toFixed(1)}%
            </span>
          </div>
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Profit Factor</span>
            <span className="text-[14px] font-semibold tabular-nums text-[var(--text-primary)]">
              {sum.profit_factor.toFixed(2)}
            </span>
          </div>
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Avg Win / Loss</span>
            <span className="text-[12px] font-semibold tabular-nums">
              <span className="text-[var(--bull)]">+{formatUsd(sum.avg_win_usd)}</span>
              <span className="mx-1 text-[var(--text-muted)]">/</span>
              <span className="text-[var(--bear)]">-{formatUsd(sum.avg_loss_usd)}</span>
            </span>
          </div>
          <div className="flex h-[48px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] uppercase text-[var(--text-muted)]">Ср. удержание</span>
            <span className="text-[14px] font-semibold tabular-nums text-[var(--text-primary)]">
              {formatDuration(sum.avg_duration_sec)}
            </span>
          </div>
        </div>
      )}

      {/* Main Split: Table + Right Trade Detail Drawer */}
      <div className={`grid grid-cols-1 gap-3 ${selected ? "xl:grid-cols-12" : ""}`}>
        <div
          className={`max-h-[65vh] overflow-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] ${
            selected ? "xl:col-span-8" : ""
          }`}
        >
          {loading ? (
            <div className="p-3">
              <TableSkeleton rows={8} cols={8} />
            </div>
          ) : sortedTrades.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              Нет закрытых сделок по выбранным фильтрам
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                <tr className="h-8">
                  <th
                    className="cursor-pointer px-3 hover:text-[var(--text-primary)]"
                    onClick={() => toggleSort("close_time_msc")}
                  >
                    Закрытие (UTC) <ArrowDownUp className="inline size-2.5" />
                  </th>
                  <th
                    className="cursor-pointer px-2 hover:text-[var(--text-primary)]"
                    onClick={() => toggleSort("symbol")}
                  >
                    Тикер / Сторона
                  </th>
                  <th className="px-2">Робот / Счёт</th>
                  <th
                    className="cursor-pointer px-2 text-right hover:text-[var(--text-primary)]"
                    onClick={() => toggleSort("volume_lots")}
                  >
                    Лот
                  </th>
                  <th className="px-2 text-right">Вход → Выход</th>
                  <th
                    className="cursor-pointer px-2 text-right hover:text-[var(--text-primary)]"
                    onClick={() => toggleSort("duration_sec")}
                  >
                    Длит.
                  </th>
                  <th
                    className="cursor-pointer px-3 text-right hover:text-[var(--text-primary)]"
                    onClick={() => toggleSort("net_pnl_usd")}
                  >
                    Net PnL (USD) <ArrowDownUp className="inline size-2.5" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sortedTrades.map((tr) => {
                  const isSel = selected?.id === tr.id;
                  return (
                    <tr
                      key={tr.id}
                      onClick={() => openTradeDrawer(tr)}
                      className={`h-[38px] cursor-pointer transition-colors ${
                        isSel ? "bg-[var(--accent-blue)]/10" : "hover:bg-[var(--bg-elevated)]/60"
                      }`}
                    >
                      <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                        {formatTerminalDateTime(tr.close_time_utc, { timezone: "UTC" })}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <AssetLogo symbol={canonicalMarketSymbol(tr.symbol)} size={15} />
                          <span className="font-semibold text-[var(--text-primary)]">
                            {tr.symbol}
                          </span>
                          <span
                            className="rounded-[2px] px-1 text-[9px] font-semibold"
                            style={{
                              backgroundColor:
                                tr.side === "LONG"
                                  ? "rgba(0,212,136,0.14)"
                                  : "rgba(255,71,87,0.14)",
                              color: tr.side === "LONG" ? "var(--bull)" : "var(--bear)",
                            }}
                          >
                            {tr.side}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-[var(--text-primary)]">{tr.robot_name}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {tr.account_name}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
                        {tr.volume_lots.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
                        {tr.entry_price} → {tr.exit_price}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">
                        {formatDuration(tr.duration_sec)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div
                          className="font-semibold"
                          style={{ color: tr.net_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)" }}
                        >
                          {mask(formatSignedUsd(tr.net_pnl_usd))}
                        </div>
                        {tr.tags.length > 0 && (
                          <div className="text-[9px] text-[var(--accent-blue)]">
                            {tr.tags.slice(0, 2).join(" ")}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right Trade Detail Drawer */}
        {selected && (
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] xl:col-span-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-2">
                <AssetLogo symbol={canonicalMarketSymbol(selected.symbol)} size={18} />
                <div>
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                    {selected.symbol} · {selected.side}
                  </div>
                  <div className="text-[10px] tabular-nums text-[var(--text-muted)]">
                    Pos #{selected.position_id} · {selected.robot_name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-[3px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
              {/* Breakdown Grid */}
              <div className="grid grid-cols-2 gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 text-[11px] tabular-nums">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)]">Net PnL</span>
                  <div
                    className="text-[14px] font-semibold"
                    style={{
                      color: selected.net_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)",
                    }}
                  >
                    {mask(formatSignedUsd(selected.net_pnl_usd))}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)]">Gross / Comm / Swap</span>
                  <div className="text-[var(--text-secondary)]">
                    {formatSignedUsd(selected.gross_pnl_usd)} / {formatSignedUsd(selected.commission_usd)} /{" "}
                    {formatSignedUsd(selected.swap_usd)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)]">Открытие (UTC)</span>
                  <div className="text-[var(--text-secondary)]">
                    {formatTerminalDateTime(selected.open_time_utc, { timezone: "UTC" })}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)]">Длительность</span>
                  <div className="text-[var(--text-secondary)]">
                    {formatDuration(selected.duration_sec)}
                  </div>
                </div>
              </div>

              {/* Rating 1-5 */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                  Оценка исполнения (1–5)
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingDraft(star)}
                      className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1 hover:bg-[var(--bg-elevated)]"
                    >
                      <Star
                        className="size-3.5"
                        style={{
                          color: star <= ratingDraft ? "var(--accent-amber)" : "var(--text-muted)",
                          fill: star <= ratingDraft ? "var(--accent-amber)" : "none",
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                  Теги
                </div>
                <div className="flex flex-wrap gap-1">
                  {QUICK_TAGS.map((tg) => {
                    const active = tagsDraft.includes(tg);
                    return (
                      <button
                        key={tg}
                        type="button"
                        onClick={() => toggleQuickTag(tg)}
                        className={`rounded-[3px] border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          active
                            ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                            : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]"
                        }`}
                      >
                        {tg}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-1">
                  <Input
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    placeholder="#свой-тег"
                    className="h-7 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = customTag.trim();
                      if (clean && !tagsDraft.includes(clean)) {
                        setTagsDraft((p) => [...p, clean]);
                        setCustomTag("");
                      }
                    }}
                    className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] hover:bg-[var(--bg-elevated)]"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                  Заметки трейдера (Markdown)
                </div>
                <textarea
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Разбор входа, контекст рынка, ошибки..."
                  className="w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <AsyncButton
                  size="sm"
                  loading={savingNote}
                  loadingText="Сохранение..."
                  onClick={() => void handleSaveAnnotation()}
                >
                  <Save className="mr-1.5 size-3.5" />
                  Сохранить
                </AsyncButton>
                <button
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: "/dashboard/tickers/$symbol",
                      params: { symbol: canonicalMarketSymbol(selected.symbol) || selected.symbol },
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent-blue)] hover:bg-[var(--bg-elevated)]"
                >
                  Показать в терминале
                  <ExternalLink className="size-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TerminalPageShell>
  );
}
