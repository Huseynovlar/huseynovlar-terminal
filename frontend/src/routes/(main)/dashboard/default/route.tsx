import { useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Bot, KeyRound, Plus, ShieldCheck } from "lucide-react";

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
  last_balance_usd: number;
  last_equity_usd: number;
  last_floating_pnl_usd: number;
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
    last_balance_usd: 6060.0,
    last_equity_usd: 6159.9,
    last_floating_pnl_usd: 99.9,
  },
];

function AccountsAndRobotsPage() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [accounts, setAccounts] = useState<AccountRow[]>(PREVIEW_ACCOUNTS);

  useEffect(() => {
    apiRequest<AccountRow[]>("/accounts")
      .then((rows) => {
        if (rows.length > 0) setAccounts(rows);
      })
      .catch(() => {});
  }, []);

  const fmt = (usd: number) =>
    privacyMode ? "••••" : `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <TerminalPageShell
      title="Счета Exness и Торговые роботы"
      subtitle="Поддержка нескольких счетов USD и USC на один актив внутри одного профиля Exness, API-ключи и MagicNumber."
      badge="MULTI-ACCOUNT"
      actions={
        <Button size="sm" className="gap-1.5 text-xs">
          <Plus className="size-3.5" />
          Добавить счёт / робота
        </Button>
      }
    >
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
              <div className="text-muted-foreground font-mono text-[11px]">
                #{acc.mt5_login} • {acc.mt5_server} • {acc.account_type}
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
                  Zero-Latency Bridge
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </TerminalPageShell>
  );
}
