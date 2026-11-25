import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/hubs/")({
  component: AssetHubsListPage,
});

export interface AssetHubItem {
  id: string;
  code: string;
  name: string;
  group: string;
  category: string;
  logo_url?: string | null;
  broker_symbols: string[];
  news_tags: string[];
  is_pinned?: boolean;
}

function AssetHubsListPage() {
  const { t } = useI18n();
  const [hubs, setHubs] = useState<AssetHubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AssetHubItem | null>(null);

  const loadHubs = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<AssetHubItem[]>("/assets");
      setHubs(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadHubs();
  }, [loadHubs]);

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      await apiRequest("/assets/seed-defaults", { method: "POST" });
      notify.success(t.hubs.seedDefaults);
      await loadHubs();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(deleteTarget.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.code);
      setDeleteTarget(null);
      await loadHubs();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.hubs.title}
      subtitle={t.hubs.subtitle}
      badge={`${hubs.length}`}
      actions={
        <>
          <AsyncButton size="sm" variant="outline" loading={seeding} loadingText={t.common.processing} onClick={() => void handleSeedDefaults()}>
            <Sparkles className="mr-1.5 size-3.5" />
            {t.hubs.seedDefaults}
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => void loadHubs()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link to="/dashboard/hubs/new" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1.5 size-3.5" />
            {t.hubs.newBtn}
          </Link>
        </>
      }
    >
      {loading ? (
        <CardGridSkeleton count={6} />
      ) : hubs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            {t.common.noData}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hubs.map((hub) => (
            <Card key={hub.id} className="border-border/70">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2.5">
                  <AssetLogo symbol={hub.code} size={28} />
                  <div>
                    <CardTitle className="font-mono text-sm font-bold">{hub.code}</CardTitle>
                    <p className="text-xs text-muted-foreground">{hub.name}</p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{hub.group || hub.category}</Badge>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0 text-xs">
                <div className="flex flex-wrap gap-1">
                  {(hub.news_tags ?? []).slice(0, 5).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <Link
                    to="/dashboard/hubs/$code"
                    params={{ code: hub.code }}
                    className="inline-flex h-7 items-center rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/20"
                  >
                    <Eye className="mr-1 size-3.5" />
                    {t.common.view}
                  </Link>
                  <div className="flex gap-1">
                    <Link
                      to="/dashboard/hubs/$code/edit"
                      params={{ code: hub.code }}
                      className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                    >
                      <Pencil className="size-3.5" />
                    </Link>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDeleteTarget(hub)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.hubs.confirmDeleteTitle}
        description={`${t.hubs.confirmDeleteDesc} (${deleteTarget?.code ?? ""})`}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
