import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, Eye, RefreshCw } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/calendar/")({
  component: EconomicCalendarPage,
});

export interface MacroCalendarEvent {
  id: string;
  title: string;
  currency: string;
  impact: string;
  forecast: string;
  previous: string;
  event_time: string;
  affected_assets?: string[];
}

function EconomicCalendarPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<MacroCalendarEvent[]>([]);
  const [impact, setImpact] = useState("");
  const [currency, setCurrency] = useState("");
  const [asset, setAsset] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (impact) qs.set("impact", impact);
      if (currency) qs.set("currency", currency);
      if (asset) qs.set("asset", asset);
      const rows = await apiRequest<MacroCalendarEvent[]>(`/intelligence/calendar?${qs.toString()}`);
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [asset, currency, impact, t.common.errorTitle]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  async function handleRefreshFeed() {
    setRefreshing(true);
    try {
      const res = await apiRequest<{ inserted?: number; updated?: number }>("/intelligence/calendar/refresh", {
        method: "POST",
      });
      await loadCalendar();
      notify.success(t.calendar.refreshFeed, `+${res.inserted ?? 0} / ~${res.updated ?? 0}`);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.calendar.title}
      subtitle={t.calendar.subtitle}
      badge={`${events.length}`}
      actions={
        <AsyncButton
          size="sm"
          variant="outline"
          loading={refreshing}
          loadingText={t.common.refreshing}
          onClick={() => void handleRefreshFeed()}
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          {t.calendar.refreshFeed}
        </AsyncButton>
      }
    >
      <Card className="border-border/70">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-xs">
          <SearchSelect value={impact} onChange={(e) => setImpact(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t.calendar.impact}: {t.common.all}</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </SearchSelect>
          <SearchSelect value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t.calendar.currency}: {t.common.all}</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="JPY">JPY</option>
            <option value="CHF">CHF</option>
          </SearchSelect>
          <SearchSelect value={asset} onChange={(e) => setAsset(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t.calendar.asset}: {t.common.all}</option>
            <option value="XAUUSD">XAUUSD</option>
            <option value="USTEC">USTEC</option>
            <option value="SPX">SPX</option>
            <option value="EURUSD">EURUSD</option>
            <option value="BTCUSD">BTCUSD</option>
          </SearchSelect>
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton rows={7} cols={7} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Time (UTC)</th>
                  <th className="px-3 py-2">{t.calendar.currency}</th>
                  <th className="px-3 py-2">{t.calendar.impact}</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">{t.calendar.forecast} / {t.calendar.previous}</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      <Calendar className="mx-auto mb-2 size-5 opacity-50" />
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <Link
                        to="/dashboard/calendar/$eventId"
                        params={{ eventId: ev.id }}
                        title={String(ev.id)}
                        className="text-primary hover:underline"
                      >
                        {String(ev.id).slice(0, 8)}
                      </Link>
                    </td>
                      <td className="px-3 py-2 font-mono">{new Date(ev.event_time).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono font-bold">{ev.currency}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={ev.impact === "High" ? "destructive" : ev.impact === "Medium" ? "default" : "secondary"}
                          className="font-mono text-[10px]"
                        >
                          {ev.impact}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{ev.title}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {ev.forecast || "—"} / {ev.previous || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          to="/dashboard/calendar/$eventId"
                          params={{ eventId: ev.id }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                        >
                          <Eye className="size-3.5" />
                        </Link>
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
