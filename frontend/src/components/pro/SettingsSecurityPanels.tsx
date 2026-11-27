import { useCallback, useEffect, useMemo, useState } from "react";

import { History, Shield, Trash2, Users } from "lucide-react";

import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";

interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name?: string;
  role: string;
  is_active: boolean;
}

interface SessionRow {
  id: string;
  user_id?: string;
  username?: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  is_current?: boolean;
}

interface LoginHistoryRow {
  id: string;
  user_id?: string;
  username?: string;
  ip_address?: string;
  success?: boolean;
  created_at?: string;
}

interface AuditRow {
  id: string;
  user_id?: string;
  username?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  created_at: string;
}

export function SettingsSecurityPanels() {
  const [subTab, setSubTab] = useState<"rbac" | "sessions" | "audit">("rbac");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [userFilter, setUserFilter] = useState<string>("all");

  const loadAll = useCallback(async () => {
    try {
      const [uRes, sRes, lRes, aRes] = await Promise.allSettled([
        apiRequest<{ items?: UserRow[] } | UserRow[]>("/users?page=1&page_size=100"),
        apiRequest<{ items?: SessionRow[] } | SessionRow[]>("/auth/sessions"),
        apiRequest<{ items?: LoginHistoryRow[] } | LoginHistoryRow[]>("/auth/login-history?page=1&page_size=50"),
        apiRequest<{ items?: AuditRow[] } | AuditRow[]>("/audit?page=1&page_size=80"),
      ]);
      if (uRes.status === "fulfilled") {
        setUsers(Array.isArray(uRes.value) ? uRes.value : uRes.value?.items || []);
      }
      if (sRes.status === "fulfilled") {
        setSessions(Array.isArray(sRes.value) ? sRes.value : sRes.value?.items || []);
      }
      if (lRes.status === "fulfilled") {
        setLoginHistory(Array.isArray(lRes.value) ? lRes.value : lRes.value?.items || []);
      }
      if (aRes.status === "fulfilled") {
        setAuditLogs(Array.isArray(aRes.value) ? aRes.value : aRes.value?.items || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await apiRequest(`/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      notify.success("Роль обновлена", `User ${userId.slice(0, 8)} → ${role}`);
    } catch (err) {
      notify.error("Ошибка смены роли", err instanceof Error ? err.message : String(err));
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiRequest(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      notify.success("Сессия завершена");
    } catch (err) {
      notify.error("Ошибка", err instanceof Error ? err.message : String(err));
    }
  };

  const userOptions = useMemo(
    () => [
      { value: "all", label: "Все пользователи" },
      ...users.map((u) => ({ value: u.id, label: `${u.username} (${u.id.slice(0, 8)})` })),
    ],
    [users],
  );

  const filteredSessions = useMemo(
    () => (userFilter === "all" ? sessions : sessions.filter((s) => s.user_id === userFilter)),
    [sessions, userFilter],
  );
  const filteredLogins = useMemo(
    () => (userFilter === "all" ? loginHistory : loginHistory.filter((l) => l.user_id === userFilter)),
    [loginHistory, userFilter],
  );
  const filteredAudit = useMemo(
    () => (userFilter === "all" ? auditLogs : auditLogs.filter((a) => a.user_id === userFilter)),
    [auditLogs, userFilter],
  );

  return (
    <div className="space-y-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-[11.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: "rbac", label: "Пользователи (RBAC)", icon: Users },
              { id: "sessions", label: "Активные сессии и Входы", icon: History },
              { id: "audit", label: "Журнал аудита (Audit Log)", icon: Shield },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  subTab === t.id
                    ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="size-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="w-52">
          <SearchSelect value={userFilter} onValueChange={setUserFilter} options={userOptions} />
        </div>
      </div>

      {/* RBAC Users */}
      {subTab === "rbac" && (
        <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="h-8 border-b border-[var(--border-subtle)] text-[10px] uppercase text-[var(--text-muted)]">
                <th className="px-3">User ID</th>
                <th className="px-2">Пользователь</th>
                <th className="px-2">Email</th>
                <th className="px-2">Роль (RBAC)</th>
                <th className="px-3 text-right">Перекрёстная ссылка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {users.map((u) => (
                <tr key={u.id} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                  <td className="px-3 font-mono text-[10px] text-[var(--text-muted)]">{u.id.slice(0, 10)}</td>
                  <td className="px-2 font-semibold text-[var(--text-primary)]">{u.username}</td>
                  <td className="px-2 text-[var(--text-secondary)]">{u.email || "—"}</td>
                  <td className="w-40 px-2">
                    <SearchSelect
                      value={u.role}
                      onValueChange={(role) => void handleRoleChange(u.id, role)}
                      options={[
                        { value: "ADMIN", label: "Admin" },
                        { value: "OPERATOR", label: "Trader" },
                        { value: "VIEWER", label: "Viewer" },
                      ]}
                    />
                  </td>
                  <td className="px-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setUserFilter(u.id);
                        setSubTab("sessions");
                      }}
                      className="text-[10.5px] font-medium text-[var(--accent-blue)] hover:underline"
                    >
                      Сессии и Аудит →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active Sessions & Login History */}
      {subTab === "sessions" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              Активные сессии ({filteredSessions.length})
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
                  <th className="px-2.5">User ID</th>
                  <th className="px-2">IP</th>
                  <th className="px-2">Создана (UTC)</th>
                  <th className="px-2.5 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredSessions.map((s) => (
                  <tr key={s.id} className="h-8">
                    <td className="px-2.5 font-mono text-[10px]">
                      <button
                        type="button"
                        onClick={() => {
                          if (s.user_id) {
                            setUserFilter(s.user_id);
                            setSubTab("audit");
                          }
                        }}
                        className="text-[var(--accent-blue)] hover:underline"
                      >
                        {(s.user_id || s.id).slice(0, 10)}
                      </button>
                    </td>
                    <td className="px-2 font-mono">{s.ip_address || "—"}</td>
                    <td className="px-2 font-mono text-[10px] text-[var(--text-muted)]">
                      {s.created_at ? s.created_at.slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="px-2.5 text-right">
                      {s.is_current ? (
                        <span className="text-[10px] font-semibold text-[var(--bull)]">Текущая</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleRevokeSession(s.id)}
                          className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--bear)] hover:underline"
                        >
                          <Trash2 className="size-3" /> Завершить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              История входов ({filteredLogins.length})
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
                  <th className="px-2.5">Время UTC</th>
                  <th className="px-2">User ID</th>
                  <th className="px-2">IP</th>
                  <th className="px-2.5 text-right">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredLogins.slice(0, 25).map((l) => (
                  <tr key={l.id} className="h-8">
                    <td className="px-2.5 font-mono text-[10px] text-[var(--text-muted)]">
                      {l.created_at ? l.created_at.slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="px-2 font-mono text-[10px]">
                      {l.user_id ? (
                        <button
                          type="button"
                          onClick={() => {
                            setUserFilter(l.user_id!);
                            setSubTab("audit");
                          }}
                          className="text-[var(--accent-blue)] hover:underline"
                        >
                          {l.user_id.slice(0, 10)}
                        </button>
                      ) : (
                        l.username || "—"
                      )}
                    </td>
                    <td className="px-2 font-mono">{l.ip_address || "—"}</td>
                    <td
                      className="px-2.5 text-right font-mono text-[10px] font-semibold"
                      style={{ color: l.success === false ? "var(--bear)" : "var(--bull)" }}
                    >
                      {l.success === false ? "DENIED" : "OK"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Immutable Audit Log */}
      {subTab === "audit" && (
        <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
          <table className="w-full border-collapse text-left text-[11px] tabular-nums">
            <thead>
              <tr className="h-8 border-b border-[var(--border-subtle)] text-[10px] uppercase text-[var(--text-muted)]">
                <th className="px-3">Время UTC</th>
                <th className="px-2">User ID</th>
                <th className="px-2">Действие</th>
                <th className="px-2">Объект</th>
                <th className="px-3 text-right">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredAudit.map((a) => (
                <tr key={a.id} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                  <td className="px-3 font-mono text-[10px] text-[var(--text-muted)]">
                    {a.created_at ? a.created_at.slice(0, 19).replace("T", " ") : "—"}
                  </td>
                  <td className="px-2 font-mono text-[10px]">
                    {a.user_id ? (
                      <button
                        type="button"
                        onClick={() => setUserFilter(a.user_id!)}
                        className="text-[var(--accent-blue)] hover:underline"
                      >
                        {a.user_id.slice(0, 10)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 font-mono font-semibold text-[var(--text-primary)]">{a.action}</td>
                  <td className="px-2 font-mono text-[10px] text-[var(--text-secondary)]">
                    {a.resource_type || "—"} {a.resource_id ? `#${a.resource_id.slice(0, 8)}` : ""}
                  </td>
                  <td className="px-3 text-right font-mono text-[10px] text-[var(--text-muted)]">
                    {a.ip_address || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
