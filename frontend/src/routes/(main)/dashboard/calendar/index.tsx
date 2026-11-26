import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Eye, List, RefreshCw } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchSelect } from "@/components/ui/search-select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function EconomicCalendarPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<MacroCalendarEvent[]>([]);
  const [impact, setImpact] = useState("");
  const [currency, setCurrency] = useState("");
  const [asset, setAsset] = useState("");
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [selectedDay, setSelectedDay] = useState<string>(() => toYmd(new Date()));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCalendar = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (impact) qs.set("impact", impact);
      if (currency) qs.set("currency", currency);
      if (asset) qs.set("asset", asset);
      const rows = await apiRequest<MacroCalendarEvent[]>(`/intelligence/calendar?${qs.toString()}`);
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [asset, currency, impact, t.common.errorTitle]);

  useEffect(() => {
    void loadCalendar(false);
  }, [loadCalendar]);

  useLiveEvents("calendar_alert", () => {
    void loadCalendar(true);
  });

  async function handleRefreshFeed() {
    setRefreshing(true);
    try {
      const res = await apiRequest<{ inserted?: number; updated?: number }>("/intelligence/calendar/refresh", {
        method: "POST",
      });
      await loadCalendar(true);
      notify.success(t.calendar.refreshFeed, `+${res.inserted ?? 0} / ~${res.updated ?? 0}`);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const eventsByDay = useMemo(() => {
    const map = new Map<string, MacroCalendarEvent[]>();
    for (const ev of events) {
      const key = ev.event_time ? ev.event_time.slice(0, 10) : "";
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const calendarDays = useMemo(() => {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const startWeekday = (first.getUTCDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells: Array<{ date: Date; ymd: string; inMonth: boolean }> = [];

    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(year, month, -i));
      cells.push({ date: d, ymd: toYmd(d), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(Date.UTC(year, month, day));
      cells.push({ date: d, ymd: toYmd(d), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const next = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 1));
      cells.push({ date: next, ymd: toYmd(next), inMonth: false });
    }
    return cells;
  }, [monthCursor]);

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(monthCursor),
    [monthCursor],
  );

  const selectedDayEvents = eventsByDay.get(selectedDay) ?? [];

  return (
    <TerminalPageShell
      title={t.calendar.title}
      subtitle={t.calendar.subtitle}
      badge={`${events.length}`}
      actions={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-input bg-background p-0.5">
            <Button
              size="xs"
              variant={viewMode === "calendar" ? "default" : "ghost"}
              onClick={() => setViewMode("calendar")}
            >
              <CalendarIcon className="mr-1 size-3.5" />
              Grid
            </Button>
            <Button
              size="xs"
              variant={viewMode === "list" ? "default" : "ghost"}
              onClick={() => setViewMode("list")}
            >
              <List className="mr-1 size-3.5" />
              List
            </Button>
          </div>
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
        </div>
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

      {loading && events.length === 0 ? (
        <TableSkeleton rows={6} cols={6} />
      ) : viewMode === "calendar" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">{monthTitle} (UTC)</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-xs"
                  variant="outline"
                  onClick={() =>
                    setMonthCursor((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)))
                  }
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const now = new Date();
                    setMonthCursor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
                    setSelectedDay(toYmd(now));
                  }}
                >
                  Today
                </Button>
                <Button
                  size="icon-xs"
                  variant="outline"
                  onClick={() =>
                    setMonthCursor((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
                  }
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="grid grid-cols-7 gap-1 pb-1 text-center font-mono text-[10px] text-muted-foreground">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1 font-medium">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((cell) => {
                  const dayEvents = eventsByDay.get(cell.ymd) ?? [];
                  const highCount = dayEvents.filter((e) => e.impact.toLowerCase() === "high").length;
                  const medCount = dayEvents.filter((e) => e.impact.toLowerCase() === "medium").length;
                  const isSelected = cell.ymd === selectedDay;
                  const isToday = cell.ymd === toYmd(new Date());
                  return (
                    <button
                      key={cell.ymd}
                      type="button"
                      onClick={() => setSelectedDay(cell.ymd)}
                      className={`flex min-h-20 flex-col justify-between rounded-md border p-1.5 text-left transition ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:bg-muted/40"
                      } ${cell.inMonth ? "" : "opacity-40"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`font-mono text-xs tabular-nums ${
                            isToday ? "bg-primary text-primary-foreground rounded px-1 font-bold" : ""
                          }`}
                        >
                          {cell.date.getUTCDate()}
                        </span>
                        {dayEvents.length > 0 ? (
                          <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                            {dayEvents.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <div
                            key={ev.id}
                            className={`truncate rounded px-1 py-0.5 text-[9px] font-medium ${
                              ev.impact.toLowerCase() === "high"
                                ? "bg-rose-500/15 text-rose-500"
                                : ev.impact.toLowerCase() === "medium"
                                  ? "bg-amber-500/15 text-amber-500"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {ev.currency} {ev.title}
                          </div>
                        ))}
                        {highCount > 0 || medCount > 0 ? (
                          <div className="flex items-center gap-1 pt-0.5">
                            {highCount > 0 ? <span className="size-1.5 rounded-full bg-rose-500" /> : null}
                            {medCount > 0 ? <span className="size-1.5 rounded-full bg-amber-500" /> : null}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="font-mono">{selectedDay}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {selectedDayEvents.length} events
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {selectedDayEvents.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center">{t.common.noData}</div>
              ) : (
                selectedDayEvents.map((ev) => (
                  <Link
                    key={ev.id}
                    to="/dashboard/calendar/$eventId"
                    params={{ eventId: ev.id }}
                    className="hover:border-primary/50 block rounded-lg border border-border/60 p-2.5 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {ev.currency}
                        </Badge>
                        <Badge
                          variant={ev.impact.toLowerCase() === "high" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {ev.impact}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                        {formatTerminalDateTime(ev.event_time).slice(11)}
                      </span>
                    </div>
                    <div className="mt-1 font-medium">{ev.title}</div>
                    <div className="text-muted-foreground mt-1 flex gap-3 font-mono text-[10px]">
                      <span>Fcst: {ev.forecast || "—"}</span>
                      <span>Prev: {ev.previous || "—"}</span>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">UTC Time</th>
                  <th className="px-3 py-2 font-medium">{t.calendar.currency}</th>
                  <th className="px-3 py-2 font-medium">{t.calendar.impact}</th>
                  <th className="px-3 py-2 font-medium">{t.calendar.title}</th>
                  <th className="px-3 py-2 font-medium">{t.calendar.forecast}</th>
                  <th className="px-3 py-2 font-medium">{t.calendar.previous}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-muted-foreground py-8 text-center">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono">
                        <Link
                          to="/dashboard/calendar/$eventId"
                          params={{ eventId: ev.id }}
                          className="text-primary hover:underline"
                          title={ev.id}
                        >
                          {String(ev.id).slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">{formatTerminalDateTime(ev.event_time)}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{ev.currency}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={ev.impact.toLowerCase() === "high" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {ev.impact}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{ev.title}</td>
                      <td className="px-3 py-2 font-mono">{ev.forecast || "—"}</td>
                      <td className="px-3 py-2 font-mono">{ev.previous || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          to="/dashboard/calendar/$eventId"
                          params={{ eventId: ev.id }}
                          className="inline-flex h-7 items-center rounded border border-input px-2 text-xs hover:bg-accent"
                        >
                          <Eye className="mr-1 size-3" />
                          {t.common.view}
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
