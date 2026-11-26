import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FolderPlus, Pencil, Save, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/wiki/categories")({
  component: WikiCategoriesPage,
});

interface WikiCategoryItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  sort_order?: number;
  pages_count?: number;
  created_at?: string;
}

function WikiCategoriesPage() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<WikiCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WikiCategoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<WikiCategoryItem[]>("/wiki/categories");
      setCategories(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function startEdit(cat: WikiCategoryItem) {
    setEditingId(cat.id);
    setName(cat.name);
    setSlug(cat.slug);
    setDescription(cat.description || "");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setSlug("");
    setDescription("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiRequest(`/wiki/categories/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim() || undefined,
            description: description.trim(),
          }),
        });
        notify.success(t.common.savedSuccess, name.trim());
      } else {
        await apiRequest("/wiki/categories", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim() || undefined,
            description: description.trim(),
          }),
        });
        notify.success(t.common.createdSuccess, name.trim());
      }
      resetForm();
      await loadCategories();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/wiki/categories/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadCategories();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TerminalPageShell
      title={`${t.wiki.title} — ${t.wiki.category}`}
      subtitle="Manage Wiki categories"
      badge={`${categories.length}`}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderPlus className="size-4 text-primary" />
              {editingId ? t.common.edit : t.common.create}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cat-name">Name</Label>
                <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-slug">Slug (auto if empty)</Label>
                <Input
                  id="cat-slug"
                  className="font-mono text-xs"
                  placeholder="runbook"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-desc">Description</Label>
                <Input id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="flex gap-2">
                {editingId ? (
                  <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                    {t.common.cancel}
                  </Button>
                ) : null}
                <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
                  <Save className="mr-1.5 size-3.5" />
                  {editingId ? t.common.save : t.common.create}
                </AsyncButton>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="overflow-x-auto p-0">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={4} cols={5} />
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Pages</th>
                    <th className="px-3 py-2 font-medium">{t.common.createdAt}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground py-8 text-center">
                        {t.common.noData}
                      </td>
                    </tr>
                  ) : (
                    categories.map((cat) => (
                      <tr key={cat.id} className="hover:bg-muted/30">
                        <td className="text-muted-foreground px-3 py-2 font-mono">{cat.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 font-medium">{cat.name}</td>
                        <td className="px-3 py-2 font-mono">
                          <Badge variant="outline">{cat.slug}</Badge>
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{cat.pages_count ?? 0}</td>
                        <td className="text-muted-foreground px-3 py-2 font-mono tabular-nums">
                          {formatTerminalDateTime(cat.created_at)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button size="xs" variant="ghost" onClick={() => startEdit(cat)}>
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeleteTarget(cat)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.common.delete}
        description={`Delete category "${deleteTarget?.name || ""}"?`}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
