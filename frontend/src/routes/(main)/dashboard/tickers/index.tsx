import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, RefreshCw, Search, Star } from "lucide-react";

import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalDataPanel, TerminalPageShell } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/tickers/")({
  component: MarketTickersPage,
});

export interface MarketTickerItem {
  symbol: string;
  name: string;
  asset_class: string;
  exchange: string;
  source: string;
  logo_url: string;
  broker_symbols?: string[];
  news_keywords?: string[];
}

const CLASSES = ["all", "metals", "indices", "forex", "crypto", "equities", "commodities"] as const;
type SortKey = "symbol" | "name" | "asset_class" | "exchange";

function MarketTickersPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [assetClass, setAssetClass] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 200);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadTickers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (assetClass !== "all") params.set("asset_class", assetClass);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiRequestPaged<MarketTickerItem>(`/assets/tickers${qs}`, page, DEFAULT_PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [assetClass, debouncedQ, page, t.common.errorTitle]);

  useEffect(() => {
    void loadTickers();
  }, [loadTickers]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return copy;
  }, [items, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiRequest<{ added: number; total: number; sources: string[] }>("/assets/tickers/sync", {
        method: "POST",
      });
      notify.success(
        "Справочник рынков обновлён",
        `+${res.added} новых (всего ${res.total}: ${res.sources.join(", ")})`,
      );
      setPage(1);
      await loadTickers();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleQuickAdd(tk: MarketTickerItem) {
    try {
      await apiRequest("/assets", {
        method: "POST",
        body: JSON.stringify({
          code: tk.symbol,
          name: tk.name,
          group: tk.asset_class,
          category: tk.asset_class,
          broker_symbols: tk.broker_symbols?.length ? tk.broker_symbols : [tk.symbol, `${tk.symbol}c`, `${tk.symbol}m`],
          news_tags: tk.news_keywords?.length ? tk.news_keywords : [tk.symbol],
        }),
      });
      notify.success("Добавлено в «Мои активы»", tk.symbol);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <TerminalPageShell
      title="Справочник рынков"
      badge={`${total}`}
      actions={
        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleSync()}
          className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Синхронизация..." : "Синхронизировать"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="XAUUSD, USTEC, BTC, NVDA, AAPL..."
            className="h-7 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-input)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-blue)]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setAssetClass(c);
                setPage(1);
              }}
              className={`h-6 rounded-[3px] border px-2 font-mono text-[10px] uppercase transition-colors duration-75 ${
                assetClass === c
                  ? "border-[var(--accent-blue)] bg-[var(--bg-elevated)] text-[var(--accent-blue)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {c}
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
            <div className="flex h-32 items-center justify-center text-[12px] text-[var(--text-muted)]">{t.common.noData}</div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)]">
                <tr className="h-8">
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("symbol")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Тикер <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Название <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("asset_class")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Класс <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">Ключевые слова</th>
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("exchange")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Биржа / Источник <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sortedItems.map((tk) => (
                  <tr
                    key={tk.symbol}
                    onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })}
                    className="h-9 cursor-pointer transition-colors duration-75 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-3 text-left">
                      <div className="flex items-center gap-2">
                        <AssetLogo symbol={tk.symbol} size={20} logoUrl={tk.logo_url} />
                        <span className="font-mono font-semibold text-[var(--text-primary)]">{tk.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 text-left text-[var(--text-secondary)]">{tk.name}</td>
                    <td className="px-3 text-left">
                      <span className="rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-secondary)]">
                        {tk.asset_class}
                      </span>
                    </td>
                    <td className="max-w-md truncate px-3 text-left font-mono text-[10px] text-[var(--text-muted)]">
                      {(tk.news_keywords ?? []).slice(0, 6).join(", ")}
                    </td>
                    <td className="px-3 text-left font-mono text-[11px] text-[var(--text-secondary)]">
                      {tk.exchange} · {tk.source}
                    </td>
                    <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })
                          }
                          className="h-6 whitespace-nowrap rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-primary)] transition-colors duration-75 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                        >
                          Терминал
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuickAdd(tk)}
                          className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors duration-75 hover:border-[var(--accent-amber)] hover:text-[var(--accent-amber)]"
                          title="Добавить в Мои активы"
                        >
                          <Star className="size-3" />В мои активы
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TerminalDataPanel>
    </TerminalPageShell>
  );
}
