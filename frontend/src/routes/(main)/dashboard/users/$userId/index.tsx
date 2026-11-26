import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Globe, History, MonitorSmartphone, Pencil, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GeoLocationMap } from "@/components/ui/geo-map";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

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
  is_online?: boolean;
  last_ip?: string;
  totp_enabled?: boolean;
  last_login_at?: string | null;
  created_at?: string;
  active_sessions?: Array<{
    id: string;
    ip_address?: string;
    user_agent?: string;
    created_at?: string;
    expires_at?: string;
  }>;
  recent_logins?: Array<{
    id: string;
    action: string;
    action_label?: Record<string, string>;
    ip_address?: string;
    created_at?: string;
  }>;
  recent_audit?: Array<{
    id: string;
    action: string;
    action_label?: Record<string, string>;
    resource_type?: string;
    resource_id?: string;
    ip_address?: string;
    created_at?: string;
  }>;
}

interface IpGeoResult {
  country?: string;
  city?: string;
  isp?: string;
  is_netbird?: boolean;
  lat?: number | null;
  lon?: number | null;
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [geo, setGeo] = useState<IpGeoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiRequest<UserDetail>(`/users/${encodeURIComponent(userId)}`)
      .then(async (res) => {
        setUser(res);
        if (res.last_ip) {
          const g = await apiRequest<IpGeoResult>(`/auth/ip-lookup/${encodeURIComponent(res.last_ip)}`).catch(
            () => null,
          );
          setGeo(g);
        }
      })
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
      subtitle={`ID: ${user?.id || userId}`}
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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>{t.common.details}</span>
              <Badge
                variant={user?.is_online ? "default" : "secondary"}
                className={user?.is_online ? "bg-emerald-600 text-white" : ""}
              >
                {user?.is_online ? "ONLINE" : "OFFLINE"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="text-muted-foreground text-xs">ID</div>
              <div className="font-mono text-xs break-all">{user?.id || userId}</div>
            </div>
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
              <div className="font-mono text-xs tabular-nums">
                {user?.last_login_at ? formatTerminalDateTime(user.last_login_at) : "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-primary" />
              Last Location {user?.last_ip ? `(${user.last_ip})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <GeoLocationMap
              lat={geo?.lat}
              lon={geo?.lon}
              label={[geo?.city, geo?.country].filter(Boolean).join(", ") || (geo?.is_netbird ? "NetBird VPN" : undefined)}
              sublabel={user?.last_ip}
              heightClass="h-48"
            />
            {geo?.isp ? <div className="text-muted-foreground font-mono text-[11px]">ISP: {geo.isp}</div> : null}
          </CardContent>
        </Card>
      </div>

      {/* Active Sessions & Recent Login History */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSmartphone className="size-4 text-primary" />
              {t.nav.sessions} ({user?.active_sessions?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50 text-xs">
              {!user?.active_sessions?.length ? (
                <div className="text-muted-foreground p-4 text-center">{t.common.noData}</div>
              ) : (
                user.active_sessions.map((s) => (
                  <Link
                    key={s.id}
                    to="/dashboard/sessions/$sessionId"
                    params={{ sessionId: s.id }}
                    className="hover:bg-muted/40 flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium">{s.ip_address || "—"}</div>
                      <div className="text-muted-foreground truncate text-[11px]">{s.user_agent || "—"}</div>
                    </div>
                    <div className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                      {formatTerminalDateTime(s.created_at)}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-4 text-primary" />
              {t.nav.loginHistory} ({user?.recent_logins?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50 text-xs">
              {!user?.recent_logins?.length ? (
                <div className="text-muted-foreground p-4 text-center">{t.common.noData}</div>
              ) : (
                user.recent_logins.map((l) => (
                  <Link
                    key={l.id}
                    to="/dashboard/login-history/$entryId"
                    params={{ entryId: l.id }}
                    className="hover:bg-muted/40 flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{l.action_label?.[language] ?? l.action}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{l.ip_address || "—"}</div>
                    </div>
                    <div className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                      {formatTerminalDateTime(l.created_at)}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Audit Trail */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-primary" />
            {t.nav.audit} ({user?.recent_audit?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">{t.loginHistory.action}</th>
                <th className="px-3 py-2 font-medium">{t.audit.resourceType}</th>
                <th className="px-3 py-2 font-medium">{t.sessions.ipAddress}</th>
                <th className="px-3 py-2 font-medium">{t.common.createdAt}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {!user?.recent_audit?.length ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-6 text-center">
                    {t.common.noData}
                  </td>
                </tr>
              ) : (
                user.recent_audit.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono">
                      <Link to="/dashboard/audit/$auditId" params={{ auditId: a.id }} className="text-primary hover:underline">
                        {a.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{a.action_label?.[language] ?? a.action}</td>
                    <td className="text-muted-foreground px-3 py-2 font-mono">{a.resource_type || "—"}</td>
                    <td className="px-3 py-2 font-mono">{a.ip_address || "—"}</td>
                    <td className="text-muted-foreground px-3 py-2 font-mono tabular-nums">
                      {formatTerminalDateTime(a.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
