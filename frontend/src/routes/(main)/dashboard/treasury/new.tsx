import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/treasury/new")({
  component: TreasuryCreatePage,
});

function TreasuryCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mt5_login: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [opKind, setOpKind] = useState("DEPOSIT");
  const [amount, setAmount] = useState("500");
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string; mt5_login: string }>>("/accounts")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setAccounts(list);
        if (list[0]) setAccountId(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string }>("/treasury/operations", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          op_kind: opKind,
          amount: Number(amount),
          comment: comment.trim(),
          notes: notes.trim(),
        }),
      });
      notify.success(t.common.createdSuccess, opKind);
      void navigate({ to: "/dashboard/treasury/$opId", params: { opId: created.id } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.treasury.newTitle}
      actions={
        <Link to="/dashboard/treasury" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.treasury.newTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="t-acc">Account</Label>
              <SearchSelect
                id="t-acc"
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">Select account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} (#{a.mt5_login})</option>
                ))}
              </SearchSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="t-kind">Operation Kind</Label>
                <SearchSelect
                  id="t-kind"
                  value={opKind}
                  onChange={(e) => setOpKind(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="WITHDRAWAL">WITHDRAWAL</option>
                  <option value="INTERNAL_TRANSFER">INTERNAL_TRANSFER</option>
                  <option value="EXNESS_VAULT">EXNESS_VAULT</option>
                  <option value="REBATE">REBATE</option>
                </SearchSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-amt">Amount (signed)</Label>
                <Input id="t-amt" type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-cmt">Comment</Label>
              <Input id="t-cmt" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-notes">Notes</Label>
              <Textarea id="t-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-4" />
              {t.common.create}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
