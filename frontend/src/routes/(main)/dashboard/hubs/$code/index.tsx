import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Newspaper, Pencil, Trash2 } from "lucide-react";

import { InteractiveChartCanvas } from "@/components/m5/InteractiveChartCanvas";
import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/")({
  component: HubDetailPage,
});

interface AssetHubDetail {
  id: string;
  code: string;
  name: string;
  group: string;
  stats: {
    accounts_count: number;
    robots_count: number;
    open_positions_count: number;
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    total_trades: number;
    win_rate_pct: number;
    net_pnl_usd: number;
  };
  news_digest: {
    total_articles: number;
    breaking_count: number;
    corroborated_count: number;
    dominant_sentiment: string;
    sentiment_breakdown: { bullish: number; bearish: number; neutral: number };
  };
  recent_news: Array<{
    id: string;
    title: string;
    source: string;
    sentiment: string;
    verification_count: number;
    published_at: string;
  }>;
}

function HubDetailPage() {
  const { code } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [hub, setHub] = useState<AssetHubDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    apiRequest<AssetHubDetail>(`/assets/${encodeURIComponent(code)}`)
      .then(setHub)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [code, t.common.errorTitle]);

  async function handleDelete() {
    if (!hub) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(hub.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, hub.code);
      void navigate({ to: "/dashboard/hubs" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!hub) {
    return (
      <TerminalPageShell title={t.hubs.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={`${hub.code} — ${hub.name}`}
      badge={hub.group}
      actions={
        <>
          <Link to="/dashboard/hubs" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <Link to="/dashboard/hubs/$code/edit" params={{ code: hub.code }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card><CardContent className="flex items-center gap-2.5 p-3"><AssetLogo symbol={hub.code} size={32} /><div><div className="text-[11px] text-muted-foreground">Accounts / Robots</div><div className="font-mono text-base font-bold">{hub.stats.accounts_count} / {hub.stats.robots_count}</div></div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Equity</div><div className="mt-1 font-mono text-base font-bold">{formatUsd(hub.stats.total_equity_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Net PnL ({hub.stats.total_trades})</div><div className={`mt-1 font-mono text-base font-bold ${hub.stats.net_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{formatSignedUsd(hub.stats.net_pnl_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Win Rate</div><div className="mt-1 font-mono text-base font-bold">{hub.stats.win_rate_pct.toFixed(1)}%</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.hubs.dominantSentiment}</div><div className="mt-1"><Badge className="font-mono uppercase">{hub.news_digest.dominant_sentiment}</Badge></div></CardContent></Card>
      </div>

      <InteractiveChartCanvas symbol={hub.code} mode="hub" height={380} />

      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Newspaper className="size-4 text-primary" />
            {t.hubs.newsDigest} ({hub.news_digest.total_articles})
          </CardTitle>
          <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
            <Badge variant="outline" className="text-emerald-500">Bullish: {hub.news_digest.sentiment_breakdown.bullish}</Badge>
            <Badge variant="outline" className="text-rose-500">Bearish: {hub.news_digest.sentiment_breakdown.bearish}</Badge>
            <Badge variant="outline">Neutral: {hub.news_digest.sentiment_breakdown.neutral}</Badge>
            <Badge variant="secondary">{t.hubs.corroborated}: {hub.news_digest.corroborated_count}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-xs">
          {hub.recent_news.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">{t.common.noData}</p>
          ) : (
            hub.recent_news.map((item) => (
              <Link
                key={item.id}
                to="/dashboard/news/$newsId"
                params={{ newsId: item.id }}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2.5 transition hover:border-primary/50"
              >
                <div className="min-w-0">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.source} • {formatTerminalDateTime(item.published_at)}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {item.sentiment}
                </Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.hubs.confirmDeleteTitle} description={t.hubs.confirmDeleteDesc} loading={busy} onConfirm={handleDelete} />
    </TerminalPageShell>
  );
}
