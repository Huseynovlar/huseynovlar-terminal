import { useCallback, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet, Filter, RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChartSkeleton, PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/analytics")({
  component: AnalyticsLabPage,
});

interface TradeStats {
  total_trades: number;
  win_rate_pct: number;
  profit_factor: number;
  net_pnl_usd: number;
  expectancy_usd: number;
  avg_win_usd: number;
  avg_loss_usd: number;
  max_drawdown_pct?: number;
}

interface AnalyticsOverview {
  portfolio: {
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    accounts_count: number;
  };
  metrics: TradeStats;
  equity_curve: Array<{ date?: string; ts?: string; equity_usd?: number; cumulative_pnl_usd?: number }>;
  drawdown_curve: Array<{ date?: string; ts?: string; drawdown_pct: number }>;
  daily_pnl: Array<{ date: string; net_pnl_usd: number; trades: number }>;
  hourly_pnl: Array<{ hour: number; net_pnl_usd: number; trades: number; win_rate_pct: number }>;
  by_symbol: Array<{ symbol: string; net_pnl_usd: number; total_trades: number; win_rate_pct: number }>;
  by_robot: Array<{ robot_name: string; net_pnl_usd: number; total_trades: number; win_rate_pct: number }>;
  long_short_breakdown: { long: TradeStats; short: TradeStats };
  mae_mfe_scatter: Array<{ symbol: string; mae_usd: number; mfe_usd: number; net_profit_usd: number }>;
  rolling_win_rate: Array<{ trade_index?: number; date?: string; win_rate_pct: number }>;
}

function AnalyticsLabPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const savedFilters = useTerminalStore((s) => s.analyticsFilters);
  const setAnalyticsFilters = useTerminalStore((s) => s.setAnalyticsFilters);

  const [days, setDays] = useState(String(savedFilters.days ?? "90"));
  const [accountId, setAccountId] = useState(String(savedFilters.account_id ?? ""));
  const [symbol, setSymbol] = useState(String(savedFilters.symbol ?? ""));
  const [magicNumber, setMagicNumber] = useState(String(savedFilters.magic_number ?? ""));
  const [side, setSide] = useState(String(savedFilters.side ?? ""));

  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mt5_login: string }>>([]);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string; mt5_login: string }>>("/accounts")
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadAnalytics = useCallback(
    async (overrides?: { days?: string; accountId?: string; symbol?: string; magicNumber?: string; side?: string }) => {
      setLoading(true);
      try {
        const d = overrides?.days ?? days;
        const acc = overrides?.accountId ?? accountId;
        const sym = overrides?.symbol ?? symbol;
        const mag = overrides?.magicNumber ?? magicNumber;
        const sd = overrides?.side ?? side;

        const qs = new URLSearchParams({ days: String(Number(d) || 90) });
        if (acc) qs.set("account_id", acc);
        if (sym.trim()) qs.set("symbol", sym.trim().toUpperCase());
        if (mag.trim() && Number.isFinite(Number(mag))) qs.set("magic_number", mag.trim());
        if (sd) qs.set("side", sd);

        const res = await apiRequest<AnalyticsOverview>(`/analytics/overview?${qs.toString()}`);
        setData(res);
      } catch (err) {
        notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [accountId, days, magicNumber, side, symbol, t.common.errorTitle],
  );

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  function applyFilters() {
    setAnalyticsFilters({
      days: Number(days) || 90,
      account_id: accountId,
      symbol: symbol.trim().toUpperCase(),
      magic_number: magicNumber.trim(),
      side,
    });
    void loadAnalytics();
    notify.success(t.analytics.applyFilters);
  }

  async function handleExport(fmt: "csv" | "xlsx") {
    setExporting(fmt);
    try {
      const fn = await apiDownload(`/analytics/statement.${fmt}`, `analytics_statement.${fmt}`);
      notify.success(t.common.download, fn);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }

  if (loading && !data) return <PageSkeleton />;

  const m = data?.metrics;
  const eqData = (data?.equity_curve ?? []).map((p, i) => ({
    x: p.date || p.ts || `#${i + 1}`,
    val: Number(p.equity_usd ?? p.cumulative_pnl_usd ?? 0),
  }));
  const ddData = (data?.drawdown_curve ?? []).map((p, i) => ({
    x: p.date || p.ts || `#${i + 1}`,
    val: Number(p.drawdown_pct ?? 0),
  }));
  const lsData = [
    {
      side: "LONG",
      net_pnl_usd: data?.long_short_breakdown?.long?.net_pnl_usd ?? 0,
      win_rate_pct: data?.long_short_breakdown?.long?.win_rate_pct ?? 0,
    },
    {
      side: "SHORT",
      net_pnl_usd: data?.long_short_breakdown?.short?.net_pnl_usd ?? 0,
      win_rate_pct: data?.long_short_breakdown?.short?.win_rate_pct ?? 0,
    },
  ];

  return (
    <TerminalPageShell
      title={t.analytics.title}
      subtitle={t.analytics.subtitle}
      badge={`${days}D`}
      actions={
        <>
          <AsyncButton size="sm" variant="outline" loading={exporting === "csv"} onClick={() => void handleExport("csv")}>
            <Download className="mr-1.5 size-3.5" />
            CSV
          </AsyncButton>
          <AsyncButton size="sm" variant="outline" loading={exporting === "xlsx"} onClick={() => void handleExport("xlsx")}>
            <FileSpreadsheet className="mr-1.5 size-3.5" />
            Excel
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => void loadAnalytics()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
        </>
      }
    >
      {/* Server-Persisted Filter Bar */}
      <Card className="border-border/70">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-xs">
          <select value={days} onChange={(e) => setDays(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="7">7D</option>
            <option value="30">30D</option>
            <option value="90">90D</option>
            <option value="365">365D</option>
          </select>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t.analytics.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} (#{a.mt5_login})</option>
            ))}
          </select>
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={t.analytics.symbolFilter} className="h-8 w-28 text-xs" />
          <Input value={magicNumber} onChange={(e) => setMagicNumber(e.target.value)} placeholder={t.analytics.magicFilter} className="h-8 w-24 text-xs" />
          <select value={side} onChange={(e) => setSide(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t.analytics.allSides}</option>
            <option value="BUY">LONG / BUY</option>
            <option value="SELL">SHORT / SELL</option>
          </select>
          <Button size="sm" onClick={applyFilters}>
            <Filter className="mr-1.5 size-3.5" />
            {t.analytics.applyFilters}
          </Button>
        </CardContent>
      </Card>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Net PnL</div><div className={`mt-1 font-mono text-lg font-bold ${(m?.net_pnl_usd ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{formatSignedUsd(m?.net_pnl_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Trades</div><div className="mt-1 font-mono text-lg font-bold">{m?.total_trades ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Win Rate</div><div className="mt-1 font-mono text-lg font-bold">{(m?.win_rate_pct ?? 0).toFixed(1)}%</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Profit Factor</div><div className="mt-1 font-mono text-lg font-bold">{(m?.profit_factor ?? 0).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Expectancy</div><div className="mt-1 font-mono text-lg font-bold">{formatSignedUsd(m?.expectancy_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Live Equity</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(data?.portfolio?.total_equity_usd, privacyMode)}</div></CardContent></Card>
      </div>

      {/* 8 Interactive Recharts Visualizations */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* 1. Equity Curve */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartEquity}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={eqData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={56} />
                  <Tooltip />
                  <Area type="monotone" dataKey="val" stroke="#f97316" fill="rgba(249,115,22,0.2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 2. Drawdown */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartDrawdown}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ddData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={48} />
                  <Tooltip />
                  <Area type="monotone" dataKey="val" stroke="#f43f5e" fill="rgba(244,63,94,0.2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 3. Daily PnL */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartDaily}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.daily_pnl ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} />
                  <Tooltip />
                  <Bar dataKey="net_pnl_usd">
                    {(data?.daily_pnl ?? []).map((entry, idx) => (
                      <Cell key={idx} fill={entry.net_pnl_usd >= 0 ? "#10b981" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 4. Hourly Session TCA */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartHourly}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.hourly_pnl ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} />
                  <Tooltip />
                  <Bar dataKey="net_pnl_usd">
                    {(data?.hourly_pnl ?? []).map((entry, idx) => (
                      <Cell key={idx} fill={entry.net_pnl_usd >= 0 ? "#10b981" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 5. Symbol Attribution */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartSymbol}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.by_symbol ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="symbol" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} />
                  <Tooltip />
                  <Bar dataKey="net_pnl_usd" fill="#f97316" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 6. Robot Attribution */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartRobot}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.by_robot ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="robot_name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} />
                  <Tooltip />
                  <Bar dataKey="net_pnl_usd" fill="#38bdf8" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 7. Long vs Short Payoff */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartLongShort}</CardTitle></CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="side" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} />
                  <Tooltip />
                  <Bar dataKey="net_pnl_usd">
                    {lsData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.side === "LONG" ? "#10b981" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 8. MAE / MFE Scatter & Rolling Win-Rate */}
          <Card className="border-border/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t.analytics.chartMaeMfe}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis type="number" dataKey="mae_usd" name="MAE" tick={{ fontSize: 10 }} />
                    <YAxis type="number" dataKey="mfe_usd" name="MFE" tick={{ fontSize: 10 }} width={40} />
                    <Tooltip />
                    <Scatter data={data?.mae_mfe_scatter ?? []} fill="#f97316" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.rolling_win_rate ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="trade_index" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={36} />
                    <Tooltip />
                    <Line type="monotone" dataKey="win_rate_pct" stroke="#10b981" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </TerminalPageShell>
  );
}
