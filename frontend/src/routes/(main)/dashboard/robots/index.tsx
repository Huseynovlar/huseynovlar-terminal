import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, Download, Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalClock, formatUptimeSeconds, useUtcClock } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/robots/")({
  component: RobotsListPage,
});

export interface RobotItem {
  id: string;
  account_id: string;
  account_name: string;
  account_login: string;
  account_currency: string;
  asset_id: string | null;
  magic_number: number;
  name: string;
  symbol: string;
  program_name: string;
  version: string;
  strategy_notes: string;
  params_json: Record<string, unknown>;
  live_status: string;
  live_state_json: Record<string, unknown>;
  last_execution_ms: number | null;
  last_heartbeat_at: string | null;
  heartbeat_age_sec: number | null;
  is_online: boolean;
  is_active: boolean;
  created_at: string;
}

function RobotsListPage() {
  const { t } = useI18n();
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone);

  const [robots, setRobots] = useState<RobotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RobotItem | null>(null);

  const loadRobots = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<RobotItem[]>("/robots");
      setRobots(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadRobots();
  }, [loadRobots]);

  useLiveEvents(["robot_state", "snapshot"], () => {
    void loadRobots();
  });

  async function handleDownload(path: string, fallback: string, key: string) {
    setBusyKey(key);
    try {
      const fn = await apiDownload(path, fallback);
      notify.success(t.common.download, fn);
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
      await apiRequest(`/robots/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadRobots();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <TerminalPageShell
      title={t.robots.title}
      subtitle={t.robots.subtitle}
      badge={`${clock.time} ${clock.label}`}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busyKey === "mq5"}
            loadingText={t.common.loading}
            onClick={() => void handleDownload("/ops/downloads/ExnessPanelBridge.mq5", "ExnessPanelBridge.mq5", "mq5")}
          >
            <Download className="mr-1.5 size-3.5" />
            {t.robots.downloadBridge}
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busyKey === "mqh"}
            loadingText={t.common.loading}
            onClick={() => void handleDownload("/ops/downloads/ExnessPanelHook.mqh", "ExnessPanelHook.mqh", "mqh")}
          >
            <Download className="mr-1.5 size-3.5" />
            {t.robots.downloadHook}
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => void loadRobots()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/robots/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.robots.newBtn}
          </Link>
        </>
      }
    >
      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : robots.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            {t.common.noData}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Robot / EA</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">{t.robots.magicNumber}</th>
                  <th className="px-3 py-2">{t.common.status}</th>
                  <th className="px-3 py-2">{t.robots.heartbeatAge} (1s)</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => {
                  const hbMs = r.last_heartbeat_at ? Date.parse(r.last_heartbeat_at) : Number.NaN;
                  const liveAgeSec = Number.isFinite(hbMs)
                    ? Math.max(0, Math.floor((now.getTime() - hbMs) / 1000))
                    : null;
                  const onlineNow = liveAgeSec !== null && liveAgeSec <= 90;
                  return (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">
                        <Link
                          to="/dashboard/robots/$robotId"
                          params={{ robotId: r.id }}
                          className="flex items-center gap-1.5 hover:text-primary hover:underline"
                        >
                          <Bot className="size-3.5 text-primary" />
                          <span>{r.name}</span>
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.program_name || "EA"} v{r.version}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 font-mono">
                          {r.symbol ? <AssetLogo symbol={r.symbol} size={16} /> : null}
                          <span>{r.symbol || "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <div>{r.account_name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground">#{r.account_login}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{r.magic_number}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={onlineNow ? "default" : "secondary"}
                          className={`font-mono text-[10px] ${onlineNow ? "bg-emerald-600 text-white" : ""}`}
                        >
                          {r.live_status || (onlineNow ? "LIVE" : "IDLE")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {liveAgeSec !== null ? formatUptimeSeconds(liveAgeSec) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.account_login ? (
                            <AsyncButton
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              loading={busyKey === `set:${r.id}`}
                              loadingText="..."
                              onClick={() =>
                                void handleDownload(
                                  `/ops/setup-wizard/${encodeURIComponent(r.account_login)}/bridge.set?url_mode=internal`,
                                  `bridge_${r.account_login}.set`,
                                  `set:${r.id}`,
                                )
                              }
                              title={t.robots.downloadSet}
                            >
                              <Download className="size-3.5" />
                            </AsyncButton>
                          ) : null}
                          <Link
                            to="/dashboard/robots/$robotId"
                            params={{ robotId: r.id }}
                            className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          >
                            <Eye className="size-3.5" />
                          </Link>
                          <Link
                            to="/dashboard/robots/$robotId/edit"
                            params={{ robotId: r.id }}
                            className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          >
                            <Pencil className="size-3.5" />
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive"
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.robots.confirmDeleteTitle}
        description={`${t.robots.confirmDeleteDesc} (${deleteTarget?.name ?? ""})`}
        loading={busyKey === `del:${deleteTarget?.id ?? ""}`}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
