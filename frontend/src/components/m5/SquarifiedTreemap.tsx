import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "@tanstack/react-router";
import { Compass, Grid2x2, LineChart, RefreshCw, Search, X } from "lucide-react";

import {
  computeSquarifiedLayout,
  formatCompactNumber,
  type TreemapItem,
  treemapTileClass,
} from "@/components/m5/treemap-layout";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { SearchSelect } from "@/components/ui/search-select";

export type TreemapUniverse =
  | "sp500_top"
  | "nasdaq100"
  | "global_leaders"
  | "gold_commodities"
  | "crypto_majors"
  | "forex_majors";

export type TreemapPeriod = "1D" | "1W" | "1M" | "3M" | "YTD";
export type TreemapSizeBy = "market_cap" | "volume" | "equal";

interface TreemapSector {
  sector: string;
  items: TreemapItem[];
}

interface TreemapResponse {
  universe: string;
  name?: string;
  linked_asset?: string;
  period: string;
  size_by?: string;
  live?: boolean;
  data_status?: string;
  updated_at?: string;
  sectors: TreemapSector[];
}

const UNIVERSES: Array<{ id: TreemapUniverse; label: string }> = [
  { id: "sp500_top", label: "S&P 500" },
  { id: "nasdaq100", label: "NASDAQ-100" },
  { id: "global_leaders", label: "Global Leaders" },
  { id: "gold_commodities", label: "Gold & Commodities" },
  { id: "crypto_majors", label: "Crypto Majors" },
  { id: "forex_majors", label: "Forex Majors" },
];

const PERIODS: TreemapPeriod[] = ["1D", "1W", "1M", "3M", "YTD"];

export function SquarifiedTreemap({ fullPage = true }: { fullPage?: boolean }) {
  const { t } = useI18n();
  const savedFilters = useTerminalStore((s) => s.treemapFilters);
  const setTreemapFilters = useTerminalStore((s) => s.setTreemapFilters);

  const [universe, setUniverse] = useState<TreemapUniverse>(
    (savedFilters.universe as TreemapUniverse) || "nasdaq100",
  );
  const [period, setPeriod] = useState<TreemapPeriod>(
    (savedFilters.period as TreemapPeriod) || "1D",
  );
  const [sizeBy, setSizeBy] = useState<TreemapSizeBy>(
    (savedFilters.size_by as TreemapSizeBy) || "market_cap",
  );
  const [sectorFilter, setSectorFilter] = useState<string>(
    typeof savedFilters.sector === "string" ? savedFilters.sector : "",
  );
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [data, setData] = useState<TreemapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<(TreemapItem & { sectorName: string }) | null>(null);

  const loadTreemap = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({
        universe,
        period,
        size_by: sizeBy,
      });
      if (sectorFilter) qs.set("sector", sectorFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());
      const res = await apiRequest<TreemapResponse>(`/intelligence/treemap?${qs.toString()}`);
      setData(res);
    } catch (err) {
      if (!silent) {
        notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [period, searchQuery, sectorFilter, sizeBy, t.common.errorTitle, universe]);

  useEffect(() => {
    void loadTreemap(false);
  }, [loadTreemap]);

  useLiveEvents("macro_quotes", () => {
    void loadTreemap(true);
  });

  const updateFilters = (patch: Partial<{ universe: TreemapUniverse; period: TreemapPeriod; size_by: TreemapSizeBy; sector: string }>) => {
    const next = {
      universe: patch.universe ?? universe,
      period: patch.period ?? period,
      size_by: patch.size_by ?? sizeBy,
      sector: patch.sector !== undefined ? patch.sector : sectorFilter,
    };
    if (patch.universe) setUniverse(patch.universe);
    if (patch.period) setPeriod(patch.period);
    if (patch.size_by) setSizeBy(patch.size_by);
    if (patch.sector !== undefined) setSectorFilter(patch.sector);
    setTreemapFilters(next);
  };

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await apiRequest(`/intelligence/treemap/refresh?universe=${universe}&period=${period}`, {
        method: "POST",
      });
      await loadTreemap();
      notify.success(t.treemap.refreshLive, `${universe.toUpperCase()} • ${period}`);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const allSectors = useMemo(() => {
    return (data?.sectors ?? []).map((s) => s.sector);
  }, [data]);

  const sectorRects = useMemo(() => {
    const sectors = data?.sectors ?? [];
    if (sectors.length === 0) return [];
    const weightedSectors = sectors.map((sec) => ({
      item: sec,
      weight: sec.items.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0),
    }));
    return computeSquarifiedLayout(weightedSectors, 100, 100);
  }, [data]);

  const canvasHeight = fullPage ? "min(74vh, 720px)" : "420px";

  return (
    <div className="space-y-3">
      <Card className="border-border/70">
        <CardHeader className="space-y-2.5 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Grid2x2 className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">
                {data?.name || t.treemap.title}
              </CardTitle>
              {data?.linked_asset ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {data.linked_asset}
                </Badge>
              ) : null}
              {data?.updated_at ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(data.updated_at).toLocaleTimeString()}
                </span>
              ) : null}
            </div>

            <AsyncButton
              size="sm"
              variant="outline"
              loading={refreshing}
              loadingText={t.common.refreshing}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              {t.treemap.refreshLive}
            </AsyncButton>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-md border border-border/60 bg-muted/40 p-0.5">
              {UNIVERSES.map((u) => (
                <Button
                  key={u.id}
                  size="sm"
                  variant={universe === u.id ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => updateFilters({ universe: u.id, sector: "" })}
                >
                  {u.label}
                </Button>
              ))}
            </div>

            <div className="flex rounded-md border border-border/60 bg-muted/40 p-0.5">
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "secondary" : "ghost"}
                  className="h-7 px-2 font-mono text-xs"
                  onClick={() => updateFilters({ period: p })}
                >
                  {p}
                </Button>
              ))}
            </div>

            <SearchSelect
              aria-label={t.treemap.sizeBy}
              value={sizeBy}
              onChange={(e) => updateFilters({ size_by: e.target.value as TreemapSizeBy })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="market_cap">{t.treemap.sizeCap}</option>
              <option value="volume">{t.treemap.sizeVolume}</option>
              <option value="equal">{t.treemap.sizeEqual}</option>
            </SearchSelect>

            <SearchSelect
              aria-label={t.treemap.sector}
              value={sectorFilter}
              onChange={(e) => updateFilters({ sector: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">{t.common.all}</option>
              {allSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </SearchSelect>

            <div className="relative min-w-[160px] flex-1 sm:max-w-[220px]">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.treemap.searchTicker}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4" style={{ height: canvasHeight }}>
              {Array.from({ length: 8 }).map((_, idx) => (
                <Skeleton key={idx} className="h-full w-full rounded-lg" />
              ))}
            </div>
          ) : sectorRects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 p-10 text-center text-xs text-muted-foreground">
              <p>{t.treemap.dataUnavailable}</p>
              <AsyncButton
                size="sm"
                variant="outline"
                loading={refreshing}
                loadingText={t.common.refreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw className="mr-1.5 size-3.5" />
                {t.treemap.refreshLive}
              </AsyncButton>
            </div>
          ) : (
            <div
              className="relative w-full overflow-hidden rounded-lg border border-border/70 bg-muted/40 dark:bg-zinc-950/80"
              style={{ height: canvasHeight, minHeight: 420 }}
            >
              {sectorRects.map((secRect) => {
                const sec = secRect.item;
                const itemRects = computeSquarifiedLayout(
                  sec.items.map((it) => ({ item: it, weight: Math.max(1, it.weight || 1) })),
                  100,
                  100,
                );
                return (
                  <div
                    key={sec.sector}
                    className="absolute overflow-hidden border border-border/80 dark:border-zinc-950/90 p-0.5"
                    style={{
                      left: `${secRect.x}%`,
                      top: `${secRect.y}%`,
                      width: `${secRect.w}%`,
                      height: `${secRect.h}%`,
                    }}
                  >
                    <div className="flex h-full flex-col">
                      <div className="truncate bg-muted/90 dark:bg-zinc-900/95 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground dark:text-zinc-300">
                        {sec.sector}
                      </div>
                      <div className="relative flex-1">
                        {itemRects.map((tile) => {
                          const it = tile.item;
                          const largeTile = secRect.w * tile.w > 700 && secRect.h * tile.h > 450;
                          const mediumTile = secRect.w * tile.w > 220 && secRect.h * tile.h > 180;
                          return (
                            <button
                              key={`${sec.sector}-${it.ticker}`}
                              type="button"
                              onClick={() => setSelectedItem({ ...it, sectorName: sec.sector })}
                              className={`absolute flex flex-col items-center justify-center overflow-hidden border p-1 text-center transition-all ${treemapTileClass(it.change_pct)}`}
                              style={{
                                left: `${tile.x}%`,
                                top: `${tile.y}%`,
                                width: `${tile.w}%`,
                                height: `${tile.h}%`,
                              }}
                              title={`${it.ticker} (${it.name ?? it.ticker}): ${it.change_pct >= 0 ? "+" : ""}${it.change_pct.toFixed(2)}%`}
                            >
                              {largeTile ? (
                                <AssetLogo symbol={it.ticker} size={22} className="mb-0.5 shadow-sm" />
                              ) : null}
                              <span
                                className={`truncate font-mono font-bold leading-tight ${
                                  largeTile ? "text-xs" : mediumTile ? "text-[11px]" : "text-[9px]"
                                }`}
                              >
                                {it.ticker}
                              </span>
                              <span
                                className={`font-mono leading-tight tabular-nums ${
                                  largeTile ? "text-[11px]" : "text-[9px]"
                                }`}
                              >
                                {it.change_pct >= 0 ? "+" : ""}
                                {it.change_pct.toFixed(2)}%
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Slide-over Detail Drawer when a tile is clicked */}
      {selectedItem ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div className="flex items-center gap-2.5">
              <AssetLogo symbol={selectedItem.ticker} size={32} />
              <div>
                <h3 className="font-mono text-base font-bold">{selectedItem.ticker}</h3>
                <p className="text-xs text-muted-foreground">{selectedItem.name || selectedItem.sectorName}</p>
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setSelectedItem(null)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/60 p-2.5">
                <div className="text-muted-foreground">{t.treemap.period} ({period})</div>
                <div
                  className={`mt-1 font-mono text-base font-bold ${
                    selectedItem.change_pct >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {selectedItem.change_pct >= 0 ? "+" : ""}
                  {selectedItem.change_pct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-2.5">
                <div className="text-muted-foreground">Price</div>
                <div className="mt-1 font-mono text-base font-bold">
                  {selectedItem.price ? `$${selectedItem.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-2.5">
                <div className="text-muted-foreground">{t.treemap.sizeCap}</div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {formatCompactNumber(selectedItem.market_cap)}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-2.5">
                <div className="text-muted-foreground">{t.treemap.sizeVolume}</div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {formatCompactNumber(selectedItem.volume)}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-2.5">
              <div className="text-muted-foreground">{t.treemap.sector}</div>
              <div className="mt-0.5 font-medium">{selectedItem.sectorName}</div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Link
                to="/dashboard/hubs/$code"
                params={{ code: selectedItem.ticker }}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <LineChart className="mr-1.5 size-4" />
                {t.treemap.openChart}
              </Link>
              <Link
                to="/dashboard/explorer"
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
              >
                <Compass className="mr-1.5 size-4" />
                {t.treemap.openExplorer}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
