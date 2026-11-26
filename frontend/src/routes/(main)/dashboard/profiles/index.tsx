import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Eye, Plus, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/profiles/")({
  component: ProfilesListPage,
});

export interface ExnessProfileItem {
  id: string;
  name: string;
  notes: string;
  has_external_api: boolean;
  accounts_count: number;
  created_at: string;
}

function ProfilesListPage() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ExnessProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [extKey, setExtKey] = useState("");
  const [extSecret, setExtSecret] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExnessProfileItem | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<ExnessProfileItem[]>("/profiles");
      setProfiles(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          notes: notes.trim(),
          external_api_key: extKey.trim() || null,
          external_api_secret: extSecret.trim() || null,
        }),
      });
      notify.success(t.common.createdSuccess, name);
      setName("");
      setNotes("");
      setExtKey("");
      setExtSecret("");
      await loadProfiles();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/profiles/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadProfiles();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.accounts.profilesBtn}
      subtitle={t.accounts.keyExplainBody}
      actions={
        <Link
          to="/dashboard/accounts"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.nav.accounts}
        </Link>
      }
    >
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.common.add} Exness Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prof-name">Profile Name</Label>
              <Input id="prof-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal Exness Main" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-notes">Notes</Label>
              <Input id="prof-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-key">Optional Exness Personal Area API Key</Label>
              <Input id="prof-key" type="password" value={extKey} onChange={(e) => setExtKey(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-sec">Optional Exness API Secret</Label>
              <Input id="prof-sec" type="password" value={extSecret} onChange={(e) => setExtSecret(e.target.value)} placeholder="Optional" />
            </div>
            <div className="sm:col-span-2">
              <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
                <Plus className="mr-1.5 size-3.5" />
                {t.common.create}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Profile</th>
                  <th className="px-3 py-2">Exness API</th>
                  <th className="px-3 py-2">Linked Accounts</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-border/40">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <Link
                        to="/dashboard/profiles/$profileId"
                        params={{ profileId: p.id }}
                        title={String(p.id)}
                        className="text-primary hover:underline"
                      >
                        {String(p.id).slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link to="/dashboard/profiles/$profileId" params={{ profileId: p.id }} className="hover:underline">
                        {p.name}
                      </Link>
                      {p.notes ? <div className="text-[11px] text-muted-foreground">{p.notes}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={p.has_external_api ? "default" : "secondary"}>
                        {p.has_external_api ? t.setup.configured : t.setup.notConfigured}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono">{p.accounts_count}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Link
                          to="/dashboard/profiles/$profileId"
                          params={{ profileId: p.id }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                        >
                          <Eye className="size-3.5" />
                        </Link>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDeleteTarget(p)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.common.delete}
        description={deleteTarget?.name ?? ""}
        loading={saving}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
