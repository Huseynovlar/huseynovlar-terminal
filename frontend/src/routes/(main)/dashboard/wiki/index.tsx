import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Eye, FolderKanban, Pencil, Pin, Plus, Search, Trash2, User as UserIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/wiki/")({
  component: WikiListPage,
});

interface WikiArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  content_md: string;
  is_pinned: boolean;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface WikiCategory {
  id: string;
  slug: string;
  name: string;
  pages_count?: number;
}

function WikiListPage() {
  const { t } = useI18n();
  const [pages, setPages] = useState<WikiArticle[]>([]);
  const [categories, setCategories] = useState<WikiCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WikiArticle | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const rows = await apiRequest<WikiCategory[]>("/wiki/categories");
      setCategories(Array.isArray(rows) ? rows : []);
    } catch {
      // ignore
    }
  }, []);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedCategory) qs.set("category", selectedCategory);
      if (query.trim()) qs.set("q", query.trim());
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await apiRequestPaged<WikiArticle>(`/wiki${suffix}`, page, DEFAULT_PAGE_SIZE);
      setPages(res.items);
      setTotal(res.total);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, query, selectedCategory, t.common.errorTitle]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/wiki/${encodeURIComponent(deleteTarget.slug)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.title);
      setDeleteTarget(null);
      await loadPages();
      await loadCategories();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.wiki.title}
      subtitle={t.wiki.subtitle}
      badge={`${total}`}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki/categories" />}>
            <FolderKanban className="mr-1.5 size-3.5" />
            {t.wiki.category}
          </Button>
          <Button size="sm" nativeButton={false} render={<Link to="/dashboard/wiki/new" />}>
            <Plus className="mr-1.5 size-3.5" />
            {t.wiki.newBtn}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="relative max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by ID, title, category, slug..."
            className="pl-8 font-mono text-xs"
          />
        </div>

        {/* Clickable category filter pills (#12) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant={selectedCategory === "" ? "default" : "outline"}
            onClick={() => {
              setSelectedCategory("");
              setPage(1);
            }}
          >
            {t.common.all}
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              size="xs"
              variant={selectedCategory === cat.slug ? "default" : "outline"}
              onClick={() => {
                setSelectedCategory(cat.slug);
                setPage(1);
              }}
            >
              {cat.name}
              {cat.pages_count !== undefined ? (
                <span className="ml-1 font-mono text-[10px] opacity-75">({cat.pages_count})</span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : pages.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">{t.common.noData}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pages.map((article) => (
              <Card key={article.id || article.slug} className="flex flex-col justify-between">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-1.5 text-sm">
                      <BookOpen className="size-4 shrink-0 text-primary" />
                      <span className="line-clamp-1">{article.title}</span>
                    </CardTitle>
                    {article.is_pinned ? <Pin className="size-3.5 shrink-0 text-amber-500" /> : null}
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory(article.category);
                        setPage(1);
                      }}
                    >
                      <Badge variant="outline" className="hover:border-primary cursor-pointer text-[10px]">
                        {article.category || "runbook"}
                      </Badge>
                    </button>
                    <span className="font-mono text-[10px]" title={article.id}>
                      #{article.id.slice(0, 8)}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-muted-foreground line-clamp-3 text-xs">
                    {article.content_md.replace(/[#*`>_]/g, "").slice(0, 180)}
                  </p>
                  <div className="text-muted-foreground flex items-center justify-between text-[10px]">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <UserIcon className="size-3" />
                      {article.updated_by || "system"}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatTerminalDateTime(article.created_at || article.updated_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1 border-t border-border/50 pt-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link to="/dashboard/wiki/$slug" params={{ slug: article.slug }} />}
                    >
                      <Eye className="mr-1 size-3" />
                      {t.common.view}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link to="/dashboard/wiki/$slug/edit" params={{ slug: article.slug }} />}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(article)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.wiki.confirmDeleteTitle}
        description={t.wiki.confirmDeleteDesc}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
