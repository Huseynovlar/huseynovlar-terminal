import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { AssetHubItem } from "@/routes/(main)/dashboard/hubs/index";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/edit")({
  component: HubEditPage,
});

function HubEditPage() {
  const { code } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("macro");
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [newsTags, setNewsTags] = useState("");

  useEffect(() => {
    apiRequest<AssetHubItem>(`/assets/${encodeURIComponent(code)}`)
      .then((res) => {
        setName(res.name);
        setGroup(res.group || "macro");
        setBrokerSymbols((res.broker_symbols ?? []).join(", "));
        setNewsTags((res.news_tags ?? []).join(", "));
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [code, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          group,
          category: group,
          broker_symbols: brokerSymbols.split(",").map((s) => s.trim()).filter(Boolean),
          news_tags: newsTags.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      notify.success(t.common.savedSuccess, code);
      void navigate({ to: "/dashboard/hubs/$code", params: { code } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={`${t.hubs.editTitle}: ${code}`}
      actions={
        <Link to="/dashboard/hubs/$code" params={{ code }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.hubs.editTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="he-name">Name</Label>
              <Input id="he-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="he-grp">Group</Label>
              <select id="he-grp" value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs">
                <option value="metals">Metals</option>
                <option value="indices">Indices</option>
                <option value="forex">Forex</option>
                <option value="crypto">Crypto</option>
                <option value="equities">Equities</option>
                <option value="macro">Macro</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="he-syms">Broker Symbols</Label>
              <Input id="he-syms" value={brokerSymbols} onChange={(e) => setBrokerSymbols(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="he-tags">News Keywords</Label>
              <Input id="he-tags" value={newsTags} onChange={(e) => setNewsTags(e.target.value)} />
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
