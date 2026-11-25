import { useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { NewsArticle } from "@/routes/(main)/dashboard/news/index";

export const Route = createFileRoute("/(main)/dashboard/news/$newsId/")({
  component: NewsDetailPage,
});

function NewsDetailPage() {
  const { newsId } = Route.useParams();
  const { t } = useI18n();
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<NewsArticle>(`/intelligence/news/${encodeURIComponent(newsId)}`)
      .then(setArticle)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [newsId, t.common.errorTitle]);

  if (loading) return <PageSkeleton />;
  if (!article) {
    return (
      <TerminalPageShell title={t.news.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={article.title}
      subtitle={`${article.source} • ${new Date(article.published_at).toLocaleString()}`}
      badge={article.sentiment}
      actions={
        <>
          <Link to="/dashboard/news" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              {t.news.openOriginal}
            </a>
          ) : null}
        </>
      }
    >
      <Card className="max-w-3xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{article.source}</Badge>
            {article.verified_source_count > 0 ? (
              <Badge variant="secondary" className="gap-1 text-emerald-500">
                <CheckCircle2 className="size-3.5" />
                {t.news.corroboratedBy}: {article.verified_source_count}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <p className="whitespace-pre-wrap text-foreground">{article.summary || t.common.noData}</p>
          {article.ai_summary ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 font-semibold text-primary">AI Summary</div>
              <p className="whitespace-pre-wrap">{article.ai_summary}</p>
            </div>
          ) : null}
          {article.affected_assets && article.affected_assets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {article.affected_assets.map((code) => (
                <Link
                  key={code}
                  to="/dashboard/hubs/$code"
                  params={{ code }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs hover:border-primary/50"
                >
                  <AssetLogo symbol={code} size={16} />
                  <span className="font-mono">{code}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
