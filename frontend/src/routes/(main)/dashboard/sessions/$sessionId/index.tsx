import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Globe, History, Trash2 } from "lucide-react";

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

interface IpGeoResult {
  ip: string;
  is_private?: boolean;
  is_netbird?: boolean;
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  isp?: string;
  lat?: number | null;
  lon?: number | null;
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [geo, setGeo] = useState<IpGeoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<SessionDetail>(`/auth/sessions/${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        setSession(res);
        if (res.ip_address) {
          const lookup = await apiRequest<IpGeoResult>(`/auth/ip-lookup/${encodeURIComponent(res.ip_address)}`).catch(
            () => null,
          );
          setGeo(lookup);
        }
      })
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
      subtitle={session?.id || sessionId}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/login-history" />}>
            <History className="mr-1.5 size-3.5" />
            {t.nav.loginHistory}
          </Button>
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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t.common.details}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="text-muted-foreground text-xs">ID</div>
              <div className="font-mono text-xs break-all">{session?.id || sessionId}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t.sessions.ipAddress}</div>
              <div className="flex items-center gap-2 font-mono">
                <span>{session?.ip_address || "—"}</span>
                {session?.is_current ? <Badge>{t.sessions.currentBadge}</Badge> : null}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t.common.createdAt}</div>
              <div className="font-mono text-xs">
                {session?.created_at ? formatTerminalDateTime(session.created_at) : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t.sessions.expiresAt}</div>
              <div className="font-mono text-xs">
                {session?.expires_at ? formatTerminalDateTime(session.expires_at) : "—"}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-muted-foreground text-xs">{t.sessions.userAgent}</div>
              <div className="break-all font-mono text-xs">{session?.user_agent || "—"}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-primary" />
              {t.loginHistory.ipLookup}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <GeoLocationMap
              lat={geo?.lat}
              lon={geo?.lon}
              label={[geo?.city, geo?.country].filter(Boolean).join(", ") || (geo?.is_netbird ? "NetBird VPN" : undefined)}
              sublabel={session?.ip_address}
            />
            {geo ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground">{t.loginHistory.country}</div>
                  <div className="font-medium">
                    {geo.country || "—"} {geo.country_code ? `(${geo.country_code})` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t.loginHistory.city}</div>
                  <div className="font-medium">{geo.city || geo.region || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">{t.loginHistory.isp}</div>
                  <div className="font-mono">{geo.isp || "—"}</div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

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
