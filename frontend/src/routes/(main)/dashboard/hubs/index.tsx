import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, Copy, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
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
    <div
      data-content-padding="false"
      className="flex h-[calc(100vh-80px)] min-h-[540px] flex-col bg-[#0B0E14] text-[#F1F5F9]"
    >
      {/* Compact 44px Institutional Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[#1E2634] bg-[#11161F] px-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[14px] font-semibold tracking-tight text-[#F1F5F9]">{t.hubs.title}</h1>
          <span className="rounded-[3px] border border-[#2C3649] bg-[#171E2B] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8] tabular-nums">
            {total}
          </span>
          <div className="relative ml-2 w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[#64748B]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фильтр: XAUUSD, BTC, USTEC..."
              className="h-7 w-full rounded-[4px] border border-[#1E2634] bg-[#0B0E14] pr-2 pl-7 text-[11px] text-[#F1F5F9] placeholder-[#64748B] outline-none focus:border-[#3B82F6]"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void loadHubs(false)}
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#1E2634] bg-[#0B0E14] px-2.5 text-[11px] text-[#94A3B8] transition-colors duration-75 hover:border-[#2C3649] hover:text-[#F1F5F9]"
          >
            <RefreshCw className="size-3" />
            {t.common.refresh}
          </button>
          <Link
            to="/dashboard/hubs/new"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] bg-[#3B82F6] px-2.5 text-[11px] font-medium text-[#0B0E14] transition-colors duration-75 hover:bg-[#3B82F6]/90"
          >
            <Plus className="size-3.5" />
            {t.hubs.newBtn}
          </Link>
        </div>
      </div>

      {/* Dense Institutional Portfolio Table */}
      <div className="pro-scroll min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 rounded-[3px] bg-[#11161F] ht-shimmer-bar" />
            ))}
          </div>
        ) : sortedHubs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-[#64748B]">
            Портфель пуст — добавьте актив или откройте «Справочник рынков».
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[11px] text-[#64748B]">
              <tr className="h-8">
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("code")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Тикер <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Название <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("group")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Класс <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-left font-medium">Символы MT5</th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("accounts_count")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Счета <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("robots_count")} className="inline-flex items-center gap-1 hover:text-[#F1F5F9]">
                    Роботы <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="w-24 px-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2634]/70">
              {sortedHubs.map((hub) => (
                <tr
                  key={hub.id}
                  onClick={() => void navigate({ to: "/dashboard/hubs/$code", params: { code: hub.code } })}
                  className="h-9 cursor-pointer transition-colors duration-75 hover:bg-[#171E2B]"
                >
                  <td className="px-3 text-left">
                    <div className="flex items-center gap-2">
                      <AssetLogo symbol={hub.code} size={20} logoUrl={hub.logo_url} />
                      <span className="font-mono font-semibold text-[#F1F5F9]">{hub.code}</span>
                    </div>
                  </td>
                  <td className="px-3 text-left text-[#CBD5E1]">{hub.name}</td>
                  <td className="px-3 text-left">
                    <span className="rounded-[3px] border border-[#2C3649] bg-[#11161F] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#94A3B8]">
                      {hub.group || hub.category}
                    </span>
                  </td>
                  <td className="px-3 text-left font-mono text-[11px] text-[#64748B]">
                    {(hub.broker_symbols ?? []).slice(0, 4).join(", ") || hub.code}
                  </td>
                  <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                    {hub.accounts_count ?? 0}
                  </td>
                  <td className="px-3 text-right font-mono tabular-nums">
                    <span className={(hub.robots_count ?? 0) > 0 ? "text-[#10B981] font-semibold" : "text-[#64748B]"}>
                      {hub.robots_count ?? 0}
                    </span>
                  </td>
                  <td
                    className="relative px-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenMenuId((cur) => (cur === hub.id ? null : hub.id))}
                      className="inline-flex size-6 items-center justify-center rounded-[3px] border border-[#1E2634] bg-[#11161F] text-[#94A3B8] hover:border-[#2C3649] hover:text-[#F1F5F9]"
                      title="Меню актива"
                    >
                      <MoreVertical className="size-3.5" />
                    </button>
                    {openMenuId === hub.id ? (
                      <div className="absolute top-8 right-3 z-40 w-44 rounded-[4px] border border-[#2C3649] bg-[#11161F] p-1 text-left text-[11px]">
                        <Link
                          to="/dashboard/hubs/$code/edit"
                          params={{ code: hub.code }}
                          onClick={() => setOpenMenuId(null)}
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[#F1F5F9] hover:bg-[#171E2B]"
                        >
                          <Pencil className="size-3 text-[#94A3B8]" />
                          Редактировать
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(hub.id);
                            notify.success("UUID скопирован", hub.id);
                            setOpenMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
                          title={hub.id}
                        >
                          <Copy className="size-3" />
                          UUID: {hub.id.slice(0, 8)}...
                        </button>
                        <div className="my-1 h-px bg-[#1E2634]" />
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setDeleteTarget(hub);
                          }}
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[#F43F5E] hover:bg-[#F43F5E]/10"
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
      </div>

      {/* Footer Pagination */}
      <div className="shrink-0 border-t border-[#1E2634] bg-[#11161F] px-3 py-1">
        <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.hubs.confirmDeleteTitle}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : ""}
        loading={busy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
