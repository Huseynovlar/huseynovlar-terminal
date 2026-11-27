import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { useUtcClock } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/accounts/")({
  component: AccountsListPage,
});

export interface TradingAccountItem {
  id: string;
  profile_id: string | null;
  profile_name?: string;
  profile_gateway_url?: string;
  profile_has_api?: boolean;
  profile_api_key_mask?: string | null;
  primary_asset_id: string | null;
  container_id: string | null;
  name: string;
  platform: string;
  mt5_login: string;
  mt5_server: string;
  account_type: string;
  currency: string;
  currency_divisor: number;
  leverage: number;
  is_demo: boolean;
  is_active: boolean;
  api_key_prefix: string;
  has_encrypted_key: boolean;
  algo_trading_enabled: boolean;
  terminal_connected: boolean;
  last_ping_ms: number;
  last_seen_at: string | null;
  last_balance: number;
  last_balance_usd: number;
  last_equity: number;
  last_equity_usd: number;
  last_floating_pnl: number;
  last_floating_pnl_usd: number;
  margin_usd: number;
  free_margin_usd: number;
  last_margin_level: number;
  open_positions_count: number;
  open_volume_lots: number;
  robots_count?: number;
  created_at: string;
}

interface OpenPositionDetail {
  position_ticket: number;
  magic_number: number;
  symbol: string;
  side: string;
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  swap_usd: number;
  mae_usd: number;
  mfe_usd: number;
  profit_usd: number;
  open_time: number;
  comment: string;
}

interface AccountDetailResponse extends TradingAccountItem {
  profile?: {
    id: string;
    name: string;
    has_external_api: boolean;
    has_external_secret: boolean;
    external_api_key_mask?: string | null;
    external_secret_mask?: string | null;
    external_gateway_url: string;
  } | null;
  open_positions: OpenPositionDetail[];
}

function formatAge(iso: string | null, nowMs: number): { label: string; sec: number } {
  if (!iso) return { label: "—", sec: 99999 };
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return { label: "—", sec: 99999 };
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return { label: `${sec}s`, sec };
  if (sec < 3600) return { label: `${Math.floor(sec / 60)}m`, sec };
  if (sec < 86400) return { label: `${Math.floor(sec / 3600)}h`, sec };
  return { label: `${Math.floor(sec / 86400)}d`, sec };
}

function AccountsListPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const now = useUtcClock(1000);
  const nowMs = now.getTime();

  const [accounts, setAccounts] = useState<TradingAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TradingAccountItem | null>(null);

  // Selected account split-drawer state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"positions" | "gateway">("positions");

  // Exness Gateway Settings state (Tab 2 — safe autofill, never overwrites user input)
  const [gwUrl, setGwUrl] = useState("");
  const [gwApiKey, setGwApiKey] = useState("");
  const [gwPrivKey, setGwPrivKey] = useState("");
  const [gwSaving, setGwSaving] = useState(false);
  const [gwTesting, setGwTesting] = useState(false);
  const [gwTestResult, setGwTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadAccounts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rows = await apiRequest<TradingAccountItem[]>("/accounts");
      setAccounts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t.common.errorTitle]);

  const loadDetail = useCallback(async (accId: string, resetGatewayFields: boolean) => {
    setDetailLoading(true);
    try {
      const res = await apiRequest<AccountDetailResponse>(`/accounts/${encodeURIComponent(accId)}`);
      setDetail(res);
      if (resetGatewayFields) {
        setGwUrl(res.profile?.external_gateway_url || "https://api.exness.com");
        setGwApiKey("");
        setGwPrivKey("");
        setGwTestResult(null);
      }
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadAccounts(false);
  }, [loadAccounts]);

  // Zero REST polling — updates strictly via /ws/account
  useLiveEvents(
    ["account_update", "snapshot", "trade_event"],
    useCallback(
      (evt) => {
        const d = (evt.data ?? {}) as Record<string, unknown>;
        if (evt.type === "account_update" && d.account_id) {
          const accId = String(d.account_id);
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === accId
                ? {
                    ...a,
                    last_balance_usd: d.balance_usd != null ? Number(d.balance_usd) : a.last_balance_usd,
                    last_equity_usd: d.equity_usd != null ? Number(d.equity_usd) : a.last_equity_usd,
                    last_floating_pnl_usd:
                      d.floating_pnl_usd != null ? Number(d.floating_pnl_usd) : a.last_floating_pnl_usd,
                    terminal_connected: true,
                    last_seen_at: new Date().toISOString(),
                  }
                : a,
            ),
          );
          if (selectedId === accId) {
            void loadDetail(accId, false);
          }
          return;
        }
        void loadAccounts(true);
        if (selectedId) {
          void loadDetail(selectedId, false);
        }
      },
      [loadAccounts, loadDetail, selectedId],
    ),
  );

  // Top 5 KPI cells (server-computed USD only)
  const kpis = useMemo(() => {
    const totalBalance = accounts.reduce((s, a) => s + a.last_balance_usd, 0);
    const totalEquity = accounts.reduce((s, a) => s + a.last_equity_usd, 0);
    const totalFreeMargin = accounts.reduce((s, a) => s + (a.free_margin_usd ?? a.last_equity_usd), 0);
    const totalMargin = accounts.reduce((s, a) => s + (a.margin_usd ?? 0), 0);
    const totalFloating = accounts.reduce((s, a) => s + a.last_floating_pnl_usd, 0);
    const activeCount = accounts.filter((a) => a.terminal_connected).length;
    const marginLevel = totalMargin > 0 ? (totalEquity / totalMargin) * 100 : 0;
    return {
      totalBalance,
      totalFreeMargin,
      totalFloating,
      marginLevel,
      activeCount,
      totalCount: accounts.length,
    };
  }, [accounts]);

  function openAccountDrawer(acc: TradingAccountItem, tab: "positions" | "gateway" = "positions") {
    setSelectedId(acc.id);
    setDrawerTab(tab);
    void loadDetail(acc.id, true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(`del:${deleteTarget.id}`);
    try {
      await apiRequest(`/accounts/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setDetail(null);
      }
      setDeleteTarget(null);
      await loadAccounts(false);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadSet(acc: TradingAccountItem) {
    setBusyId(`set:${acc.id}`);
    try {
      const filename = await apiDownload(
        `/ops/setup-wizard/${encodeURIComponent(acc.mt5_login)}/bridge.set?url_mode=internal`,
        `bridge_${acc.mt5_login}.set`,
      );
      notify.success(t.common.download, filename);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveGateway() {
    if (!detail?.profile?.id) {
      notify.error("Профиль брокера не найден");
      return;
    }
    setGwSaving(true);
    try {
      const payload: Record<string, string> = {
        external_gateway_url: gwUrl.trim(),
      };
      if (gwApiKey.trim()) payload.external_api_key = gwApiKey.trim();
      if (gwPrivKey.trim()) payload.external_api_secret = gwPrivKey.trim();
      await apiRequest(`/profiles/${encodeURIComponent(detail.profile.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      notify.success("Параметры Exness Gateway сохранены");
      setGwApiKey("");
      setGwPrivKey("");
      await loadDetail(detail.id, false);
      await loadAccounts(true);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setGwSaving(false);
    }
  }

  async function handleTestGateway() {
    if (!detail?.profile?.id) return;
    setGwTesting(true);
    setGwTestResult(null);
    try {
      const res = await apiRequest<{ ok: boolean; error?: string; message?: string }>(
        `/profiles/${encodeURIComponent(detail.profile.id)}/test-exness-api`,
        {
          method: "POST",
          body: JSON.stringify({
            external_gateway_url: gwUrl.trim() || undefined,
            external_api_key: gwApiKey.trim() || undefined,
            external_api_secret: gwPrivKey.trim() || undefined,
            account_id: detail.mt5_login,
            scope: "trading",
          }),
        },
      );
      setGwTestResult({
        ok: Boolean(res.ok),
        msg: res.ok ? res.message || "Подключение Exness API успешно" : res.error || "Ошибка проверки",
      });
    } catch (err) {
      setGwTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGwTesting(false);
    }
  }

  const mask = (v: string) => (privacyMode ? "••••••" : v);

  return (
    <TerminalPageShell
      title="Счета и Брокеры"
      subtitle="Управление MT5 Bridge и Exness API · единая нормализация USC ÷ 100 → USD · /ws/account"
      badge={`${kpis.activeCount}/${kpis.totalCount} LIVE`}
      actions={
        <>
          <Link
            to="/dashboard/profiles"
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <KeyRound className="mr-1.5 size-3.5" />
            Профили Exness
          </Link>
          <button
            type="button"
            onClick={() => void loadAccounts(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Синхр.
          </button>
          <Link
            to="/dashboard/accounts/new"
            className="inline-flex h-8 items-center rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="mr-1.5 size-3.5" />
            Добавить счёт
          </Link>
        </>
      }
    >
      {/* 5-Cell KPI Strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Общий баланс (USD)
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
            {mask(formatUsd(kpis.totalBalance))}
          </span>
        </div>
        <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Свободная маржа
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
            {mask(formatUsd(kpis.totalFreeMargin))}
          </span>
        </div>
        <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Плавающий PnL
          </span>
          <span
            className="text-[15px] font-semibold tabular-nums"
            style={{
              color:
                kpis.totalFloating > 0
                  ? "var(--bull)"
                  : kpis.totalFloating < 0
                    ? "var(--bear)"
                    : "var(--text-primary)",
            }}
          >
            {mask(formatSignedUsd(kpis.totalFloating))}
          </span>
        </div>
        <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Загрузка плеча (Margin Lvl)
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
            {kpis.marginLevel > 0 ? `${kpis.marginLevel.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Активные счета
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
            <span className="text-[var(--bull)]">{kpis.activeCount}</span> / {kpis.totalCount}
          </span>
        </div>
      </div>

      {/* Main Split Area: Dense Table + Right Detail Drawer */}
      <div className={`grid grid-cols-1 gap-3 ${selectedId ? "xl:grid-cols-12" : ""}`}>
        <div
          className={`overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] ${
            selectedId ? "xl:col-span-7" : ""
          }`}
        >
          {loading ? (
            <div className="p-3">
              <TableSkeleton rows={5} cols={9} />
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              Нет подключённых торговых счетов. Нажмите «Добавить счёт».
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-[12px] tabular-nums">
              <thead>
                <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                  <th className="px-3">Счёт / Брокер</th>
                  <th className="px-2.5">Провайдер / Мост</th>
                  <th className="px-2.5 text-right">Баланс (USD)</th>
                  <th className="px-2.5 text-right">Эквити (USD)</th>
                  <th className="px-2.5 text-right">Маржа / Свободно</th>
                  <th className="px-2.5 text-right">Позиции</th>
                  <th className="px-2.5 text-right">Плечо</th>
                  <th className="px-2.5 text-right">Сигнал</th>
                  <th className="px-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {accounts.map((acc) => {
                  const isCent = acc.currency.toUpperCase() === "USC";
                  const age = formatAge(acc.last_seen_at, nowMs);
                  const dotColor = !acc.terminal_connected
                    ? "var(--bear)"
                    : age.sec > 5
                      ? "var(--accent-amber)"
                      : "var(--bull)";
                  const statusLabel = !acc.terminal_connected
                    ? "OFFLINE"
                    : age.sec > 5
                      ? "STALE"
                      : "CONNECTED";
                  const eqDelta = acc.last_equity_usd - acc.last_balance_usd;
                  const isSelected = selectedId === acc.id;

                  return (
                    <tr
                      key={acc.id}
                      onClick={() => openAccountDrawer(acc, "positions")}
                      className={`h-[44px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[var(--accent-blue)]/10"
                          : "hover:bg-[var(--bg-elevated)]/60"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {acc.name}
                          </span>
                          <span
                            className={`rounded-[3px] border px-1 py-0.2 text-[9px] font-semibold uppercase ${
                              acc.is_demo
                                ? "border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
                                : isCent
                                  ? "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                                  : "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)]"
                            }`}
                          >
                            {acc.is_demo ? "DEMO" : isCent ? "CENT" : "REAL"}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          #{acc.mt5_login} · {acc.mt5_server}
                        </div>
                      </td>

                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: dotColor }}
                            title={statusLabel}
                          />
                          <span className="text-[11px] font-medium text-[var(--text-primary)]">
                            {acc.platform === "MT5" ? "MT5 Bridge" : acc.platform}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {statusLabel}
                          {acc.profile_has_api ? " · Exness API" : ""}
                        </div>
                      </td>

                      <td className="px-2.5 py-1.5 text-right">
                        <div className="font-semibold text-[var(--text-primary)]">
                          {mask(formatUsd(acc.last_balance_usd))}
                        </div>
                        {isCent && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {mask(`${Math.round(acc.last_balance).toLocaleString("ru-RU")} USC`)}
                          </div>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 text-right">
                        <div className="font-semibold text-[var(--text-primary)]">
                          {mask(formatUsd(acc.last_equity_usd))}
                        </div>
                        <div
                          className="text-[10px] font-medium"
                          style={{
                            color:
                              eqDelta > 0
                                ? "var(--bull)"
                                : eqDelta < 0
                                  ? "var(--bear)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {mask(formatSignedUsd(eqDelta))}
                        </div>
                      </td>

                      <td className="px-2.5 py-1.5 text-right">
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {mask(formatUsd(acc.margin_usd))} / {mask(formatUsd(acc.free_margin_usd))}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          ML: {acc.last_margin_level > 0 ? `${acc.last_margin_level.toFixed(0)}%` : "—"}
                        </div>
                      </td>

                      <td className="px-2.5 py-1.5 text-right">
                        <div className="font-medium text-[var(--text-primary)]">
                          {acc.open_positions_count}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {acc.open_volume_lots.toFixed(2)} lot
                        </div>
                      </td>

                      <td className="px-2.5 py-1.5 text-right text-[11px] text-[var(--text-secondary)]">
                        {acc.leverage > 0 ? `1:${acc.leverage}` : "1:Unlimited"}
                      </td>

                      <td className="px-2.5 py-1.5 text-right text-[11px] text-[var(--text-muted)]">
                        {age.label}
                      </td>

                      <td
                        className="px-3 py-1.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openAccountDrawer(acc, "positions")}
                            className="rounded-[3px] border border-[var(--border-subtle)] px-1.5 py-1 text-[10px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                            title="Открыть детали и позиции"
                          >
                            Открыть
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `set:${acc.id}`}
                            onClick={() => void handleDownloadSet(acc)}
                            className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                            title="Скачать bridge.set"
                          >
                            <Download className="size-3.5" />
                          </button>
                          <Link
                            to="/dashboard/accounts/$accountId/edit"
                            params={{ accountId: acc.id }}
                            className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                            title="Настроить счёт"
                          >
                            <Pencil className="size-3.5" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(acc)}
                            className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--bear)] hover:bg-[var(--bear)]/10"
                            title="Удалить счёт"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right Split-Panel Drawer for Selected Account */}
        {selectedId && (
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] xl:col-span-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                    {detail?.name ?? "Загрузка..."}
                  </span>
                  {detail && (
                    <Link
                      to="/dashboard/accounts/$accountId"
                      params={{ accountId: detail.id }}
                      className="inline-flex items-center gap-0.5 text-[10px] text-[var(--accent-blue)] hover:underline"
                    >
                      Карточка <ExternalLink className="size-2.5" />
                    </Link>
                  )}
                </div>
                {detail && (
                  <div className="text-[10px] tabular-nums text-[var(--text-muted)]">
                    #{detail.mt5_login} · {detail.mt5_server} · {detail.currency}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                className="rounded-[3px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5">
              <button
                type="button"
                onClick={() => setDrawerTab("positions")}
                className={`rounded-[3px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  drawerTab === "positions"
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Открытые позиции ({detail?.open_positions.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab("gateway")}
                className={`rounded-[3px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  drawerTab === "gateway"
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Exness Gateway (API)
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {detailLoading && !detail ? (
                <TableSkeleton rows={4} cols={5} />
              ) : drawerTab === "positions" ? (
                (detail?.open_positions.length ?? 0) === 0 ? (
                  <div className="py-10 text-center text-xs text-[var(--text-muted)]">
                    Нет открытых позиций по этому счёту
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase text-[var(--text-muted)]">
                          <th className="py-1.5 pr-2">Тикет / Символ</th>
                          <th className="py-1.5 px-1.5">Вход / Тек.</th>
                          <th className="py-1.5 px-1.5">SL / TP</th>
                          <th className="py-1.5 px-1.5 text-right">MAE / MFE</th>
                          <th className="py-1.5 pl-1.5 text-right">PnL (USD)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {detail?.open_positions.map((p) => (
                          <tr key={p.position_ticket} className="hover:bg-[var(--bg-elevated)]/40">
                            <td className="py-1.5 pr-2">
                              <div className="flex items-center gap-1">
                                <span
                                  className="rounded-[2px] px-1 text-[9px] font-semibold"
                                  style={{
                                    backgroundColor:
                                      p.side === "BUY"
                                        ? "rgba(0,212,136,0.14)"
                                        : "rgba(255,71,87,0.14)",
                                    color: p.side === "BUY" ? "var(--bull)" : "var(--bear)",
                                  }}
                                >
                                  {p.side}
                                </span>
                                <span className="font-semibold text-[var(--text-primary)]">
                                  {p.symbol}
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  {p.volume.toFixed(2)}
                                </span>
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)]">
                                #{p.position_ticket} · M:{p.magic_number}
                              </div>
                            </td>
                            <td className="py-1.5 px-1.5 text-[var(--text-secondary)]">
                              <div>{p.open_price}</div>
                              <div className="text-[10px] text-[var(--text-muted)]">
                                {p.current_price}
                              </div>
                            </td>
                            <td className="py-1.5 px-1.5 text-[10px] text-[var(--text-muted)]">
                              <div>SL: {p.sl || "—"}</div>
                              <div>TP: {p.tp || "—"}</div>
                            </td>
                            <td className="py-1.5 px-1.5 text-right text-[10px]">
                              <div className="text-[var(--bear)]">{formatSignedUsd(p.mae_usd)}</div>
                              <div className="text-[var(--bull)]">{formatSignedUsd(p.mfe_usd)}</div>
                            </td>
                            <td className="py-1.5 pl-1.5 text-right">
                              <div
                                className="font-semibold"
                                style={{
                                  color: p.profit_usd >= 0 ? "var(--bull)" : "var(--bear)",
                                }}
                              >
                                {formatSignedUsd(p.profit_usd)}
                              </div>
                              <div className="text-[9px] text-[var(--text-muted)]">
                                Swap {formatSignedUsd(p.swap_usd)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                /* Tab 2: Exness Gateway Settings (Ed25519 + EXN-API-KEY, masked storage) */
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-[var(--accent-blue)]" />
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          Профиль: {detail?.profile?.name || "Exness Main"}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Ключи хранятся в зашифрованном Vault и не возвращаются в открытом виде.
                        </div>
                      </div>
                    </div>
                    {detail?.profile?.has_external_api && (
                      <span className="rounded-[3px] border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--bull)]">
                        {detail.profile.external_api_key_mask || "••••••"}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-[var(--text-secondary)]">
                        Exness Gateway URL
                      </Label>
                      <button
                        type="button"
                        onClick={() => {
                          if (!gwUrl.trim()) setGwUrl("https://api.exness.com");
                        }}
                        className="text-[10px] text-[var(--accent-blue)] hover:underline"
                      >
                        Автозаполнить (если пусто)
                      </button>
                    </div>
                    <Input
                      value={gwUrl}
                      onChange={(e) => setGwUrl(e.target.value)}
                      placeholder="https://api.exness.com"
                      className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] text-[var(--text-secondary)]">
                      EXN-API-KEY{" "}
                      {detail?.profile?.external_api_key_mask
                        ? `(сохранён: ${detail.profile.external_api_key_mask})`
                        : ""}
                    </Label>
                    <Input
                      type="password"
                      value={gwApiKey}
                      onChange={(e) => setGwApiKey(e.target.value)}
                      placeholder="Оставьте пустым, чтобы не перезаписывать"
                      className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] text-[var(--text-secondary)]">
                      Ed25519 Private Key (PEM / base64 / hex){" "}
                      {detail?.profile?.has_external_secret ? "(сохранён: ••••••Ed25519)" : ""}
                    </Label>
                    <textarea
                      rows={3}
                      value={gwPrivKey}
                      onChange={(e) => setGwPrivKey(e.target.value)}
                      placeholder="-----BEGIN PRIVATE KEY----- (оставьте пустым, чтобы не менять)"
                      className="w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                    />
                  </div>

                  {gwTestResult && (
                    <div
                      className="flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px]"
                      style={{
                        borderColor: gwTestResult.ok ? "var(--bull)" : "var(--bear)",
                        color: gwTestResult.ok ? "var(--bull)" : "var(--bear)",
                      }}
                    >
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      <span>{gwTestResult.msg}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <AsyncButton
                      size="sm"
                      loading={gwSaving}
                      loadingText="Сохранение..."
                      onClick={() => void handleSaveGateway()}
                    >
                      Сохранить Gateway
                    </AsyncButton>
                    <AsyncButton
                      size="sm"
                      variant="outline"
                      loading={gwTesting}
                      loadingText="Проверка..."
                      onClick={() => void handleTestGateway()}
                    >
                      Проверить подключение
                    </AsyncButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить торговый счёт?"
        description={
          deleteTarget
            ? `Счёт «${deleteTarget.name}» (#${deleteTarget.mt5_login}) будет удалён вместе со связанными сделками.`
            : ""
        }
        confirmLabel="Удалить"
        destructive
        loading={deleteTarget !== null && busyId === `del:${deleteTarget.id}`}
        onConfirm={() => void handleDelete()}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      />
    </TerminalPageShell>
  );
}
