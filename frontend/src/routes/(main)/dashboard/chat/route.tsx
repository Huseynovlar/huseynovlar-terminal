import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Newspaper, RefreshCw, Send, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/chat")({
  component: WorldNewsAndGeminiPage,
});

interface NewsRow {
  id: string;
  source: string;
  category: string;
  title: string;
  url: string;
  affected_assets: string[];
  sentiment: string;
  impact_score: number;
  is_breaking: boolean;
  published_at: string;
}

const PREVIEW_NEWS: NewsRow[] = [
  {
    id: "n1",
    source: "Kitco Gold News",
    category: "commodities",
    title: "Gold holds firm above $2,640 as global central banks accelerate physical reserve buying",
    url: "https://www.kitco.com/",
    affected_assets: ["XAUUSD"],
    sentiment: "bullish",
    impact_score: 8,
    is_breaking: true,
    published_at: new Date().toISOString(),
  },
  {
    id: "n2",
    source: "CNBC Finance & Markets",
    category: "equities_macro",
    title: "NASDAQ-100 futures climb ahead of US CPI as AI semiconductor revenue beats consensus",
    url: "https://www.cnbc.com/",
    affected_assets: ["USTEC"],
    sentiment: "bullish",
    impact_score: 8,
    is_breaking: false,
    published_at: new Date().toISOString(),
  },
  {
    id: "n3",
    source: "Federal Reserve Press",
    category: "central_banks",
    title: "FOMC minutes highlight data-dependent rate path; traders monitor Treasury yields (US10Y)",
    url: "https://www.federalreserve.gov/",
    affected_assets: ["XAUUSD", "USTEC", "EURUSD"],
    sentiment: "neutral",
    impact_score: 9,
    is_breaking: true,
    published_at: new Date().toISOString(),
  },
];

function WorldNewsAndGeminiPage() {
  const [assetFilter, setAssetFilter] = useState<string>("ALL");
  const [news, setNews] = useState<NewsRow[]>(PREVIEW_NEWS);
  const [refreshing, setRefreshing] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string>(
    "Нажмите «Утренний брифинг» или задайте любой вопрос — **Google Gemini Co-Pilot** проанализирует ваш живой портфель Exness (`XAUUSD` / `USTEC`), открытые позиции и мировые новости.",
  );

  function loadNews(filter: string) {
    const q = filter === "ALL" ? "" : `?asset=${filter}`;
    apiRequest<NewsRow[]>(`/intelligence/news${q}`)
      .then((rows) => {
        if (rows.length > 0) setNews(rows);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadNews(assetFilter);
  }, [assetFilter]);

  async function handleRefreshFeeds() {
    setRefreshing(true);
    try {
      await apiRequest("/intelligence/news/refresh", { method: "POST" });
      loadNews(assetFilter);
    } catch {
      // ignore offline preview
    } finally {
      setRefreshing(false);
    }
  }

  async function runGemini(text: string, kind = "copilot") {
    if (!text.trim()) return;
    setAiLoading(true);
    try {
      const res = await apiRequest<{ response_md: string }>("/intelligence/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ prompt: text, kind }),
      });
      setAiAnswer(res.response_md);
    } catch (err) {
      setAiAnswer(err instanceof Error ? err.message : "Не удалось обратиться к Gemini API");
    } finally {
      setAiLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runGemini(prompt);
    setPrompt("");
  }

  return (
    <TerminalPageShell
      title="Мировые новости и Google Gemini AI Co-Pilot"
      subtitle="Резервные мульти-источники новостей со всего мира (Kitco, FXStreet, CNBC, Fed, ECB, GDELT) + анализ портфеля через Google AI."
      badge="GEMINI AI"
      actions={
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleRefreshFeeds} disabled={refreshing}>
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Обновить мировые ленты
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Global Multi-Source News Stream */}
        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Newspaper className="size-4 text-blue-500" />
              Лента мировых новостей
            </CardTitle>
            <div className="flex gap-1">
              {["ALL", "XAUUSD", "USTEC", "EURUSD", "BTCUSD"].map((code) => (
                <Button
                  key={code}
                  size="sm"
                  variant={assetFilter === code ? "secondary" : "ghost"}
                  className="h-6 px-2 font-mono text-[11px]"
                  onClick={() => setAssetFilter(code)}
                >
                  {code}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            {news.map((item) => (
              <div key={item.id} className="space-y-1.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {item.is_breaking ? (
                      <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                        BREAKING
                      </Badge>
                    ) : null}
                    <span className="font-semibold text-foreground">{item.source}</span>
                    {item.affected_assets.map((tag) => (
                      <Badge key={tag} variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-muted-foreground font-mono">
                    Impact {item.impact_score}/10 • {item.published_at.slice(11, 16)} UTC
                  </span>
                </div>
                <a
                  href={item.url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary block text-sm font-medium leading-snug transition-colors"
                >
                  {item.title}
                </a>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Google Gemini AI Co-Pilot Panel */}
        <Card className="flex flex-col lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-amber-500" />
              Google AI (Gemini) Co-Pilot
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={aiLoading}
                onClick={() =>
                  runGemini("Сделай краткий утренний брифинг по XAUUSD и USTEC с учётом моих открытых позиций и новостей.", "briefing")
                }
              >
                Утренний брифинг
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={aiLoading}
                onClick={() =>
                  runGemini("Оцени текущие риски портфеля: корреляция XAUUSD и USTEC, просадка и ближайшие новости.", "risk")
                }
              >
                Риск-анализ портфеля
              </Button>
            </div>

            <div className="bg-muted/30 min-h-60 flex-1 whitespace-pre-wrap rounded-lg border border-border/60 p-3 text-xs leading-relaxed">
              {aiLoading ? "Gemini анализирует ваш портфель и мировые новости..." : aiAnswer}
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Спросите Gemini про XAUUSD, USTEC или риски..."
                className="text-xs"
              />
              <Button type="submit" size="sm" disabled={aiLoading}>
                <Send className="size-3.5" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
