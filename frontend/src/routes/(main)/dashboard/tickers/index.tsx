import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, RefreshCw, Search, Star } from "lucide-react";

import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";

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
    <div
      data-content-padding="false"
      className="flex h-[calc(100vh-80px)] min-h-[540px] flex-col bg-[#0B0E14] text-[#F1F5F9]"
    >
      {/* Compact 44px Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#1E2634] bg-[#11161F] px-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[14px] font-semibold tracking-tight text-[#F1F5F9]">Справочник рынков</h1>
          <span className="rounded-[3px] border border-[#2C3649] bg-[#171E2B] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8] tabular-nums">
            {total}
          </span>
          <div className="relative ml-1 w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[#64748B]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="XAUUSD, USTEC, BTC, NVDA..."
              className="h-7 w-full rounded-[4px] border border-[#1E2634] bg-[#0B0E14] pr-2 pl-7 text-[11px] text-[#F1F5F9] placeholder-[#64748B] outline-none focus:border-[#3B82F6]"
            />
          </div>
          <div className="hidden items-center gap-1 lg:flex">
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
                    ? "border-[#3B82F6] bg-[#171E2B] text-[#3B82F6]"
                    : "border-[#1E2634] bg-[#0B0E14] text-[#94A3B8] hover:text-[#F1F5F9]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleSync()}
          className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[#2C3649] bg-[#171E2B] px-2.5 text-[11px] font-medium text-[#F1F5F9] transition-colors duration-75 hover:border-[#3B82F6] disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Синхронизация..." : "Синхронизировать"}
        </button>
      </div>

      {/* Dense Market Directory Table */}
      <div className="pro-scroll min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 rounded-[3px] bg-[#11161F] ht-shimmer-bar" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-[#64748B]">{t.common.noData}</div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[11px] text-[#64748B]">
              <tr className="h-8">
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("symbol")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Тикер <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Название <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("asset_class")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Класс <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">Ключевые слова</th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("exchange")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Биржа / Источник <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2634]/70">
              {sortedItems.map((tk) => (
                <tr
                  key={tk.symbol}
                  onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })}
                  className="h-9 cursor-pointer transition-colors duration-75 hover:bg-[#171E2B]"
                >
                  <td className="px-3 text-left">
                    <div className="flex items-center gap-2">
                      <AssetLogo symbol={tk.symbol} size={20} logoUrl={tk.logo_url} />
                      <span className="font-mono font-semibold text-[#F1F5F9]">{tk.symbol}</span>
                    </div>
                  </td>
                  <td className="px-3 text-left text-[#CBD5E1]">{tk.name}</td>
                  <td className="px-3 text-left">
                    <span className="rounded-[3px] border border-[#2C3649] bg-[#11161F] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#94A3B8]">
                      {tk.asset_class}
                    </span>
                  </td>
                  <td className="max-w-md truncate px-3 text-left font-mono text-[10px] text-[#64748B]">
                    {(tk.news_keywords ?? []).slice(0, 6).join(", ")}
                  </td>
                  <td className="px-3 text-left font-mono text-[11px] text-[#94A3B8]">
                    {tk.exchange} · {tk.source}
                  </td>
                  <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: tk.symbol } })
                        }
                        className="h-6 rounded-[3px] border border-[#2C3649] bg-[#11161F] px-2 text-[11px] text-[#F1F5F9] transition-colors duration-75 hover:border-[#3B82F6] hover:text-[#3B82F6]"
                      >
                        Терминал
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleQuickAdd(tk)}
                        className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-[#1E2634] bg-[#0B0E14] px-2 text-[11px] text-[#94A3B8] transition-colors duration-75 hover:border-[#F59E0B] hover:text-[#F59E0B]"
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
      </div>

      {/* Footer Pagination */}
      <div className="shrink-0 border-t border-[#1E2634] bg-[#11161F] px-3 py-1">
        <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
      </div>
    </div>
  );
}
