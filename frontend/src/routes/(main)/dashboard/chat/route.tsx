import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Newspaper, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";

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
  source_domain?: string;
  trust_tier?: string;
  is_verified_source?: boolean;
  corroborating_sources?: string[];
  verified_corroborators?: string[];
  verification_count?: number;
  verified_source_count?: number;
  category: string;
  title: string;
  url: string;
  affected_assets: string[];
  sentiment: string;
  impact_score: number;
  is_breaking: boolean;
  published_at: string;
}

interface VerifiedSourceRow {
  id: string;
  name: string;
  domain: string;
  category: string;
  priority: string;
  verified: boolean;
  trust_tier: string;
  items_count: number;
}

function WorldNewsAndGeminiPage() {
  const [assetFilter, setAssetFilter] = useState<string>("ALL");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [news, setNews] = useState<NewsRow[]>([]);
  const [sources, setSources] = useState<VerifiedSourceRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string>(
    "Нажмите «Утренний брифинг» или задайте любой вопрос — **Google Gemini Co-Pilot** проанализирует ваш живой портфель Exness (`XAUUSD` / `USTEC`), открытые позиции и проверенные мировые новости.",
  );

  function loadNews(filter: string, onlyVerified: boolean) {
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("asset", filter);
    if (onlyVerified) params.set("verified_only", "true");
    const qs = params.toString() ? `?${params.toString()}` : "";
    apiRequest<NewsRow[]>(`/intelligence/news${qs}`)
      .then((rows) => setNews(rows))
      .catch(() => setNews([]));
  }

  function loadSources() {
    apiRequest<VerifiedSourceRow[]>("/intelligence/sources")
      .then((rows) => setSources(rows))
      .catch(() => {});
  }

  useEffect(() => {
    loadNews(assetFilter, verifiedOnly);
  }, [assetFilter, verifiedOnly]);

  useEffect(() => {
    loadSources();
  }, []);

  async function handleRefreshFeeds() {
    setRefreshing(true);
    try {
      await apiRequest("/intelligence/news/refresh", { method: "POST" });
      loadNews(assetFilter, verifiedOnly);
      loadSources();
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
      title="Мировые новости (Verified Sources) и Google Gemini AI"
      subtitle="Реестр подтверждённых первоисточников с зелёной галочкой ✓, автоматическая группировка и перекрёстная проверка новостей между СМИ + Gemini Co-Pilot."
      badge="VERIFIED WIRE"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={verifiedOnly ? "default" : "outline"}
            className="gap-1.5 text-xs"
            onClick={() => setVerifiedOnly((v) => !v)}
          >
            <BadgeCheck className="size-3.5 text-emerald-500" />
            Только проверенные ✓
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleRefreshFeeds} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Обновить ленты
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Global Multi-Source Verified News Stream */}
        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Newspaper className="size-4 text-blue-500" />
              Лента мировых новостей и кросс-проверка
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
            {news.map((item) => {
              const verCount = item.verification_count || 1;
              const corr = item.corroborating_sources || [];
              return (
                <div key={item.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.is_breaking ? (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                          BREAKING
                        </Badge>
                      ) : null}
                      <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                        {item.source}
                        {item.is_verified_source ? (
                          <BadgeCheck
                            className="size-3.5 text-emerald-500"
                            aria-label="Подтверждённый источник из реестра"
                          />
                        ) : null}
                      </span>
                      {item.source_domain ? (
                        <span className="text-muted-foreground font-mono text-[10px]">({item.source_domain})</span>
                      ) : null}
                      {verCount > 1 ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 bg-emerald-500/15 px-1.5 py-0 text-[10px] text-emerald-500"
                        >
                          <ShieldCheck className="size-3" />
                          Подтверждено: {verCount} СМИ
                        </Badge>
                      ) : null}
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
                  {corr.length > 0 ? (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span>Также подтвердили:</span>
                      {corr.map((src) => (
                        <span
                          key={src}
                          className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          {src}
                          {(item.verified_corroborators || []).includes(src) ? (
                            <BadgeCheck className="size-3 text-emerald-500" />
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Right Column: Gemini Co-Pilot + Verified Sources Registry */}
        <div className="space-y-4 lg:col-span-5">
          <Card className="flex flex-col">
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
                    runGemini(
                      "Сделай краткий утренний брифинг по XAUUSD и USTEC с учётом моих открытых позиций и проверенных новостей.",
                      "briefing",
                    )
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
                    runGemini(
                      "Оцени текущие риски портфеля: корреляция XAUUSD и USTEC, просадка и ближайшие новости.",
                      "risk",
                    )
                  }
                >
                  Риск-анализ портфеля
                </Button>
              </div>

              <div className="bg-muted/30 min-h-48 flex-1 whitespace-pre-wrap rounded-lg border border-border/60 p-3 text-xs leading-relaxed">
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

          {/* Verified Sources Registry */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-emerald-500" />
                  Реестр проверенных источников
                </span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {sources.filter((s) => s.verified).length} VERIFIED
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-64 space-y-1.5 overflow-auto text-xs">
              {sources.length === 0 ? (
                <div className="text-muted-foreground py-2">Загрузка реестра источников...</div>
              ) : (
                sources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center justify-between rounded border border-border/50 bg-muted/20 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 font-medium">
                        <span className="truncate">{src.name}</span>
                        {src.verified ? (
                          <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <Badge variant="outline" className="px-1 py-0 text-[9px]">
                            АГРЕГАТОР
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {src.domain} • {src.trust_tier.toUpperCase()}
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {src.items_count}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TerminalPageShell>
  );
}
