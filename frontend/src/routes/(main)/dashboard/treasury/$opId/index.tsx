import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Lock, Pencil, Trash2 } from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
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
import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import type { TreasuryOp } from "@/routes/(main)/dashboard/treasury/index";

export const Route = createFileRoute("/(main)/dashboard/treasury/$opId/")({
  component: TreasuryDetailPage,
});

interface TreasuryOpDetail extends TreasuryOp {
  balance_before_usd?: number | null;
  balance_after_usd?: number | null;
}

function TreasuryDetailPage() {
  const { opId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [op, setOp] = useState<TreasuryOpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    apiRequest<TreasuryOpDetail>(`/treasury/operations/${encodeURIComponent(opId)}`)
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
      subtitle={`ID: ${op.id}`}
      badge={op.op_kind}
      actions={
        <>
          <Link to="/dashboard/treasury" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          {op.is_manual ? (
            <>
              <Link to="/dashboard/treasury/$opId/edit" params={{ opId: op.id }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
                <Pencil className="mr-1.5 size-3.5" />
                {t.common.edit}
              </Link>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 size-3.5" />
                {t.common.delete}
              </Button>
            </>
          ) : (
            <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
              <Lock className="size-3" />
              Broker-synced (Read-Only)
            </Badge>
          )}
        </>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>{op.account_name || op.account_login}</span>
            <Badge variant="outline">{op.op_kind}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">ID</div>
            <div className="font-mono break-all">{op.id}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Balance Before</div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              {op.balance_before_usd != null ? formatUsd(op.balance_before_usd, privacyMode) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Balance After</div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              {op.balance_after_usd != null ? formatUsd(op.balance_after_usd, privacyMode) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Amount USD</div>
            <div className={`font-mono text-sm font-bold tabular-nums ${op.amount_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {formatSignedUsd(op.amount_usd, privacyMode)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Timestamp (UTC)</div>
            <div className="font-mono tabular-nums">{formatTerminalDateTime(op.timestamp)}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Comment</div>
            <div>{op.comment || "—"}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Notes</div>
            <div>{op.notes || "—"}</div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.treasury.confirmDeleteTitle} description={t.treasury.confirmDeleteDesc} loading={busy} onConfirm={handleDelete} />
    </TerminalPageShell>
  );
}
