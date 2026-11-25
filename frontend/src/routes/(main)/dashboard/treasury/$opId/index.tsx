import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import type { TreasuryOp } from "@/routes/(main)/dashboard/treasury/index";

export const Route = createFileRoute("/(main)/dashboard/treasury/$opId/")({
  component: TreasuryDetailPage,
});

function TreasuryDetailPage() {
  const { opId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [op, setOp] = useState<TreasuryOp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    apiRequest<TreasuryOp>(`/treasury/operations/${encodeURIComponent(opId)}`)
      .then(setOp)
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [opId, t.common.errorTitle]);

  async function handleDelete() {
    if (!op) return;
    setBusy(true);
    try {
      await apiRequest(`/treasury/operations/${encodeURIComponent(op.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess);
      void navigate({ to: "/dashboard/treasury" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!op) {
    return (
      <TerminalPageShell title={t.treasury.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={`${t.treasury.detailTitle}`}
      badge={op.op_kind}
      actions={
        <>
          <Link to="/dashboard/treasury" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <Link to="/dashboard/treasury/$opId/edit" params={{ opId: op.id }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>{op.account_name || op.account_login}</span>
            <Badge variant="outline">{op.op_kind}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div><span className="text-muted-foreground">Amount USD:</span> <span className="font-mono font-bold">{formatSignedUsd(op.amount_usd, privacyMode)}</span></div>
          <div><span className="text-muted-foreground">Timestamp:</span> <span className="font-mono">{new Date(op.timestamp).toLocaleString()}</span></div>
          <div><span className="text-muted-foreground">Comment:</span> {op.comment || "—"}</div>
          <div><span className="text-muted-foreground">Notes:</span> {op.notes || "—"}</div>
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.treasury.confirmDeleteTitle} description={t.treasury.confirmDeleteDesc} loading={busy} onConfirm={handleDelete} />
    </TerminalPageShell>
  );
}
