import { useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/audit/$auditId/")({
  component: AuditDetailPage,
});

interface AuditDetail {
  id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  user_id?: string;
  ip_address?: string;
  created_at?: string;
  details?: unknown;
  metadata?: unknown;
}

function AuditDetailPage() {
  const { auditId } = Route.useParams();
  const { t } = useI18n();
  const [entry, setEntry] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<AuditDetail>(`/audit/${encodeURIComponent(auditId)}`)
      .then(setEntry)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [auditId, t.common.errorTitle]);

  if (loading) return <PageSkeleton />;

  const payload = entry?.details ?? entry?.metadata ?? {};

  return (
    <TerminalPageShell
      title={t.audit.detailTitle}
      subtitle={entry?.id || auditId}
      badge={entry?.action || "AUDIT"}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/audit" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Button>
      }
    >
      <Card className="max-w-3xl">
        <CardContent className="space-y-4 pt-6 text-xs">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">{t.loginHistory.action}</div>
              <Badge className="mt-0.5 font-mono">{entry?.action || "—"}</Badge>
            </div>
            <div>
              <div className="text-muted-foreground">{t.audit.resourceType}</div>
              <div className="font-mono">{entry?.resource_type || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.audit.resourceId}</div>
              <div className="font-mono">{entry?.resource_id || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.audit.actor}</div>
              <div className="font-mono">{entry?.user_id || "system"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.sessions.ipAddress}</div>
              <div className="font-mono">{entry?.ip_address || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.common.createdAt}</div>
              <div className="font-mono">
                {entry?.created_at ? new Date(entry.created_at).toLocaleString() : "—"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-muted-foreground font-medium">{t.audit.metadata}</div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
