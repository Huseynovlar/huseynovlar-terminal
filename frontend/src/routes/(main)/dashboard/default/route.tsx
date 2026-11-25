import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Activity, Bot, Clock, KeyRound, Plus, Radio, ShieldCheck, Wallet, Wifi } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

function getMarketSessions(nowUtc: Date) {
  const h = nowUtc.getUTCHours();
  return [
    { name: "Sydney", open: h >= 22 || h < 7 },
    { name: "Tokyo", open: h >= 0 && h < 9 },
    { name: "London", open: h >= 8 && h < 17 },
    { name: "New York", open: h >= 13 && h < 22 },
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
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [robots, setRobots] = useState<RobotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowUtc, setNowUtc] = useState(() => new Date());

  // Real "Add Exness Account" form
  const [showAddForm, setShowAddForm] = useState(false);
  const [accName, setAccName] = useState("");
  const [mt5Login, setMt5Login] = useState("");
  const [mt5Server, setMt5Server] = useState("Exness-MT5Real10");
  const [currency, setCurrency] = useState<"USD" | "USC">("USD");
  const [accountType, setAccountType] = useState("PRO");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    Promise.all([
      apiRequest<AccountRow[]>("/accounts").catch(() => [] as AccountRow[]),
      apiRequest<RobotRow[]>("/accounts/robots").catch(() => [] as RobotRow[]),
    ])
      .then(([accs, robs]) => {
        setAccounts(accs);
        setRobots(robs);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const id = setInterval(() => setNowUtc(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreatedApiKey(null);
    try {
      const res = await apiRequest<{ api_key: string; name: string }>("/accounts", {
        method: "POST",
        body: JSON.stringify({
          name: accName.trim(),
          mt5_login: mt5Login.trim(),
          mt5_server: mt5Server.trim(),
          account_type: accountType,
          currency,
        }),
      });
      setCreatedApiKey(res.api_key);
      setAccName("");
      setMt5Login("");
      setShowAddForm(false);
      loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось создать счёт");
    }
  }

  const fmt = (usd: number) =>
    privacyMode ? "••••" : `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totalBalance = accounts.reduce((s, a) => s + (a.last_balance_usd || 0), 0);
  const totalEquity = accounts.reduce((s, a) => s + (a.last_equity_usd || 0), 0);
  const totalFloating = accounts.reduce((s, a) => s + (a.last_floating_pnl_usd || 0), 0);

  const sessions = getMarketSessions(nowUtc);
  const isLondonNyOverlap = sessions[2].open && sessions[3].open;

  return (
    <TerminalPageShell
      title="Счета Exness, Общий Баланс и Статусы Роботов"
      subtitle="Реальные данные из вашей БД и MT5 Bridge: агрегированный баланс, живой пинг брокера (ms) и телеметрия роботов."
      badge="LIVE"
      actions={
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowAddForm((v) => !v)}>
          <Plus className="size-3.5" />
          Добавить счёт Exness
        </Button>
      }
    >
      {/* Total Aggregated Balance Across All Accounts */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-muted-foreground text-xs">Общий баланс (все счета)</div>
              <div className="mt-1 font-mono text-2xl font-bold">{fmt(totalBalance)}</div>
            </div>
            <Wallet className="size-6 text-blue-500" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-muted-foreground text-xs">Общий Equity</div>
              <div className="mt-1 font-mono text-2xl font-bold">{fmt(totalEquity)}</div>
            </div>
            <Activity className="size-6 text-emerald-500" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-muted-foreground text-xs">Суммарный Floating PnL</div>
              <div
                className={`mt-1 font-mono text-2xl font-bold ${totalFloating >= 0 ? "text-emerald-500" : "text-rose-500"}`}
              >
                {totalFloating >= 0 ? "+" : ""}
                {fmt(totalFloating)}
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {accounts.length} счетов
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Created API key banner (shown once on creation) */}
      {createdApiKey ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
          <div className="font-semibold text-emerald-500">
            Счёт создан! Скопируйте API-ключ для ExnessPanelBridge.mq5 (показывается один раз):
          </div>
          <code className="mt-1 block break-all rounded bg-background/80 p-2 font-mono">{createdApiKey}</code>
        </div>
      ) : null}

      {formError ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {formError}
        </div>
      ) : null}

      {/* Add Real Account Form */}
      {showAddForm ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Новый торговый счёт Exness (MT5)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateAccount} className="grid gap-2 text-xs md:grid-cols-6">
              <Input
                placeholder="Название (напр. XAUUSD Pro)"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                required
              />
              <Input
                placeholder="MT5 Login (номер счёта)"
                value={mt5Login}
                onChange={(e) => setMt5Login(e.target.value)}
                className="font-mono"
                required
              />
              <Input
                placeholder="MT5 Server"
                value={mt5Server}
                onChange={(e) => setMt5Server(e.target.value)}
                className="font-mono"
                required
              />
              <select
                className="bg-background rounded-md border border-border px-2.5 py-1.5 text-xs"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "USD" | "USC")}
              >
                <option value="USD">USD (долларовый)</option>
                <option value="USC">USC (центовый / 100)</option>
              </select>
              <select
                className="bg-background rounded-md border border-border px-2.5 py-1.5 text-xs"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="PRO">PRO</option>
                <option value="RAW_SPREAD">RAW_SPREAD</option>
                <option value="STANDARD">STANDARD</option>
                <option value="STANDARD_CENT">STANDARD_CENT</option>
              </select>
              <Button type="submit" size="sm">
                Создать счёт
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Bloomberg Global Market Sessions Clock */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <Clock className="size-4 text-blue-500" />
            <span className="font-semibold">{nowUtc.toISOString().slice(11, 19)} UTC</span>
            {isLondonNyOverlap ? (
              <Badge className="bg-amber-500/20 text-[10px] text-amber-500">LONDON + NY OVERLAP</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1 font-mono text-[11px]"
              >
                <span className={`size-2 rounded-full ${s.open ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground text-[10px]">{s.open ? "OPEN" : "CLOSED"}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Real Trading Accounts */}
      {loading ? (
        <div className="text-muted-foreground py-6 text-center text-xs">Загрузка счетов...</div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs">
            <p className="text-muted-foreground mb-3">
              У вас пока не добавлено ни одного реального счёта Exness. Нажмите кнопку ниже, чтобы создать первый счёт и
              получить API-ключ для MT5 Bridge.
            </p>
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="mr-1.5 size-3.5" />
              Добавить первый счёт Exness
            </Button>
          </CardContent>
        </Card>
      ) : (
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
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={async () => {
                        try {
                          const res = await apiRequest<{ api_key: string }>(`/accounts/${acc.id}/rotate-key`, {
                            method: "POST",
                          });
                          setCreatedApiKey(res.api_key);
                          loadData();
                        } catch (err) {
                          setFormError(err instanceof Error ? err.message : "Ошибка генерации ключа");
                        }
                      }}
                    >
                      Новый ключ
                    </Button>
                    <span className="flex items-center gap-1 text-emerald-500">
                      <ShieldCheck className="size-3" />
                      {acc.terminal_connected ? "MT5 Live" : "Ждёт MT5"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Real-Time Robot Statuses */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="size-4 text-emerald-500" />
            Живые статусы торговых роботов ({robots.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {robots.length === 0 ? (
            <div className="text-muted-foreground py-4 text-center text-xs">
              Роботы появятся автоматически, как только MT5 Bridge передаст телеметрию по MagicNumber, либо вы добавите
              их вручную.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            </div>
          )}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
