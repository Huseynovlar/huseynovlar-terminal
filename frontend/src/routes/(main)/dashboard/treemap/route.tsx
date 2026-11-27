import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";

import { EChartsTreemap, type TreemapSector } from "@/components/institutional/EChartsTreemap";
import { AsyncButton } from "@/components/ui/async-button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export const Route = createFileRoute("/(main)/dashboard/treemap")({
  component: TreemapPage,
});

interface TreemapResponse {
  universe: string;
  name: string;
  period: string;
  size_by: string;
  data_status: string;
  live_tickers: number;
  total_tickers: number;
  updated_at: string;
  sectors: TreemapSector[];
}

const UNIVERSES = [
  { id: "crypto_majors", label: "Крипто (Top)" },
  { id: "sp500_top", label: "Акции США (S&P 500)" },
  { id: "nasdaq100", label: "Nasdaq 100" },
  { id: "forex_majors", label: "Форекс" },
  { id: "gold_commodities", label: "Металлы и Сырьё" },
] as const;

const SIZE_OPTIONS = [
  { id: "market_cap", label: "Market Cap" },
  { id: "volume", label: "Объём 24ч" },
  { id: "equal", label: "Равный вес" },
] as const;

const PERIOD_OPTIONS = [
  { id: "1H", label: "1ч" },
  { id: "1D", label: "24ч" },
  { id: "1W", label: "7д" },
  { id: "1M", label: "1м" },
] as const;

function TreemapPage() {
  const navigate = useNavigate();
  const [universe, setUniverse] = useState<string>("crypto_majors");
  const [sizeBy, setSizeBy] = useState<string>("market_cap");
  const [period, setPeriod] = useState<string>("1D");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<TreemapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTreemap = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({ universe, period, size_by: sizeBy });
        if (search.trim()) qs.set("q", search.trim());
        const res = await apiRequest<TreemapResponse>(`/intelligence/treemap?${qs.toString()}`);
        setData(res);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки карты рынка", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [period, search, sizeBy, universe],
  );

  useEffect(() => {
    void loadTreemap(false);
  }, [loadTreemap]);

  // Visible canonical symbols for live /ws/market streaming (zero REST polling!)
  const visibleSymbols = useMemo(() => {
    if (!data?.sectors) return [];
    const list: string[] = [];
    for (const sec of data.sectors) {
      for (const item of sec.items) {
        const canon = item.canonical_symbol || item.ticker.replace("-USD", "USD").replace("=X", "").replace("=F", "");
        if (canon) list.push(canon);
      }
    }
    return list.slice(0, 35);
  }, [data]);

  const liveQuotes = useMarketListStream(visibleSymbols);

  async function handleForceRefresh() {
    setRefreshing(true);
    try {
      await apiRequest(`/intelligence/treemap/refresh?universe=${universe}&period=${period}`, { method: "POST" });
      await loadTreemap(true);
      notify.success("Карта рынка обновлена");
    } catch (err) {
      notify.error("Ошибка обновления", err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <TerminalPageShell
      title="Карта рынка (Treemap)"
      subtitle="Apache ECharts v6 · Мгновенный кэш + живые дельты /ws/market · Клик по плитке → терминал актива"
      badge={data ? `${data.live_tickers}/${data.total_tickers} LIVE` : "LIVE"}
      actions={
        <AsyncButton
          size="sm"
          variant="outline"
          loading={refreshing}
          loadingText="Обновление..."
          onClick={() => void handleForceRefresh()}
          className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs"
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Обновить срез
        </AsyncButton>
      }
    >
      <div className="flex h-[calc(100vh-148px)] min-h-[560px] flex-col gap-2.5">
        {/* Top Controls Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5">
          {/* Market Switcher */}
          <div className="flex flex-wrap items-center gap-1">
            {UNIVERSES.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setUniverse(u.id)}
                className={`h-7 rounded-[4px] px-2.5 text-[11px] font-semibold transition-colors ${
                  universe === u.id
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Size Metric */}
            <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px]">
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSizeBy(s.id)}
                  className={`h-6 rounded-[3px] px-2 font-medium ${
                    sizeBy === s.id
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Period Selector */}
            <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px] tabular-nums">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`h-6 rounded-[3px] px-2 font-semibold ${
                    period === p.id
                      ? "bg-[var(--accent-blue)] text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative w-36 sm:w-44">
              <Search className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск тикера..."
                className="h-7 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Full-Height ECharts Treemap Canvas */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
          {loading && !data ? (
            <div className="p-4">
              <PageSkeleton />
            </div>
          ) : data && data.sectors.length > 0 ? (
            <EChartsTreemap
              sectors={data.sectors}
              liveQuotes={liveQuotes}
              onSelectSymbol={(sym) =>
                void navigate({
                  to: "/dashboard/tickers/$symbol",
                  params: { symbol: sym },
                })
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              Нет данных по выбранному фильтру
            </div>
          )}
        </div>

        {/* Institutional Color Scale Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tabular-nums text-[var(--text-muted)]">
          <span>Клик по любой плитке открывает терминал актива (AssetTerminalView)</span>
          <div className="flex items-center gap-1">
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#B91C1C" }}>
              ≤ -5%
            </span>
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#DC2626" }}>
              -2%
            </span>
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#7F1D1D" }}>
              -0.5%
            </span>
            <span className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-semibold text-[var(--text-primary)]">
              0%
            </span>
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#14532D" }}>
              +0.5%
            </span>
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#16A34A" }}>
              +2%
            </span>
            <span className="rounded-[2px] px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "#15803D" }}>
              ≥ +5%
            </span>
          </div>
        </div>
      </div>
    </TerminalPageShell>
  );
}
