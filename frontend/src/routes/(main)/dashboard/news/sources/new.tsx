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

export const Route = createFileRoute("/(main)/dashboard/news/sources/new")({
  component: NewsSourceCreatePage,
});

function NewsSourceCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("macro");
  const [trustTier, setTrustTier] = useState("tier_1");
  const [isVerified, setIsVerified] = useState(true);
  const [assetTags, setAssetTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string }>("/intelligence/sources", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          category,
          trust_tier: trustTier,
          is_verified: isVerified,
          asset_tags: assetTags.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
        }),
      });
      notify.success(t.common.createdSuccess, name);
      void navigate({ to: "/dashboard/news/sources/$sourceId", params: { sourceId: created.id } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.sources.newTitle}
      actions={
        <Link to="/dashboard/news/sources" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.sources.newTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ns-name">Source Name</Label>
              <Input id="ns-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Reuters Business" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-url">RSS / Atom Feed URL (HTTPS)</Label>
              <Input id="ns-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ns-cat">Category</Label>
                <Input id="ns-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ns-tier">{t.sources.trustTier}</Label>
                <select id="ns-tier" value={trustTier} onChange={(e) => setTrustTier(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs">
                  <option value="tier_1">tier_1</option>
                  <option value="tier_2">tier_2</option>
                  <option value="custom">custom</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-tags">Asset Tags (comma-separated)</Label>
              <Input id="ns-tags" value={assetTags} onChange={(e) => setAssetTags(e.target.value)} placeholder="XAUUSD, USTEC, SPX" />
            </div>
            <div className="flex items-center gap-2">
              <input id="ns-ver" type="checkbox" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} />
              <Label htmlFor="ns-ver">{t.sources.verifiedBadge}</Label>
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
