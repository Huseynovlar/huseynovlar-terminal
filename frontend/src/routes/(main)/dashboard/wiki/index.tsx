import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Eye, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

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
  updated_at?: string;
}

function WikiListPage() {
  const { t } = useI18n();
  const [pages, setPages] = useState<WikiArticle[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WikiArticle | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<WikiArticle[]>("/wiki");
      setPages(Array.isArray(res) ? res : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? pages.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.slug.toLowerCase().includes(q),
        )
      : pages;
    return [...list].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned));
  }, [pages, query]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/wiki/${encodeURIComponent(deleteTarget.slug)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.title);
      setDeleteTarget(null);
      await loadPages();
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
      badge="WIKI"
      actions={
        <Button size="sm" nativeButton={false} render={<Link to="/dashboard/wiki/new" />}>
          <Plus className="mr-1.5 size-3.5" />
          {t.wiki.newBtn}
        </Button>
      }
    >
      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          className="pl-8"
        />
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">{t.common.noData}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((article) => (
            <Card key={article.id || article.slug} className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    <BookOpen className="size-4 shrink-0 text-primary" />
                    <span className="line-clamp-1">{article.title}</span>
                  </CardTitle>
                  {article.is_pinned ? <Pin className="size-3.5 shrink-0 text-amber-500" /> : null}
                </div>
                <CardDescription className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {article.category || "playbook"}
                  </Badge>
                  <span className="font-mono text-[10px]">{article.slug}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {article.content_md.replace(/[#*`>_]/g, "").slice(0, 180)}
                </p>
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
