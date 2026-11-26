import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertOctagon,
  Eye,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Trash2,
} from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, PromptDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/containers/")({
  component: ContainersListPage,
});

interface ContainerItem {
  id?: string;
  name: string;
  container_name?: string;
  display_name?: string;
  host_label?: string;
  image?: string;
  state?: string;
  status?: string;
  cpu_pct?: number | null;
  mem_mb?: number | null;
}

interface AccountOption {
  id: string;
  name: string;
  mt5_login: string;
  currency?: string;
}

function ContainersListPage() {
  const { t } = useI18n();
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContainerItem | null>(null);
  const [killAccountId, setKillAccountId] = useState("");
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [killLoading, setKillLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cList, aList] = await Promise.all([
        apiRequest<ContainerItem[]>("/ops/containers").catch(() => [] as ContainerItem[]),
        apiRequest<AccountOption[]>("/accounts").catch(() => [] as AccountOption[]),
      ]);
      setContainers(Array.isArray(cList) ? cList : []);
      const accs = Array.isArray(aList) ? aList : [];
      setAccounts(accs);
      setKillAccountId((prev) => prev || accs[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useLiveEvents("container_event", () => {
    void loadAll();
  });

  async function runAction(name: string, action: "start" | "stop" | "restart") {
    const key = `${name}:${action}`;
    setBusyKey(key);
    try {
      await apiRequest(`/ops/containers/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      notify.success(t.containers.actionSuccess, `${name} → ${action.toUpperCase()}`);
      await loadAll();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id || deleteTarget.name;
    setBusyKey(`delete:${targetId}`);
    try {
      await apiRequest(`/ops/containers/${encodeURIComponent(targetId)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.display_name || deleteTarget.name);
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleKillSwitch(confirmText: string) {
    if (!killAccountId) return;
    setKillLoading(true);
    try {
      await apiRequest(`/ops/kill-switch/${encodeURIComponent(killAccountId)}`, {
        method: "POST",
        body: JSON.stringify({ confirm_text: confirmText }),
      });
      notify.warning(t.containers.killSwitchTitle, `Kill-Switch dispatched (${killAccountId})`);
      setKillDialogOpen(false);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setKillLoading(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.containers.title}
      subtitle={t.containers.subtitle}
      badge="DOCKER OPS"
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={loading}
            loadingText={t.common.refreshing}
            onClick={() => void loadAll()}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </AsyncButton>
          <Button size="sm" nativeButton={false} render={<Link to="/dashboard/containers/new" />}>
            <Plus className="mr-1.5 size-3.5" />
            {t.containers.registerBtn}
          </Button>
        </>
      }
    >
      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {containers.length === 0 ? (
            <Card className="lg:col-span-2">
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                {t.common.noData}
              </CardContent>
            </Card>
          ) : (
            containers.map((c) => {
              const cid = c.id || c.name;
              const cname = c.container_name || c.name;
              const isRunning = (c.state || "").toLowerCase() === "running" || (c.status || "").toLowerCase().startsWith("up");
              return (
                <Card key={cid} className="border-border/70">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Server className="size-4 text-primary" />
                          <span>{c.display_name || cname}</span>
                        </CardTitle>
                        <CardDescription className="font-mono text-xs">
                          {cname} {c.host_label ? `• ${c.host_label}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant={isRunning ? "default" : "secondary"} className="font-mono text-[10px] uppercase">
                        {c.state || (isRunning ? "running" : "stopped")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-xs">
                      <div>
                        <div className="text-muted-foreground text-[10px]">{t.common.status}</div>
                        <div className="truncate font-mono">{c.status || t.common.unknown}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">{t.containers.cpu}</div>
                        <div className="font-mono">{c.cpu_pct != null ? `${c.cpu_pct.toFixed(1)}%` : "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">{t.containers.memory}</div>
                        <div className="font-mono">{c.mem_mb != null ? `${Math.round(c.mem_mb)} MB` : "—"}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        <AsyncButton
                          size="xs"
                          variant="outline"
                          loading={busyKey === `${cname}:start`}
                          onClick={() => void runAction(cname, "start")}
                        >
                          <Play className="mr-1 size-3 text-emerald-500" />
                          {t.containers.start}
                        </AsyncButton>
                        <AsyncButton
                          size="xs"
                          variant="outline"
                          loading={busyKey === `${cname}:restart`}
                          onClick={() => void runAction(cname, "restart")}
                        >
                          <RotateCcw className="mr-1 size-3 text-amber-500" />
                          {t.containers.restart}
                        </AsyncButton>
                        <AsyncButton
                          size="xs"
                          variant="outline"
                          loading={busyKey === `${cname}:stop`}
                          onClick={() => void runAction(cname, "stop")}
                        >
                          <Square className="mr-1 size-3 text-destructive" />
                          {t.containers.stop}
                        </AsyncButton>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link to="/dashboard/containers/$containerId" params={{ containerId: cid }} />}
                        >
                          <Eye className="mr-1 size-3" />
                          {t.common.view}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link to="/dashboard/containers/$containerId/edit" params={{ containerId: cid }} />}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertOctagon className="size-4" />
            {t.containers.killSwitchTitle}
          </CardTitle>
          <CardDescription>{t.containers.killSwitchDesc}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label htmlFor="kill-account-select" className="text-xs font-medium">
              {t.containers.selectAccount}
            </label>
            <SearchSelect
              id="kill-account-select"
              value={killAccountId}
              onChange={(e) => setKillAccountId(e.target.value)}
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
            >
              {accounts.length === 0 ? (
                <option value="">{t.common.noData}</option>
              ) : (
                accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} — MT5 #{acc.mt5_login} ({acc.currency || "USD"})
                  </option>
                ))
              )}
            </SearchSelect>
          </div>
          <Button
            variant="destructive"
            disabled={!killAccountId}
            onClick={() => setKillDialogOpen(true)}
          >
            <AlertOctagon className="mr-1.5 size-4" />
            {t.containers.triggerKillSwitch}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.containers.confirmDeleteTitle}
        description={t.containers.confirmDeleteDesc}
        loading={Boolean(deleteTarget && busyKey === `delete:${deleteTarget.id || deleteTarget.name}`)}
        onConfirm={handleDelete}
      />

      <PromptDialog
        open={killDialogOpen}
        onOpenChange={setKillDialogOpen}
        title={t.containers.confirmKillTitle}
        description={t.containers.confirmKillDesc}
        placeholder="CLOSE ALL"
        expectedValue="CLOSE ALL"
        destructive
        loading={killLoading}
        confirmLabel={t.containers.triggerKillSwitch}
        onSubmit={handleKillSwitch}
      />
    </TerminalPageShell>
  );
}
