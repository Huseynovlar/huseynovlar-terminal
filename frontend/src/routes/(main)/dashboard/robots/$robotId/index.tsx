import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Pencil, Trash2 } from "lucide-react";

import { RobotTelemetryPanel } from "@/components/m5/RobotTelemetryPanel";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalClock, formatUptimeSeconds, useUtcClock } from "@/framework/use-utc-clock";
import type { RobotItem } from "@/routes/(main)/dashboard/robots/index";

export const Route = createFileRoute("/(main)/dashboard/robots/$robotId/")({
  component: RobotDetailPage,
});

function RobotDetailPage() {
  const { robotId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone);

  const [robot, setRobot] = useState<RobotItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadRobot = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiRequest<RobotItem>(`/robots/${encodeURIComponent(robotId)}`);
        setRobot(res);
      } catch (err) {
        if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [robotId, t.common.errorTitle],
  );

  useEffect(() => {
    void loadRobot(false);
  }, [loadRobot]);

  useLiveEvents(["robot_state", "robot_telemetry"], () => {
    void loadRobot(true);
  });

  async function handleDownload(path: string, filename: string) {
    setBusy(true);
    try {
      const fn = await apiDownload(path, filename);
      notify.success(t.common.download, fn);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!robot) return;
    setBusy(true);
    try {
      await apiRequest(`/robots/${encodeURIComponent(robot.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, robot.name);
      void navigate({ to: "/dashboard/robots" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!robot) {
    return (
      <TerminalPageShell title={t.robots.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  const hbMs = robot.last_heartbeat_at ? Date.parse(robot.last_heartbeat_at) : Number.NaN;
  const ageSec = Number.isFinite(hbMs) ? Math.max(0, Math.floor((now.getTime() - hbMs) / 1000)) : null;

  return (
    <TerminalPageShell
      title={robot.name}
      subtitle={`${robot.program_name || "EA"} v${robot.version} • Magic #${robot.magic_number}`}
      badge={`${clock.time} ${clock.label}`}
      actions={
        <>
          <Link
            to="/dashboard/robots"
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => void handleDownload("/ops/downloads/ExnessPanelBridge.mq5", "ExnessPanelBridge.mq5")}
          >
            <Download className="mr-1.5 size-3.5" />
            .mq5
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => void handleDownload("/ops/downloads/ExnessPanelHook.mqh", "ExnessPanelHook.mqh")}
          >
            <Download className="mr-1.5 size-3.5" />
            .mqh
          </AsyncButton>
          {robot.account_login ? (
            <AsyncButton
              size="sm"
              variant="outline"
              loading={busy}
              onClick={() =>
                void handleDownload(
                  `/ops/setup-wizard/${encodeURIComponent(robot.account_login)}/bridge.set?url_mode=internal`,
                  `bridge_${robot.account_login}.set`,
                )
              }
            >
              <Download className="mr-1.5 size-3.5" />
              bridge.set
            </AsyncButton>
          ) : null}
          <Link
            to="/dashboard/robots/$robotId/edit"
            params={{ robotId: robot.id }}
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Symbol</div><div className="mt-1 flex items-center gap-1.5 font-mono text-base font-bold">{robot.symbol ? <AssetLogo symbol={robot.symbol} size={20} /> : null}{robot.symbol || "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Live Status</div><div className="mt-1"><Badge className="font-mono">{robot.live_status}</Badge></div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.robots.heartbeatAge}</div><div className="mt-1 font-mono text-base font-bold tabular-nums">{ageSec !== null ? formatUptimeSeconds(ageSec) : "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Execution Latency</div><div className="mt-1 font-mono text-base font-bold">{robot.last_execution_ms ?? 0} ms</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RobotTelemetryPanel state={robot.live_state_json} title={t.robots.telemetry} />

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t.robots.strategyNotes}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {robot.strategy_notes || t.common.noData}
            </p>
            <div>
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">params_json</div>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                {JSON.stringify(robot.params_json ?? {}, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.robots.confirmDeleteTitle}
        description={t.robots.confirmDeleteDesc}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
