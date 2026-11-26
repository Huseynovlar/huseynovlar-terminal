import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { TreasuryOp } from "@/routes/(main)/dashboard/treasury/index";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/treasury/$opId/edit")({
  component: TreasuryEditPage,
});

function TreasuryEditPage() {
  const { opId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [opKind, setOpKind] = useState("DEPOSIT");
  const [amount, setAmount] = useState("0");
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    apiRequest<TreasuryOp>(`/treasury/operations/${encodeURIComponent(opId)}`)
      .then((res) => {
        setOpKind(res.op_kind);
        setAmount(String(res.amount));
        setComment(res.comment || "");
        setNotes(res.notes || "");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [opId, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/treasury/operations/${encodeURIComponent(opId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          op_kind: opKind,
          amount: Number(amount),
          comment: comment.trim(),
          notes: notes.trim(),
        }),
      });
      notify.success(t.common.savedSuccess);
      void navigate({ to: "/dashboard/treasury/$opId", params: { opId } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.treasury.editTitle}
      actions={
        <Link to="/dashboard/treasury/$opId" params={{ opId }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.treasury.editTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="te-kind">Kind</Label>
                <SearchSelect id="te-kind" value={opKind} onChange={(e) => setOpKind(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs">
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="WITHDRAWAL">WITHDRAWAL</option>
                  <option value="INTERNAL_TRANSFER">INTERNAL_TRANSFER</option>
                  <option value="EXNESS_VAULT">EXNESS_VAULT</option>
                  <option value="REBATE">REBATE</option>
                </SearchSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="te-amt">Amount</Label>
                <Input id="te-amt" type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="te-cmt">Comment</Label>
              <Input id="te-cmt" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="te-notes">Notes</Label>
              <Textarea id="te-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-4" />
              {t.common.save}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
