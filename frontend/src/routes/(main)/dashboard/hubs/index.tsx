import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, Eye, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";

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
  accounts_count?: number;
  robots_count?: number;
  is_pinned?: boolean;
}

function AssetHubsListPage() {
  const { t } = useI18n();
  const [hubs, setHubs] = useState<AssetHubItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AssetHubItem | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadHubs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : "";
        const res = await apiRequestPaged<AssetHubItem>(`/assets${qs}`, page, DEFAULT_PAGE_SIZE);
        setHubs(res.items);
        setTotal(res.total);
      } catch (err) {
        if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [debouncedQ, page, t.common.errorTitle],
  );

  useEffect(() => {
    void loadHubs(false);
  }, [loadHubs]);

  useLiveEvents(["trade_event", "robot_state"], () => {
    void loadHubs(true);
  });

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(deleteTarget.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.code);
      setDeleteTarget(null);
      await loadHubs(false);
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
      badge={`${total}`}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void loadHubs(false)}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/hubs/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.hubs.newBtn}
          </Link>
        </>
      }
    >
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по коду, названию, группе или ID..."
          className="h-8 pl-8 text-xs"
        />
      </div>

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : hubs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">{t.common.noData}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hubs.map((hub) => (
              <Card key={hub.id} className="border-border/70 transition hover:border-primary/40">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-2.5">
                    <AssetLogo symbol={hub.code} size={30} />
                    <div>
                      <CardTitle className="font-mono text-sm font-bold">{hub.code}</CardTitle>
                      <p className="text-xs text-muted-foreground">{hub.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground/70" title={hub.id}>
                        ID: {hub.id.slice(0, 8)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    {hub.group || hub.category}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-0 text-xs">
                  <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="size-3 text-primary" />
                      Счета: <strong className="text-foreground">{hub.accounts_count ?? 0}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Bot className="size-3 text-emerald-500" />
                      Роботы: <strong className="text-foreground">{hub.robots_count ?? 0}</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(hub.news_tags ?? []).slice(0, 5).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive"
                        onClick={() => setDeleteTarget(hub)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.common.delete}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : ""}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
