import { useCallback, useEffect, useMemo, useState } from "react";

import { BookOpen, CheckCircle2, FileCode2, Plus, Search, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";

interface EtcDiagnostics {
  updated_at: string;
  env_checks: Array<{ key: string; configured: boolean; scope: string }>;
  network_routes: Array<{ service: string; target: string; network: string; status: string }>;
}

interface WikiArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  content_md?: string;
  tags?: string[];
  updated_at?: string;
}

const WIKI_CATEGORIES = [
  { value: "all", label: "Все категории" },
  { value: "strategies", label: "Стратегии" },
  { value: "mt5_bridge", label: "Настройка MT5 Bridge" },
  { value: "troubleshooting", label: "Ошибки и фиксы" },
  { value: "risk_management", label: "Риск-менеджмент" },
];

export function InfraEtcAndWikiPanel() {
  const [diag, setDiag] = useState<EtcDiagnostics | null>(null);
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<WikiArticle | null>(null);

  // Create / Edit state
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCat, setDraftCat] = useState("strategies");
  const [draftTags, setDraftTags] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const loadDiag = useCallback(async () => {
    try {
      const res = await apiRequest<EtcDiagnostics>("/pro/etc-diagnostics");
      setDiag(res);
    } catch {
      // silent
    }
  }, []);

  const loadWiki = useCallback(async () => {
    try {
      const res = await apiRequest<{ items?: WikiArticle[] } | WikiArticle[]>("/wiki");
      const list = Array.isArray(res) ? res : res?.items || [];
      setArticles(list);
    } catch {
      setArticles([]);
    }
  }, []);

  useEffect(() => {
    void loadDiag();
    void loadWiki();
  }, [loadDiag, loadWiki]);

  const filteredArticles = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return articles.filter((a) => {
      if (categoryFilter !== "all" && (a.category || "").toLowerCase() !== categoryFilter) return false;
      if (!q) return true;
      const inTitle = a.title.toLowerCase().includes(q);
      const inTags = (a.tags || []).some((t) => t.toLowerCase().includes(q));
      return inTitle || inTags;
    });
  }, [articles, categoryFilter, searchQ]);

  const handleSaveArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim() || !draftBody.trim()) return;
    try {
      const tags = draftTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const created = await apiRequest<WikiArticle>("/wiki", {
        method: "POST",
        body: JSON.stringify({
          title: draftTitle.trim(),
          category: draftCat,
          content_md: draftBody.trim(),
          tags,
        }),
      });
      notify.success("Статья сохранена в Wiki", created.title);
      setCreating(false);
      setDraftTitle("");
      setDraftTags("");
      setDraftBody("");
      await loadWiki();
    } catch (err) {
      notify.error("Ошибка сохранения Wiki", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteArticle = async (id: string) => {
    try {
      await apiRequest(`/wiki/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selected?.id === id) setSelected(null);
      notify.success("Статья удалена");
      await loadWiki();
    } catch (err) {
      notify.error("Ошибка удаления", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* TILE 5: Мастер /etc и Конфигурация */}
      <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
            <FileCode2 className="size-3.5 text-[var(--accent-blue)]" />
            Мастер /etc и Конфигурация
          </div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">READ-ONLY · NO SECRETS</span>
        </div>

        <div className="space-y-3 p-3 text-[11px]">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Статус переменных окружения (.env)
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {(diag?.env_checks ?? []).map((chk) => (
                <div key={chk.key} className="flex items-center justify-between px-2.5 py-1.5 font-mono">
                  <div>
                    <span className="font-semibold text-[var(--text-primary)]">{chk.key}</span>
                    <span className="ml-2 font-sans text-[10px] text-[var(--text-muted)]">{chk.scope}</span>
                  </div>
                  {chk.configured ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--bull)]">
                      <CheckCircle2 className="size-3" /> OK
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]">
                      <XCircle className="size-3" /> NOT SET
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Маршрутизация Docker / nginx / huseynovlar_webhooks / MT5 IPC
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {(diag?.network_routes ?? []).map((rt) => (
                <div key={rt.service} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text-primary)]">{rt.service}</div>
                    <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {rt.target} · {rt.network}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[9.5px] font-bold"
                    style={{
                      color: rt.status === "OK" ? "var(--bull)" : rt.status === "IDLE" ? "var(--accent-amber)" : "var(--bear)",
                      backgroundColor: "var(--bg-surface)",
                    }}
                  >
                    {rt.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* TILE 6: Wiki / База знаний терминала (Full CRUD) */}
      <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
            <BookOpen className="size-3.5 text-[var(--accent-amber)]" />
            Wiki / База знаний терминала ({articles.length})
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[10.5px]"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus className="size-3" />
            {creating ? "Отмена" : "Новая статья"}
          </Button>
        </div>

        <div className="space-y-2.5 p-3 text-[11.5px]">
          {creating && (
            <form
              onSubmit={(e) => void handleSaveArticle(e)}
              className="space-y-2 rounded-[4px] border border-[var(--accent-blue)]/40 bg-[var(--bg-canvas)] p-2.5"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Заголовок статьи..."
                  className="h-8 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[11.5px] focus:border-[var(--accent-blue)] focus:outline-none"
                />
                <SearchSelect
                  value={draftCat}
                  onValueChange={setDraftCat}
                  options={WIKI_CATEGORIES.filter((c) => c.value !== "all")}
                />
              </div>
              <input
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="Теги через запятую (mt5, bridge, xauusd)..."
                className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] focus:border-[var(--accent-blue)] focus:outline-none"
              />
              <textarea
                required
                rows={4}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Содержание в Markdown..."
                className="w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-mono text-[11px] focus:border-[var(--accent-blue)] focus:outline-none"
              />
              <Button type="submit" size="sm" className="h-7 text-[11px]">
                Сохранить статью
              </Button>
            </form>
          )}

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-[var(--text-muted)]" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Поиск по заголовку и тегам..."
                className="h-7 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-2 pl-7 text-[11px] focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>
            <div className="w-48">
              <SearchSelect
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={WIKI_CATEGORIES}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="max-h-[260px] divide-y divide-[var(--border-subtle)] overflow-y-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] md:col-span-5">
              {filteredArticles.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-[var(--text-muted)]">
                  Статей не найдено. Нажмите «Новая статья» для создания.
                </div>
              ) : (
                filteredArticles.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={`flex cursor-pointer items-center justify-between gap-1 px-2.5 py-2 transition-colors ${
                      selected?.id === a.id ? "bg-[var(--accent-blue)]/15" : "hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--text-primary)]">{a.title}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{a.category}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteArticle(a.id);
                      }}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--bear)]"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="max-h-[260px] overflow-y-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 md:col-span-7">
              {selected ? (
                <div className="space-y-1.5">
                  <div className="font-semibold text-[var(--text-primary)]">{selected.title}</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded-[3px] bg-[var(--accent-blue)]/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent-blue)]">
                      {selected.category}
                    </span>
                    {(selected.tags || []).map((t) => (
                      <span key={t} className="rounded-[3px] border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--text-muted)]">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {selected.content_md || "—"}
                  </pre>
                </div>
              ) : (
                <div className="py-10 text-center text-[11px] text-[var(--text-muted)]">
                  Выберите статью слева для просмотра
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
