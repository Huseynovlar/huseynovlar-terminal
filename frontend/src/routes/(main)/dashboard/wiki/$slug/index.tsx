import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/wiki/$slug/")({
  component: WikiDetailPage,
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

function WikiDetailPage() {
  const { slug } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [article, setArticle] = useState<WikiArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiRequest<WikiArticle>(`/wiki/${encodeURIComponent(slug)}`)
      .then(setArticle)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [slug, t.common.errorTitle]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiRequest(`/wiki/${encodeURIComponent(slug)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      await navigate({ to: "/dashboard/wiki" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={article?.title || slug}
      subtitle={article?.updated_at ? `${t.common.updatedAt}: ${new Date(article.updated_at).toLocaleString()}` : slug}
      badge={article?.category || "WIKI"}
      actions={
        <>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki" />}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/dashboard/wiki/$slug/edit" params={{ slug }} />}
          >
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{article?.category || "playbook"}</Badge>
            <span className="text-muted-foreground font-mono text-xs">{article?.slug}</span>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {article?.content_md || t.common.noData}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.wiki.confirmDeleteTitle}
        description={t.wiki.confirmDeleteDesc}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
