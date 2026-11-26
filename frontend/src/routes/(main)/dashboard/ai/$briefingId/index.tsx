import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { AiBriefingItem } from "@/routes/(main)/dashboard/ai/index";

export const Route = createFileRoute("/(main)/dashboard/ai/$briefingId/")({
  component: AiBriefingDetailPage,
});

function AiBriefingDetailPage() {
  const { briefingId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [item, setItem] = useState<AiBriefingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    apiRequest<AiBriefingItem>(`/intelligence/ai/briefings/${encodeURIComponent(briefingId)}`)
      .then(setItem)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [briefingId, t.common.errorTitle]);

  async function handleDelete() {
    if (!item) return;
    setDeleting(true);
    try {
      await apiRequest(`/intelligence/ai/briefings/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, item.title);
      void navigate({ to: "/dashboard/ai" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!item) {
    return (
      <TerminalPageShell title={t.ai.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={item.title}
      subtitle={`${item.model} • ${formatTerminalDateTime(item.created_at)}`}
      badge={item.kind}
      actions={
        <>
          <Link to="/dashboard/ai" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      <Card className="max-w-3xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.ai.detailTitle}</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
          {item.content_md}
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.ai.confirmDeleteTitle} description={t.ai.confirmDeleteDesc} loading={deleting} onConfirm={handleDelete} />
    </TerminalPageShell>
  );
}
