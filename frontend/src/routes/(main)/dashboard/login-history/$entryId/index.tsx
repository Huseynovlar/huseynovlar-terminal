import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Globe, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/login-history/$entryId/")({
  component: LoginHistoryDetailPage,
});

interface LoginEntryDetail {
  id: string;
  action: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  details?: Record<string, unknown>;
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

function LoginHistoryDetailPage() {
  const { entryId } = Route.useParams();
  const { t } = useI18n();
  const [entry, setEntry] = useState<LoginEntryDetail | null>(null);
  const [geo, setGeo] = useState<IpGeoResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<LoginEntryDetail>(`/auth/login-history/${encodeURIComponent(entryId)}`)
      .then(async (res) => {
        setEntry(res);
        if (res.ip_address) {
          const lookup = await apiRequest<IpGeoResult>(`/auth/ip-lookup/${encodeURIComponent(res.ip_address)}`).catch(
            () => null,
          );
          setGeo(lookup);
        }
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [entryId, t.common.errorTitle]);

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.loginHistory.detailTitle}
      subtitle={entry?.id || entryId}
      badge={entry?.action || "AUTH"}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/login-history" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t.common.details}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground">{t.loginHistory.action}</div>
              <Badge className="mt-0.5 font-mono">{entry?.action || "—"}</Badge>
            </div>
            <div>
              <div className="text-muted-foreground">{t.sessions.ipAddress}</div>
              <div className="font-mono text-sm">{entry?.ip_address || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.common.createdAt}</div>
              <div className="font-mono">
                {entry?.created_at ? formatTerminalDateTime(entry.created_at) : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t.sessions.userAgent}</div>
              <div className="break-all font-mono">{entry?.user_agent || "—"}</div>
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
          <CardContent className="space-y-2.5 text-xs">
            {geo ? (
              <>
                {geo.is_private || geo.is_netbird ? (
                  <Badge variant="secondary">{t.loginHistory.netbirdPrivate}</Badge>
                ) : null}
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
                  {geo.lat != null && geo.lon != null ? (
                    <div className="col-span-2 flex items-center gap-1.5 font-mono text-emerald-500">
                      <MapPin className="size-3.5" />
                      <span>
                        {geo.lat.toFixed(4)}, {geo.lon.toFixed(4)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">{t.common.noData}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
