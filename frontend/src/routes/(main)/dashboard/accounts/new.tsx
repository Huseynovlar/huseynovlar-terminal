import { type FormEvent, useEffect, useState } from "react";

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
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/accounts/new")({
  component: AccountCreatePage,
});

function AccountCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState("");
  const [mt5Login, setMt5Login] = useState("");
  const [mt5Server, setMt5Server] = useState("Exness-MT5Real");
  const [accountType, setAccountType] = useState("PRO");
  const [currency, setCurrency] = useState("USD");
  const [leverage, setLeverage] = useState("2000");
  const [profileId, setProfileId] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string }>>("/profiles")
      .then((rows) => setProfiles(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string; api_key?: string }>("/accounts", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          mt5_login: mt5Login.trim(),
          mt5_server: mt5Server.trim(),
          account_type: accountType,
          currency,
          leverage: Number(leverage) || 2000,
          profile_id: profileId || null,
          is_demo: isDemo,
        }),
      });
      notify.success(t.common.createdSuccess, name);
      void navigate({ to: "/dashboard/accounts/$accountId", params: { accountId: created.id } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.accounts.newTitle}
      subtitle={t.accounts.keyExplainTitle}
      actions={
        <Link
          to="/dashboard/accounts"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.accounts.newTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="acc-name">Account Name</Label>
              <Input id="acc-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Exness XAU Pro" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-login">MT5 Login</Label>
              <Input id="acc-login" required value={mt5Login} onChange={(e) => setMt5Login(e.target.value)} placeholder="253752700" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-server">MT5 Server</Label>
              <Input id="acc-server" required value={mt5Server} onChange={(e) => setMt5Server(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-type">Account Type</Label>
              <SearchSelect
                id="acc-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="PRO">PRO</option>
                <option value="RAW">RAW Spread</option>
                <option value="ZERO">ZERO</option>
                <option value="STANDARD">STANDARD</option>
                <option value="STANDARD_CENT">STANDARD CENT</option>
              </SearchSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-curr">Currency</Label>
              <SearchSelect
                id="acc-curr"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="USD">USD</option>
                <option value="USC">USC (Cent ÷100)</option>
                <option value="EUR">EUR</option>
              </SearchSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-lev">Leverage</Label>
              <Input id="acc-lev" type="number" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-prof">Exness Profile (optional)</Label>
              <SearchSelect
                id="acc-prof"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">—</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </SearchSelect>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input id="acc-demo" type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} />
              <Label htmlFor="acc-demo">Demo Account</Label>
            </div>
            <div className="sm:col-span-2 pt-2">
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
