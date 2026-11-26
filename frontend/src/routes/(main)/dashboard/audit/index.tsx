import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, RefreshCw, Search } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/audit/")({
  component: AuditListPage,
});

interface AuditEntry {
  id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  created_at?: string;
}

function AuditListPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const qs = actionFilter.trim() ? `?action=${encodeURIComponent(actionFilter.trim())}&limit=100` : "?limit=100";
      const res = await apiRequest<AuditEntry[]>(`/audit${qs}`);
      setRows(Array.isArray(res) ? res : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [actionFilter, t.common.errorTitle]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  return (
    <TerminalPageShell
      title={t.audit.title}
      subtitle={t.audit.subtitle}
      badge="AUDIT"
      actions={
        <AsyncButton size="sm" variant="outline" loading={loading} onClick={() => void loadAudit()}>
          <RefreshCw className="mr-1.5 size-3.5" />
          {t.common.refresh}
        </AsyncButton>
      }
    >
      <div className="flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input
            className="pl-8 font-mono text-xs"
            placeholder="Filter by action..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadAudit()}>
          {t.common.filter}
        </Button>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2.5 font-medium">{t.loginHistory.action}</th>
                  <th className="px-3 py-2.5 font-medium">{t.audit.resourceType}</th>
                  <th className="px-3 py-2.5 font-medium">{t.sessions.ipAddress}</th>
                  <th className="px-3 py-2.5 font-medium">{t.common.createdAt}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground py-8 text-center">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <Link
                        to="/dashboard/audit/$auditId"
                        params={{ auditId: row.id }}
                        title={String(row.id)}
                        className="text-primary hover:underline"
                      >
                        {String(row.id).slice(0, 8)}
                      </Link>
                    </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.resource_type || "—"} {row.resource_id ? `#${row.resource_id.slice(0, 8)}` : ""}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.ip_address || "—"}</td>
                      <td className="text-muted-foreground px-3 py-2 font-mono">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link to="/dashboard/audit/$auditId" params={{ auditId: row.id }} />}
                        >
                          <Eye className="mr-1 size-3.5" />
                          {t.common.view}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </TerminalPageShell>
  );
}
