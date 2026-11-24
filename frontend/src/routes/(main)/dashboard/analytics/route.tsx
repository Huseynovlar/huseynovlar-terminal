import { useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer, Radio } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";
import { MarketTreemap } from "@/framework/components/MarketTreemap";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveTerminalSocket } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/analytics")({
  component: DeepAnalyticsPage,
});

interface AnalyticsOverview {
  portfolio: {
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    accounts_count: number;
  };
  metrics: {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate_pct: number;
    net_pnl_usd: number;
    profit_factor: number;
    expectancy_usd: number;
    payoff_ratio: number;
    max_drawdown_usd: number;
    max_drawdown_pct: number;
    recovery_factor: number;
    sharpe_ratio: number;
    total_lots: number;
  };
  equity_curve: { date: string; cum_pnl_usd: number; drawdown_usd: number }[];
  daily_calendar: { date: string; net_pnl_usd: number; trades: number }[];
  hourly_heatmap: { hour: number; net_pnl_usd: number; trades: number }[];
  by_symbol: { symbol: string; total_trades: number; win_rate_pct: number; profit_factor: number; net_pnl_usd: number }[];
  by_account: { account_name: string; currency: string; total_trades: number; win_rate_pct: number; net_pnl_usd: number }[];
}

const PREVIEW_ANALYTICS: AnalyticsOverview = {
  portfolio: { total_balance_usd: 18450.0, total_equity_usd: 18680.5, total_floating_pnl_usd: 230.5, accounts_count: 4 },
  metrics: {
    total_trades: 148,
    wins: 102,
    losses: 46,
    win_rate_pct: 68.92,
    net_pnl_usd: 4285.4,
    profit_factor: 2.64,
    expectancy_usd: 28.96,
    payoff_ratio: 1.48,
    max_drawdown_usd: 412.8,
    max_drawdown_pct: 4.18,
    recovery_factor: 10.38,
    sharpe_ratio: 3.12,
    total_lots: 64.5,
  },
  equity_curve: [
    { date: "Nov 01", cum_pnl_usd: 320, drawdown_usd: 0 },
    { date: "Nov 04", cum_pnl_usd: 780, drawdown_usd: -45 },
    { date: "Nov 08", cum_pnl_usd: 640, drawdown_usd: -140 },
    { date: "Nov 12", cum_pnl_usd: 1590, drawdown_usd: 0 },
    { date: "Nov 15", cum_pnl_usd: 2140, drawdown_usd: -80 },
    { date: "Nov 19", cum_pnl_usd: 3180, drawdown_usd: -210 },
    { date: "Nov 22", cum_pnl_usd: 3890, drawdown_usd: -40 },
    { date: "Nov 24", cum_pnl_usd: 4285, drawdown_usd: 0 },
  ],
  daily_calendar: [
    { date: "2026-11-18", net_pnl_usd: 284.5, trades: 9 },
    { date: "2026-11-19", net_pnl_usd: -95.2, trades: 6 },
    { date: "2026-11-20", net_pnl_usd: 418.0, trades: 11 },
    { date: "2026-11-21", net_pnl_usd: 192.4, trades: 7 },
    { date: "2026-11-22", net_pnl_usd: 540.1, trades: 12 },
    { date: "2026-11-23", net_pnl_usd: -42.0, trades: 4 },
    { date: "2026-11-24", net_pnl_usd: 395.0, trades: 8 },
  ],
  hourly_heatmap: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    net_pnl_usd: hour >= 9 && hour <= 18 ? Number((Math.sin(hour) * 180 + 160).toFixed(1)) : Number((Math.cos(hour) * 60).toFixed(1)),
    trades: hour >= 9 && hour <= 18 ? 10 : 3,
  })),
  by_symbol: [
    { symbol: "XAUUSD", total_trades: 94, win_rate_pct: 71.2, profit_factor: 2.85, net_pnl_usd: 2640.2 },
    { symbol: "USTEC", total_trades: 54, win_rate_pct: 64.8, profit_factor: 2.34, net_pnl_usd: 1645.2 },
  ],
  by_account: [
    { account_name: "XAUUSD Pro USD", currency: "USD", total_trades: 58, win_rate_pct: 72.4, net_pnl_usd: 1980.0 },
    { account_name: "XAUUSD Cent USC", currency: "USC", total_trades: 36, win_rate_pct: 69.4, net_pnl_usd: 660.2 },
    { account_name: "USTEC Pro USD", currency: "USD", total_trades: 54, win_rate_pct: 64.8, net_pnl_usd: 1645.2 },
  ],
};

function DeepAnalyticsPage() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const currencyMode = useTerminalStore((s) => s.currencyMode);
  const { connected } = useLiveTerminalSocket();
  const [data, setData] = useState<AnalyticsOverview>(PREVIEW_ANALYTICS);

  useEffect(() => {
    apiRequest<AnalyticsOverview>("/analytics/overview?days=90")
      .then((res) => {
        if (res.metrics.total_trades > 0) setData(res);
      })
      .catch(() => {});
  }, []);

  const fmt = (usd: number, signed = true) => {
    if (privacyMode) return "••••";
    const val = currencyMode === "USC" ? usd * 100 : usd;
    const prefix = currencyMode === "USC" ? "¢" : "$";
    const sign = signed && val > 0 ? "+" : val < 0 ? "-" : "";
    return `${sign}${prefix}${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <TerminalPageShell
      title="Аналитика, Risk Lab и Полный отчёт Exness"
      subtitle="Сводная институциональная статистика по всем счетам (USD + USC), активам XAUUSD / USTEC и роботам."
      badge={connected ? "WS LIVE" : "RISK LAB"}
      actions={
        <>
          <Badge variant={connected ? "default" : "secondary"} className="gap-1 font-mono text-[11px]">
            <Radio className="size-3" />
            {connected ? "WebSocket Live" : "Standby"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => window.open("/api/v1/analytics/statement.csv", "_blank")}
          >
            <Download className="size-3.5" />
            Exness Statement (CSV / Excel)
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="size-3.5" />
            PDF / Печать
          </Button>
        </>
      }
    >
      {/* Institutional KPI Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: `Чистая прибыль (${currencyMode})`, val: fmt(data.metrics.net_pnl_usd), accent: "text-emerald-500" },
          { label: "Profit Factor / Expectancy", val: `${data.metrics.profit_factor} • ${fmt(data.metrics.expectancy_usd)}`, accent: "" },
          { label: "Win Rate / Сделки", val: `${data.metrics.win_rate_pct}% (${data.metrics.wins}W / ${data.metrics.losses}L)`, accent: "" },
          { label: "Max Drawdown / Recovery", val: `${fmt(-data.metrics.max_drawdown_usd)} (${data.metrics.max_drawdown_pct}%) • RF ${data.metrics.recovery_factor}`, accent: "text-rose-500" },
          { label: "Общий Equity портфеля", val: fmt(data.portfolio.total_equity_usd, false), accent: "" },
          { label: "Плавающий PnL", val: fmt(data.portfolio.total_floating_pnl_usd), accent: data.portfolio.total_floating_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500" },
          { label: "Sharpe / Payoff Ratio", val: `${data.metrics.sharpe_ratio} • ${data.metrics.payoff_ratio}`, accent: "" },
          { label: "Проторговано объёма", val: `${data.metrics.total_lots} lots (${data.portfolio.accounts_count} счетов)`, accent: "" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground text-xs font-normal">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`font-mono text-lg font-semibold ${kpi.accent}`}>{kpi.val}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* StockCharts / Finviz Global Market Heatmap */}
      <MarketTreemap />

      {/* Equity Curve & Underwater Drawdown */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Кривая накопленной прибыли (Net Equity Curve)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.equity_curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="cum_pnl_usd" stroke="#10b981" fill="#10b981" fillOpacity={0.18} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Underwater Drawdown (Просадка)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.equity_curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="drawdown_usd" stroke="#ef4444" fill="#ef4444" fillOpacity={0.22} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Heatmap & Daily PnL Calendar */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Прибыльность по часам суток (00:00 – 23:00 UTC)</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.hourly_heatmap}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="net_pnl_usd">
                  {data.hourly_heatmap.map((h) => (
                    <Cell key={h.hour} fill={h.net_pnl_usd >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Календарь доходности по дням</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.daily_calendar.map((day) => (
              <div
                key={day.date}
                className={`rounded-lg border p-2.5 font-mono text-xs ${
                  day.net_pnl_usd >= 0
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-rose-500/30 bg-rose-500/10"
                }`}
              >
                <div className="text-muted-foreground text-[10px]">{day.date}</div>
                <div className={`font-semibold ${day.net_pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmt(day.net_pnl_usd)}
                </div>
                <div className="text-muted-foreground text-[10px]">{day.trades} сделок</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Asset & Multi-Account Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Разрез по активам (XAUUSD vs USTEC)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground border-y border-border/60">
                <tr>
                  <th className="px-3 py-2">Актив</th>
                  <th className="px-3 py-2">Сделок</th>
                  <th className="px-3 py-2">Win Rate</th>
                  <th className="px-3 py-2">PF</th>
                  <th className="px-3 py-2 text-right">Net PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {data.by_symbol.map((row) => (
                  <tr key={row.symbol}>
                    <td className="px-3 py-2 font-semibold">{row.symbol}</td>
                    <td className="px-3 py-2">{row.total_trades}</td>
                    <td className="px-3 py-2">{row.win_rate_pct}%</td>
                    <td className="px-3 py-2">{row.profit_factor}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${row.net_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {fmt(row.net_pnl_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Разрез по счетам (USD + USC)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground border-y border-border/60">
                <tr>
                  <th className="px-3 py-2">Счёт</th>
                  <th className="px-3 py-2">Валюта</th>
                  <th className="px-3 py-2">Сделок</th>
                  <th className="px-3 py-2">Win Rate</th>
                  <th className="px-3 py-2 text-right">Net PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {data.by_account.map((row) => (
                  <tr key={row.account_name}>
                    <td className="px-3 py-2 font-sans font-medium">{row.account_name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {row.currency}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{row.total_trades}</td>
                    <td className="px-3 py-2">{row.win_rate_pct}%</td>
                    <td className={`px-3 py-2 text-right font-semibold ${row.net_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {fmt(row.net_pnl_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
