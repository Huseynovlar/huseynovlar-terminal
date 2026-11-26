import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  CalendarClock,
  Globe,
  Newspaper,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatCountdown,
  formatPct,
  formatSignedUsd,
  formatUsd,
} from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalClock, useUtcClock } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/home/")({
  component: HomeCommandCenterPage,
});

interface HomeSummary {
  kpis: {
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    today_pnl_usd: number;
    week_pnl_usd: number;
    month_pnl_usd: number;
    win_rate_30d_pct: number;
    profit_factor_30d: number;
    accounts_count: number;
    connected_accounts_count: number;
    open_positions_count: number;
    active_robots_count: number;
  };
  equity_curve: Array<{ date?: string; ts?: string; equity_usd?: number; cumulative_pnl_usd?: number }>;
  accounts_pulse: Array<{
    id: string;
    name: string;
    mt5_login: string;
    currency: string;
    balance_usd: number;
    equity_usd: number;
    floating_pnl_usd: number;
    terminal_connected: boolean;
    algo_trading_enabled: boolean;
    last_seen_at: string | null;
  }>;
  robots_pulse: Array<{
    id: string;
    account_id: string;
    name: string;
    symbol: string;
    magic_number: number;
    live_status: string;
    is_active: boolean;
    last_heartbeat_at: string | null;
  }>;
  market_sessions: Array<{
    name: string;
    city?: string;
    is_open: boolean;
    open_utc?: string;
    close_utc?: string;
  }>;
  macro_ribbon: Array<{
    symbol: string;
    name?: string;
    price?: number;
    change_pct?: number;
  }>;
  sector_pulse: Array<{
    sector: string;
    avg_change_pct: number;
    count?: number;
  }>;
  breaking_news: Array<{
    id: string;
    title: string;
    source: string;
    sentiment: string;
    impact_score: number;
    is_breaking: boolean;
    affected_assets: string[];
    published_at: string;
  }>;
  next_macro_event: {
    id: string;
    title: string;
    currency: string;
    impact: string;
    forecast: string;
    previous: string;
    event_time: string;
  } | null;
}

function HomeCommandCenterPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone);

  const [data, setData] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadSummary = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await apiRequest<HomeSummary>("/analytics/home-summary");
      setData(res);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadSummary(false);
  }, [loadSummary]);

  useLiveEvents(["snapshot", "trade_event", "breaking_news", "macro_quotes", "robot_state"], () => {
    void loadSummary(true);
  });

  if (loading && !data) {
    return <PageSkeleton />;
  }

  const kpis = data?.kpis;
  const chartData = (data?.equity_curve ?? []).map((p, idx) => ({
    label: p.date || p.ts || `#${idx + 1}`,
    value: Number(p.equity_usd ?? p.cumulative_pnl_usd ?? 0),
  }));

  return (
    <TerminalPageShell
      title={t.home.title}
      subtitle={t.home.subtitle}
      badge={`${clock.time} ${clock.label}`}
      actions={
        <AsyncButton
          size="sm"
          variant="outline"
          loading={refreshing}
          loadingText={t.common.refreshing}
          onClick={() => void loadSummary(true)}
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          {t.common.refresh}
        </AsyncButton>
      }
    >
      {/* Macro Ribbon with AssetLogo */}
      {data?.macro_ribbon && data.macro_ribbon.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {data.macro_ribbon.map((m) => (
            <Link
              key={m.symbol}
              to="/dashboard/charts/$symbol"
              params={{ symbol: m.symbol }}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs transition hover:border-primary/50"
            >
              <AssetLogo symbol={m.symbol} size={18} />
              <span className="font-mono font-semibold">{m.symbol}</span>
              <span className="font-mono tabular-nums">
                {typeof m.price === "number" && Number.isFinite(m.price)
                  ? m.price.toLocaleString("en-US", { maximumFractionDigits: 2 })
                  : "—"}
              </span>
              {typeof m.change_pct === "number" && Number.isFinite(m.change_pct) ? (
                <span
                  className={`font-mono text-[11px] font-medium ${
                    m.change_pct >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {formatPct(m.change_pct)}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Top KPI Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t.home.balance}</span>
              <Wallet className="size-3.5 text-primary" />
            </div>
            <div className="mt-1 font-mono text-lg font-bold">{formatUsd(kpis?.total_balance_usd, privacyMode)}</div>
            <div className="text-[11px] text-muted-foreground">
              {kpis?.connected_accounts_count ?? 0}/{kpis?.accounts_count ?? 0} MT5
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t.home.equity}</span>
              <Activity className="size-3.5 text-emerald-500" />
            </div>
            <div className="mt-1 font-mono text-lg font-bold">{formatUsd(kpis?.total_equity_usd, privacyMode)}</div>
            <div className="text-[11px] text-muted-foreground">
              {kpis?.open_positions_count ?? 0} open pos
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground">{t.home.floatingPnl}</div>
            <div
              className={`mt-1 font-mono text-lg font-bold ${
                (kpis?.total_floating_pnl_usd ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {formatSignedUsd(kpis?.total_floating_pnl_usd, privacyMode)}
            </div>
            <div className="text-[11px] text-muted-foreground">Live WS</div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground">{t.home.todayPnl}</div>
            <div
              className={`mt-1 font-mono text-lg font-bold ${
                (kpis?.today_pnl_usd ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {formatSignedUsd(kpis?.today_pnl_usd, privacyMode)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t.home.weekPnl}: {formatSignedUsd(kpis?.week_pnl_usd, privacyMode)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground">{t.home.winRate30d}</div>
            <div className="mt-1 font-mono text-lg font-bold">
              {(kpis?.win_rate_30d_pct ?? 0).toFixed(1)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t.home.profitFactor}: {(kpis?.profit_factor_30d ?? 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t.home.robotsPulse}</span>
              <Bot className="size-3.5 text-primary" />
            </div>
            <div className="mt-1 font-mono text-lg font-bold">{kpis?.active_robots_count ?? 0}</div>
            <Link to="/dashboard/robots" className="text-[11px] text-primary hover:underline">
              {t.nav.robots} →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Main Row: Equity Curve + Market Sessions & Next Macro Event */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-border/70 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="size-4 text-primary" />
              {t.home.equityCurve}
            </CardTitle>
            <Link to="/dashboard/analytics" className="text-xs text-primary hover:underline">
              {t.nav.analytics} →
            </Link>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-border/60 text-xs text-muted-foreground">
                {t.common.noData}
              </div>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="homeEqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={64} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#f97316"
                      strokeWidth={2}
                      fill="url(#homeEqGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {/* Global Market Sessions (1s synced UTC) */}
          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Globe className="size-4 text-primary" />
                  {t.home.marketSessions}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{clock.time}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 pt-0">
              {(data?.market_sessions ?? []).map((sess) => (
                <div
                  key={sess.name}
                  className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2 text-xs"
                >
                  <div>
                    <div className="font-medium">{sess.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {sess.open_utc ?? ""}–{sess.close_utc ?? ""}
                    </div>
                  </div>
                  <Badge
                    variant={sess.is_open ? "default" : "secondary"}
                    className={`font-mono text-[10px] ${sess.is_open ? "bg-emerald-600 text-white" : ""}`}
                  >
                    {sess.is_open ? t.home.sessionOpen : t.home.sessionClosed}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Next Macro Event Countdown */}
          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-4 text-amber-500" />
                  {t.home.nextMacroEvent}
                </span>
                <Link to="/dashboard/calendar" className="text-xs font-normal text-primary hover:underline">
                  {t.nav.calendar} →
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs">
              {data?.next_macro_event ? (
                <Link
                  to="/dashboard/calendar/$eventId"
                  params={{ eventId: data.next_macro_event.id }}
                  className="block space-y-1.5 rounded-md border border-border/60 p-2.5 transition hover:border-primary/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {data.next_macro_event.currency} • {data.next_macro_event.impact}
                    </Badge>
                    <span className="font-mono text-xs font-bold text-amber-500">
                      T-{formatCountdown(data.next_macro_event.event_time, now)}
                    </span>
                  </div>
                  <div className="font-medium">{data.next_macro_event.title}</div>
                  <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
                    <span>F: {data.next_macro_event.forecast || "—"}</span>
                    <span>P: {data.next_macro_event.previous || "—"}</span>
                  </div>
                </Link>
              ) : (
                <p className="text-muted-foreground">{t.home.noMacroEvent}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Row: Accounts Pulse, Sector Pulse, Breaking News */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">{t.home.accountsPulse}</CardTitle>
            <Link to="/dashboard/accounts" className="text-xs text-primary hover:underline">
              {t.nav.accounts} →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs">
            {(data?.accounts_pulse ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t.common.noData}</p>
            ) : (
              (data?.accounts_pulse ?? []).map((acc) => (
                <Link
                  key={acc.id}
                  to="/dashboard/accounts/$accountId"
                  params={{ accountId: acc.id }}
                  className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2 transition hover:border-primary/50"
                >
                  <div>
                    <div className="font-medium">{acc.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      #{acc.mt5_login} • {acc.currency}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-semibold">{formatUsd(acc.equity_usd, privacyMode)}</div>
                    <div
                      className={`text-[11px] ${
                        acc.floating_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {formatSignedUsd(acc.floating_pnl_usd, privacyMode)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">{t.home.sectorPulse}</CardTitle>
            <Link to="/dashboard/treemap" className="text-xs text-primary hover:underline">
              {t.nav.treemap} →
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0 text-xs">
            {(data?.sector_pulse ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t.common.noData}</p>
            ) : (
              (data?.sector_pulse ?? []).slice(0, 7).map((sec) => (
                <div
                  key={sec.sector}
                  className="flex items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5"
                >
                  <span className="truncate font-medium">{sec.sector}</span>
                  <span
                    className={`font-mono font-semibold ${
                      sec.avg_change_pct >= 0 ? "text-emerald-500" : "text-rose-500"
                    }`}
                  >
                    {formatPct(sec.avg_change_pct)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Newspaper className="size-4 text-primary" />
              {t.home.breakingNews}
            </CardTitle>
            <Link to="/dashboard/news" className="text-xs text-primary hover:underline">
              {t.nav.news} →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs">
            {(data?.breaking_news ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t.common.noData}</p>
            ) : (
              (data?.breaking_news ?? []).slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  to="/dashboard/news/$newsId"
                  params={{ newsId: item.id }}
                  className="block rounded-md border border-border/60 p-2 transition hover:border-primary/50"
                >
                  <div className="line-clamp-2 font-medium">{item.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{item.source}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {item.sentiment}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
