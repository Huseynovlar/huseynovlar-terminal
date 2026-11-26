import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, FlaskConical, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/news/sources/")({
  component: NewsSourcesListPage,
});

export interface NewsSourceItem {
  id: string;
  name: string;
  url: string;
  category: string;
  trust_tier: string;
  is_verified: boolean;
  is_enabled: boolean;
  asset_tags: string[];
  article_count: number;
  last_polled_at?: string | null;
  last_error?: string;
}

function NewsSourcesListPage() {
  const { t } = useI18n();
  const [sources, setSources] = useState<NewsSourceItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCat, setSelectedCat] = useState("");
  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsSourceItem | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await apiRequest<string[]>("/intelligence/source-categories");
      setCategories(Array.isArray(cats) ? cats : []);
    } catch {
      // ignore
    }
  }, []);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("q", search.trim());
      if (selectedCat) qs.set("category", selectedCat);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await apiRequestPaged<NewsSourceItem>(`/intelligence/sources${suffix}`, page, DEFAULT_PAGE_SIZE);
      setSources(res.items);
      setTotal(res.total);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedCat, t.common.errorTitle]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function handleAddCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      const updated = await apiRequest<string[]>("/intelligence/source-categories", {
        method: "POST",
        body: JSON.stringify({ slug: newCategory.trim() }),
      });
      setCategories(updated);
      setNewCategory("");
      notify.success(t.common.createdSuccess);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCategory(slug: string) {
    try {
      const updated = await apiRequest<string[]>(`/intelligence/source-categories/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      setCategories(updated);
      if (selectedCat === slug) setSelectedCat("");
      notify.success(t.common.deletedSuccess, slug);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTest(src: NewsSourceItem) {
    setBusyKey(`test:${src.id}`);
    try {
      const res = await apiRequest<{
        ok?: boolean;
        entries_found?: number;
        items_found?: number;
        status_code?: number;
        error?: string;
      }>(`/intelligence/sources/${encodeURIComponent(src.id)}/test`, { method: "POST" });
      const count = res.entries_found ?? res.items_found ?? 0;
      if (res.ok) {
        notify.success(t.sources.testSuccess, `${src.name} (${count} entries)`);
      } else {
        notify.warning(src.name, res.error || `HTTP ${res.status_code ?? "ERR"}`);
      }
      await loadSources();
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
      await apiRequest(`/intelligence/sources/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadSources();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <TerminalPageShell
      title={t.sources.title}
      subtitle={t.sources.subtitle}
      badge={`${total}`}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void loadSources()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/news/sources/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.sources.newBtn}
          </Link>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 max-w-md flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
            <Input
              className="pl-8 font-mono text-xs"
              placeholder="Search by ID, source name, URL, category..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <form onSubmit={(e) => void handleAddCategory(e)} className="flex items-center gap-1.5">
            <Input
              className="h-8 w-40 font-mono text-xs"
              placeholder="New category..."
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <Button type="submit" size="xs" variant="outline">
              <Plus className="mr-1 size-3" />
              Category
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant={selectedCat === "" ? "default" : "outline"}
            onClick={() => {
              setSelectedCat("");
              setPage(1);
            }}
          >
            {t.common.all}
          </Button>
          {categories.map((cat) => (
            <div key={cat} className="inline-flex items-center">
              <Button
                size="xs"
                variant={selectedCat === cat ? "default" : "outline"}
                className="rounded-r-none"
                onClick={() => {
                  setSelectedCat(cat);
                  setPage(1);
                }}
              >
                {cat}
              </Button>
              <Button
                size="icon-xs"
                variant="outline"
                className="rounded-l-none border-l-0 text-muted-foreground hover:text-destructive"
                title={`Delete ${cat}`}
                onClick={() => void handleDeleteCategory(cat)}
              >
                <X className="size-2.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">{t.sources.trustTier}</th>
                  <th className="px-3 py-2">Articles</th>
                  <th className="px-3 py-2">{t.common.status}</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground py-8 text-center">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  sources.map((src) => (
                    <tr key={src.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-[11px]">
                        <Link
                          to="/dashboard/news/sources/$sourceId"
                          params={{ sourceId: src.id }}
                          title={String(src.id)}
                          className="text-primary hover:underline"
                        >
                          {String(src.id).slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Link
                            to="/dashboard/news/sources/$sourceId"
                            params={{ sourceId: src.id }}
                            className="hover:underline"
                          >
                            {src.name}
                          </Link>
                          {src.is_verified ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null}
                        </div>
                        <div className="max-w-xs truncate font-mono text-[10px] text-muted-foreground">{src.url}</div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCat(src.category);
                            setPage(1);
                          }}
                        >
                          <Badge variant="outline" className="hover:border-primary cursor-pointer text-[10px]">
                            {src.category}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono">{src.trust_tier}</td>
                      <td className="px-3 py-2 font-mono">{src.article_count}</td>
                      <td className="px-3 py-2">
                        <Badge variant={src.is_enabled ? "default" : "secondary"} className="text-[10px]">
                          {src.is_enabled ? t.common.enabled : t.common.disabled}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <AsyncButton
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            loading={busyKey === `test:${src.id}`}
                            loadingText="..."
                            onClick={() => void handleTest(src)}
                            title={t.sources.testFeed}
                          >
                            <FlaskConical className="size-3.5" />
                          </AsyncButton>
                          <Link
                            to="/dashboard/news/sources/$sourceId"
                            params={{ sourceId: src.id }}
                            className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          >
                            <Eye className="size-3.5" />
                          </Link>
                          <Link
                            to="/dashboard/news/sources/$sourceId/edit"
                            params={{ sourceId: src.id }}
                            className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          >
                            <Pencil className="size-3.5" />
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive"
                            onClick={() => setDeleteTarget(src)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.sources.confirmDeleteTitle}
        description={`${t.sources.confirmDeleteDesc} (${deleteTarget?.name ?? ""})`}
        loading={busyKey === `del:${deleteTarget?.id ?? ""}`}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
