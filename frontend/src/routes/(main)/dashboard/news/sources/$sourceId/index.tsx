import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FlaskConical, Pencil, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { NewsSourceItem } from "@/routes/(main)/dashboard/news/sources/index";

export const Route = createFileRoute("/(main)/dashboard/news/sources/$sourceId/")({
  component: NewsSourceDetailPage,
});

function NewsSourceDetailPage() {
  const { sourceId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [src, setSrc] = useState<NewsSourceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadSource = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<NewsSourceItem>(`/intelligence/sources/${encodeURIComponent(sourceId)}`);
      setSrc(res);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sourceId, t.common.errorTitle]);

  useEffect(() => {
    void loadSource();
  }, [loadSource]);

  async function handleTest() {
    if (!src) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ ok?: boolean; entries_found?: number }>(
        `/intelligence/sources/${encodeURIComponent(src.id)}/test`,
        { method: "POST" },
      );
      if (res.ok) notify.success(t.sources.testSuccess, `${res.entries_found ?? 0} entries`);
      else notify.warning(src.name, "Feed check returned non-OK");
      await loadSource();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!src) return;
    setBusy(true);
    try {
      await apiRequest(`/intelligence/sources/${encodeURIComponent(src.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, src.name);
      void navigate({ to: "/dashboard/news/sources" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!src) {
    return (
      <TerminalPageShell title={t.sources.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={src.name}
      subtitle={src.url}
      badge={src.trust_tier}
      actions={
        <>
          <Link to="/dashboard/news/sources" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <AsyncButton size="sm" variant="outline" loading={busy} onClick={() => void handleTest()}>
            <FlaskConical className="mr-1.5 size-3.5" />
            {t.sources.testFeed}
          </AsyncButton>
          <Link to="/dashboard/news/sources/$sourceId/edit" params={{ sourceId: src.id }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
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
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span>{t.sources.detailTitle}</span>
            {src.is_verified ? <CheckCircle2 className="size-4 text-emerald-500" /> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div><span className="text-muted-foreground">Category:</span> <Badge variant="outline">{src.category}</Badge></div>
          <div><span className="text-muted-foreground">Articles Collected:</span> <span className="font-mono font-bold">{src.article_count}</span></div>
          <div><span className="text-muted-foreground">Last Polled:</span> <span className="font-mono">{src.last_polled_at ?? "—"}</span></div>
          {src.last_error ? (
            <div className="rounded bg-destructive/10 p-2 font-mono text-destructive">{src.last_error}</div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.sources.confirmDeleteTitle} description={t.sources.confirmDeleteDesc} loading={busy} onConfirm={handleDelete} />
    </TerminalPageShell>
  );
}
