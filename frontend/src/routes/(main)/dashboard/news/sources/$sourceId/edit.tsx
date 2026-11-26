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
import type { NewsSourceItem } from "@/routes/(main)/dashboard/news/sources/index";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/news/sources/$sourceId/edit")({
  component: NewsSourceEditPage,
});

function NewsSourceEditPage() {
  const { sourceId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("macro");
  const [trustTier, setTrustTier] = useState("tier_1");
  const [isVerified, setIsVerified] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    apiRequest<NewsSourceItem>(`/intelligence/sources/${encodeURIComponent(sourceId)}`)
      .then((res) => {
        setName(res.name);
        setUrl(res.url);
        setCategory(res.category);
        setTrustTier(res.trust_tier);
        setIsVerified(res.is_verified);
        setIsEnabled(res.is_enabled);
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sourceId, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/intelligence/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          category,
          trust_tier: trustTier,
          is_verified: isVerified,
          is_enabled: isEnabled,
        }),
      });
      notify.success(t.common.savedSuccess, name);
      void navigate({ to: "/dashboard/news/sources/$sourceId", params: { sourceId } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.sources.editTitle}
      actions={
        <Link to="/dashboard/news/sources/$sourceId" params={{ sourceId }} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t.sources.editTitle}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="nse-name">Name</Label>
              <Input id="nse-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nse-url">Feed URL</Label>
              <Input id="nse-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="nse-cat">Category</Label>
                <Input id="nse-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nse-tier">{t.sources.trustTier}</Label>
                <SearchSelect id="nse-tier" value={trustTier} onChange={(e) => setTrustTier(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs">
                  <option value="tier_1">tier_1</option>
                  <option value="tier_2">tier_2</option>
                  <option value="custom">custom</option>
                </SearchSelect>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} />{t.sources.verifiedBadge}</label>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />{t.common.enabled}</label>
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
