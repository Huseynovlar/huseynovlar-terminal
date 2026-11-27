import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Cpu, Pause, Play, Radio, RefreshCw, Server, Terminal } from "lucide-react";

import { InfraEtcAndWikiPanel } from "@/components/pro/InfraEtcAndWikiPanel";
import { Mt5BridgesPanel } from "@/components/pro/Mt5BridgesPanel";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { soundEngine } from "@/framework/sound-engine";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/infrastructure")({
  component: InfrastructureHubPage,
});

interface InfraOverviewResponse {
  updated_at_utc: string;
  docker_proxy_connected: boolean;
  bridge: {
    version: string;
    status: "CONNECTED" | "STALE" | "OFFLINE" | string;
    seq: number;
    updated_at_utc: string | null;
    latency_ms: number | null;
    accounts_count: number;
    ipc_streams: Array<{
      id: string;
      name: string;
      symbol: string;
      magic: number;
      status: string;
      updated_at_utc: string;
    }>;
  };
  containers: Array<{
    service: string;
    status: string;
    uptime: string;
    cpu_pct: number | null;
    ram_mb: number | null;
    network: string;
  }>;
  gateways: Array<{
    name: string;
    status: string;
    clients: number;
    msg_per_sec: number;
  }>;
  logs: Array<{
    id: string;
    timestamp_utc: string;
    level: "INFO" | "WARN" | "ERROR" | string;
    source: string;
    message: string;
  }>;
}

function statusBadgeColor(status: string): string {
  const s = status.toUpperCase();
  if (s === "CONNECTED" || s === "HEALTHY" || s === "UP" || s === "ONLINE") return "var(--bull)";
  if (s === "STALE" || s === "DEGRADED" || s === "STANDBY") return "var(--accent-amber)";
  return "var(--bear)";
}

function InfrastructureHubPage() {
  const [data, setData] = useState<InfraOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [logFilter, setLogFilter] = useState<"ALL" | "WARN" | "ERROR">("ALL");
  const [logsPaused, setLogsPaused] = useState(false);
  const prevBridgeStatusRef = useRef<string | null>(null);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest<InfraOverviewResponse>("/ops/infrastructure/overview");
      setData(res);
      const prev = prevBridgeStatusRef.current;
      const next = res.bridge.status;
      if (prev && prev !== next) {
        if (next === "CONNECTED") soundEngine.play("bridgeReconnect");
        else if (next === "OFFLINE") soundEngine.play("bridgeDisconnect");
      }
      prevBridgeStatusRef.current = next;
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки инфраструктуры", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview]);

  // Silent Anti-Flicker WS updates on /ws/account events (never triggers setLoading(true))
  useLiveEvents("account_update", () => {
    if (!logsPaused) void loadOverview(true);
  });
  useLiveEvents("heartbeat", () => {
    if (!logsPaused) void loadOverview(true);
  });

  const filteredLogs = useMemo(() => {
    if (!data?.logs) return [];
    if (logFilter === "ALL") return data.logs;
    return data.logs.filter((l) => l.level === logFilter);
  }, [data, logFilter]);

  return (
    <TerminalPageShell
      title="Инфраструктура MT5 и Сервис"
      subtitle="Единый хаб телеметрии: мост ExnessPanelBridge v2.33+, Docker-контейнеры, WebSocket-шлюзы и системные логи"
      badge={data ? `BRIDGE: ${data.bridge.status}` : "SYNC"}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard/containers"
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            Управление MT5-контейнерами
          </Link>
          <button
            type="button"
            onClick={() => void loadOverview(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Обновить
          </button>
        </div>
      }
    >
      {loading && !data ? (
        <PageSkeleton />
      ) : data ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* TILE 1: ExnessPanelBridge.mq5 (v2.33+) */}
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-6">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                <Activity className="size-3.5 text-[var(--accent-blue)]" />
                Мост {data.bridge.version}
              </div>
              <span
                className="rounded-[3px] px-2 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: `color-mix(in srgb, ${statusBadgeColor(data.bridge.status)} 16%, transparent)`,
                  color: statusBadgeColor(data.bridge.status),
                }}
              >
                ● {data.bridge.status}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-px border-b border-[var(--border-subtle)] bg-[var(--border-subtle)] text-center tabular-nums">
              <div className="bg-[var(--bg-canvas)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Seq</div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{data.bridge.seq}</div>
              </div>
              <div className="bg-[var(--bg-canvas)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Задержка</div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {data.bridge.latency_ms !== null ? `${data.bridge.latency_ms} ms` : "—"}
                </div>
              </div>
              <div className="bg-[var(--bg-canvas)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Счетов</div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{data.bridge.accounts_count}</div>
              </div>
              <div className="bg-[var(--bg-canvas)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Сигнал UTC</div>
                <div className="truncate text-[11px] font-medium text-[var(--text-secondary)]">
                  {data.bridge.updated_at_utc
                    ? formatTerminalDateTime(data.bridge.updated_at_utc, { timezone: "UTC" }).slice(11)
                    : "—"}
                </div>
              </div>
            </div>

            <div className="max-h-[240px] overflow-y-auto">
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Робот / График MT5 (ep_ipc)</th>
                    <th className="px-2">Тикер</th>
                    <th className="px-2 text-right">Magic</th>
                    <th className="px-3 text-right">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.bridge.ipc_streams.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-xs text-[var(--text-muted)]">
                        Ожидание телеметрии chart_discovery / ep_ipc...
                      </td>
                    </tr>
                  ) : (
                    data.bridge.ipc_streams.map((s) => (
                      <tr key={s.id} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                        <td className="px-3 font-medium text-[var(--text-primary)]">{s.name}</td>
                        <td className="px-2 font-semibold text-[var(--accent-blue)]">{s.symbol}</td>
                        <td className="px-2 text-right text-[var(--text-muted)]">{s.magic}</td>
                        <td className="px-3 text-right font-semibold" style={{ color: statusBadgeColor(s.status) }}>
                          {s.status}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* TILE 2: Active Docker Containers & Core Workers (fixes bug #9) */}
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-6">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                <Server className="size-3.5 text-[var(--accent-amber)]" />
                Активные Docker-контейнеры и воркеры ({data.containers.length})
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">
                {data.docker_proxy_connected ? "Docker Socket" : "Healthcheck Mesh"}
              </span>
            </div>

            <div className="max-h-[300px] overflow-x-auto overflow-y-auto">
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Сервис</th>
                    <th className="px-2">Статус</th>
                    <th className="px-2">Uptime</th>
                    <th className="px-2 text-right">CPU %</th>
                    <th className="px-3 text-right">RAM (MB)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.containers.map((c) => (
                    <tr key={c.service} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">{c.service}</td>
                      <td className="px-2">
                        <span
                          className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${statusBadgeColor(c.status)} 16%, transparent)`,
                            color: statusBadgeColor(c.status),
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-2 text-[var(--text-secondary)]">{c.uptime}</td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        {c.cpu_pct !== null ? `${c.cpu_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 text-right text-[var(--text-primary)]">
                        {c.ram_mb !== null ? `${c.ram_mb.toFixed(1)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* TILE 3: External WebSocket Gateways */}
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                <Radio className="size-3.5 text-[var(--bull)]" />
                Внешние WebSocket-шлюзы
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">{data.gateways.length} каналов</span>
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="px-3">Шлюз</th>
                  <th className="px-2">Статус</th>
                  <th className="px-2 text-right">Подписки</th>
                  <th className="px-3 text-right">msg/sec</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.gateways.map((g) => (
                  <tr key={g.name} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                    <td className="px-3 font-medium text-[var(--text-primary)]">{g.name}</td>
                    <td className="px-2 font-semibold" style={{ color: statusBadgeColor(g.status) }}>
                      ● {g.status}
                    </td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">{g.clients}</td>
                    <td className="px-3 text-right font-semibold text-[var(--text-primary)]">
                      {g.msg_per_sec.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* TILE 4: System Logs */}
          <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                <Terminal className="size-3.5 text-[var(--text-muted)]" />
                Системные логи
              </div>
              <div className="flex items-center gap-1.5">
                <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px]">
                  {(["ALL", "WARN", "ERROR"] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLogFilter(lvl)}
                      className={`rounded-[3px] px-2 py-0.5 font-semibold ${
                        logFilter === lvl
                          ? "bg-[var(--accent-blue)] text-white"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setLogsPaused((v) => !v)}
                  className="inline-flex h-6 items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[10px] font-semibold text-[var(--text-primary)]"
                >
                  {logsPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
                  {logsPaused ? "Продолжить" : "Пауза"}
                </button>
              </div>
            </div>

            <div className="max-h-[260px] divide-y divide-[var(--border-subtle)] overflow-y-auto font-mono text-[11px]">
              {filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center gap-1.5 py-8 text-xs text-[var(--text-muted)]">
                  <Cpu className="size-3.5" />
                  Нет записей для выбранного фильтра
                </div>
              ) : (
                filteredLogs.map((l) => (
                  <div key={l.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--bg-elevated)]/40">
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                      {formatTerminalDateTime(l.timestamp_utc, { timezone: "UTC" }).slice(11)}
                    </span>
                    <span
                      className="w-11 shrink-0 font-bold"
                      style={{
                        color:
                          l.level === "ERROR"
                            ? "var(--bear)"
                            : l.level === "WARN"
                              ? "var(--accent-amber)"
                              : "var(--accent-blue)",
                      }}
                    >
                      {l.level}
                    </span>
                    <span className="shrink-0 text-[var(--text-secondary)]">[{l.source}]</span>
                    <span className="min-w-0 flex-1 break-words text-[var(--text-primary)]">{l.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      <Mt5BridgesPanel />
      <InfraEtcAndWikiPanel />
    </TerminalPageShell>
  );
}
