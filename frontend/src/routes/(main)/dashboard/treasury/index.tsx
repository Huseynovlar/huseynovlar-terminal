import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/treasury/")({
  component: TreasuryListPage,
});

export interface TreasuryOp {
  id: string;
  account_id: string;
  account_name: string;
  account_login: string;
  currency: string;
  op_kind: string;
  amount: number;
  amount_usd: number;
  comment: string;
  is_manual: boolean;
  notes: string;
  timestamp: string;
}

interface TreasuryReport {
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
  operations: TreasuryOp[];
}

function TreasuryListPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const vaultTargetUsd = useTerminalStore((s) => s.vaultTargetUsd);
  const setVaultTargetUsd = useTerminalStore((s) => s.setVaultTargetUsd);

  const [report, setReport] = useState<TreasuryReport | null>(null);
  const [targetInput, setTargetInput] = useState(String(vaultTargetUsd || 500));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TreasuryOp | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const target = Math.max(1, Number(vaultTargetUsd) || 500);
      const res = await apiRequest<TreasuryReport>(`/analytics/treasury?vault_target_usd=${target}`);
      setReport(res);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle, vaultTargetUsd]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    setTargetInput(String(vaultTargetUsd || 500));
  }, [vaultTargetUsd]);

  function handleSaveTarget() {
    const val = Number(targetInput);
    if (!Number.isFinite(val) || val <= 0) {
      notify.error(t.common.errorTitle, "Invalid Vault target");
      return;
    }
    setVaultTargetUsd(val);
    notify.success(t.common.savedSuccess, `${t.treasury.vaultTarget}: $${val}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/treasury/operations/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.op_kind);
      setDeleteTarget(null);
      await loadReport();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const s = report?.summary;
  const ops = report?.operations ?? [];

  return (
    <TerminalPageShell
      title={t.treasury.title}
      subtitle={t.treasury.subtitle}
      actions={
        <>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="h-8 w-28 font-mono text-xs"
              aria-label={t.treasury.vaultTarget}
            />
            <Button size="sm" variant="outline" onClick={handleSaveTarget}>
              <Save className="mr-1 size-3.5" />
              {t.treasury.saveTarget}
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadReport()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/treasury/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.treasury.newBtn}
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.workingCapital}</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(s?.working_capital_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.deposited}</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(s?.total_deposited_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.withdrawn}</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(s?.total_withdrawn_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.inVault}</div><div className="mt-1 font-mono text-lg font-bold text-emerald-500">{formatUsd(s?.total_vault_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.readyForVault}</div><div className="mt-1 font-mono text-lg font-bold text-primary">{formatUsd(s?.profit_ready_for_vault_usd, privacyMode)}</div><div className="text-[10px] text-muted-foreground">Target: {formatUsd(s?.vault_target_usd, privacyMode)}</div></CardContent></Card>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Comment / Notes</th>
                  <th className="px-3 py-2 text-right">Amount USD</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {ops.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
                ) : (
                  ops.map((op) => (
                    <tr key={op.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono">{new Date(op.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2">{op.account_name || op.account_login}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="font-mono text-[10px]">{op.op_kind}</Badge></td>
                      <td className="px-3 py-2 text-muted-foreground">{op.comment || op.notes || "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${op.amount_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {formatSignedUsd(op.amount_usd, privacyMode)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Link to="/dashboard/treasury/$opId" params={{ opId: op.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                            <Eye className="size-3.5" />
                          </Link>
                          <Link to="/dashboard/treasury/$opId/edit" params={{ opId: op.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                            <Pencil className="size-3.5" />
                          </Link>
                          <AsyncButton size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDeleteTarget(op)}>
                            <Trash2 className="size-3.5" />
                          </AsyncButton>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.treasury.confirmDeleteTitle}
        description={t.treasury.confirmDeleteDesc}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
