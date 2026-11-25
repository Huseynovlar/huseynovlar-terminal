import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import type { JournalDeal } from "@/routes/(main)/dashboard/journal/index";

export const Route = createFileRoute("/(main)/dashboard/journal/deals/$dealId/")({
  component: DealDetailPage,
});

function DealDetailPage() {
  const { dealId } = Route.useParams();
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [deal, setDeal] = useState<JournalDeal | null>(null);
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<JournalDeal>(`/journal/deals/${encodeURIComponent(dealId)}`)
      .then((res) => {
        setDeal(res);
        setNotes(res.notes || "");
        setTagsInput(Array.isArray(res.tags) ? res.tags.join(", ") : "");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [dealId, t.common.errorTitle]);

  async function handleSaveNotes(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await apiRequest<JournalDeal>(`/journal/deals/${encodeURIComponent(dealId)}`, {
        method: "PATCH",
        body: JSON.stringify({ notes, tags }),
      });
      setDeal(updated);
      notify.success(t.common.savedSuccess);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!deal) {
    return (
      <TerminalPageShell title={t.journal.dealDetailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={`${t.journal.dealDetailTitle} #${deal.mt5_deal_ticket}`}
      subtitle={`${deal.account_name} • ${deal.robot_name}`}
      badge={`${deal.symbol} ${deal.side}`}
      actions={
        <Link
          to="/dashboard/journal"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Symbol</div><div className="mt-1 flex items-center gap-1.5 font-mono text-base font-bold"><AssetLogo symbol={deal.symbol} size={20} />{deal.symbol}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Volume / Price</div><div className="mt-1 font-mono text-base font-bold">{deal.volume.toFixed(2)} @ {deal.price.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Commission / Swap</div><div className="mt-1 font-mono text-sm font-semibold">{formatSignedUsd(deal.commission_usd, privacyMode)} / {formatSignedUsd(deal.swap_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Net PnL (USD)</div><div className={`mt-1 font-mono text-lg font-bold ${deal.net_profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{formatSignedUsd(deal.net_profit_usd, privacyMode)}</div></CardContent></Card>
      </div>

      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>{t.journal.notes}</span>
            <Badge variant="outline" className="font-mono text-[10px]">Position #{deal.position_id}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSaveNotes(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="deal-tags">{t.journal.tags}</Label>
              <Input id="deal-tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="breakout, ny-session, disciplined" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deal-notes">{t.journal.notes}</Label>
              <Textarea id="deal-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-3.5" />
              {t.journal.saveNotes}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
