import { formatTerminalDateTime } from "@/framework/use-utc-clock";
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
  username?: string;
  action_label?: Record<string, string>;
  ip_address?: string;
  created_at?: string;
  details?: unknown;
  metadata?: unknown;
}

function AuditDetailPage() {
  const { auditId } = Route.useParams();
  const { t, language } = useI18n();
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
  const label = entry?.action_label?.[language] ?? entry?.action ?? "—";
  const detailRows: [string, string][] =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload as Record<string, unknown>).map(([k, v]) => [
          k,
          typeof v === "object" && v !== null ? JSON.stringify(v) : String(v),
        ])
      : [];

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
      <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardContent className="space-y-3 pt-6 text-xs">
            <Field label={t.loginHistory.action}>
              <div className="space-y-1">
                <div className="text-sm font-semibold">{label}</div>
                <Badge className="font-mono">{entry?.action || "—"}</Badge>
              </div>
            </Field>
            <Field label={t.audit.actor}>
              <div className="font-mono">
                {entry?.username || "system"}
                {entry?.user_id ? <span className="text-muted-foreground block text-[10px]">{entry.user_id}</span> : null}
              </div>
            </Field>
            <Field label={t.audit.resourceType}>
              <span className="font-mono">{entry?.resource_type || "—"}</span>
            </Field>
            <Field label={t.audit.resourceId}>
              <span className="font-mono break-all">{entry?.resource_id || "—"}</span>
            </Field>
            <Field label={t.sessions.ipAddress}>
              <span className="font-mono">{entry?.ip_address || "—"}</span>
            </Field>
            <Field label={t.common.createdAt}>
              <span className="font-mono">{entry?.created_at ? formatTerminalDateTime(entry.created_at) : "—"}</span>
            </Field>
            <Field label="ID">
              <span className="font-mono break-all">{entry?.id || auditId}</span>
            </Field>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="space-y-4 pt-6 text-xs">
            {detailRows.length > 0 ? (
              <div className="space-y-1">
                <div className="text-muted-foreground font-medium">{t.audit.metadata}</div>
                <div className="divide-y divide-border/50 rounded-lg border border-border/60">
                  {detailRows.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[minmax(8rem,12rem)_1fr] gap-3 px-3 py-1.5">
                      <span className="text-muted-foreground font-mono">{k}</span>
                      <span className="font-mono break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-1">
              <div className="text-muted-foreground font-medium">JSON</div>
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
