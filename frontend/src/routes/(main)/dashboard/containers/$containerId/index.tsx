import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Play, RefreshCw, RotateCcw, Square, Terminal, Trash2 } from "lucide-react";

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

export const Route = createFileRoute("/(main)/dashboard/containers/$containerId/")({
  component: ContainerDetailPage,
});

interface ContainerDetail {
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
  networks?: string[];
}

function ContainerDetailPage() {
  const { containerId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [item, setItem] = useState<ContainerDetail | null>(null);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await apiRequest<ContainerDetail>(`/ops/containers/${encodeURIComponent(containerId)}`);
      setItem(detail);
      const cname = detail.container_name || detail.name || containerId;
      const logRes = await apiRequest<{ logs?: string }>(
        `/ops/containers/${encodeURIComponent(cname)}/logs?tail=200`,
      ).catch(() => ({ logs: "" }));
      setLogs(logRes.logs || "");
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [containerId, t.common.errorTitle]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (loading && !item) return <PageSkeleton />;

  const cname = item?.container_name || item?.name || containerId;

  async function runAction(action: "start" | "stop" | "restart") {
    setBusyAction(action);
    try {
      await apiRequest(`/ops/containers/${encodeURIComponent(cname)}/${action}`, { method: "POST" });
      notify.success(t.containers.actionSuccess, `${cname} → ${action.toUpperCase()}`);
      await loadDetail();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    setBusyAction("delete");
    try {
      await apiRequest(`/ops/containers/${encodeURIComponent(containerId)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      await navigate({ to: "/dashboard/containers" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <TerminalPageShell
      title={item?.display_name || cname}
      subtitle={`${t.containers.detailTitle} • ${cname}`}
      badge={item?.state || "DOCKER"}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/containers" />}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Button>
          <AsyncButton size="sm" variant="outline" loading={loading} onClick={() => void loadDetail()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </AsyncButton>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/dashboard/containers/$containerId/edit" params={{ containerId }} />}
          >
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">{t.common.status}</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm">
            <Badge>{item?.state || t.common.unknown}</Badge>
            <div className="text-muted-foreground mt-1 text-xs">{item?.status || "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">{t.containers.cpu}</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold">
            {item?.cpu_pct != null ? `${item.cpu_pct.toFixed(1)}%` : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">{t.containers.memory}</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold">
            {item?.mem_mb != null ? `${Math.round(item.mem_mb)} MB` : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">{t.common.actions}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            <AsyncButton size="xs" variant="outline" loading={busyAction === "start"} onClick={() => void runAction("start")}>
              <Play className="mr-1 size-3 text-emerald-500" />
              {t.containers.start}
            </AsyncButton>
            <AsyncButton size="xs" variant="outline" loading={busyAction === "restart"} onClick={() => void runAction("restart")}>
              <RotateCcw className="mr-1 size-3 text-amber-500" />
              {t.containers.restart}
            </AsyncButton>
            <AsyncButton size="xs" variant="outline" loading={busyAction === "stop"} onClick={() => void runAction("stop")}>
              <Square className="mr-1 size-3 text-destructive" />
              {t.containers.stop}
            </AsyncButton>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Terminal className="size-4" />
            {t.containers.logs}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">
            {logs || t.common.noData}
          </pre>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.containers.confirmDeleteTitle}
        description={t.containers.confirmDeleteDesc}
        loading={busyAction === "delete"}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
