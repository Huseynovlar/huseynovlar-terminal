import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, LogOut, MonitorSmartphone, RefreshCw, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/sessions/")({
  component: SessionsListPage,
});

interface SessionRecord {
  id: string;
  ip_address?: string;
  user_agent?: string;
  is_current?: boolean;
  created_at?: string;
  expires_at?: string;
}

function SessionsListPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<SessionRecord | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequestPaged<SessionRecord>("/auth/sessions", page, DEFAULT_PAGE_SIZE);
      setSessions(res.items);
      setTotal(res.total);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, t.common.errorTitle]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleRevokeOne() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/auth/sessions/${encodeURIComponent(revokeTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      setRevokeTarget(null);
      await loadSessions();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeOthers() {
    setBusy(true);
    try {
      await apiRequest("/auth/sessions/revoke-others", { method: "POST" });
      notify.success(t.common.savedSuccess);
      setRevokeOthersOpen(false);
      await loadSessions();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.sessions.title}
      subtitle={t.sessions.subtitle}
      badge={`${sessions.length}`}
      actions={
        <>
          <AsyncButton size="sm" variant="outline" loading={loading} onClick={() => void loadSessions()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </AsyncButton>
          <Button size="sm" variant="destructive" onClick={() => setRevokeOthersOpen(true)}>
            <LogOut className="mr-1.5 size-3.5" />
            {t.sessions.revokeOthers}
          </Button>
        </>
      }
    >
      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border/50 p-0">
            {sessions.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-sm">{t.common.noData}</div>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <MonitorSmartphone className="size-4 shrink-0 text-primary" />
                      <span className="font-mono">{s.ip_address || "—"}</span>
                      {s.is_current ? <Badge className="text-[10px]">{t.sessions.currentBadge}</Badge> : null}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">{s.user_agent || t.common.unknown}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">
                      {s.created_at ? formatTerminalDateTime(s.created_at) : ""}
                      {s.expires_at ? ` • ${t.sessions.expiresAt}: ${formatTerminalDateTime(s.expires_at)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link to="/dashboard/sessions/$sessionId" params={{ sessionId: s.id }} />}
                    >
                      <Eye className="mr-1 size-3.5" />
                      {t.common.view}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRevokeTarget(s)}
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      {t.sessions.revokeBtn}
                    </Button>
                  </div>
                </div>
              ))
            )}
            <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t.sessions.confirmRevokeTitle}
        description={t.sessions.confirmRevokeDesc}
        loading={busy}
        onConfirm={handleRevokeOne}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title={t.sessions.confirmRevokeOthersTitle}
        description={t.sessions.confirmRevokeOthersDesc}
        loading={busy}
        onConfirm={handleRevokeOthers}
      />
    </TerminalPageShell>
  );
}
