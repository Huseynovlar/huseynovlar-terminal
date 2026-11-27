import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Download,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import {
  RobotEquityMiniChart,
  type RobotEquityPoint,
} from "@/components/robots/RobotEquityMiniChart";
import { AsyncButton } from "@/components/ui/async-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";
import { useUtcClock } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/robots/")({
  component: RobotsListPage,
});

export interface RobotItem {
  id: string;
  account_id: string;
  account_name: string;
  account_login: string;
  account_currency: string;
  account_type?: string;
  asset_id: string | null;
  magic_number: number;
  name: string;
  symbol: string;
  program_name: string;
  version: string;
  strategy_notes: string;
  params_json: Record<string, unknown>;
  live_status: string;
  live_state_json: Record<string, unknown>;
  last_execution_ms: number | null;
  last_heartbeat_at: string | null;
  heartbeat_age_sec: number | null;
  is_online: boolean;
  is_active: boolean;
  stats?: {
    open_positions_count: number;
    open_volume_lots: number;
    floating_pnl_usd: number;
    today_pnl_usd: number;
    total_pnl_usd: number;
    total_trades: number;
    win_rate_pct: number;
    profit_factor: number;
  };
  created_at: string;
}

interface RobotDetailResponse extends RobotItem {
  equity_curve: RobotEquityPoint[];
}

function buildHudSummary(state: Record<string, unknown>): string {
  const parts: string[] = [];
  const zones = state.zones as Record<string, unknown> | undefined;
  if (zones && typeof zones === "object" && zones.fair != null) {
    parts.push(`Fair: ${Number(zones.fair).toFixed(2)}`);
  } else if (state.fair_price != null) {
    parts.push(`Fair: ${Number(state.fair_price).toFixed(2)}`);
  }
  if (state.regime) parts.push(`Regime: ${String(state.regime)}`);
  if (state.rsi_m5 != null) parts.push(`RSI: ${Number(state.rsi_m5).toFixed(1)}`);
  if (state.er_h1 != null) parts.push(`ER: ${Number(state.er_h1).toFixed(2)}`);
  if (state.spread_pts != null) parts.push(`Spr: ${Number(state.spread_pts).toFixed(0)} pts`);
  if (state.signal_bias) parts.push(`Bias: ${String(state.signal_bias)}`);
  return parts.length > 0 ? parts.slice(0, 3).join(" · ") : "—";
}

function formatAgeSec(iso: string | null, nowMs: number): { label: string; sec: number } {
  if (!iso) return { label: "—", sec: 99999 };
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return { label: "—", sec: 99999 };
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return { label: `${sec}s`, sec };
  if (sec < 3600) return { label: `${Math.floor(sec / 60)}m`, sec };
  return { label: `${Math.floor(sec / 3600)}h`, sec };
}

function RobotsListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const now = useUtcClock(1000);
  const nowMs = now.getTime();

  const [robots, setRobots] = useState<RobotItem[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mt5_login: string }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "IN_MARKET" | "IDLE" | "PAUSED" | "OFFLINE">("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RobotItem | null>(null);

  // Selected robot detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RobotDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string; mt5_login: string }>>("/accounts")
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadRobots = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (debouncedQ) params.set("q", debouncedQ);
        if (accountFilter) params.set("account_id", accountFilter);
        if (statusFilter) params.set("status", statusFilter);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await apiRequestPaged<RobotItem>(`/robots${qs}`, page, DEFAULT_PAGE_SIZE);
        setRobots(res.items);
        setTotal(res.total);
      } catch (err) {
        if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [debouncedQ, accountFilter, statusFilter, page, t.common.errorTitle],
  );

  const loadRobotDetail = useCallback(async (robotId: string) => {
    setDetailLoading(true);
    try {
      const res = await apiRequest<RobotDetailResponse>(`/robots/${encodeURIComponent(robotId)}`);
      setDetail(res);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadRobots(false);
  }, [loadRobots]);

  // Zero REST polling — live updates strictly via /ws/account
  useLiveEvents(
    ["robot_state", "robot_telemetry", "snapshot"],
    useCallback(
      (evt) => {
        const d = (evt.data ?? {}) as Record<string, unknown>;
        const robotId = String(d.robot_id ?? d.id ?? "");
        if ((evt.type === "robot_state" || evt.type === "robot_telemetry") && robotId) {
          const nowIso = new Date().toISOString();
          setRobots((prev) =>
            prev.map((r) =>
              r.id === robotId
                ? {
                    ...r,
                    live_status: d.live_status ? String(d.live_status) : r.live_status,
                    live_state_json:
                      d.live_state_json && typeof d.live_state_json === "object"
                        ? (d.live_state_json as Record<string, unknown>)
                        : { ...r.live_state_json, ...d },
                    last_heartbeat_at: nowIso,
                    is_online: true,
                  }
                : r,
            ),
          );
          return;
        }
        void loadRobots(true);
      },
      [loadRobots],
    ),
  );

  async function handleDownload(path: string, fallback: string, key: string) {
    setBusyKey(key);
    try {
      const fn = await apiDownload(path, fallback);
      notify.success(t.common.download, fn);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyKey(`del:${deleteTarget.id}`);
    try {
      await apiRequest(`/robots/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setDetail(null);
      }
      setDeleteTarget(null);
      await loadRobots(false);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  const telemetryEntries = useMemo(() => {
    const st = detail?.live_state_json ?? {};
    return Object.entries(st).filter(([, v]) => v !== null && v !== undefined && v !== "");
  }, [detail?.live_state_json]);

  return (
    <TerminalPageShell
      title="Торговые роботы"
      subtitle="Советники MT5 (EA) · живая телеметрия ep_ipc · статистика по Magic Number (без ExnessPanelBridge)"
      badge={`${total} EA`}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busyKey === "mq5"}
            loadingText={t.common.loading}
            onClick={() =>
              void handleDownload("/ops/downloads/ExnessPanelBridge.mq5", "ExnessPanelBridge.mq5", "mq5")
            }
          >
            <Download className="mr-1.5 size-3.5" />
            Bridge .mq5
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={busyKey === "mqh"}
            loadingText={t.common.loading}
            onClick={() =>
              void handleDownload("/ops/downloads/ExnessPanelHook.mqh", "ExnessPanelHook.mqh", "mqh")
            }
          >
            <Download className="mr-1.5 size-3.5" />
            Hook .mqh
          </AsyncButton>
          <button
            type="button"
            onClick={() => void loadRobots(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </button>
          <Link
            to="/dashboard/robots/new"
            className="inline-flex h-8 items-center rounded-[4px] bg-[var(--accent-blue)] px-3 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="mr-1.5 size-3.5" />
            Зарегистрировать EA
          </Link>
        </>
      }
    >
      {/* Compact Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фильтр: XAUUSD, USTEC, Magic, EA..."
              className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-8 text-xs"
            />
          </div>

          <select
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] outline-none"
          >
            <option value="">Все счета</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (#{a.mt5_login})
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
          {(
            [
              { id: "", label: "Все" },
              { id: "IN_MARKET", label: "В рынке" },
              { id: "IDLE", label: "Ожидание" },
              { id: "PAUSED", label: "Пауза" },
              { id: "OFFLINE", label: "Офлайн" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id || "all"}
              type="button"
              onClick={() => {
                setStatusFilter(tab.id);
                setPage(1);
              }}
              className={`rounded-[3px] px-2.5 py-1 font-medium transition-colors ${
                statusFilter === tab.id
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table + Detail Split */}
      <div className={`grid grid-cols-1 gap-3 ${selectedId ? "xl:grid-cols-12" : ""}`}>
        <div
          className={`overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] ${
            selectedId ? "xl:col-span-7" : ""
          }`}
        >
          {loading ? (
            <div className="p-3">
              <TableSkeleton rows={6} cols={8} />
            </div>
          ) : robots.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              Нет торговых роботов по выбранному фильтру
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-[12px] tabular-nums">
              <thead>
                <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
                  <th className="px-3">Робот / Версия</th>
                  <th className="px-2">Magic</th>
                  <th className="px-2">Символ / ТФ</th>
                  <th className="px-2">Счёт</th>
                  <th className="px-2">Статус EA</th>
                  <th className="px-2 text-right">Открыто сейчас</th>
                  <th className="px-2 text-right">День / Всего (USD)</th>
                  <th className="px-3">Телеметрия HUD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {robots.map((r) => {
                  const age = formatAgeSec(r.last_heartbeat_at, nowMs);
                  const isStale = age.sec > 15 || !r.is_online;
                  const stUp = (r.live_status || "IDLE").toUpperCase();
                  const statusBadge = isStale
                    ? { label: `STALE · ${age.label}`, color: "var(--bear)" }
                    : stUp.includes("PAUSE")
                      ? { label: "PAUSED", color: "var(--accent-amber)" }
                      : (r.stats?.open_positions_count ?? 0) > 0 || stUp.includes("RUN")
                        ? { label: `RUNNING · ${age.label}`, color: "var(--bull)" }
                        : { label: `IDLE · ${age.label}`, color: "var(--text-secondary)" };
                  const cleanSym = canonicalMarketSymbol(r.symbol);
                  const tf = String(r.live_state_json?.timeframe ?? r.live_state_json?.tf ?? "M5");
                  const isSelected = selectedId === r.id;

                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setSelectedId(r.id);
                        void loadRobotDetail(r.id);
                      }}
                      className={`h-[44px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[var(--accent-blue)]/10"
                          : "hover:bg-[var(--bg-elevated)]/60"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-semibold text-[var(--text-primary)]">{r.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          v{r.version || "1.0"} {r.program_name ? `· ${r.program_name}` : ""}
                        </div>
                      </td>

                      <td className="px-2 py-1.5">
                        <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]">
                          {r.magic_number}
                        </span>
                      </td>

                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <Link
                          to="/dashboard/hubs/$code"
                          params={{ code: cleanSym || r.symbol }}
                          className="inline-flex items-center gap-1.5 rounded-[3px] px-1 py-0.5 hover:bg-[var(--bg-elevated)]"
                          title="Открыть в AssetTerminalView (Зоны MT5)"
                        >
                          <AssetLogo symbol={cleanSym || r.symbol} size={16} />
                          <span className="font-semibold text-[var(--accent-blue)]">
                            {r.symbol || "—"}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">· {tf}</span>
                        </Link>
                      </td>

                      <td className="px-2 py-1.5">
                        <div className="text-[11px] font-medium text-[var(--text-primary)]">
                          #{r.account_login}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {r.account_currency === "USC" ? "CENT (USC→USD)" : r.account_currency}
                        </div>
                      </td>

                      <td className="px-2 py-1.5">
                        <span
                          className="inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            borderColor: statusBadge.color,
                            color: statusBadge.color,
                          }}
                        >
                          {statusBadge.label}
                        </span>
                      </td>

                      <td className="px-2 py-1.5 text-right">
                        <div className="text-[11px] font-medium text-[var(--text-primary)]">
                          {r.stats?.open_positions_count ?? 0} ·{" "}
                          {(r.stats?.open_volume_lots ?? 0).toFixed(2)} lot
                        </div>
                        <div
                          className="text-[10px] font-semibold"
                          style={{
                            color:
                              (r.stats?.floating_pnl_usd ?? 0) > 0
                                ? "var(--bull)"
                                : (r.stats?.floating_pnl_usd ?? 0) < 0
                                  ? "var(--bear)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {formatSignedUsd(r.stats?.floating_pnl_usd ?? 0)}
                        </div>
                      </td>

                      <td className="px-2 py-1.5 text-right">
                        <div className="text-[11px] font-semibold">
                          <span
                            style={{
                              color:
                                (r.stats?.today_pnl_usd ?? 0) >= 0 ? "var(--bull)" : "var(--bear)",
                            }}
                          >
                            {formatSignedUsd(r.stats?.today_pnl_usd ?? 0)}
                          </span>
                          <span className="mx-1 text-[var(--text-muted)]">/</span>
                          <span
                            style={{
                              color:
                                (r.stats?.total_pnl_usd ?? 0) >= 0 ? "var(--bull)" : "var(--bear)",
                            }}
                          >
                            {formatSignedUsd(r.stats?.total_pnl_usd ?? 0)}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          WR {(r.stats?.win_rate_pct ?? 0).toFixed(0)}% · PF{" "}
                          {(r.stats?.profit_factor ?? 0).toFixed(2)}
                        </div>
                      </td>

                      <td className="px-3 py-1.5">
                        <div className="max-w-[200px] truncate text-[10px] text-[var(--text-secondary)]">
                          {buildHudSummary(r.live_state_json || {})}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {total > DEFAULT_PAGE_SIZE && (
            <div className="border-t border-[var(--border-subtle)] px-3 py-2">
              <PagerBar
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={total}
                onPage={setPage}
              />
            </div>
          )}
        </div>

        {/* Right Detail Panel (ep_ipc Inspector + ECharts Mini-Chart + Open on Chart) */}
        {selectedId && (
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] xl:col-span-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Activity className="size-3.5 text-[var(--accent-blue)]" />
                  <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                    {detail?.name ?? "Загрузка..."}
                  </span>
                  {detail && (
                    <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
                      Magic #{detail.magic_number}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {detail && (
                  <>
                    <Link
                      to="/dashboard/robots/$robotId/edit"
                      params={{ robotId: detail.id }}
                      className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                      title="Редактировать"
                    >
                      <Pencil className="size-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(detail)}
                      className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--bear)] hover:bg-[var(--bear)]/10"
                      title="Удалить"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className="rounded-[3px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {detailLoading && !detail ? (
                <TableSkeleton rows={5} cols={2} />
              ) : detail ? (
                <>
                  {/* Primary Action: Open on Chart with MT5 Zones */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                      Сделок: <strong>{detail.stats?.total_trades ?? 0}</strong> · WR{" "}
                      <strong>{(detail.stats?.win_rate_pct ?? 0).toFixed(1)}%</strong> · PF{" "}
                      <strong>{(detail.stats?.profit_factor ?? 0).toFixed(2)}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/dashboard/hubs/$code",
                          params: { code: canonicalMarketSymbol(detail.symbol) || detail.symbol },
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-[4px] bg-[var(--accent-blue)] px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
                    >
                      Открыть на графике (Зоны MT5)
                      <ExternalLink className="size-3" />
                    </button>
                  </div>

                  {/* Mini-Equity Chart per Magic Number (Apache ECharts v6) */}
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      Кривая доходности Magic #{detail.magic_number} (USD)
                    </div>
                    <RobotEquityMiniChart
                      points={detail.equity_curve || []}
                      magicNumber={detail.magic_number}
                    />
                  </div>

                  {/* Full ep_ipc KV/JSON Inspector */}
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      Живая телеметрия ep_ipc ({telemetryEntries.length} полей)
                    </div>
                    {telemetryEntries.length > 0 ? (
                      <div className="max-h-[240px] divide-y divide-[var(--border-subtle)] overflow-y-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[11px] tabular-nums">
                        {telemetryEntries.map(([k, v]) => (
                          <div key={k} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                            <span className="shrink-0 font-medium text-[var(--text-muted)]">{k}</span>
                            <span className="break-all text-right text-[var(--text-primary)]">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-center text-[11px] text-[var(--text-muted)]">
                        Нет данных ep_ipc от ExnessPanelHook
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить торгового робота?"
        description={
          deleteTarget
            ? `Робот «${deleteTarget.name}» (Magic #${deleteTarget.magic_number}) будет удалён из реестра.`
            : ""
        }
        confirmLabel="Удалить"
        destructive
        loading={deleteTarget !== null && busyKey === `del:${deleteTarget.id}`}
        onConfirm={() => void handleDelete()}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      />
    </TerminalPageShell>
  );
}
