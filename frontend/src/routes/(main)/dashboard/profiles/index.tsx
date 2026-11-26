import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Eye, PlugZap, Plus, Trash2, XCircle } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  has_external_secret?: boolean;
  external_gateway_url?: string;
  accounts_count: number;
  created_at: string;
}

export interface ExnessTestResult {
  ok: boolean;
  broker: string;
  scope: string;
  latency_ms?: number;
  http_status?: number | null;
  access_point?: string | null;
  account_id?: string | null;
  account_info?: Record<string, unknown> | null;
  balance?: Record<string, unknown> | null;
  error_code?: string | null;
  error?: string | null;
  hint?: string | null;
}

export function ExnessTestResultBanner({ result }: { result: ExnessTestResult | null }) {
  if (!result) return null;
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        result.ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
        <span className="inline-flex items-center gap-1.5">
          {result.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {result.ok ? "Подключение к Exness API v1 успешно" : "Ошибка подключения к Exness API v1"}
        </span>
        <span className="font-mono text-[11px] opacity-80">
          {result.scope.toUpperCase()}
          {result.latency_ms ? ` • ${result.latency_ms}ms` : ""}
          {result.http_status ? ` • HTTP ${result.http_status}` : ""}
          {result.error_code ? ` • #${result.error_code}` : ""}
        </span>
      </div>
      {result.access_point ? (
        <div className="mt-1.5 font-mono text-[11px] opacity-90">Access Point: {result.access_point}</div>
      ) : null}
      {result.balance ? (
        <div className="mt-1 font-mono text-[11px] opacity-90">
          Balance: {String(result.balance.balance ?? "—")} {String(result.balance.currency ?? "")}
        </div>
      ) : null}
      {result.account_info ? (
        <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-black/15 p-2 font-mono text-[10px]">
          {JSON.stringify(result.account_info, null, 2)}
        </pre>
      ) : null}
      {result.error ? <div className="mt-1.5 font-medium">{result.error}</div> : null}
      {result.hint ? <div className="mt-1 text-[11px] opacity-85">{result.hint}</div> : null}
    </div>
  );
}

function ProfilesListPage() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ExnessProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ExnessTestResult | null>(null);

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [extKey, setExtKey] = useState("");
  const [extSecret, setExtSecret] = useState("");
  const [testScope, setTestScope] = useState("trading");
  const [testAccountId, setTestAccountId] = useState("");
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

  async function handleTestApi() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest<ExnessTestResult>("/profiles/test-exness-api", {
        method: "POST",
        body: JSON.stringify({
          external_gateway_url: gatewayUrl.trim() || null,
          external_api_key: extKey.trim() || null,
          external_api_secret: extSecret.trim() || null,
          account_id: testAccountId.trim() || null,
          scope: testScope,
        }),
      });
      setTestResult(res);
      if (res.ok) {
        notify.success("Exness API v1", `Подключено (${res.latency_ms ?? 0}ms)`);
      } else {
        notify.error("Exness API v1", res.error || "Ошибка проверки");
      }
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          notes: notes.trim(),
          external_gateway_url: gatewayUrl.trim() || null,
          external_api_key: extKey.trim() || null,
          external_api_secret: extSecret.trim() || null,
        }),
      });
      notify.success(t.common.createdSuccess, name);
      setName("");
      setNotes("");
      setGatewayUrl("");
      setExtKey("");
      setExtSecret("");
      setTestAccountId("");
      setTestResult(null);
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
          <CardTitle className="text-sm">{t.common.add} Exness Profile & API v1 (Ed25519)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prof-name">Profile Name</Label>
              <Input
                id="prof-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Personal Exness Main"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-notes">Notes</Label>
              <Input id="prof-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Main desk" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-gw">Exness Gateway URL (из DNS widget)</Label>
              <Input
                id="prof-gw"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="https://api-gateway.exness.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-key">Exness API Key (EXN-API-KEY)</Label>
              <Input
                id="prof-key"
                type="password"
                value={extKey}
                onChange={(e) => setExtKey(e.target.value)}
                placeholder="exnsk-..."
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="prof-sec">Ed25519 Private Key (PEM / base64 / hex — хранится в AES-GCM)</Label>
              <Textarea
                id="prof-sec"
                rows={3}
                className="font-mono text-xs"
                value={extSecret}
                onChange={(e) => setExtSecret(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-scope">Scope для проверки</Label>
              <SearchSelect
                id="prof-scope"
                value={testScope}
                onChange={(e) => setTestScope(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="trading">Trading API (Discovery + Account Info)</option>
                <option value="payments">Payments API (Account Balance)</option>
                <option value="partnership">Partnership API (Default Link)</option>
              </SearchSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prof-acc">Account ID для теста (MT5 логин)</Label>
              <Input
                id="prof-acc"
                value={testAccountId}
                onChange={(e) => setTestAccountId(e.target.value)}
                placeholder="253752700"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 sm:col-span-2">
              <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
                <Plus className="mr-1.5 size-3.5" />
                {t.common.create}
              </AsyncButton>
              <AsyncButton
                type="button"
                variant="outline"
                size="sm"
                loading={testing}
                loadingText="Проверка Ed25519..."
                onClick={() => void handleTestApi()}
              >
                <PlugZap className="mr-1.5 size-3.5" />
                Проверить подключение
              </AsyncButton>
            </div>
            {testResult ? (
              <div className="sm:col-span-2">
                <ExnessTestResultBanner result={testResult} />
              </div>
            ) : null}
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
                  <th className="px-3 py-2">Exness API v1</th>
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
                      <div className="flex flex-col gap-0.5">
                        <Badge variant={p.has_external_api ? "default" : "secondary"} className="w-fit">
                          {p.has_external_api ? t.setup.configured : t.setup.notConfigured}
                        </Badge>
                        {p.external_gateway_url ? (
                          <span className="font-mono text-[10px] text-muted-foreground">{p.external_gateway_url}</span>
                        ) : null}
                      </div>
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
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
