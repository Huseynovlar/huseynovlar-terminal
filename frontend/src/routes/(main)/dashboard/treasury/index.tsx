import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import {
  type CashflowPoint,
  TreasuryCashflowChart,
} from "@/components/treasury/TreasuryCashflowChart";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
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
  effective_kind?: string;
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
    net_invested_usd: number;
    total_deposited_usd: number;
    deposits_count: number;
    total_withdrawn_usd: number;
    withdrawals_count: number;
    total_internal_transfers_usd: number;
    internal_transfers_count: number;
    total_vault_usd: number;
    total_rebates_usd: number;
    realized_trading_profit_usd: number;
  };
  cashflow_series: CashflowPoint[];
  operations: TreasuryOp[];
}

const KIND_BADGE: Record<string, { label: string; color: string }> = {
  DEPOSIT: { label: "DEPOSIT", color: "var(--bull)" },
  WITHDRAWAL: { label: "WITHDRAWAL", color: "var(--bear)" },
  INTERNAL_TRANSFER: { label: "INTERNAL (ALLINT)", color: "var(--text-muted)" },
  EXNESS_VAULT: { label: "EXNESS VAULT", color: "var(--accent-blue)" },
  REBATE: { label: "REBATE", color: "var(--accent-amber)" },
};

function TreasuryListPage() {
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [report, setReport] = useState<TreasuryReport | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<
    "ALL" | "DEPOSIT" | "WITHDRAWAL" | "INTERNAL_TRANSFER" | "REBATE"
  >("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreasuryOp | null>(null);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string }>>("/accounts")
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = accountFilter ? `?account_id=${encodeURIComponent(accountFilter)}` : "";
        const res = await apiRequest<TreasuryReport>(`/analytics/treasury${qs}`);
        setReport(res);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки казны", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accountFilter],
  );

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  // Zero REST polling — silent updates on /ws/account
  useLiveEvents(
    ["treasury_update", "snapshot", "trade_event"],
    useCallback(() => {
      void loadReport(true);
    }, [loadReport]),
  );

  const filteredOps = useMemo(() => {
    const ops = report?.operations ?? [];
    const ql = search.trim().toLowerCase();
    return ops.filter((o) => {
      const kind = o.effective_kind || o.op_kind;
      if (kindFilter !== "ALL" && kind !== kindFilter) return false;
      if (
        ql &&
        !o.account_name.toLowerCase().includes(ql) &&
        !o.comment.toLowerCase().includes(ql) &&
        !o.notes.toLowerCase().includes(ql) &&
        !kind.toLowerCase().includes(ql)
      ) {
        return false;
      }
      return true;
    });
  }, [report?.operations, kindFilter, search]);

  const pagedOps = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredOps.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredOps, page]);

  async function handleReclassify(op: TreasuryOp, nextKind: string) {
    setBusyId(op.id);
    try {
      await apiRequest(`/treasury/operations/${encodeURIComponent(op.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ op_kind: nextKind }),
      });
      notify.success("Категория обновлена", `${op.account_name} → ${nextKind}`);
      await loadReport(true);
    } catch (err) {
      notify.error("Ошибка переклассификации", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await apiRequest(`/treasury/operations/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      notify.success("Операция удалена");
      setDeleteTarget(null);
      await loadReport(true);
    } catch (err) {
      notify.error("Ошибка удаления", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const mask = (v: string) => (privacyMode ? "••••••" : v);
  const sum = report?.summary;

  return (
    <TerminalPageShell
      title="Казна и переводы"
      subtitle="Реальное движение капитала (USD) · ALLINT и парные 60с-переводы исключены из Net Invested и PnL"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadReport(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </button>
          <Link
            to="/dashboard/treasury/new"
            className="inline-flex h-8 items-center rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="mr-1.5 size-3.5" />
            Добавить операцию
          </Link>
        </>
      }
    >
      {/* 4 Top KPI Cards */}
      {sum && (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex h-[62px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Чистый ввод капитала (Net Invested)
            </span>
            <div className="flex items-baseline justify-between tabular-nums">
              <span className="text-[16px] font-semibold text-[var(--text-primary)]">
                {mask(formatSignedUsd(sum.net_invested_usd))}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                Deposits − Withdrawals
              </span>
            </div>
          </div>

          <div className="flex h-[62px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Внешние пополнения (Deposits)
            </span>
            <div className="flex items-baseline justify-between tabular-nums">
              <span className="text-[16px] font-semibold text-[var(--bull)]">
                +{mask(formatUsd(sum.total_deposited_usd))}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {sum.deposits_count} оп.
              </span>
            </div>
          </div>

          <div className="flex h-[62px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Внешние выводы (Withdrawals)
            </span>
            <div className="flex items-baseline justify-between tabular-nums">
              <span className="text-[16px] font-semibold text-[var(--bear)]">
                -{mask(formatUsd(sum.total_withdrawn_usd))}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {sum.withdrawals_count} оп.
              </span>
            </div>
          </div>

          <div className="flex h-[62px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Внутренние переводы (ALLINT)
              </span>
              <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 py-0.2 text-[9px] text-[var(--text-muted)]">
                Не влияет на PnL
              </span>
            </div>
            <div className="flex items-baseline justify-between tabular-nums">
              <span className="text-[16px] font-semibold text-[var(--text-secondary)]">
                {mask(formatUsd(sum.total_internal_transfers_usd))}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {sum.internal_transfers_count} перев.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ECharts v6 Cashflow Chart */}
      <TreasuryCashflowChart series={report?.cashflow_series ?? []} />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
            {(
              [
                { id: "ALL", label: "Все" },
                { id: "DEPOSIT", label: "Депозиты" },
                { id: "WITHDRAWAL", label: "Выводы" },
                { id: "INTERNAL_TRANSFER", label: "Внутренние ALLINT" },
                { id: "REBATE", label: "Рибейт" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setKindFilter(tab.id);
                  setPage(1);
                }}
                className={`rounded-[3px] px-2 py-0.5 font-medium transition-colors ${
                  kindFilter === tab.id
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(1);
            }}
            className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-primary)]"
          >
            <option value="">Все счета</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Поиск по комментарию MT5..."
            className="h-7 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-7 text-[11px]"
          />
        </div>
      </div>

      {/* Transactions Table with Inline Manual Reclassification */}
      <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        {loading ? (
          <div className="p-3">
            <TableSkeleton rows={6} cols={7} />
          </div>
        ) : pagedOps.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--text-muted)]">
            Нет операций по выбранному фильтру
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[11px] tabular-nums">
            <thead>
              <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                <th className="px-3">Дата (UTC)</th>
                <th className="px-2">Тип</th>
                <th className="px-2">Счёт</th>
                <th className="px-2 text-right">Сумма (USD)</th>
                <th className="px-2 text-right">Исходная сумма</th>
                <th className="px-2">Комментарий MT5</th>
                <th className="px-3 text-right">Переклассификация</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {pagedOps.map((op) => {
                const eff = op.effective_kind || op.op_kind;
                const badge = KIND_BADGE[eff] ?? { label: eff, color: "var(--text-secondary)" };
                return (
                  <tr key={op.id} className="h-[38px] hover:bg-[var(--bg-elevated)]/50">
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                      {formatTerminalDateTime(op.timestamp, { timezone: "UTC" })}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className="rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ borderColor: badge.color, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-[var(--text-primary)]">
                        {op.account_name}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        #{op.account_login}
                      </div>
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-semibold"
                      style={{
                        color:
                          eff === "INTERNAL_TRANSFER"
                            ? "var(--text-muted)"
                            : op.amount_usd >= 0
                              ? "var(--bull)"
                              : "var(--bear)",
                      }}
                    >
                      {mask(formatSignedUsd(op.amount_usd))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">
                      {mask(`${op.amount.toLocaleString("ru-RU")} ${op.currency}`)}
                    </td>
                    <td className="max-w-[240px] truncate px-2 py-1.5 text-[var(--text-secondary)]">
                      {op.comment || op.notes || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <select
                          disabled={busyId === op.id}
                          value={op.op_kind}
                          onChange={(e) => void handleReclassify(op, e.target.value)}
                          className="h-6 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 text-[10px] text-[var(--text-primary)]"
                          title="Ручная переклассификация с сохранением в БД"
                        >
                          <option value="DEPOSIT">DEPOSIT</option>
                          <option value="WITHDRAWAL">WITHDRAWAL</option>
                          <option value="INTERNAL_TRANSFER">INTERNAL_TRANSFER</option>
                          <option value="EXNESS_VAULT">EXNESS_VAULT</option>
                          <option value="REBATE">REBATE</option>
                        </select>
                        {op.is_manual && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(op)}
                            className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--bear)] hover:bg-[var(--bear)]/10"
                            title="Удалить ручную запись"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filteredOps.length > DEFAULT_PAGE_SIZE && (
          <div className="border-t border-[var(--border-subtle)] px-3 py-2">
            <PagerBar
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={filteredOps.length}
              onPage={setPage}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить операцию?"
        description="Ручная балансовая запись будет удалена из Казны."
        confirmLabel="Удалить"
        destructive
        loading={deleteTarget !== null && busyId === deleteTarget.id}
        onConfirm={() => void handleDelete()}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      />
    </TerminalPageShell>
  );
}
