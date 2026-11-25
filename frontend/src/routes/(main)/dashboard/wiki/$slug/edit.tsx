import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/wiki/$slug/edit")({
  component: WikiEditPage,
});

function WikiEditPage() {
  const { slug } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("playbook");
  const [isPinned, setIsPinned] = useState(false);
  const [contentMd, setContentMd] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ title: string; category: string; is_pinned: boolean; content_md: string }>(
      `/wiki/${encodeURIComponent(slug)}`,
    )
      .then((res) => {
        setTitle(res.title || "");
        setCategory(res.category || "playbook");
        setIsPinned(Boolean(res.is_pinned));
        setContentMd(res.content_md || "");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [slug, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/wiki/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          category: category.trim() || "playbook",
          is_pinned: isPinned,
          content_md: contentMd,
        }),
      });
      notify.success(t.common.savedSuccess);
      await navigate({ to: "/dashboard/wiki/$slug", params: { slug } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.wiki.editTitle}
      subtitle={slug}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki/$slug" params={{ slug }} />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Button>
      }
    >
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wiki-title">{t.wiki.pageTitle}</Label>
                <Input id="wiki-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiki-category">{t.wiki.category}</Label>
                <Input id="wiki-category" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="wiki-pinned" checked={isPinned} onCheckedChange={(v) => setIsPinned(Boolean(v))} />
              <Label htmlFor="wiki-pinned">{t.wiki.pinned}</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiki-md">{t.wiki.contentMd}</Label>
              <Textarea
                id="wiki-md"
                rows={12}
                className="font-mono text-xs"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/dashboard/wiki/$slug" params={{ slug }} />}
              >
                {t.common.cancel}
              </Button>
              <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-4" />
                {t.common.save}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
