import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/users/")({
  component: UsersListPage,
});

interface UserRecord {
  id: string;
  username: string;
  email?: string;
  display_name?: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER" | string;
  is_active: boolean;
  totp_enabled?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

function UsersListPage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<UserRecord[]>("/users");
      setUsers(Array.isArray(res) ? res : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/users/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.username);
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.users.title}
      subtitle={t.users.subtitle}
      badge="RBAC"
      actions={
        <Button size="sm" nativeButton={false} render={<Link to="/dashboard/users/new" />}>
          <Plus className="mr-1.5 size-3.5" />
          {t.users.newBtn}
        </Button>
      }
    >
      {loading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t.auth.username}</th>
                  <th className="px-3 py-2.5 font-medium">{t.auth.displayName}</th>
                  <th className="px-3 py-2.5 font-medium">{t.users.role}</th>
                  <th className="px-3 py-2.5 font-medium">{t.users.activeStatus}</th>
                  <th className="px-3 py-2.5 font-medium">{t.users.totpStatus}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground py-8 text-center">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium">
                        <div className="flex items-center gap-1.5">
                          <Users className="size-3.5 text-muted-foreground" />
                          <span>{u.username}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{u.display_name || "—"}</div>
                        <div className="text-muted-foreground text-[11px]">{u.email || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.role === "ADMIN" ? "default" : "secondary"} className="font-mono text-[10px]">
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.is_active ? "outline" : "destructive"} className="text-[10px]">
                          {u.is_active ? t.common.active : t.common.inactive}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {u.totp_enabled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-500">
                            <ShieldCheck className="size-3.5" />
                            {t.common.enabled}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t.common.disabled}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            nativeButton={false}
                            render={<Link to="/dashboard/users/$userId" params={{ userId: u.id }} />}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            nativeButton={false}
                            render={<Link to="/dashboard/users/$userId/edit" params={{ userId: u.id }} />}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.users.confirmDeleteTitle}
        description={t.users.confirmDeleteDesc}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
