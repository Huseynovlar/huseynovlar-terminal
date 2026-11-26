import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, FlaskConical, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/news/sources/")({
  component: NewsSourcesListPage,
});

export interface NewsSourceItem {
  id: string;
  name: string;
  url: string;
  category: string;
  trust_tier: string;
  is_verified: boolean;
  is_enabled: boolean;
  asset_tags: string[];
  poll_interval_sec: number;
  last_polled_at: string | null;
  last_error: string | null;
  article_count: number;
}

function NewsSourcesListPage() {
  const { t } = useI18n();
  const [sources, setSources] = useState<NewsSourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsSourceItem | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<NewsSourceItem[]>("/intelligence/sources");
      setSources(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function handleTest(src: NewsSourceItem) {
    setBusyKey(`test:${src.id}`);
    try {
      const res = await apiRequest<{ ok?: boolean; entries_found?: number; status_code?: number }>(
        `/intelligence/sources/${encodeURIComponent(src.id)}/test`,
        { method: "POST" },
      );
      if (res.ok) {
        notify.success(t.sources.testSuccess, `${src.name} (${res.entries_found ?? 0} entries)`);
      } else {
        notify.warning(src.name, `HTTP ${res.status_code ?? "ERR"}`);
      }
      await loadSources();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyKey(`del:${deleteTarget.id}`);
    try {
      await apiRequest(`/intelligence/sources/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadSources();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <TerminalPageShell
      title={t.sources.title}
      subtitle={t.sources.subtitle}
      badge={`${sources.length}`}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void loadSources()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/news/sources/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.sources.newBtn}
          </Link>
        </>
      }
    >
      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">{t.sources.trustTier}</th>
                  <th className="px-3 py-2">Articles</th>
                  <th className="px-3 py-2">{t.common.status}</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => (
                  <tr key={src.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <Link
                        to="/dashboard/news/sources/$sourceId"
                        params={{ sourceId: src.id }}
                        title={String(src.id)}
                        className="text-primary hover:underline"
                      >
                        {String(src.id).slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Link to="/dashboard/news/sources/$sourceId" params={{ sourceId: src.id }} className="hover:underline">
                          {src.name}
                        </Link>
                        {src.is_verified ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null}
                      </div>
                      <div className="max-w-xs truncate font-mono text-[10px] text-muted-foreground">{src.url}</div>
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{src.category}</Badge></td>
                    <td className="px-3 py-2 font-mono">{src.trust_tier}</td>
                    <td className="px-3 py-2 font-mono">{src.article_count}</td>
                    <td className="px-3 py-2">
                      <Badge variant={src.is_enabled ? "default" : "secondary"} className="text-[10px]">
                        {src.is_enabled ? t.common.enabled : t.common.disabled}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <AsyncButton
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          loading={busyKey === `test:${src.id}`}
                          loadingText="..."
                          onClick={() => void handleTest(src)}
                          title={t.sources.testFeed}
                        >
                          <FlaskConical className="size-3.5" />
                        </AsyncButton>
                        <Link to="/dashboard/news/sources/$sourceId" params={{ sourceId: src.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                          <Eye className="size-3.5" />
                        </Link>
                        <Link to="/dashboard/news/sources/$sourceId/edit" params={{ sourceId: src.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                          <Pencil className="size-3.5" />
                        </Link>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDeleteTarget(src)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.sources.confirmDeleteTitle}
        description={`${t.sources.confirmDeleteDesc} (${deleteTarget?.name ?? ""})`}
        loading={busyKey === `del:${deleteTarget?.id ?? ""}`}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
