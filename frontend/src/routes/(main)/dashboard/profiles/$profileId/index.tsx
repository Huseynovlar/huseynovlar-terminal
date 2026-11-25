import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { ExnessProfileItem } from "@/routes/(main)/dashboard/profiles/index";

export const Route = createFileRoute("/(main)/dashboard/profiles/$profileId/")({
  component: ProfileDetailPage,
});

function ProfileDetailPage() {
  const { profileId } = Route.useParams();
  const { t } = useI18n();
  const [profile, setProfile] = useState<(ExnessProfileItem & { accounts?: Array<{ id: string; name: string; mt5_login: string }> }) | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<ExnessProfileItem & { accounts?: Array<{ id: string; name: string; mt5_login: string }> }>(
      `/profiles/${encodeURIComponent(profileId)}`,
    )
      .then((res) => {
        setProfile(res);
        setName(res.name);
        setNotes(res.notes || "");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [profileId, t.common.errorTitle]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), notes: notes.trim() }),
      });
      notify.success(t.common.savedSuccess, name);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!profile) {
    return (
      <TerminalPageShell title={t.accounts.profilesBtn}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={profile.name}
      badge={profile.has_external_api ? "API Configured" : "Standard"}
      actions={
        <Link
          to="/dashboard/profiles"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.common.edit}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-notes">Notes</Label>
              <Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-3.5" />
              {t.common.save}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>

      {profile.accounts && profile.accounts.length > 0 ? (
        <Card className="max-w-xl border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Linked MT5 Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {profile.accounts.map((a) => (
              <Link
                key={a.id}
                to="/dashboard/accounts/$accountId"
                params={{ accountId: a.id }}
                className="flex items-center justify-between rounded border border-border/60 px-2.5 py-1.5 hover:border-primary/50"
              >
                <span>{a.name}</span>
                <Badge variant="outline" className="font-mono">#{a.mt5_login}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </TerminalPageShell>
  );
}
