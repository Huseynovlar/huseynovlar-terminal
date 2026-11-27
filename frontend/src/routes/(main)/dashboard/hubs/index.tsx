import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpDown,
  Copy,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { TerminalDataPanel, TerminalDropdown, TerminalPageShell } from "@/framework/templates";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export const Route = createFileRoute("/(main)/dashboard/hubs/")({
  component: MyAssetsListPage,
});

export interface AssetHubItem {
  id: string;
  code: string;
  name: string;
  group: string;
  category: string;
  logo_url?: string | null;
  status: string;
  color: string;
  icon: string;
  broker_symbols?: string[];
  news_tags?: string[];
  macro_drivers?: string[];
  notes?: string;
  accounts_count?: number;
  robots_count?: number;
  robots_running?: number;
  robots_paused?: number;
  robots_error?: number;
  open_positions_count?: number;
  open_positions_lots?: number;
  floating_pnl_usd?: number;
  pnl_24h_usd?: number;
  mt5_zone?: "BUY ZONE" | "FAIR" | "SELL ZONE" | null;
  news_sentiment?: "BULL" | "BEAR" | "NEUTRAL";
}

type SortKey =
  | "code"
  | "price"
  | "change"
  | "zone"
  | "robots_count"
  | "positions"
  | "pnl_24h_usd"
  | "news_sentiment";

const QUICK_FILTERS = [
  { id: "all", label: "Все" },
  { id: "active", label: "В работе" },
  { id: "crypto", label: "Crypto" },
  { id: "metals", label: "Metals" },
  { id: "indices", label: "Indices" },
  { id: "forex", label: "Forex" },
] as const;

function formatPrice(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val) || val <= 0) return "—";
  if (val >= 1000) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(5);
}

function MiniSparkline({ points, positive }: { points: number[]; positive: boolean }) {
  if (points.length < 2) {
    return <span className="inline-block h-3 w-12 rounded-[2px] bg-[var(--bg-elevated)]" />;
  }
  const w = 52;
  const h = 16;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, min * 0.0001 || 1);
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 2 - ((p - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block shrink-0 align-middle">
      <polyline
        fill="none"
        stroke={positive ? "var(--bull)" : "var(--bear)"}
        strokeWidth="1.25"
        points={coords}
      />
    </svg>
  );
}

function ZoneBadge({ zone }: { zone?: "BUY ZONE" | "FAIR" | "SELL ZONE" | null }) {
  if (!zone) return <span className="font-mono text-[11px] text-[var(--text-muted)]">—</span>;
  const cls =
    zone === "BUY ZONE"
      ? "border-[var(--bull)]/40 bg-[var(--bull-bg)] text-[var(--bull)]"
      : zone === "SELL ZONE"
        ? "border-[var(--bear)]/40 bg-[var(--bear-bg)] text-[var(--bear)]"
        : "border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium ${cls}`}>
      {zone}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: "BULL" | "BEAR" | "NEUTRAL" }) {
  const s = sentiment || "NEUTRAL";
  const cls =
    s === "BULL"
      ? "text-[var(--bull)] border-[var(--bull)]/30 bg-[var(--bull-bg)]"
      : s === "BEAR"
        ? "text-[var(--bear)] border-[var(--bear)]/30 bg-[var(--bear-bg)]"
        : "text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--bg-elevated)]";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium ${cls}`}>
      {s}
    </span>
  );
}

function MyAssetsListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [hubs, setHubs] = useState<AssetHubItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<(typeof QUICK_FILTERS)[number]["id"]>("all");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [sortKey, setSortKey] = useState<SortKey>("robots_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [deleteTarget, setDeleteTarget] = useState<AssetHubItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
        const res = await apiRequestPaged<AssetHubItem>(`/assets${qs}`, page, DEFAULT_PAGE_SIZE);
        setHubs(res.items);
        setTotal(res.total);
      } catch (e) {
        if (!silent) notify.error("Ошибка загрузки", e instanceof Error ? e.message : String(e));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, search],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Throttled silent updates via /ws/account (zero flicker, zero logo reload, zero REST polling)
  const lastLiveRefreshRef = useState(() => ({ ts: 0 }))[0];
  useLiveEvents(["trade_event", "account_update", "robot_state"], () => {
    const now = Date.now();
    if (now - lastLiveRefreshRef.ts < 5000) return;
    lastLiveRefreshRef.ts = now;
    void load(true);
  });

  const visibleSymbols = useMemo(() => hubs.map((h) => h.code), [hubs]);
  const liveQuotes = useMarketListStream(visibleSymbols);

  const filteredHubs = useMemo(() => {
    if (quickFilter === "all") return hubs;
    if (quickFilter === "active") return hubs.filter((h) => (h.robots_count ?? 0) > 0 || (h.open_positions_count ?? 0) > 0);
    return hubs.filter((h) => {
      const grp = `${h.group} ${h.category}`.toLowerCase();
      return grp.includes(quickFilter);
    });
  }, [hubs, quickFilter]);

  const sortedHubs = useMemo(() => {
    const arr = [...filteredHubs];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const qa = liveQuotes[canonicalMarketSymbol(a.code)];
      const qb = liveQuotes[canonicalMarketSymbol(b.code)];
      switch (sortKey) {
        case "code":
          return a.code.localeCompare(b.code) * dir;
        case "price":
          return ((qa?.price ?? 0) - (qb?.price ?? 0)) * dir;
        case "change":
          return ((qa?.changePct ?? 0) - (qb?.changePct ?? 0)) * dir;
        case "zone":
          return String(a.mt5_zone ?? "").localeCompare(String(b.mt5_zone ?? "")) * dir;
        case "robots_count":
          return ((a.robots_count ?? 0) - (b.robots_count ?? 0)) * dir;
        case "positions":
          return ((a.open_positions_count ?? 0) - (b.open_positions_count ?? 0)) * dir;
        case "pnl_24h_usd":
          return ((a.pnl_24h_usd ?? 0) - (b.pnl_24h_usd ?? 0)) * dir;
        case "news_sentiment":
          return String(a.news_sentiment ?? "").localeCompare(String(b.news_sentiment ?? "")) * dir;
      }
    });
    return arr;
  }, [filteredHubs, liveQuotes, sortKey, sortDir]);

  // Portfolio KPI summary (aggregated from server-computed USD fields)
  const kpi = useMemo(() => {
    let running = 0;
    let totalRobots = 0;
    let positions = 0;
    let floating = 0;
    let pnl24h = 0;
    for (const h of hubs) {
      running += h.robots_running ?? 0;
      totalRobots += h.robots_count ?? 0;
      positions += h.open_positions_count ?? 0;
      floating += h.floating_pnl_usd ?? 0;
      pnl24h += h.pnl_24h_usd ?? 0;
    }
    return { running, totalRobots, positions, floating, pnl24h };
  }, [hubs]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "code" ? "asc" : "desc");
    }
  };

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(deleteTarget.code)}`, { method: "DELETE" });
      notify.success("Актив удалён", deleteTarget.code);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      notify.error("Ошибка удаления", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TerminalPageShell
      title="Мои активы"
      badge={`${total}`}
      actions={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Фильтр: XAUUSD, BTC, USTEC..."
              className="h-7 w-48 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-blue)] sm:w-56"
            />
          </div>

          <div className="inline-flex h-7 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[11px] transition-colors duration-75 ${
                viewMode === "table"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title="Плотная таблица"
            >
              <List className="size-3" />
              Таблица
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[11px] transition-colors duration-75 ${
                viewMode === "cards"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title="Кокпит-карточки"
            >
              <LayoutGrid className="size-3" />
              Карточки
            </button>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors duration-75 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw className="size-3" />
            {t.common.refresh}
          </button>
          <Link
            to="/dashboard/hubs/new"
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[11px] font-medium text-white transition-colors duration-75 hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t.hubs.newBtn}
          </Link>
        </>
      }
    >
      {/* 1-Line Portfolio KPI Strip (44px, server-computed USD) */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 font-mono text-[11px] tabular-nums">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="text-[var(--text-muted)]">Активов: </span>
            <span className="font-semibold text-[var(--text-primary)]">{total}</span>
          </span>
          <span className="hidden h-3.5 w-px bg-[var(--border-subtle)] sm:inline-block" />
          <span>
            <span className="text-[var(--text-muted)]">Роботов: </span>
            <span className="font-semibold text-[var(--bull)]">{kpi.running} RUNNING</span>
            {kpi.totalRobots > kpi.running ? (
              <span className="text-[var(--text-muted)]"> / {kpi.totalRobots}</span>
            ) : null}
          </span>
          <span className="hidden h-3.5 w-px bg-[var(--border-subtle)] sm:inline-block" />
          <span>
            <span className="text-[var(--text-muted)]">Позиций: </span>
            <span className="font-semibold text-[var(--text-primary)]">{kpi.positions}</span>
          </span>
          <span className="hidden h-3.5 w-px bg-[var(--border-subtle)] sm:inline-block" />
          <span>
            <span className="text-[var(--text-muted)]">Плавающий PnL: </span>
            <span className={kpi.floating >= 0 ? "font-semibold text-[var(--bull)]" : "font-semibold text-[var(--bear)]"}>
              {formatSignedUsd(kpi.floating, privacyMode)}
            </span>
          </span>
          <span className="hidden h-3.5 w-px bg-[var(--border-subtle)] sm:inline-block" />
          <span>
            <span className="text-[var(--text-muted)]">PnL сегодня: </span>
            <span className={kpi.pnl24h >= 0 ? "font-semibold text-[var(--bull)]" : "font-semibold text-[var(--bear)]"}>
              {formatSignedUsd(kpi.pnl24h, privacyMode)}
            </span>
          </span>
        </div>

        {/* Quick filter chips */}
        <div className="flex flex-wrap items-center gap-1">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setQuickFilter(f.id)}
              className={`h-6 whitespace-nowrap rounded-[3px] border px-2 text-[10px] font-medium transition-colors duration-75 ${
                quickFilter === f.id
                  ? "border-[var(--accent-blue)] bg-[var(--bg-elevated)] text-[var(--accent-blue)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "table" ? (
        <TerminalDataPanel
          footer={<PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />}
        >
          {loading ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 rounded-[3px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
              ))}
            </div>
          ) : sortedHubs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-[12px] text-[var(--text-muted)]">
              Портфель пуст — добавьте актив или откройте «Справочник рынков».
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)]">
                <tr className="h-8">
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("code")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Актив <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("price")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Цена (Live) <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("change")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      24ч % + Тренд <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-center font-medium">
                    <button type="button" onClick={() => toggleSort("zone")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Зона MT5 <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-center font-medium">
                    <button type="button" onClick={() => toggleSort("robots_count")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Роботы MT5 <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("positions")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Позиции / Лот <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("pnl_24h_usd")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      PnL сегодня <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-center font-medium">
                    <button type="button" onClick={() => toggleSort("news_sentiment")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                      Фон <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium whitespace-nowrap">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sortedHubs.map((hub) => {
                  const q = liveQuotes[canonicalMarketSymbol(hub.code)];
                  const pnl24 = hub.pnl_24h_usd ?? 0;
                  const posCount = hub.open_positions_count ?? 0;
                  const posLots = hub.open_positions_lots ?? 0;
                  const rRun = hub.robots_running ?? 0;
                  const rPause = hub.robots_paused ?? 0;
                  const rErr = hub.robots_error ?? 0;

                  return (
                    <tr
                      key={hub.id}
                      onClick={() => void navigate({ to: "/dashboard/hubs/$code", params: { code: hub.code } })}
                      className="h-11 cursor-pointer transition-colors duration-75 hover:bg-[var(--bg-elevated)]"
                    >
                      <td className="px-3 text-left">
                        <div className="flex items-center gap-2">
                          <AssetLogo symbol={hub.code} size={20} logoUrl={hub.logo_url} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-[var(--text-primary)]">{hub.code}</span>
                              <span className="rounded-[2px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1 py-0 font-mono text-[9px] uppercase text-[var(--text-secondary)]">
                                {hub.group || hub.category}
                              </span>
                            </div>
                            <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                              {hub.name}
                              {hub.broker_symbols?.length ? ` · ${hub.broker_symbols.slice(0, 2).join(", ")}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 text-right font-mono tabular-nums">
                        {q ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span
                              className={`rounded-[2px] px-1 font-semibold text-[var(--text-primary)] ${
                                q.flash === "bull" ? "ht-flash-bull" : q.flash === "bear" ? "ht-flash-bear" : ""
                              }`}
                            >
                              {formatPrice(q.price)}
                            </span>
                            <span className="text-[9px] text-[var(--text-muted)]">{q.source}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>

                      <td className="px-3 text-right font-mono tabular-nums">
                        <div className="inline-flex items-center justify-end gap-2">
                          {q ? (
                            <span className={q.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                              {q.changePct >= 0 ? "+" : ""}
                              {q.changePct.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                          <MiniSparkline points={q?.spark ?? []} positive={(q?.changePct ?? 0) >= 0} />
                        </div>
                      </td>

                      <td className="px-3 text-center">
                        <ZoneBadge zone={hub.mt5_zone} />
                      </td>

                      <td className="px-3 text-center font-mono text-[11px] tabular-nums">
                        {rRun > 0 ? (
                          <span className="whitespace-nowrap font-semibold text-[var(--bull)]">{rRun} RUNNING</span>
                        ) : rErr > 0 ? (
                          <span className="whitespace-nowrap font-semibold text-[var(--bear)]">{rErr} STALE</span>
                        ) : rPause > 0 ? (
                          <span className="whitespace-nowrap font-semibold text-[var(--accent-amber)]">{rPause} PAUSED</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>

                      <td className="px-3 text-right font-mono text-[11px] tabular-nums">
                        {posCount > 0 ? (
                          <span className="whitespace-nowrap text-[var(--text-primary)]">
                            {posCount} pos · {posLots.toFixed(2)}L
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </td>

                      <td className="px-3 text-right font-mono font-semibold tabular-nums">
                        <span className={pnl24 > 0 ? "text-[var(--bull)]" : pnl24 < 0 ? "text-[var(--bear)]" : "text-[var(--text-muted)]"}>
                          {formatSignedUsd(pnl24, privacyMode)}
                        </span>
                      </td>

                      <td className="px-3 text-center">
                        <SentimentBadge sentiment={hub.news_sentiment} />
                      </td>

                      <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void navigate({ to: "/dashboard/hubs/$code", params: { code: hub.code } })}
                            className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                          >
                            График
                            <ArrowRight className="size-3" />
                          </button>

                          {/* Portal-based menu: NEVER clipped by table overflow */}
                          <TerminalDropdown
                            open={openMenuId === hub.id}
                            onOpenChange={(v) => setOpenMenuId(v ? hub.id : null)}
                            align="right"
                            widthClassName="w-44"
                            trigger={
                              <button
                                type="button"
                                onClick={() => setOpenMenuId((cur) => (cur === hub.id ? null : hub.id))}
                                className="inline-flex size-6 items-center justify-center rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                                title="Меню актива"
                              >
                                <MoreVertical className="size-3.5" />
                              </button>
                            }
                          >
                            <Link
                              to="/dashboard/hubs/$code/edit"
                              params={{ code: hub.code }}
                              onClick={() => setOpenMenuId(null)}
                              className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                            >
                              <Pencil className="size-3 text-[var(--text-secondary)]" />
                              Редактировать
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(hub.id);
                                notify.success("UUID скопирован", hub.id);
                                setOpenMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                            >
                              <Copy className="size-3" />
                              UUID: {hub.id.slice(0, 8)}...
                            </button>
                            <div className="my-1 h-px bg-[var(--border-subtle)]" />
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setDeleteTarget(hub);
                              }}
                              className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[var(--bear)] hover:bg-[var(--bear-bg)]"
                            >
                              <Trash2 className="size-3" />
                              Удалить
                            </button>
                          </TerminalDropdown>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TerminalDataPanel>
      ) : (
        /* Cockpit Cards Grid (3-4 columns, strict 1px border, 4px radius, zero shadow) */
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedHubs.map((hub) => {
            const q = liveQuotes[canonicalMarketSymbol(hub.code)];
            const pnl24 = hub.pnl_24h_usd ?? 0;
            return (
              <div
                key={hub.id}
                onClick={() => void navigate({ to: "/dashboard/hubs/$code", params: { code: hub.code } })}
                className="flex cursor-pointer flex-col justify-between gap-2.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 transition-colors duration-75 hover:border-[var(--accent-blue)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AssetLogo symbol={hub.code} size={22} logoUrl={hub.logo_url} />
                    <div className="min-w-0">
                      <div className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">{hub.code}</div>
                      <div className="truncate text-[10px] text-[var(--text-muted)]">{hub.name}</div>
                    </div>
                  </div>
                  <ZoneBadge zone={hub.mt5_zone} />
                </div>

                <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                  <div>
                    <div className="text-[16px] font-semibold text-[var(--text-primary)]">
                      {q ? formatPrice(q.price) : "—"}
                    </div>
                    <div className={`text-[11px] ${(q?.changePct ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {q ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}
                    </div>
                  </div>
                  <MiniSparkline points={q?.spark ?? []} positive={(q?.changePct ?? 0) >= 0} />
                </div>

                <div className="grid grid-cols-3 gap-1 border-t border-[var(--border-subtle)] pt-2 font-mono text-[10px] tabular-nums">
                  <div>
                    <div className="text-[var(--text-muted)]">Роботы</div>
                    <div className="font-semibold text-[var(--bull)]">{hub.robots_running ?? 0} RUN</div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Позиции</div>
                    <div className="font-semibold text-[var(--text-primary)]">{hub.open_positions_count ?? 0}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--text-muted)]">PnL 24ч</div>
                    <div className={pnl24 >= 0 ? "font-semibold text-[var(--bull)]" : "font-semibold text-[var(--bear)]"}>
                      {formatSignedUsd(pnl24, privacyMode)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
                  <SentimentBadge sentiment={hub.news_sentiment} />
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-blue)]">
                    Открыть терминал <ArrowRight className="size-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.hubs.confirmDeleteTitle}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : ""}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
