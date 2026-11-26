import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { MacroCalendarEvent } from "@/routes/(main)/dashboard/calendar/index";

export const Route = createFileRoute("/(main)/dashboard/calendar/$eventId/")({
  component: CalendarEventDetailPage,
});

function CalendarEventDetailPage() {
  const { eventId } = Route.useParams();
  const { t } = useI18n();
  const [ev, setEv] = useState<MacroCalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<MacroCalendarEvent>(`/intelligence/calendar/${encodeURIComponent(eventId)}`)
      .then(setEv)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [eventId, t.common.errorTitle]);

  if (loading) return <PageSkeleton />;
  if (!ev) {
    return (
      <TerminalPageShell title={t.calendar.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={ev.title}
      subtitle={formatTerminalDateTime(ev.event_time)}
      badge={`${ev.currency} • ${ev.impact}`}
      actions={
        <Link to="/dashboard/calendar" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.calendar.detailTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 p-2.5">
              <div className="text-muted-foreground">{t.calendar.currency}</div>
              <div className="mt-1 font-mono text-base font-bold">{ev.currency}</div>
            </div>
            <div className="rounded-md border border-border/60 p-2.5">
              <div className="text-muted-foreground">{t.calendar.forecast}</div>
              <div className="mt-1 font-mono text-base font-bold">{ev.forecast || "—"}</div>
            </div>
            <div className="rounded-md border border-border/60 p-2.5">
              <div className="text-muted-foreground">{t.calendar.previous}</div>
              <div className="mt-1 font-mono text-base font-bold">{ev.previous || "—"}</div>
            </div>
          </div>

          {ev.affected_assets && ev.affected_assets.length > 0 ? (
            <div>
              <div className="mb-1.5 text-muted-foreground">{t.calendar.affectedAssets}</div>
              <div className="flex flex-wrap gap-1.5">
                {ev.affected_assets.map((code) => (
                  <Link
                    key={code}
                    to="/dashboard/hubs/$code"
                    params={{ code }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 hover:border-primary/50"
                  >
                    <AssetLogo symbol={code} size={16} />
                    <Badge variant="outline" className="font-mono text-[10px]">{code}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
