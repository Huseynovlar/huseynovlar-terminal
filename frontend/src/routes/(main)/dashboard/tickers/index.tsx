import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, Plus, RefreshCw, Search } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

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
}

const CLASSES = ["all", "equities", "crypto", "forex", "metals", "indices", "commodities"] as const;

function MarketTickersPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [assetClass, setAssetClass] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 220);
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

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiRequest<{ added: number; total: number; sources: string[] }>("/assets/tickers/sync", {
        method: "POST",
      });
      notify.success("Справочник тикеров обновлён", `+${res.added} новых (всего ${res.total}: ${res.sources.join(", ")})`);
      setPage(1);
      await loadTickers();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <TerminalPageShell
      title="Справочник тикеров"
      subtitle="Все доступные инструменты (Binance, Alpaca US Stocks/ETFs, Forex, Металлы, Индексы) с официальными логотипами — используются при создании Хабов и Роботов"
      badge={`${total} тикеров`}
      actions={
        <AsyncButton size="sm" loading={syncing} loadingText="Синхронизация..." onClick={() => void handleSync()}>
          <RefreshCw className="mr-1.5 size-3.5" />
          Синхронизировать (Binance + Alpaca)
        </AsyncButton>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: NVIDIA, AAPL, BTC, XAUUSD, EURUSD..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CLASSES.map((c) => (
            <Button
              key={c}
              size="xs"
              variant={assetClass === c ? "default" : "outline"}
              className="font-mono text-[10px] uppercase"
              onClick={() => {
                setAssetClass(c);
                setPage(1);
              }}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">{t.common.noData}</CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Тикер и Лого</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Класс</th>
                  <th className="px-3 py-2">Биржа / Источник</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((tk) => (
                  <tr key={tk.symbol} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <AssetLogo symbol={tk.symbol} size={24} />
                        <span className="font-mono font-bold">{tk.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{tk.name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {tk.asset_class}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {tk.exchange} • {tk.source}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          to="/dashboard/explorer"
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-[11px] hover:bg-accent"
                        >
                          <Compass className="size-3" />
                          График
                        </Link>
                        <Link
                          to="/dashboard/hubs/new"
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/20"
                        >
                          <Plus className="size-3" />
                          В Хаб
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
          </CardContent>
        </Card>
      )}
    </TerminalPageShell>
  );
}
