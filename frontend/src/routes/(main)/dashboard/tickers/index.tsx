import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpDown, Plus, RefreshCw, Search, Star, X } from "lucide-react";

import { MarketScannerPanel } from "@/components/pro/MarketScannerPanel";
import { formatDynamicVolume } from "@/components/terminal/MicrostructurePanel";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { TerminalDataPanel, TerminalPageShell } from "@/framework/templates";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export const Route = createFileRoute("/(main)/dashboard/tickers/")({
  component: MarketTickersPage,
});

export interface MarketTickerItem {
  id?: number;
  symbol: string;
  name: string;
  asset_class: string;
  exchange: string;
  source: string;
  logo_url: string;
  broker_symbols?: string[];
  news_keywords?: string[];
  price?: number | null;
  change_pct_24h?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  volume_24h?: number | null;
  spread_bps?: number | null;
  ws_source?: string | null;
  market_session?: "ONLINE" | "PRE_MARKET" | "AFTER_HOURS" | "OFFLINE" | string;
}

const CLASSES = [
  { id: "all", label: "Все" },
  { id: "crypto", label: "Крипто" },
  { id: "forex", label: "Форекс" },
  { id: "metals", label: "Металлы" },
  { id: "indices", label: "Индексы" },
  { id: "equities", label: "Акции США" },
  { id: "commodities", label: "Сырьё" },
] as const;

type PresetId = "none" | "top_recent" | "gainers" | "losers" | "volume";
type SortKey = "id" | "symbol" | "asset_class" | "price" | "change" | "high" | "volume" | "spread";

function formatPrice(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val) || val <= 0) return "—";
  if (val >= 1000) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(5);
}

function MarketTickersPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const [portfolioSet, setPortfolioSet] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<"directory" | "scanner">(() => {
    if (typeof window === "undefined") return "directory";
    return new URLSearchParams(window.location.search).get("tab") === "scanner" ? "scanner" : "directory";
  });
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [assetClass, setAssetClass] = useState<string>("all");
  const [preset, setPreset] = useState<PresetId>("none");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Manual ticker add inline modal state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSym, setManualSym] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualClass, setManualClass] = useState("crypto");
  const [manualExchange, setManualExchange] = useState("CUSTOM");
  const [manualSaving, setManualSaving] = useState(false);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await apiRequestPaged<{ code: string }>("/assets", 1, 200);
      setPortfolioSet(new Set(res.items.map((x) => canonicalMarketSymbol(x.code))));
    } catch {
      // optional
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (assetClass !== "all") params.set("asset_class", assetClass);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiRequestPaged<MarketTickerItem>(`/assets/tickers${qs}`, page, DEFAULT_PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      notify.error("Ошибка", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, search, assetClass]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  const visibleSymbols = useMemo(() => items.map((i) => i.symbol), [items]);
  const liveQuotes = useMarketListStream(visibleSymbols);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    const effKey: SortKey =
      preset === "top_recent" || preset === "gainers" || preset === "losers"
        ? "change"
        : preset === "volume"
          ? "volume"
          : sortKey;
    const effDir =
      preset === "losers"
        ? 1
        : preset === "top_recent" || preset === "gainers" || preset === "volume"
          ? -1
          : sortDir === "asc"
            ? 1
            : -1;

    arr.sort((a, b) => {
      const qa = liveQuotes[canonicalMarketSymbol(a.symbol)];
      const qb = liveQuotes[canonicalMarketSymbol(b.symbol)];
      switch (effKey) {
        case "id":
          return ((a.id ?? 0) - (b.id ?? 0)) * effDir;
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * effDir;
        case "asset_class":
          return a.asset_class.localeCompare(b.asset_class) * effDir;
        case "price":
          return ((qa?.price ?? a.price ?? 0) - (qb?.price ?? b.price ?? 0)) * effDir;
        case "change": {
          const rawA = qa?.changePct ?? a.change_pct_24h ?? 0;
          const rawB = qb?.changePct ?? b.change_pct_24h ?? 0;
          const ca = preset === "top_recent" ? Math.abs(rawA) : rawA;
          const cb = preset === "top_recent" ? Math.abs(rawB) : rawB;
          return (ca - cb) * effDir;
        }
        case "high":
          return ((qa?.high24h ?? a.high_24h ?? 0) - (qb?.high24h ?? b.high_24h ?? 0)) * effDir;
        case "volume":
          return ((qa?.volume24h ?? a.volume_24h ?? 0) - (qb?.volume24h ?? b.volume_24h ?? 0)) * effDir;
        case "spread":
          return ((qa?.spreadBps ?? a.spread_bps ?? 0) - (qb?.spreadBps ?? b.spread_bps ?? 0)) * effDir;
      }
    });
    return arr;
  }, [items, liveQuotes, preset, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    setPreset("none");
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "id" || key === "symbol" ? "asc" : "desc");
    }
  };

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiRequest<{ added: number; total_tickers: number }>("/assets/tickers/sync", {
        method: "POST",
      });
      notify.success("Справочник синхронизирован", `+${res.added} (всего: ${res.total_tickers})`);
      await load();
    } catch (e) {
      notify.error("Ошибка", e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleTogglePortfolio(tk: MarketTickerItem) {
    const canon = canonicalMarketSymbol(tk.symbol);
    const exists = portfolioSet.has(canon);
    try {
      if (exists) {
        await apiRequest(`/assets/${encodeURIComponent(tk.symbol)}`, { method: "DELETE" });
        setPortfolioSet((prev) => {
          const next = new Set(prev);
          next.delete(canon);
          return next;
        });
        notify.success("Удалено из «Моих активов»", tk.symbol);
      } else {
        await apiRequest("/assets", {
          method: "POST",
          body: JSON.stringify({
            code: tk.symbol,
            name: tk.name,
            group: tk.asset_class,
            category: tk.asset_class,
            broker_symbols: tk.broker_symbols?.length ? tk.broker_symbols : [tk.symbol],
            news_tags: tk.news_keywords?.length ? tk.news_keywords : [tk.symbol],
          }),
        });
        setPortfolioSet((prev) => new Set(prev).add(canon));
        notify.success("Добавлено в «Мои активы»", tk.symbol);
      }
    } catch (e) {
      notify.error("Ошибка", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreateManualTicker(e: React.FormEvent) {
    e.preventDefault();
    if (!manualSym.trim() || !manualName.trim()) return;
    setManualSaving(true);
    try {
      await apiRequest("/assets/tickers", {
        method: "POST",
        body: JSON.stringify({
          symbol: manualSym.trim().toUpperCase(),
          name: manualName.trim(),
          asset_class: manualClass,
          exchange: manualExchange.trim().toUpperCase() || "CUSTOM",
          source: "manual",
        }),
      });
      notify.success("Тикер добавлен", manualSym.trim().toUpperCase());
      setManualSym("");
      setManualName("");
      setManualOpen(false);
      await load();
    } catch (err) {
      notify.error("Ошибка", err instanceof Error ? err.message : String(err));
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title="Справочник рынков"
      badge={`${total}`}
      actions={
        <>
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-[11px] text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
          >
            <Plus className="size-3.5" />
            Добавить тикер вручную
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void handleSync()}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors duration-75 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Синхронизация..." : "Синхронизировать"}
          </button>
        </>
      }
    >
      {/* Top View Tabs: Directory vs Market Anomaly Scanner */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("directory")}
          className={`rounded-[4px] border px-3 py-1 text-[11px] font-semibold transition-colors ${
            activeTab === "directory"
              ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          }`}
        >
          Справочник рынков ({total})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("scanner")}
          className={`rounded-[4px] border px-3 py-1 text-[11px] font-semibold transition-colors ${
            activeTab === "scanner"
              ? "border-[var(--accent-amber)] bg-[var(--accent-amber)]/15 text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          }`}
        >
          Скринер аномалий (RVOL / ATR / Funding)
        </button>
      </div>

      {activeTab === "scanner" ? (
        <MarketScannerPanel />
      ) : (
        <>
      {/* Inline Manual Ticker Creation Form */}
      {manualOpen ? (
        <form
          onSubmit={(e) => void handleCreateManualTicker(e)}
          className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-2 text-[11px]"
        >
          <span className="font-semibold text-[var(--text-primary)]">Новый тикер:</span>
          <input
            required
            value={manualSym}
            onChange={(e) => setManualSym(e.target.value)}
            placeholder="Тикер (напр. PLTR)"
            className="h-7 w-32 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
          />
          <input
            required
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="Название (Palantir Technologies)"
            className="h-7 w-52 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
          />
          <div className="w-36">
            <SearchSelect
              value={manualClass}
              onValueChange={setManualClass}
              options={CLASSES.filter((c) => c.id !== "all").map((c) => ({
                value: c.id,
                label: c.label,
              }))}
            />
          </div>
          <input
            value={manualExchange}
            onChange={(e) => setManualExchange(e.target.value)}
            placeholder="Биржа (NASDAQ)"
            className="h-7 w-28 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
          />
          <button
            type="submit"
            disabled={manualSaving}
            className="h-7 rounded-[3px] bg-[var(--accent-blue)] px-3 font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {manualSaving ? "Сохранение..." : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => setManualOpen(false)}
            className="ml-auto flex size-6 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" />
          </button>
        </form>
      ) : null}

      {/* Compact Single-Row Filter & Preset Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск: XAUUSD, BTC, NVDA, EURUSD..."
              className="h-7 w-56 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-blue)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {CLASSES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setAssetClass(c.id);
                  setPage(1);
                }}
                className={`h-6 whitespace-nowrap rounded-[3px] border px-2 text-[10px] font-medium transition-colors duration-75 ${
                  assetClass === c.id
                    ? "border-[var(--accent-blue)] bg-[var(--bg-elevated)] text-[var(--accent-blue)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Screener Presets (#105) */}
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: "top_recent", label: "Топ за последнее время" },
              { id: "gainers", label: "Лидеры роста" },
              { id: "losers", label: "Лидеры падения" },
              { id: "volume", label: "По объёму" },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset((cur) => (cur === p.id ? "none" : p.id))}
              className={`h-6 whitespace-nowrap rounded-[3px] border px-2 text-[10px] font-medium transition-colors duration-75 ${
                preset === p.id
                  ? "border-[var(--accent-amber)] bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TerminalDataPanel
        footer={<PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />}
      >
        {loading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 rounded-[3px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-[var(--text-muted)]">
            {t.common.noData}
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)]">
              <tr className="h-8">
                <th className="w-14 px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    ID <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("symbol")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    Актив <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("asset_class")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    Класс <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("price")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    Цена (Live) <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("change")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    24ч % <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("high")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    24ч High / Low <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("volume")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    Объём 24ч <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("spread")} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--text-primary)]">
                    Спред <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium whitespace-nowrap">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {sortedItems.map((tk, idx) => {
                const canon = canonicalMarketSymbol(tk.symbol);
                const q = liveQuotes[canon];
                const inPortfolio = portfolioSet.has(canon);
                const displayPrice = q?.price ?? tk.price ?? null;
                const displayChange = q?.changePct ?? tk.change_pct_24h ?? null;
                const displayHigh = q?.high24h ?? tk.high_24h ?? null;
                const displayLow = q?.low24h ?? tk.low_24h ?? null;
                const displayVol = q?.volume24h ?? tk.volume_24h ?? null;
                const displaySpread = q?.spreadBps ?? tk.spread_bps ?? null;

                return (
                  <tr
                    key={tk.symbol}
                    onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })}
                    className="h-10 cursor-pointer transition-colors duration-75 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-3 text-left font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      #{tk.id ?? idx + 1}
                    </td>

                    <td className="px-3 text-left">
                      <div className="flex items-center gap-2">
                        <AssetLogo symbol={tk.symbol} size={20} logoUrl={tk.logo_url} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold text-[var(--text-primary)]">{tk.symbol}</span>
                            {tk.market_session ? (
                              <span
                                className="rounded-[2px] px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase"
                                style={{
                                  backgroundColor:
                                    tk.market_session === "ONLINE"
                                      ? "color-mix(in srgb, var(--bull) 16%, transparent)"
                                      : tk.market_session === "OFFLINE"
                                        ? "var(--bg-elevated)"
                                        : "color-mix(in srgb, var(--accent-amber) 16%, transparent)",
                                  color:
                                    tk.market_session === "ONLINE"
                                      ? "var(--bull)"
                                      : tk.market_session === "OFFLINE"
                                        ? "var(--text-muted)"
                                        : "var(--accent-amber)",
                                }}
                              >
                                {tk.market_session.replace("_", "-")}
                              </span>
                            ) : null}
                          </div>
                          <div className="max-w-[200px] truncate text-[10px] text-[var(--text-muted)]">{tk.name}</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 text-left">
                      <span className="rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-secondary)]">
                        {tk.asset_class}
                      </span>
                    </td>

                    <td className="px-3 text-right font-mono tabular-nums">
                      {displayPrice ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span
                            className={`rounded-[2px] px-1 font-semibold text-[var(--text-primary)] ${
                              q?.flash === "bull" ? "ht-flash-bull" : q?.flash === "bear" ? "ht-flash-bear" : ""
                            }`}
                          >
                            {formatPrice(displayPrice)}
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)]">
                            {q?.source || tk.ws_source || tk.exchange}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>

                    <td className="px-3 text-right font-mono tabular-nums">
                      {displayChange !== null ? (
                        <span className={displayChange >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                          {displayChange >= 0 ? "+" : ""}
                          {displayChange.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>

                    <td className="px-3 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {displayHigh && displayLow ? (
                        <span className="whitespace-nowrap">
                          {formatPrice(displayHigh)} / {formatPrice(displayLow)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>

                    <td className="px-3 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {displayVol ? `$${formatDynamicVolume(displayVol)}` : <span className="text-[var(--text-muted)]">—</span>}
                    </td>

                    <td className="px-3 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {displaySpread != null ? `${displaySpread.toFixed(1)} bps` : <span className="text-[var(--text-muted)]">—</span>}
                    </td>

                    <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleTogglePortfolio(tk)}
                          className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] border px-2 text-[11px] transition-colors duration-75 ${
                            inPortfolio
                              ? "border-[var(--bull)]/40 bg-[var(--bull-bg)] text-[var(--bull)]"
                              : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-amber)] hover:text-[var(--accent-amber)]"
                          }`}
                          title={inPortfolio ? "Убрать из Моих активов" : "Добавить в Мои активы"}
                        >
                          <Star className={`size-3 ${inPortfolio ? "fill-current" : ""}`} />
                          {inPortfolio ? "В портфеле" : "В мои активы"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })
                          }
                          className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                        >
                          График
                          <ArrowRight className="size-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TerminalDataPanel>
        </>
      )}
    </TerminalPageShell>
  );
}
