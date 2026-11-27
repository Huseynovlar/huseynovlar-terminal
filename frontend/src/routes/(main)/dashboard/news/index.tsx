import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useMarketListStream } from "@/framework/use-market-list-stream";
import { type LiveNewsItem, stripHtmlSafe, useNewsStream } from "@/framework/use-news-stream";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/news/")({
  component: NewsWirePage,
});

export interface NewsArticle {
  id: string;
  source: string;
  category: string;
  title: string;
  url: string;
  source_url?: string;
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

const CATEGORY_TABS = [
  { id: "all", label: "Все" },
  { id: "macro", label: "Макро / ЦБ" },
  { id: "crypto", label: "Крипто" },
  { id: "equities", label: "Акции / Индексы" },
  { id: "commodities", label: "Сырьё / Металлы" },
  { id: "sec", label: "SEC Filings" },
] as const;

function formatUtcTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toISOString().slice(11, 19);
}

function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function NewsWirePage() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [pendingItems, setPendingItems] = useState<NewsArticle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [highImpactOnly, setHighImpactOnly] = useState(false);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const wireListRef = useRef<HTMLDivElement | null>(null);

  const loadNews = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (category && category !== "all") qs.set("category", category);
        if (highImpactOnly) qs.set("high_impact", "true");
        if (portfolioOnly) qs.set("portfolio_only", "true");
        if (searchQuery.trim()) qs.set("q", searchQuery.trim());
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const res = await apiRequestPaged<NewsArticle>(`/intelligence/news${suffix}`, 1, 80);
        setArticles(res.items);
        setTotal(res.total);
        setPendingItems([]);
        setSelectedId((prev) => {
          if (prev && res.items.some((a) => a.id === prev)) return prev;
          return res.items[0]?.id ?? null;
        });
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки ленты", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [category, highImpactOnly, portfolioOnly, searchQuery],
  );

  useEffect(() => {
    void loadNews(false);
  }, [loadNews]);

  // Real-time /ws/news stream — zero setLoading, scroll-safe prepend or sticky pill
  const handleLiveNewsItem = useCallback((live: LiveNewsItem) => {
    const incoming: NewsArticle = {
      id: live.id,
      source: live.source,
      category: "global",
      title: stripHtmlSafe(live.title),
      url: "",
      summary: "",
      affected_assets: live.affected_assets,
      sentiment: live.sentiment.toLowerCase(),
      impact_score: live.impact_score,
      is_breaking: live.is_breaking,
      verification_count: 1,
      verified_source_count: 1,
      published_at: live.published_at,
    };

    const scrolledDown = (wireListRef.current?.scrollTop ?? 0) > 40;
    if (scrolledDown) {
      setPendingItems((prev) => (prev.some((x) => x.id === incoming.id) ? prev : [incoming, ...prev].slice(0, 50)));
    } else {
      setArticles((prev) => {
        if (prev.some((x) => x.id === incoming.id || x.title === incoming.title)) return prev;
        return [incoming, ...prev].slice(0, 120);
      });
      setTotal((n) => n + 1);
    }
  }, []);

  const { connected: newsWsLive } = useNewsStream(handleLiveNewsItem);

  const flushPendingToTop = () => {
    if (pendingItems.length === 0) return;
    setArticles((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const fresh = pendingItems.filter((p) => !seen.has(p.id));
      return [...fresh, ...prev].slice(0, 120);
    });
    setTotal((n) => n + pendingItems.length);
    setPendingItems([]);
    wireListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function handleRefreshWire() {
    setRefreshing(true);
    try {
      const res = await apiRequest<{ inserted?: number }>("/intelligence/news/refresh", { method: "POST" });
      await loadNews(true);
      notify.success("Лента обновлена", `+${res.inserted ?? 0} новых событий`);
    } catch (err) {
      notify.error("Ошибка обновления", err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedId) ?? articles[0] ?? null,
    [articles, selectedId],
  );

  // Live mini-quotes for tickers attached to the currently inspected news article
  const inspectorSymbols = useMemo(
    () => (selectedArticle?.affected_assets ?? []).slice(0, 8),
    [selectedArticle],
  );
  const liveQuotes = useMarketListStream(inspectorSymbols);

  return (
    <TerminalPageShell
      title="Лента новостей"
      subtitle="Реалтайм-агрегатор /ws/news · Tree News · Alpaca · SEC EDGAR · Fed · ECB · EIA"
      badge={newsWsLive ? `● WS LIVE · ${total}` : `${total}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard/news/sources"
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <ShieldCheck className="mr-1.5 size-3.5" />
            Источники
          </Link>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={refreshing}
            loadingText="Обновление..."
            onClick={() => void handleRefreshWire()}
            className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </AsyncButton>
        </div>
      }
    >
      <div className="flex h-[calc(100vh-148px)] min-h-[560px] flex-col gap-2.5">
        {/* Top Filter Bar (44px) */}
        <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`h-7 rounded-[4px] px-2.5 text-[11px] font-medium transition-colors ${
                  category === tab.id
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Importance Toggle */}
            <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setHighImpactOnly(false)}
                className={`rounded-[3px] px-2 py-0.5 font-medium ${
                  !highImpactOnly ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                }`}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setHighImpactOnly(true)}
                className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                  highImpactOnly ? "bg-[var(--bear)]/20 text-[var(--bear)]" : "text-[var(--text-muted)]"
                }`}
              >
                High Impact
              </button>
            </div>

            {/* Portfolio Assets Only Toggle */}
            <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={portfolioOnly}
                onChange={(e) => setPortfolioOnly(e.target.checked)}
                className="accent-[var(--accent-blue)]"
              />
              <span>Только мои активы</span>
            </label>

            {/* Search Input */}
            <div className="relative w-48 sm:w-56">
              <Search className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="XAUUSD, NVDA, BTC, CPI..."
                className="h-7 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Split-View Body (60% Wire / 40% Inspector) */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 lg:grid-cols-12">
          {/* Left 60% — Live Wire */}
          <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-7">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <span>Live Wire ({articles.length})</span>
              <span style={{ color: newsWsLive ? "var(--bull)" : "var(--text-muted)" }}>
                {newsWsLive ? "● /ws/news активен" : "○ переподключение..."}
              </span>
            </div>

            {pendingItems.length > 0 ? (
              <div className="absolute top-10 left-1/2 z-10 -translate-x-1/2">
                <button
                  type="button"
                  onClick={flushPendingToTop}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-blue)] bg-[var(--accent-blue)] px-3 py-1 text-[11px] font-semibold text-white shadow-md hover:opacity-95"
                >
                  <ArrowUp className="size-3" />
                  Новые события ({pendingItems.length})
                </button>
              </div>
            ) : null}

            <div ref={wireListRef} className="min-h-0 flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {loading && articles.length === 0 ? (
                <div className="p-3">
                  <TableSkeleton rows={10} cols={4} />
                </div>
              ) : articles.length === 0 ? (
                <div className="flex h-full items-center justify-center p-8 text-xs text-[var(--text-muted)]">
                  Нет новостей по выбранным фильтрам
                </div>
              ) : (
                articles.map((item) => {
                  const isSelected = selectedArticle?.id === item.id;
                  const isHigh = item.is_breaking || item.impact_score >= 7;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors ${
                        isSelected
                          ? "border-l-2 border-l-[var(--accent-blue)] bg-[var(--bg-elevated)]/80"
                          : "hover:bg-[var(--bg-elevated)]/40"
                      }`}
                    >
                      {/* Time UTC */}
                      <span className="w-[58px] shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                        {formatUtcTimeOnly(item.published_at)}
                      </span>

                      {/* Source Badge */}
                      <span className="w-[74px] shrink-0 truncate rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
                        {item.source}
                      </span>

                      {/* Importance */}
                      <span
                        className="w-[38px] shrink-0 rounded-[3px] px-1 py-0.5 text-center text-[9px] font-bold uppercase"
                        style={{
                          backgroundColor: isHigh
                            ? "color-mix(in srgb, var(--bear) 16%, transparent)"
                            : "color-mix(in srgb, var(--accent-amber) 14%, transparent)",
                          color: isHigh ? "var(--bear)" : "var(--accent-amber)",
                        }}
                      >
                        {isHigh ? "HIGH" : "MED"}
                      </span>

                      {/* Clean Headline */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">{item.title}</p>
                      </div>

                      {/* Clickable Ticker Chips */}
                      {item.affected_assets.length > 0 ? (
                        <div className="hidden shrink-0 items-center gap-1 sm:flex">
                          {item.affected_assets.slice(0, 3).map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: sym } });
                              }}
                              className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-blue)] hover:border-[var(--accent-blue)]"
                            >
                              {sym}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right 40% — News Inspector */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <span>Инспектор новости</span>
              {selectedArticle ? (
                <span className="tabular-nums">{formatTerminalDateTime(selectedArticle.published_at, { timezone: "UTC" })} UTC</span>
              ) : null}
            </div>

            {selectedArticle ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {/* Meta Badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-primary)]">
                    {selectedArticle.source}
                  </span>
                  {selectedArticle.is_breaking || selectedArticle.impact_score >= 7 ? (
                    <span className="rounded-[3px] bg-[var(--bear)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--bear)]">
                      HIGH IMPACT
                    </span>
                  ) : null}
                  {selectedArticle.verified_source_count > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-[3px] bg-[var(--bull)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--bull)]">
                      <CheckCircle2 className="size-3" />
                      Подтверждено ({selectedArticle.verified_source_count})
                    </span>
                  ) : null}
                  <span
                    className="rounded-[3px] border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{
                      color:
                        selectedArticle.sentiment === "bullish"
                          ? "var(--bull)"
                          : selectedArticle.sentiment === "bearish"
                            ? "var(--bear)"
                            : "var(--text-muted)",
                    }}
                  >
                    {selectedArticle.sentiment}
                  </span>
                </div>

                {/* Headline */}
                <h2 className="text-[15px] leading-snug font-semibold text-[var(--text-primary)]">
                  {selectedArticle.title}
                </h2>

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] uppercase text-[var(--text-muted)]">Время (UTC)</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatTerminalDateTime(selectedArticle.published_at, { timezone: "UTC" })} UTC
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-[var(--text-muted)]">Локальное время</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatLocalDateTime(selectedArticle.published_at)}
                    </div>
                  </div>
                </div>

                {/* Cleaned Summary */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    Аннотация / Контент
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    {selectedArticle.summary || "Краткий заголовок по ленте без расширенной аннотации. Откройте оригинал источника для полного текста."}
                  </p>
                </div>

                {/* Linked Tickers with Live Mini-Quotes */}
                {selectedArticle.affected_assets.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      Затронутые тикеры (живые котировки)
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {selectedArticle.affected_assets.slice(0, 8).map((sym) => {
                        const q = liveQuotes[sym];
                        return (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: sym } })}
                            className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-blue)]"
                          >
                            <div className="flex items-center gap-1.5">
                              <AssetLogo symbol={sym} size={16} />
                              <span className="text-[12px] font-semibold text-[var(--text-primary)]">{sym}</span>
                            </div>
                            <div className="text-right tabular-nums">
                              <div className="text-[11px] font-semibold text-[var(--text-primary)]">
                                {q ? q.price.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}
                              </div>
                              {q ? (
                                <div
                                  className="text-[10px] font-semibold"
                                  style={{ color: q.changePct >= 0 ? "var(--bull)" : "var(--bear)" }}
                                >
                                  {q.changePct >= 0 ? "+" : ""}
                                  {q.changePct.toFixed(2)}%
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                  {selectedArticle.url || selectedArticle.source_url ? (
                    <a
                      href={selectedArticle.source_url || selectedArticle.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                    >
                      Открыть оригинал
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                  {selectedArticle.affected_assets[0] ? (
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/dashboard/tickers/$symbol",
                          params: { symbol: selectedArticle.affected_assets[0] },
                        })
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-semibold text-white hover:opacity-90"
                    >
                      <TrendingUp className="size-3.5" />
                      Открыть {selectedArticle.affected_assets[0]} в терминале
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-xs text-[var(--text-muted)]">
                Выберите новость из ленты слева для просмотра деталей
              </div>
            )}
          </div>
        </div>
      </div>
    </TerminalPageShell>
  );
}
