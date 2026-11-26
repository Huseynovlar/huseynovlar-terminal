import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Lock, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TreasuryOp | null>(null);

  const loadReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const target = Math.max(1, Number(vaultTargetUsd) || 500);
      const res = await apiRequest<TreasuryReport>(`/analytics/treasury?vault_target_usd=${target}`);
      setReport(res);
    } catch (err) {
      if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle, vaultTargetUsd]);

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  useLiveEvents(["snapshot", "trade_event"], () => {
    void loadReport(true);
  });

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
      await loadReport(true);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const s = report?.summary;
  const allOps = report?.operations ?? [];
  const filteredOps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOps;
    return allOps.filter(
      (op) =>
        op.id.toLowerCase().includes(q) ||
        (op.account_name || "").toLowerCase().includes(q) ||
        (op.account_login || "").toLowerCase().includes(q) ||
        (op.op_kind || "").toLowerCase().includes(q) ||
        (op.comment || "").toLowerCase().includes(q) ||
        (op.notes || "").toLowerCase().includes(q),
    );
  }, [allOps, search]);

  const pagedOps = useMemo(
    () => filteredOps.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [filteredOps, page],
  );

  return (
    <TerminalPageShell
      title={t.treasury.title}
      subtitle={t.treasury.subtitle}
      badge={`${filteredOps.length}`}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void loadReport(false)}>
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
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.workingCapital}</div><div className="mt-1 font-mono text-base font-bold tabular-nums">{formatUsd(s?.working_capital_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.deposited}</div><div className="mt-1 font-mono text-base font-bold text-emerald-500 tabular-nums">{formatUsd(s?.total_deposited_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.withdrawn}</div><div className="mt-1 font-mono text-base font-bold text-rose-500 tabular-nums">{formatUsd(s?.total_withdrawn_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">{t.treasury.inVault}</div><div className="mt-1 font-mono text-base font-bold tabular-nums">{formatUsd(s?.total_vault_usd, privacyMode)}</div></CardContent></Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground">{t.treasury.vaultTarget}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Input value={targetInput} onChange={(e) => setTargetInput(e.target.value)} className="h-7 font-mono text-xs" />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={handleSaveTarget}>
                <Save className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
        <Input
          className="pl-8 font-mono text-xs"
          placeholder="Search by ID, account, operation type, comment..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {loading && !report ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Timestamp (UTC)</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Comment / Notes</th>
                  <th className="px-3 py-2 text-right">Amount USD</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {pagedOps.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
                ) : (
                  pagedOps.map((op) => (
                    <tr key={op.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-[11px]">
                        <Link
                          to="/dashboard/treasury/$opId"
                          params={{ opId: op.id }}
                          title={String(op.id)}
                          className="text-primary hover:underline"
                        >
                          {String(op.id).slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">{formatTerminalDateTime(op.timestamp)}</td>
                      <td className="px-3 py-2">{op.account_name || op.account_login}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {op.op_kind}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{op.comment || op.notes || "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${op.amount_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {formatSignedUsd(op.amount_usd, privacyMode)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link to="/dashboard/treasury/$opId" params={{ opId: op.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                            <Eye className="size-3.5" />
                          </Link>
                          {op.is_manual ? (
                            <>
                              <Link to="/dashboard/treasury/$opId/edit" params={{ opId: op.id }} className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent">
                                <Pencil className="size-3.5" />
                              </Link>
                              <AsyncButton size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDeleteTarget(op)}>
                                <Trash2 className="size-3.5" />
                              </AsyncButton>
                            </>
                          ) : (
                            <span title="Broker-synced transaction (read-only)" className="text-muted-foreground inline-flex h-7 items-center px-1.5">
                              <Lock className="size-3" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={filteredOps.length} onPage={setPage} />
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
