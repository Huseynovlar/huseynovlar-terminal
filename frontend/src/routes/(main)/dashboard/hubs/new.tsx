import { type FormEvent, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/hubs/new")({
  component: HubCreatePage,
});

function HubCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("metals");
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [newsTags, setNewsTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanCode = code.trim().toUpperCase();
      await apiRequest("/assets", {
        method: "POST",
        body: JSON.stringify({
          code: cleanCode,
          name: name.trim(),
          group,
          category: group,
          broker_symbols: brokerSymbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          news_tags: newsTags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      notify.success(t.common.createdSuccess, cleanCode);
      void navigate({ to: "/dashboard/hubs/$code", params: { code: cleanCode } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.hubs.newTitle}
      actions={
        <Link to="/dashboard/hubs" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.hubs.newTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="h-code">Asset Code</Label>
                <Input id="h-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XAUUSD" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="h-group">Group</Label>
                <select id="h-group" value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs">
                  <option value="metals">Metals</option>
                  <option value="indices">Indices</option>
                  <option value="forex">Forex</option>
                  <option value="crypto">Crypto</option>
                  <option value="equities">Equities</option>
                  <option value="macro">Macro</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="h-name">Display Name</Label>
              <Input id="h-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold Spot vs US Dollar" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="h-syms">Broker Symbols (comma-separated)</Label>
              <Input id="h-syms" value={brokerSymbols} onChange={(e) => setBrokerSymbols(e.target.value)} placeholder="XAUUSD, XAUUSDc, XAUUSDm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="h-tags">News Keywords / Tags (comma-separated)</Label>
              <Input id="h-tags" value={newsTags} onChange={(e) => setNewsTags(e.target.value)} placeholder="gold, bullion, fed, treasury yields" />
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
