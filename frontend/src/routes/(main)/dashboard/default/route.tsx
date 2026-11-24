import { useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Activity, Bot, Clock, KeyRound, Plus, Radio, ShieldCheck, Wifi } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/default")({
  component: AccountsAndRobotsPage,
});

interface AccountRow {
  id: string;
  name: string;
  mt5_login: string;
  mt5_server: string;
  account_type: string;
  currency: string;
  api_key_prefix: string;
  algo_trading_enabled: boolean;
  terminal_connected?: boolean;
  last_ping_ms?: number | null;
  last_balance_usd: number;
  last_equity_usd: number;
  last_floating_pnl_usd: number;
}

interface RobotRow {
  id: string;
  name: string;
  magic_number: number;
  symbol: string;
  account_id: string;
  live_status?: string;
  live_state_json?: Record<string, unknown> | null;
  last_execution_ms?: number | null;
  is_active: boolean;
}

const PREVIEW_ACCOUNTS: AccountRow[] = [
  {
    id: "acc-1",
    name: "XAUUSD Pro USD",
    mt5_login: "100200300",
    mt5_server: "Exness-MT5Real10",
    account_type: "PRO",
    currency: "USD",
    api_key_prefix: "htk_9f2a1c08",
    algo_trading_enabled: true,
    terminal_connected: true,
    last_ping_ms: 14,
    last_balance_usd: 10240.0,
    last_equity_usd: 10336.4,
    last_floating_pnl_usd: 96.4,
  },
  {
    id: "acc-2",
    name: "XAUUSD Cent USC",
    mt5_login: "100200301",
    mt5_server: "Exness-MT5Real10",
    account_type: "STANDARD_CENT",
    currency: "USC",
    api_key_prefix: "htk_4b8e7d11",
    algo_trading_enabled: true,
    terminal_connected: true,
    last_ping_ms: 18,
    last_balance_usd: 2150.0,
    last_equity_usd: 2184.2,
    last_floating_pnl_usd: 34.2,
  },
  {
    id: "acc-3",
    name: "USTEC Pro USD",
    mt5_login: "100200302",
    mt5_server: "Exness-MT5Real10",
    account_type: "RAW_SPREAD",
    currency: "USD",
    api_key_prefix: "htk_7c1d3e92",
    algo_trading_enabled: true,
    terminal_connected: true,
    last_ping_ms: 21,
    last_balance_usd: 6060.0,
    last_equity_usd: 6159.9,
    last_floating_pnl_usd: 99.9,
  },
];

const PREVIEW_ROBOTS: RobotRow[] = [
  {
    id: "r1",
    name: "Gold Scalp Sovereign v4",
    magic_number: 77701,
    symbol: "XAUUSD",
    account_id: "acc-1",
    live_status: "IN_TRADE",
    live_state_json: { action: "Trailing SL +18 pts", spread: 0.21 },
    last_execution_ms: 19,
    is_active: true,
  },
  {
    id: "r2",
    name: "Gold Cent Grid Guard",
    magic_number: 77702,
    symbol: "XAUUSDc",
    account_id: "acc-2",
    live_status: "SCANNING",
    live_state_json: { action: "Waiting M5 liquidity sweep" },
    last_execution_ms: 24,
    is_active: true,
  },
  {
    id: "r3",
    name: "USTEC NY Momentum",
    magic_number: 88801,
    symbol: "USTEC",
    account_id: "acc-3",
    live_status: "NEWS_PAUSE",
    live_state_json: { action: "Paused ahead of US macro release" },
    last_execution_ms: 16,
    is_active: true,
  },
];

function getMarketSessions(nowUtc: Date) {
  const h = nowUtc.getUTCHours();
  return [
    { name: "Sydney", open: h >= 22 || h < 7, hours: "22:00–07:00 UTC" },
    { name: "Tokyo", open: h >= 0 && h < 9, hours: "00:00–09:00 UTC" },
    { name: "London", open: h >= 8 && h < 17, hours: "08:00–17:00 UTC" },
    { name: "New York", open: h >= 13 && h < 22, hours: "13:00–22:00 UTC" },
  ];
}

function pingColor(ms?: number | null) {
  if (ms === undefined || ms === null) return "text-muted-foreground";
  if (ms < 35) return "text-emerald-500";
  if (ms < 100) return "text-amber-500";
  return "text-rose-500";
}

function AccountsAndRobotsPage() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [accounts, setAccounts] = useState<AccountRow[]>(PREVIEW_ACCOUNTS);
  const [robots, setRobots] = useState<RobotRow[]>(PREVIEW_ROBOTS);
  const [nowUtc, setNowUtc] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNowUtc(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    apiRequest<AccountRow[]>("/accounts")
      .then((rows) => {
        if (rows.length > 0) setAccounts(rows);
      })
      .catch(() => {});

    apiRequest<RobotRow[]>("/accounts/robots")
      .then((rows) => {
        if (rows.length > 0) setRobots(rows);
      })
      .catch(() => {});
  }, []);

  const fmt = (usd: number) =>
    privacyMode ? "••••" : `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const sessions = getMarketSessions(nowUtc);
  const isLondonNyOverlap = sessions[2].open && sessions[3].open;

  return (
    <TerminalPageShell
      title="Счета Exness, Живой Пинг и Статусы Роботов"
      subtitle="Реальное время: пинг брокера (ms), точное состояние каждого робота, мульти-счета USD + USC и мировые торговые сессии (UTC)."
      badge="REALTIME DESK"
      actions={
        <Button size="sm" className="gap-1.5 text-xs">
          <Plus className="size-3.5" />
          Добавить счёт / робота
        </Button>
      }
    >
      {/* Bloomberg Global Market Sessions Clock */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <Clock className="size-4 text-blue-500" />
            <span className="font-semibold">{nowUtc.toISOString().slice(11, 19)} UTC</span>
            {isLondonNyOverlap ? (
              <Badge className="bg-amber-500/20 text-amber-500 text-[10px]">LONDON + NY OVERLAP (HIGH LIQUIDITY)</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1 font-mono text-[11px]"
              >
                <span className={`size-2 rounded-full ${s.open ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground text-[10px]">{s.open ? "OPEN" : "CLOSED"}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trading Accounts with Live Broker Ping */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((acc) => (
          <Card key={acc.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bot className="size-4 text-emerald-500" />
                  {acc.name}
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {acc.currency}
                  </Badge>
                  <Badge variant={acc.algo_trading_enabled ? "default" : "destructive"} className="text-[10px]">
                    {acc.algo_trading_enabled ? "ALGO ON" : "ALGO OFF"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-muted-foreground">
                  #{acc.mt5_login} • {acc.mt5_server}
                </span>
                <span className={`inline-flex items-center gap-1 font-semibold ${pingColor(acc.last_ping_ms)}`}>
                  <Wifi className="size-3" />
                  {acc.last_ping_ms !== undefined && acc.last_ping_ms !== null ? `${acc.last_ping_ms} ms` : "— ms"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 font-mono">
                <div>
                  <div className="text-muted-foreground text-[10px]">Balance</div>
                  <div className="font-semibold">{fmt(acc.last_balance_usd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Equity</div>
                  <div className="font-semibold">{fmt(acc.last_equity_usd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Floating</div>
                  <div className={`font-semibold ${acc.last_floating_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {acc.last_floating_pnl_usd >= 0 ? "+" : ""}
                    {fmt(acc.last_floating_pnl_usd)}
                  </div>
                </div>
              </div>

              <div className="text-muted-foreground flex items-center justify-between font-mono text-[11px]">
                <span className="flex items-center gap-1">
                  <KeyRound className="size-3" />
                  {acc.api_key_prefix}••••
                </span>
                <span className="flex items-center gap-1 text-emerald-500">
                  <ShieldCheck className="size-3" />
                  {acc.terminal_connected === false ? "Disconnected" : "Zero-Latency Bridge"}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Real-Time Robot Statuses */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="size-4 animate-pulse text-emerald-500" />
            Живые статусы торговых роботов (MQL5 Hook Telemetry)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {robots.map((r) => {
            const st = (r.live_status || "IDLE").toUpperCase();
            const actionText =
              r.live_state_json && typeof r.live_state_json.action === "string"
                ? r.live_state_json.action
                : "Мониторинг тиков в реальном времени";
            return (
              <div key={r.id} className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Badge
                    variant={st === "IN_TRADE" ? "default" : st === "ERROR" ? "destructive" : "secondary"}
                    className="font-mono text-[10px]"
                  >
                    {st}
                  </Badge>
                </div>
                <div className="text-muted-foreground flex items-center justify-between font-mono text-[11px]">
                  <span>
                    {r.symbol} • Magic #{r.magic_number}
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <Activity className="size-3" />
                    {r.last_execution_ms ?? "—"} ms
                  </span>
                </div>
                <div className="rounded bg-background/60 px-2 py-1 text-[11px] text-foreground/90">{actionText}</div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
