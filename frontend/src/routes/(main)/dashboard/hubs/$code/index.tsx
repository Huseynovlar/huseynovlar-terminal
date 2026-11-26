import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot, Brain, Calendar, ListOrdered, Newspaper, Pencil, Trash2 } from "lucide-react";

import { InteractiveChartCanvas, type RobotZoneLevels } from "@/components/m5/InteractiveChartCanvas";
import { OrderBookAndTicks } from "@/components/m5/OrderBookAndTicks";
import { RobotTelemetryPanel } from "@/components/m5/RobotTelemetryPanel";
import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/")({
  component: HubDetailPage,
});

interface AssetHubDetail {
  id: string;
  code: string;
  name: string;
  group: string;
  stats: {
    accounts_count: number;
    robots_count: number;
    open_positions_count: number;
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    total_trades: number;
    win_rate_pct: number;
    net_pnl_usd: number;
  };
  news_digest: {
    total_articles: number;
    breaking_count: number;
    corroborated_count: number;
    dominant_sentiment: string;
    sentiment_breakdown: { bullish: number; bearish: number; neutral: number };
  };
  recent_news: Array<{
    id: string;
    title: string;
    source: string;
    sentiment: string;
    verification_count: number;
    published_at: string;
  }>;
}

interface DealRow {
  id: string;
  ticket: string;
  symbol: string;
  side: string;
  volume: number;
  price: number;
  net_profit_usd: number;
  timestamp: string;
}

interface RobotRow {
  id: string;
  name: string;
  symbol: string;
  magic_number: number;
  is_active: boolean;
  status?: string;
  live_status?: string;
  live_state_json?: Record<string, unknown>;
}

interface CalRow {
  id: string;
  title: string;
  currency: string;
  impact: string;
  event_time: string;
}

/**
 * Unified Bloomberg-grade Asset Hub (#28, #18, #39):
 * Combines live chart, period PnL breakdown, linked robots, paginated deals & news,
 * economic calendar, and contextual Gemini AI market analysis in one screen.
 */
function HubDetailPage() {
  const { code } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [hub, setHub] = useState<AssetHubDetail | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [dealsTotal, setDealsTotal] = useState(0);
  const [dealsPage, setDealsPage] = useState(1);
  const [robots, setRobots] = useState<RobotRow[]>([]);
  const [calEvents, setCalEvents] = useState<CalRow[]>([]);
  const [activeTab, setActiveTab] = useState<"orders" | "news" | "calendar" | "robots">("orders");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadHub = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [h, dRes, rList, cList] = await Promise.all([
        apiRequest<AssetHubDetail>(`/assets/${encodeURIComponent(code)}`),
        apiRequestPaged<DealRow>(`/journal/deals?symbol=${encodeURIComponent(code)}`, dealsPage, DEFAULT_PAGE_SIZE).catch(
          () => ({ items: [] as DealRow[], total: 0 }),
        ),
        apiRequest<RobotRow[]>(`/robots?q=${encodeURIComponent(code)}`).catch(() => [] as RobotRow[]),
        apiRequest<CalRow[]>(`/intelligence/calendar?asset=${encodeURIComponent(code)}`).catch(() => [] as CalRow[]),
      ]);
      setHub(h);
      setDeals(dRes.items);
      setDealsTotal(dRes.total);
      setRobots(Array.isArray(rList) ? rList : []);
      setCalEvents(Array.isArray(cList) ? cList.slice(0, 15) : []);
    } catch (err) {
      if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [code, dealsPage, t.common.errorTitle]);

  useEffect(() => {
    void loadHub(false);
  }, [loadHub]);

  useLiveEvents(["snapshot", "trade_event", "robot_state", "breaking_news"], () => {
    void loadHub(true);
  });

  const periodPnl = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    let d1 = 0;
    let d7 = 0;
    let d30 = 0;
    for (const d of deals) {
      const ts = new Date(d.timestamp).getTime();
      const val = Number(d.net_profit_usd || 0);
      if (now - ts <= dayMs) d1 += val;
      if (now - ts <= 7 * dayMs) d7 += val;
      if (now - ts <= 30 * dayMs) d30 += val;
    }
    return { d1, d7, d30 };
  }, [deals]);

  async function handleAiAnalyze() {
    if (!hub) return;
    setAiLoading(true);
    try {
      const res = await apiRequest<{ content_md?: string; summary?: string }>("/intelligence/ai/analyze", {
        method: "POST",
        body: JSON.stringify({
          mode: "asset_deep_dive",
          symbol: hub.code,
          prompt: `Analyze current market conditions, risk, news sentiment, and entry/exit outlook for ${hub.code} (${hub.name}).`,
        }),
      });
      setAiResult(res.content_md || res.summary || "Analysis completed.");
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleDelete() {
    if (!hub) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(hub.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, hub.code);
      void navigate({ to: "/dashboard/hubs" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !hub) return <PageSkeleton />;
  if (!hub) {
    return (
      <TerminalPageShell title={t.hubs.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={`${hub.code} — ${hub.name}`}
      subtitle={`ID: ${hub.id}`}
      badge={hub.group}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="default"
            loading={aiLoading}
            loadingText="Analyzing..."
            onClick={() => void handleAiAnalyze()}
          >
            <Brain className="mr-1.5 size-3.5" />
            AI Market Brief
          </AsyncButton>
          <Link to="/dashboard/hubs" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <Link to="/dashboard/hubs/$code/edit" params={{ code: hub.code }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      {/* Top KPI + Period PnL Strip */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3">
            <AssetLogo symbol={hub.code} size={30} />
            <div>
              <div className="text-[10px] text-muted-foreground">Accounts / Robots</div>
              <div className="font-mono text-sm font-bold tabular-nums">
                {hub.stats.accounts_count} / {hub.stats.robots_count}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Equity</div>
            <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">
              {formatUsd(hub.stats.total_equity_usd, privacyMode)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">24h PnL</div>
            <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${periodPnl.d1 >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {formatSignedUsd(periodPnl.d1, privacyMode)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">7D / 30D PnL</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
              <span className={periodPnl.d7 >= 0 ? "text-emerald-500" : "text-rose-500"}>
                {formatSignedUsd(periodPnl.d7, privacyMode)}
              </span>
              {" / "}
              <span className={periodPnl.d30 >= 0 ? "text-emerald-500" : "text-rose-500"}>
                {formatSignedUsd(periodPnl.d30, privacyMode)}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Total PnL ({hub.stats.total_trades})</div>
            <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${hub.stats.net_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {formatSignedUsd(hub.stats.net_pnl_usd, privacyMode)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Win Rate / Sentiment</div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs font-bold tabular-nums">
              <span>{hub.stats.win_rate_pct.toFixed(1)}%</span>
              <Badge variant="outline" className="text-[9px] uppercase">
                {hub.news_digest.dominant_sentiment}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contextual AI Market Brief Panel */}
      {aiResult ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Brain className="size-4 text-primary" />
              AI Market Brief — {hub.code}
            </CardTitle>
            <Button size="xs" variant="ghost" onClick={() => setAiResult(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-xs leading-relaxed">{aiResult}</CardContent>
        </Card>
      ) : null}

      {/* Full-width Live Chart with MT5 Strategy Bands (SELL ZONE / FAIR / MEAN / BUY ZONE) */}
      {(() => {
        const activeRobot = robots.find((r) => r.live_state_json && Object.keys(r.live_state_json).length > 0) ?? robots[0];
        const outer = activeRobot?.live_state_json ?? {};
        const nested =
          outer.telemetry && typeof outer.telemetry === "object"
            ? (outer.telemetry as Record<string, unknown>)
            : {};
        const merged: Record<string, unknown> = { ...outer, ...nested };
        const n = (k: string) => {
          const v = Number(merged[k]);
          return Number.isFinite(v) && v > 0 ? v : null;
        };
        const robotZones: RobotZoneLevels | null = activeRobot
          ? {
              sellZone: n("bb_upper"),
              fair: n("vwap"),
              mean: n("bb_mid"),
              buyZone: n("bb_lower"),
              label: activeRobot.name,
            }
          : null;
        return (
          <>
            <InteractiveChartCanvas symbol={hub.code} mode="hub" height={420} robotZones={robotZones} />
            {activeRobot ? (
              <RobotTelemetryPanel
                state={activeRobot.live_state_json}
                title={`${activeRobot.name} (#${activeRobot.magic_number}) — Live HUD`}
              />
            ) : null}
          </>
        );
      })()}

      {/* Live WebSocket Order Book (DOM) & Tick Chart */}
      <OrderBookAndTicks symbol={hub.code} />

      {/* Tabbed Bloomberg Bottom Desk */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant={activeTab === "orders" ? "default" : "outline"} onClick={() => setActiveTab("orders")}>
              <ListOrdered className="mr-1 size-3.5" />
              Orders ({dealsTotal})
            </Button>
            <Button size="xs" variant={activeTab === "robots" ? "default" : "outline"} onClick={() => setActiveTab("robots")}>
              <Bot className="mr-1 size-3.5" />
              Robots ({robots.length})
            </Button>
            <Button size="xs" variant={activeTab === "news" ? "default" : "outline"} onClick={() => setActiveTab("news")}>
              <Newspaper className="mr-1 size-3.5" />
              News ({hub.news_digest.total_articles})
            </Button>
            <Button size="xs" variant={activeTab === "calendar" ? "default" : "outline"} onClick={() => setActiveTab("calendar")}>
              <Calendar className="mr-1 size-3.5" />
              Calendar ({calEvents.length})
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
            <Badge variant="outline" className="text-emerald-500">Bull: {hub.news_digest.sentiment_breakdown.bullish}</Badge>
            <Badge variant="outline" className="text-rose-500">Bear: {hub.news_digest.sentiment_breakdown.bearish}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0 text-xs">
          {activeTab === "orders" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Time (UTC)</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 font-medium">Volume</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Net PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {deals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground py-6 text-center">
                        {t.common.noData}
                      </td>
                    </tr>
                  ) : (
                    deals.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">{d.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{formatTerminalDateTime(d.timestamp)}</td>
                        <td className="px-3 py-2 font-mono uppercase">{d.side}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{d.volume}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{d.price}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${d.net_profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {formatSignedUsd(d.net_profit_usd, privacyMode)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PagerBar page={dealsPage} pageSize={DEFAULT_PAGE_SIZE} total={dealsTotal} onPage={setDealsPage} />
            </div>
          ) : activeTab === "robots" ? (
            <div className="divide-y divide-border/50">
              {robots.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center">{t.common.noData}</div>
              ) : (
                robots.map((r) => (
                  <Link
                    key={r.id}
                    to="/dashboard/robots/$robotId"
                    params={{ robotId: r.id }}
                    className="hover:bg-muted/40 flex items-center justify-between px-4 py-2.5"
                  >
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {r.symbol} • Magic #{r.magic_number}
                      </div>
                    </div>
                    <Badge variant={r.is_active ? "default" : "secondary"}>{r.status || (r.is_active ? "ACTIVE" : "OFF")}</Badge>
                  </Link>
                ))
              )}
            </div>
          ) : activeTab === "calendar" ? (
            <div className="divide-y divide-border/50">
              {calEvents.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center">{t.common.noData}</div>
              ) : (
                calEvents.map((ev) => (
                  <Link
                    key={ev.id}
                    to="/dashboard/calendar/$eventId"
                    params={{ eventId: ev.id }}
                    className="hover:bg-muted/40 flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div>
                      <div className="font-medium">{ev.title}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {ev.currency} • {ev.impact}
                      </div>
                    </div>
                    <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                      {formatTerminalDateTime(ev.event_time)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {hub.recent_news.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground">{t.common.noData}</p>
              ) : (
                hub.recent_news.map((item) => (
                  <Link
                    key={item.id}
                    to="/dashboard/news/$newsId"
                    params={{ newsId: item.id }}
                    className="hover:border-primary/50 block rounded-md border border-border/50 p-2.5 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {item.sentiment}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1 font-mono text-[10px]">
                      {item.source} • {formatTerminalDateTime(item.published_at)}
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.common.delete}
        description={`Delete Asset Hub ${hub.code} (${hub.name})?`}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
