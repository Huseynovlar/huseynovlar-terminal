import { useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Landmark, Vault } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/finance")({
  component: TreasuryVaultPage,
});

interface TreasuryData {
  summary: {
    working_capital_usd: number;
    total_deposited_usd: number;
    total_withdrawn_usd: number;
    total_vault_usd: number;
    total_rebates_usd: number;
    realized_trading_profit_usd: number;
    profit_ready_for_vault_usd: number;
    vault_target_usd: number;
    vault_target_reached: boolean;
  };
  operations: {
    id: string;
    account_name: string;
    currency: string;
    op_kind: string;
    amount_usd: number;
    comment: string;
    timestamp: string;
  }[];
}

const PREVIEW_TREASURY: TreasuryData = {
  summary: {
    working_capital_usd: 18680.5,
    total_deposited_usd: 15000.0,
    total_withdrawn_usd: 1200.0,
    total_vault_usd: 2450.0,
    total_rebates_usd: 145.0,
    realized_trading_profit_usd: 4285.4,
    profit_ready_for_vault_usd: 635.4,
    vault_target_usd: 500.0,
    vault_target_reached: true,
  },
  operations: [
    { id: "1", account_name: "XAUUSD Pro USD", currency: "USD", op_kind: "EXNESS_VAULT", amount_usd: -850, comment: "Transfer to Exness Vault", timestamp: "2026-11-22T14:20:00Z" },
    { id: "2", account_name: "USTEC Pro USD", currency: "USD", op_kind: "INTERNAL_TRANSFER", amount_usd: -400, comment: "Internal transfer to Reserve", timestamp: "2026-11-19T11:05:00Z" },
    { id: "3", account_name: "XAUUSD Cent USC", currency: "USC", op_kind: "DEPOSIT", amount_usd: 1000, comment: "Deposit 100,000 USC", timestamp: "2026-11-12T08:40:00Z" },
  ],
};

function TreasuryVaultPage() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [data, setData] = useState<TreasuryData>(PREVIEW_TREASURY);
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    apiRequest<TreasuryData>("/analytics/treasury")
      .then((res) => {
        if (res.operations.length > 0 || res.summary.working_capital_usd > 0) setData(res);
      })
      .catch(() => {});
  }, []);

  const fmt = (usd: number) =>
    privacyMode
      ? "••••"
      : `${usd < 0 ? "-" : ""}$${Math.abs(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const progressPct = Math.min(100, Math.round((data.summary.profit_ready_for_vault_usd / data.summary.vault_target_usd) * 100));
  const filteredOps = filter === "ALL" ? data.operations : data.operations.filter((o) => o.op_kind === filter);

  return (
    <TerminalPageShell
      title="Казначейство и Хранилище Exness"
      subtitle="Автоматический учёт депозитов, выводов, внутренних переводов и Хранилища (Exness Vault) на базе DEAL_TYPE_BALANCE."
      badge="TREASURY"
      actions={
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => window.open("https://my.exness.com/", "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="size-3.5" />
          Открыть ЛК Exness для перевода
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-normal">В работе на счетах (Equity)</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold">{fmt(data.summary.working_capital_usd)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-xs font-normal">
              <Vault className="size-3.5 text-amber-500" /> В Хранилище (Exness Vault)
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold text-amber-500">
            {fmt(data.summary.total_vault_usd)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-normal">Всего внесено (Депозиты)</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold">{fmt(data.summary.total_deposited_usd)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-normal">Выведено на внешние реквизиты</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-xl font-semibold text-emerald-500">
            {fmt(data.summary.total_withdrawn_usd)}
          </CardContent>
        </Card>
      </div>

      {/* Vault Profit Lock Target Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Landmark className="size-4 text-emerald-500" />
              Цель фиксации прибыли в Хранилище Exness
            </span>
            <Badge variant={data.summary.vault_target_reached ? "default" : "secondary"}>
              {data.summary.vault_target_reached ? "Готово к переводу в Хранилище" : `${progressPct}% до цели`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="text-muted-foreground flex justify-between font-mono text-xs">
            <span>Накоплено к выводу: {fmt(data.summary.profit_ready_for_vault_usd)}</span>
            <span>Порог напоминания: {fmt(data.summary.vault_target_usd)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Balance Operations Ledger */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Журнал операций (Депозиты / Выводы / Хранилище / Переводы)</CardTitle>
          <div className="flex flex-wrap gap-1">
            {["ALL", "EXNESS_VAULT", "DEPOSIT", "WITHDRAWAL", "INTERNAL_TRANSFER"].map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={filter === kind ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setFilter(kind)}
              >
                {kind}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground border-y border-border/60">
              <tr>
                <th className="px-3 py-2">Дата (UTC)</th>
                <th className="px-3 py-2">Счёт</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Комментарий брокера</th>
                <th className="px-3 py-2 text-right">Сумма (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 font-mono">
              {filteredOps.map((op) => (
                <tr key={op.id}>
                  <td className="px-3 py-2 text-[11px]">{op.timestamp.replace("T", " ").slice(0, 16)}</td>
                  <td className="px-3 py-2 font-sans font-medium">
                    {op.account_name} <span className="text-muted-foreground text-[10px]">({op.currency})</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">
                      {op.op_kind}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-sans text-muted-foreground">{op.comment}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      op.amount_usd >= 0 ? "text-emerald-500" : "text-amber-500"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {op.amount_usd >= 0 ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
                      {fmt(op.amount_usd)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
