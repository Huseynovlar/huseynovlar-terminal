import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Globe, RefreshCw, Search } from "lucide-react";

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

export const Route = createFileRoute("/(main)/dashboard/login-history/")({
  component: LoginHistoryListPage,
});

interface LoginHistoryEntry {
  id: string;
  action: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  details?: Record<string, unknown>;
}

function LoginHistoryListPage() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<LoginHistoryEntry[]>([]);
  const [ipFilter, setIpFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const qs = ipFilter.trim() ? `?ip=${encodeURIComponent(ipFilter.trim())}&limit=100` : "?limit=100";
      const res = await apiRequest<LoginHistoryEntry[]>(`/auth/login-history${qs}`);
      setEntries(Array.isArray(res) ? res : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipFilter, t.common.errorTitle]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <TerminalPageShell
      title={t.loginHistory.title}
      subtitle={t.loginHistory.subtitle}
      badge="GEO-IP"
      actions={
        <AsyncButton size="sm" variant="outline" loading={loading} onClick={() => void loadHistory()}>
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
            placeholder="Filter by IP (e.g. 100.104...)"
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadHistory()}>
          {t.common.filter}
        </Button>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t.loginHistory.action}</th>
                  <th className="px-3 py-2.5 font-medium">{t.sessions.ipAddress}</th>
                  <th className="px-3 py-2.5 font-medium">{t.common.createdAt}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-muted-foreground py-8 text-center">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Badge variant={entry.action.includes("fail") ? "destructive" : "secondary"} className="font-mono text-[10px]">
                          {entry.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <span className="inline-flex items-center gap-1.5">
                          <Globe className="size-3 text-muted-foreground" />
                          {entry.ip_address || "—"}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link to="/dashboard/login-history/$entryId" params={{ entryId: entry.id }} />}
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
