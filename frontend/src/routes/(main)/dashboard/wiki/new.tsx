import { type FormEvent, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/wiki/new")({
  component: WikiCreatePage,
});

function WikiCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("playbook");
  const [isPinned, setIsPinned] = useState(false);
  const [contentMd, setContentMd] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await apiRequest<{ slug: string }>("/wiki", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim() || undefined,
          category: category.trim() || "playbook",
          is_pinned: isPinned,
          content_md: contentMd,
        }),
      });
      notify.success(t.common.createdSuccess, title.trim());
      await navigate({ to: "/dashboard/wiki/$slug", params: { slug: created.slug } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.wiki.newTitle}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
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
                <Label htmlFor="wiki-slug">{t.wiki.slug}</Label>
                <Input
                  id="wiki-slug"
                  placeholder="mt5-dual-ea-runbook"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wiki-category">{t.wiki.category}</Label>
                <Input id="wiki-category" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox id="wiki-pinned" checked={isPinned} onCheckedChange={(v) => setIsPinned(Boolean(v))} />
                <Label htmlFor="wiki-pinned">{t.wiki.pinned}</Label>
              </div>
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
              <Button type="button" variant="outline" nativeButton={false} render={<Link to="/dashboard/wiki" />}>
                {t.common.cancel}
              </Button>
              <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-4" />
                {t.common.create}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
