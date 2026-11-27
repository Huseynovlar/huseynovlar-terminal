import { useCallback, useEffect, useState } from "react";

import { Pencil, Radio, RefreshCw, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";

interface BridgeRobotDto {
  id: string;
  account_id: string;
  account_name: string;
  account_login: string;
  name: string;
  symbol: string;
  program_name: string;
  version: string;
  strategy_notes: string;
  live_status: string;
  is_online: boolean;
  is_active: boolean;
  heartbeat_age_sec: number | null;
  last_heartbeat_at: string | null;
  params_json: Record<string, unknown>;
  live_state_json: Record<string, unknown>;
}

function isBridgeRobot(r: BridgeRobotDto): boolean {
  const pj = r.params_json || {};
  if (pj.is_bridge) return true;
  const blob = `${r.name} ${r.program_name} ${r.strategy_notes}`.toLowerCase();
  return blob.includes("bridge") || blob.includes("exnesspanel");
}

export function Mt5BridgesPanel() {
  const [bridges, setBridges] = useState<BridgeRobotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BridgeRobotDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPollSec, setEditPollSec] = useState("5");
  const [editAlertSec, setEditAlertSec] = useState("30");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<BridgeRobotDto[]>("/robots?include_bridges=true&page=1&page_size=200");
      setBridges((Array.isArray(rows) ? rows : []).filter(isBridgeRobot));
    } catch {
      setBridges([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (b: BridgeRobotDto) => {
    setEditing(b);
    setEditName(b.name);
    setEditNotes(b.strategy_notes || "");
    const pj = b.params_json || {};
    setEditPollSec(String(pj.poll_interval_sec ?? 5));
    setEditAlertSec(String(pj.stale_alert_sec ?? 30));
    setEditActive(b.is_active);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await apiRequest(`/robots/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim() || editing.name,
          strategy_notes: editNotes.trim(),
          is_active: editActive,
          params_json: {
            ...(editing.params_json || {}),
            is_bridge: true,
            poll_interval_sec: Number(editPollSec) || 5,
            stale_alert_sec: Number(editAlertSec) || 30,
          },
        }),
      });
      notify.success("Мост обновлён", editName.trim());
      setEditing(null);
      await load();
    } catch (err) {
      notify.error("Ошибка сохранения", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b: BridgeRobotDto) => {
    if (!window.confirm(`Удалить мост «${b.name}»?`)) return;
    try {
      await apiRequest(`/robots/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      notify.success("Мост удалён", b.name);
      await load();
    } catch (err) {
      notify.error("Ошибка удаления", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mt-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          <Radio className="size-3.5 text-[var(--accent-blue)]" />
          Мосты MT5 (ExnessPanelBridge · {bridges.length})
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      {editing && (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-[11px] md:grid-cols-12"
        >
          <div className="md:col-span-3">
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-muted)]">Название моста</label>
            <input
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-muted)]">Опрос (сек)</label>
            <input
              type="number"
              min={1}
              value={editPollSec}
              onChange={(e) => setEditPollSec(e.target.value)}
              className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-muted)]">Порог алерта (сек)</label>
            <input
              type="number"
              min={5}
              value={editAlertSec}
              onChange={(e) => setEditAlertSec(e.target.value)}
              className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-muted)]">Заметки / Параметры</label>
            <input
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
          <div className="flex items-end justify-end gap-1.5 md:col-span-2">
            <label className="flex h-7 items-center gap-1 text-[10.5px]">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              Активен
            </label>
            <Button type="submit" size="sm" disabled={saving} className="h-7 gap-1 px-2 text-[11px]">
              <Save className="size-3" />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)} className="h-7 px-2">
              <X className="size-3" />
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[11.5px] tabular-nums">
          <thead>
            <tr className="h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
              <th className="px-3">Мост</th>
              <th className="px-2">Статус</th>
              <th className="px-2">Счёт MT5</th>
              <th className="px-2 text-right">seq</th>
              <th className="px-2">chart_discovery</th>
              <th className="px-2 text-right">updated_at_utc</th>
              <th className="px-3 text-right">Управление</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {bridges.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                  {loading ? "Загрузка подключённых мостов MT5..." : "Подключённых системных мостов не найдено"}
                </td>
              </tr>
            ) : (
              bridges.map((b) => {
                const st = b.live_state_json || {};
                const seq = st.seq ?? "—";
                const chartsRaw = st.chart_discovery;
                const chartsLabel = Array.isArray(chartsRaw)
                  ? `${chartsRaw.length} граф.`
                  : typeof chartsRaw === "string"
                    ? chartsRaw
                    : b.symbol || "—";
                const badgeStatus = b.is_online
                  ? "CONNECTED"
                  : b.heartbeat_age_sec !== null && b.heartbeat_age_sec <= 300
                    ? "STALE"
                    : "OFFLINE";
                return (
                  <tr key={b.id} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                    <td className="px-3 font-semibold text-[var(--text-primary)]">
                      {b.name}
                      {b.version && (
                        <span className="ml-1.5 font-mono text-[10px] font-normal text-[var(--text-muted)]">
                          v{b.version}
                        </span>
                      )}
                    </td>
                    <td className="px-2">
                      <span
                        className="rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-bold"
                        style={{
                          color:
                            badgeStatus === "CONNECTED"
                              ? "var(--bull)"
                              : badgeStatus === "STALE"
                                ? "var(--accent-amber)"
                                : "var(--bear)",
                          backgroundColor: "var(--bg-canvas)",
                        }}
                      >
                        {badgeStatus}
                      </span>
                    </td>
                    <td className="px-2 text-[var(--text-secondary)]">
                      {b.account_name || "—"}
                      {b.account_login && (
                        <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">#{b.account_login}</span>
                      )}
                    </td>
                    <td className="px-2 text-right font-mono text-[var(--text-secondary)]">{String(seq)}</td>
                    <td className="px-2 font-mono text-[10.5px] text-[var(--text-secondary)]">{chartsLabel}</td>
                    <td className="px-2 text-right font-mono text-[10.5px] text-[var(--text-muted)]">
                      {b.last_heartbeat_at ? b.last_heartbeat_at.slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(b)}
                          className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[10.5px] text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
                        >
                          <Pencil className="size-2.5" />
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(b)}
                          className="inline-flex h-6 items-center rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 text-[var(--text-muted)] hover:border-[var(--bear)] hover:text-[var(--bear)]"
                          title="Удалить мост"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
