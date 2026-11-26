import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, PlugZap, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import {
  type ExnessProfileItem,
  type ExnessTestResult,
  ExnessTestResultBanner,
} from "@/routes/(main)/dashboard/profiles/index";

export const Route = createFileRoute("/(main)/dashboard/profiles/$profileId/")({
  component: ProfileDetailPage,
});

function ProfileDetailPage() {
  const { profileId } = Route.useParams();
  const { t } = useI18n();
  const [profile, setProfile] = useState<
    (ExnessProfileItem & { accounts?: Array<{ id: string; name: string; mt5_login: string }> }) | null
  >(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [extKey, setExtKey] = useState("");
  const [extSecret, setExtSecret] = useState("");
  const [testScope, setTestScope] = useState("trading");
  const [testAccountId, setTestAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ExnessTestResult | null>(null);

  useEffect(() => {
    apiRequest<ExnessProfileItem & { accounts?: Array<{ id: string; name: string; mt5_login: string }> }>(
      `/profiles/${encodeURIComponent(profileId)}`,
    )
      .then((res) => {
        setProfile(res);
        setName(res.name);
        setNotes(res.notes || "");
        setGatewayUrl(res.external_gateway_url || "");
        if (res.accounts && res.accounts.length > 0) {
          setTestAccountId(res.accounts[0].mt5_login);
        }
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [profileId, t.common.errorTitle]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        notes: notes.trim(),
        external_gateway_url: gatewayUrl.trim(),
      };
      if (extKey.trim()) payload.external_api_key = extKey.trim();
      if (extSecret.trim()) payload.external_api_secret = extSecret.trim();

      const updated = await apiRequest<ExnessProfileItem>(`/profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setProfile((prev) => (prev ? { ...prev, ...updated } : prev));
      setExtKey("");
      setExtSecret("");
      notify.success(t.common.savedSuccess, name);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest<ExnessTestResult>(
        `/profiles/${encodeURIComponent(profileId)}/test-exness-api`,
        {
          method: "POST",
          body: JSON.stringify({
            external_gateway_url: gatewayUrl.trim() || null,
            external_api_key: extKey.trim() || null,
            external_api_secret: extSecret.trim() || null,
            account_id: testAccountId.trim() || null,
            scope: testScope,
          }),
        },
      );
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
      subtitle={`ID: ${profile.id}`}
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
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.common.edit} & Exness API v1 (Ed25519)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSave(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-notes">Notes</Label>
              <Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-gw">Exness Gateway URL</Label>
              <Input
                id="p-gw"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="https://api-gateway.exness.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-key">
                Exness API Key {profile.has_external_api ? "(оставьте пустым, чтобы не менять)" : ""}
              </Label>
              <Input
                id="p-key"
                type="password"
                value={extKey}
                onChange={(e) => setExtKey(e.target.value)}
                placeholder={profile.has_external_api ? "•••••••• (сохранён)" : "exnsk-..."}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="p-sec">
                Ed25519 Private Key {profile.has_external_secret ? "(оставьте пустым, чтобы не менять)" : ""}
              </Label>
              <Textarea
                id="p-sec"
                rows={3}
                className="font-mono text-xs"
                value={extSecret}
                onChange={(e) => setExtSecret(e.target.value)}
                placeholder={
                  profile.has_external_secret
                    ? "•••••••• (зашифрован в AES-GCM)"
                    : "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-scope">Scope для проверки</Label>
              <SearchSelect
                id="p-scope"
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
              <Label htmlFor="p-acc">Account ID для теста</Label>
              <Input
                id="p-acc"
                value={testAccountId}
                onChange={(e) => setTestAccountId(e.target.value)}
                placeholder="253752700"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 sm:col-span-2">
              <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-3.5" />
                {t.common.save}
              </AsyncButton>
              <AsyncButton
                type="button"
                variant="outline"
                size="sm"
                loading={testing}
                loadingText="Проверка Ed25519..."
                onClick={() => void handleTestConnection()}
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

      {profile.accounts && profile.accounts.length > 0 ? (
        <Card className="max-w-2xl border-border/70">
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
                <Badge variant="outline" className="font-mono">
                  #{a.mt5_login}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </TerminalPageShell>
  );
}
