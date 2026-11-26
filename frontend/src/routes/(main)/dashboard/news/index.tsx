import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, RefreshCw, Search, ShieldCheck } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { SearchSelect } from "@/components/ui/search-select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/news/")({
  component: NewsWirePage,
});

export interface NewsArticle {
  id: string;
  source: string;
  category: string;
  title: string;
  url: string;
  summary: string;
  affected_assets: string[];
  sentiment: string;
  impact_score: number;
  is_breaking: boolean;
  verification_count: number;
  verified_source_count: number;
  verified_corroborators?: string[];
  ai_summary?: string | null;
  published_at: string;
}

function NewsWirePage() {
  const { t } = useI18n();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [hubs, setHubs] = useState<Array<{ code: string; name: string }>>([]);
  const [assetFilter, setAssetFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ code: string; name: string }>>("/assets")
      .then((rows) => setHubs(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadNews = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (assetFilter) qs.set("asset", assetFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());
      if (sentiment) qs.set("sentiment", sentiment);
      if (verifiedOnly) qs.set("verified_only", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await apiRequestPaged<NewsArticle>(`/intelligence/news${suffix}`, page, DEFAULT_PAGE_SIZE);
      setArticles(res.items);
      setTotal(res.total);
    } catch (err) {
      if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [assetFilter, page, searchQuery, sentiment, t.common.errorTitle, verifiedOnly]);

  useEffect(() => {
    void loadNews(false);
  }, [loadNews]);

  useLiveEvents("breaking_news", () => {
    void loadNews(true);
  });

  async function handleRefreshWire() {
    setRefreshing(true);
    try {
      const res = await apiRequest<{ inserted?: number }>("/intelligence/news/refresh", { method: "POST" });
      await loadNews(true);
      notify.success(t.news.refreshNews, `+${res.inserted ?? 0}`);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.news.title}
      subtitle={t.news.subtitle}
      badge={`${total}`}
      actions={
        <>
          <Link
            to="/dashboard/news/sources"
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <ShieldCheck className="mr-1.5 size-3.5" />
            {t.news.sourcesBtn}
          </Link>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={refreshing}
            loadingText={t.common.refreshing}
            onClick={() => void handleRefreshWire()}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.news.refreshNews}
          </AsyncButton>
        </>
      }
    >
      {/* Dynamic Asset Hubs + Search Filter Bar */}
      <Card className="border-border/70">
        <CardContent className="space-y-2.5 p-3 text-xs">
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={assetFilter === "" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setAssetFilter("")}
            >
              {t.common.all}
            </Button>
            {hubs.map((h) => (
              <Button
                key={h.code}
                size="sm"
                variant={assetFilter === h.code ? "default" : "outline"}
                className="h-7 gap-1.5 px-2 font-mono text-xs"
                onClick={() => setAssetFilter(h.code)}
              >
                <AssetLogo symbol={h.code} size={14} />
                {h.code}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.common.search}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <SearchSelect
              value={sentiment}
              onChange={(e) => setSentiment(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">{t.news.sentiment}: {t.common.all}</option>
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
              <option value="neutral">Neutral</option>
            </SearchSelect>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
              />
              <span>{t.news.verifiedOnly}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : articles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            {t.common.noData}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {articles.map((item) => (
            <Card key={item.id} className="border-border/70 transition hover:border-primary/40">
              <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.is_breaking ? (
                      <Badge variant="destructive" className="font-mono text-[10px]">BREAKING</Badge>
                    ) : null}
                    <Badge variant="outline" className="font-mono text-[10px]">{item.source}</Badge>
                    {item.verified_source_count > 0 ? (
                      <Badge variant="secondary" className="gap-1 font-mono text-[10px] text-emerald-500">
                        <CheckCircle2 className="size-3" />
                        {item.verified_source_count}✓
                      </Badge>
                    ) : null}
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] ${
                        item.sentiment === "bullish"
                          ? "text-emerald-500"
                          : item.sentiment === "bearish"
                            ? "text-rose-500"
                            : ""
                      }`}
                    >
                      {item.sentiment}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatTerminalDateTime(item.published_at)}
                    </span>
                  </div>
                  <Link
                    to="/dashboard/news/$newsId"
                    params={{ newsId: item.id }}
                    className="block text-sm font-semibold hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  {item.summary ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
                  ) : null}
                </div>
                <Link
                  to="/dashboard/news/$newsId"
                  params={{ newsId: item.id }}
                  className="inline-flex h-8 shrink-0 items-center rounded-md border border-input px-2.5 text-xs hover:bg-accent"
                >
                  <Eye className="mr-1 size-3.5" />
                  {t.common.view}
                </Link>
              </CardContent>
            </Card>
          ))}
          <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}
    </TerminalPageShell>
  );
}
