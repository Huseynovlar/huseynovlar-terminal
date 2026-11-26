import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Newspaper, Plus, Search } from "lucide-react";

import { InteractiveChartCanvas } from "@/components/m5/InteractiveChartCanvas";
import { OrderBookAndTicks } from "@/components/m5/OrderBookAndTicks";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/explorer/")({
  component: AssetExplorerPage,
});

interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  in_hubs: boolean;
}

interface ExploredNewsItem {
  id: string;
  title: string;
  source: string;
  sentiment: string;
  verified_source_count: number;
  published_at: string;
}

function AssetExplorerPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [activeSymbol, setActiveSymbol] = useState("NVDA");
  const [activeName, setActiveName] = useState("NVIDIA Corporation");
  const [inHubs, setInHubs] = useState(false);
  const [addingHub, setAddingHub] = useState(false);

  const [newsMode, setNewsMode] = useState<"auto" | "manual">("auto");
  const [manualNewsQuery, setManualNewsQuery] = useState("");
  const [news, setNews] = useState<ExploredNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);

  const loadNews = useCallback(async () => {
    setLoadingNews(true);
    try {
      const qs = new URLSearchParams();
      if (newsMode === "auto") {
        qs.set("symbol", activeSymbol);
      } else if (manualNewsQuery.trim()) {
        qs.set("q", manualNewsQuery.trim());
      }
      const rows = await apiRequest<ExploredNewsItem[]>(`/intelligence/news/explore?${qs.toString()}`);
      setNews(Array.isArray(rows) ? rows : []);
    } catch {
      setNews([]);
    } finally {
      setLoadingNews(false);
    }
  }, [activeSymbol, manualNewsQuery, newsMode]);

  useEffect(() => {
    void loadNews();
  }, [loadNews]);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await apiRequest<SymbolSearchResult[]>(
        `/charts/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: SymbolSearchResult) {
    setActiveSymbol(r.symbol);
    setActiveName(r.name);
    setInHubs(r.in_hubs);
  }

  async function handleAddToHubs() {
    setAddingHub(true);
    try {
      await apiRequest("/assets", {
        method: "POST",
        body: JSON.stringify({
          code: activeSymbol.toUpperCase(),
          name: activeName || activeSymbol.toUpperCase(),
          group: "equities",
          category: "equities",
          broker_symbols: [activeSymbol.toUpperCase()],
          news_tags: [activeSymbol.toLowerCase(), activeName.toLowerCase()],
        }),
      });
      setInHubs(true);
      notify.success(t.common.createdSuccess, activeSymbol);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setAddingHub(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.explorer.title}
      subtitle={t.explorer.subtitle}
      badge={activeSymbol}
      actions={
        <AsyncButton
          size="sm"
          variant={inHubs ? "secondary" : "default"}
          disabled={inHubs}
          loading={addingHub}
          loadingText={t.common.saving}
          onClick={() => void handleAddToHubs()}
        >
          {inHubs ? <Check className="mr-1.5 size-3.5" /> : <Plus className="mr-1.5 size-3.5" />}
          {inHubs ? t.explorer.alreadyInHubs : t.explorer.addToHubs}
        </AsyncButton>
      }
    >
      <Card className="border-border/70">
        <CardContent className="space-y-2.5 p-3">
          <form onSubmit={(e) => void handleSearch(e)} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.explorer.searchPlaceholder}
                className="pl-9 text-xs"
              />
            </div>
            <AsyncButton type="submit" size="sm" loading={searching} loadingText={t.common.loading}>
              {t.explorer.searchBtn}
            </AsyncButton>
          </form>

          {results.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {results.map((r) => (
                <button
                  key={`${r.symbol}-${r.exchange}`}
                  type="button"
                  onClick={() => selectResult(r)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                    activeSymbol === r.symbol
                      ? "border-primary bg-primary/10 font-semibold"
                      : "border-border/60 hover:border-primary/40"
                  }`}
                >
                  <AssetLogo symbol={r.symbol} size={16} />
                  <span className="font-mono">{r.symbol}</span>
                  <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">{r.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <InteractiveChartCanvas symbol={activeSymbol} mode="explore" height={460} />
          <OrderBookAndTicks symbol={activeSymbol} />
        </div>

        <Card className="border-border/70">
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Newspaper className="size-4 text-primary" />
              {t.nav.news} ({news.length})
            </CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={newsMode === "auto" ? "default" : "outline"}
                className="h-7 flex-1 text-xs"
                onClick={() => setNewsMode("auto")}
              >
                {t.explorer.newsModeAuto}
              </Button>
              <Button
                size="sm"
                variant={newsMode === "manual" ? "default" : "outline"}
                className="h-7 flex-1 text-xs"
                onClick={() => setNewsMode("manual")}
              >
                {t.explorer.newsModeManual}
              </Button>
            </div>
            {newsMode === "manual" ? (
              <div className="flex gap-1.5">
                <Input
                  value={manualNewsQuery}
                  onChange={(e) => setManualNewsQuery(e.target.value)}
                  placeholder={t.explorer.newsFilterPlaceholder}
                  className="h-8 text-xs"
                />
                <Button size="sm" variant="outline" className="h-8" onClick={() => void loadNews()}>
                  <Search className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="max-h-[420px] space-y-2 overflow-y-auto pt-0 text-xs">
            {loadingNews ? (
              <TableSkeleton rows={5} cols={1} />
            ) : news.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">{t.common.noData}</p>
            ) : (
              news.map((item) => (
                <Link
                  key={item.id}
                  to="/dashboard/news/$newsId"
                  params={{ newsId: item.id }}
                  className="block rounded-md border border-border/60 p-2.5 transition hover:border-primary/50"
                >
                  <div className="line-clamp-2 font-medium">{item.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {item.source} {item.verified_source_count > 0 ? "✓" : ""}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{item.sentiment}</Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
