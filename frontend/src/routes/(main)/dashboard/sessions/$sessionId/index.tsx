import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/sessions/$sessionId/")({
  component: SessionDetailPage,
});

interface SessionDetail {
  id: string;
  ip_address?: string;
  user_agent?: string;
  is_current?: boolean;
  created_at?: string;
  expires_at?: string;
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<SessionDetail>(`/auth/sessions/${encodeURIComponent(sessionId)}`)
      .then(setSession)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sessionId, t.common.errorTitle]);

  async function handleRevoke() {
    setBusy(true);
    try {
      await apiRequest(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      await navigate({ to: "/dashboard/sessions" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={`${t.sessions.title} #${sessionId.slice(0, 8)}`}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/sessions" />}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.sessions.revokeBtn}
          </Button>
        </>
      }
    >
      <Card className="max-w-2xl">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-xs">ID</div>
            <div className="font-mono text-xs">{session?.id || sessionId}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.sessions.ipAddress}</div>
            <div className="flex items-center gap-2 font-mono">
              <span>{session?.ip_address || "—"}</span>
              {session?.is_current ? <Badge>{t.sessions.currentBadge}</Badge> : null}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-muted-foreground text-xs">{t.sessions.userAgent}</div>
            <div className="break-all font-mono text-xs">{session?.user_agent || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.common.createdAt}</div>
            <div className="font-mono text-xs">
              {session?.created_at ? new Date(session.created_at).toLocaleString() : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.sessions.expiresAt}</div>
            <div className="font-mono text-xs">
              {session?.expires_at ? new Date(session.expires_at).toLocaleString() : "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.sessions.confirmRevokeTitle}
        description={t.sessions.confirmRevokeDesc}
        loading={busy}
        onConfirm={handleRevoke}
      />
    </TerminalPageShell>
  );
}
