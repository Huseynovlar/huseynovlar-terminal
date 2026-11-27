import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, Copy, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalDataPanel, TerminalPageShell } from "@/framework/templates";
import { useLiveEvents } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/hubs/")({
  component: MyAssetsListPage,
});

export interface AssetHubItem {
  id: string;
  code: string;
  name: string;
  group: string;
  category: string;
  logo_url?: string | null;
  broker_symbols: string[];
  news_tags: string[];
  accounts_count?: number;
  robots_count?: number;
  is_pinned?: boolean;
}

type SortKey = "code" | "name" | "group" | "accounts_count" | "robots_count";

function MyAssetsListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [hubs, setHubs] = useState<AssetHubItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AssetHubItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 220);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadHubs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : "";
        const res = await apiRequestPaged<AssetHubItem>(`/assets${qs}`, page, DEFAULT_PAGE_SIZE);
        setHubs(res.items);
        setTotal(res.total);
      } catch (err) {
        if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [debouncedQ, page, t.common.errorTitle],
  );

  useEffect(() => {
    void loadHubs(false);
  }, [loadHubs]);

  useLiveEvents(["trade_event", "robot_state"], () => {
    void loadHubs(true);
  });

  const sortedHubs = useMemo(() => {
    const copy = [...hubs];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [hubs, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(deleteTarget.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.code);
      setDeleteTarget(null);
      await loadHubs(false);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.hubs.title}
      badge={`${total}`}
      actions={
        <>
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фильтр: XAUUSD, BTC, USTEC..."
              className="h-7 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-input)] pr-2 pl-7 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-blue)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void loadHubs(false)}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors duration-75 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw className="size-3" />
            {t.common.refresh}
          </button>
          <Link
            to="/dashboard/hubs/new"
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[11px] font-medium text-white transition-colors duration-75 hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t.hubs.newBtn}
          </Link>
        </>
      }
    >
      <TerminalDataPanel
        footer={<PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />}
      >
          {loading ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 rounded-[3px] bg-[var(--bg-elevated)] ht-shimmer-bar" />
              ))}
            </div>
          ) : sortedHubs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-[12px] text-[var(--text-muted)]">
              Портфель пуст — добавьте актив или откройте «Справочник рынков».
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)]">
                <tr className="h-8">
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("code")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Тикер <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Название <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">
                    <button type="button" onClick={() => toggleSort("group")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Класс <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-left font-medium">Символы MT5</th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("accounts_count")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Счета <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 text-right font-medium">
                    <button type="button" onClick={() => toggleSort("robots_count")} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                      Роботы <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="w-24 px-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sortedHubs.map((hub) => (
                  <tr
                    key={hub.id}
                    onClick={() => void navigate({ to: "/dashboard/hubs/$code", params: { code: hub.code } })}
                    className="h-9 cursor-pointer transition-colors duration-75 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-3 text-left">
                      <div className="flex items-center gap-2">
                        <AssetLogo symbol={hub.code} size={20} logoUrl={hub.logo_url} />
                        <span className="font-mono font-semibold text-[var(--text-primary)]">{hub.code}</span>
                      </div>
                    </td>
                    <td className="px-3 text-left text-[var(--text-secondary)]">{hub.name}</td>
                    <td className="px-3 text-left">
                      <span className="rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-secondary)]">
                        {hub.group || hub.category}
                      </span>
                    </td>
                    <td className="px-3 text-left font-mono text-[11px] text-[var(--text-muted)]">
                      {(hub.broker_symbols ?? []).slice(0, 4).join(", ") || hub.code}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                      {hub.accounts_count ?? 0}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums">
                      <span className={(hub.robots_count ?? 0) > 0 ? "font-semibold text-[var(--bull)]" : "text-[var(--text-muted)]"}>
                        {hub.robots_count ?? 0}
                      </span>
                    </td>
                    <td className="relative px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setOpenMenuId((cur) => (cur === hub.id ? null : hub.id))}
                        className="inline-flex size-6 items-center justify-center rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                        title="Меню актива"
                      >
                        <MoreVertical className="size-3.5" />
                      </button>
                      {openMenuId === hub.id ? (
                        <div className="absolute top-8 right-3 z-40 w-44 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)] p-1 text-left text-[11px]">
                          <Link
                            to="/dashboard/hubs/$code/edit"
                            params={{ code: hub.code }}
                            onClick={() => setOpenMenuId(null)}
                            className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                          >
                            <Pencil className="size-3 text-[var(--text-secondary)]" />
                            Редактировать
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(hub.id);
                              notify.success("UUID скопирован", hub.id);
                              setOpenMenuId(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                            title={hub.id}
                          >
                            <Copy className="size-3" />
                            UUID: {hub.id.slice(0, 8)}...
                          </button>
                          <div className="my-1 h-px bg-[var(--border-subtle)]" />
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setDeleteTarget(hub);
                            }}
                            className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[var(--bear)] hover:bg-[var(--bear-bg)]"
                          >
                            <Trash2 className="size-3" />
                            Удалить
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TerminalDataPanel>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.hubs.confirmDeleteTitle}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : ""}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
