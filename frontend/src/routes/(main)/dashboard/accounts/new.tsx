import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/accounts/new")({
  component: AccountCreatePage,
});

const BROKER_PRESETS: Record<string, { server: string; platform: string }> = {
  EXNESS_REAL: { server: "Exness-MT5Real", platform: "MT5" },
  EXNESS_TRIAL: { server: "Exness-MT5Trial", platform: "MT5" },
  EXNESS_API: { server: "https://api.exness.com", platform: "EXNESS_API" },
  BINANCE: { server: "https://api.binance.com", platform: "BINANCE" },
};

const KNOWN_DEFAULT_SERVERS = new Set([
  "",
  ...Object.values(BROKER_PRESETS).map((p) => p.server),
]);

function AccountCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [brokerPreset, setBrokerPreset] = useState("EXNESS_REAL");
  const [name, setName] = useState("");
  const [mt5Login, setMt5Login] = useState("");
  const [mt5Server, setMt5Server] = useState("Exness-MT5Real");
  const [serverTouched, setServerTouched] = useState(false);
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

  // Safe Autofill (fix #34): only autofill server/demo when not manually edited; NEVER overwrite Login ID / Name / Keys!
  function handlePresetChange(nextPreset: string) {
    setBrokerPreset(nextPreset);
    const preset = BROKER_PRESETS[nextPreset];
    if (!preset) return;
    if (!serverTouched || KNOWN_DEFAULT_SERVERS.has(mt5Server.trim())) {
      setMt5Server(preset.server);
    }
    if (nextPreset === "EXNESS_TRIAL") {
      setIsDemo(true);
    } else if (nextPreset === "EXNESS_REAL") {
      setIsDemo(false);
    }
  }

  function handleAccountTypeChange(nextType: string) {
    setAccountType(nextType);
    if (nextType === "STANDARD_CENT" && currency === "USD") {
      setCurrency("USC");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const preset = BROKER_PRESETS[brokerPreset];
      const created = await apiRequest<{ id: string; api_key?: string }>("/accounts", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          platform: preset?.platform ?? "MT5",
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
      subtitle="Подключение MT5 Bridge / Exness API с безопасным автозаполнением шлюза"
      actions={
        <Link
          to="/dashboard/accounts"
          className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <div className="max-w-2xl rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="acc-broker" className="text-[11px] text-[var(--text-secondary)]">
              Брокер / Провайдер (безопасное автозаполнение сервера)
            </Label>
            <SearchSelect
              id="acc-broker"
              value={brokerPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs"
            >
              <option value="EXNESS_REAL">Exness MT5 Real (Exness-MT5Real*)</option>
              <option value="EXNESS_TRIAL">Exness MT5 Demo (Exness-MT5Trial*)</option>
              <option value="EXNESS_API">Exness Trader API (https://api.exness.com)</option>
              <option value="BINANCE">Binance API (https://api.binance.com)</option>
            </SearchSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-name" className="text-[11px] text-[var(--text-secondary)]">
              Название счёта
            </Label>
            <Input
              id="acc-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Exness XAU Cent"
              className="h-9 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-login" className="text-[11px] text-[var(--text-secondary)]">
              MT5 Login / Account ID
            </Label>
            <Input
              id="acc-login"
              required
              value={mt5Login}
              onChange={(e) => setMt5Login(e.target.value)}
              placeholder="16000770596"
              className="h-9 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-server" className="text-[11px] text-[var(--text-secondary)]">
              Торговый сервер / Gateway URL
            </Label>
            <Input
              id="acc-server"
              required
              value={mt5Server}
              onChange={(e) => {
                setServerTouched(true);
                setMt5Server(e.target.value);
              }}
              className="h-9 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-type" className="text-[11px] text-[var(--text-secondary)]">
              Тип счёта
            </Label>
            <SearchSelect
              id="acc-type"
              value={accountType}
              onChange={(e) => handleAccountTypeChange(e.target.value)}
              className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs"
            >
              <option value="PRO">PRO</option>
              <option value="RAW">RAW Spread</option>
              <option value="ZERO">ZERO</option>
              <option value="STANDARD">STANDARD</option>
              <option value="STANDARD_CENT">STANDARD CENT (USC ÷100)</option>
            </SearchSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-curr" className="text-[11px] text-[var(--text-secondary)]">
              Валюта счёта
            </Label>
            <SearchSelect
              id="acc-curr"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs"
            >
              <option value="USD">USD</option>
              <option value="USC">USC (Cent ÷100 → USD)</option>
              <option value="EUR">EUR</option>
            </SearchSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-lev" className="text-[11px] text-[var(--text-secondary)]">
              Плечо (0 = Unlimited)
            </Label>
            <Input
              id="acc-lev"
              type="number"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="h-9 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc-prof" className="text-[11px] text-[var(--text-secondary)]">
              Профиль брокера (Exness Gateway)
            </Label>
            <SearchSelect
              id="acc-prof"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs"
            >
              <option value="">— Авто (Exness Main)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SearchSelect>
          </div>

          <div className="flex items-center gap-2 pt-5">
            <input
              id="acc-demo"
              type="checkbox"
              checked={isDemo}
              onChange={(e) => setIsDemo(e.target.checked)}
            />
            <Label htmlFor="acc-demo" className="text-xs">
              Демо-счёт (DEMO)
            </Label>
          </div>

          <div className="pt-2 sm:col-span-2">
            <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-4" />
              {t.common.create}
            </AsyncButton>
          </div>
        </form>
      </div>
    </TerminalPageShell>
  );
}
