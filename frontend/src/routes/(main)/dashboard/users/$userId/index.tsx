import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/users/$userId/")({
  component: UserDetailPage,
});

interface UserDetail {
  id: string;
  username: string;
  email?: string;
  display_name?: string;
  role: string;
  is_active: boolean;
  totp_enabled?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiRequest<UserDetail>(`/users/${encodeURIComponent(userId)}`)
      .then(setUser)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [userId, t.common.errorTitle]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiRequest(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      await navigate({ to: "/dashboard/users" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={user?.display_name || user?.username || userId}
      subtitle={t.users.detailTitle}
      badge={user?.role || "USER"}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/users" />}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/dashboard/users/$userId/edit" params={{ userId }} />}
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
      <Card className="max-w-2xl">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-xs">{t.auth.username}</div>
            <div className="font-mono font-medium">{user?.username || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.auth.email}</div>
            <div>{user?.email || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.users.role}</div>
            <Badge className="mt-0.5 font-mono">{user?.role || "—"}</Badge>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.users.activeStatus}</div>
            <Badge variant={user?.is_active ? "outline" : "destructive"} className="mt-0.5">
              {user?.is_active ? t.common.active : t.common.inactive}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.users.totpStatus}</div>
            <div>{user?.totp_enabled ? t.common.enabled : t.common.disabled}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t.users.lastLogin}</div>
            <div className="font-mono text-xs">
              {user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.users.confirmDeleteTitle}
        description={t.users.confirmDeleteDesc}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
