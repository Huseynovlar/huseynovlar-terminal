import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Fingerprint, KeyRound, Save, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/profile")({
  component: ProfileAndSecurityPage,
});

const VAULT_FIELDS = [
  { key: "google_ai_api_key", label: "Google AI (Gemini) API Key" },
  { key: "alerts_bot_webhook_url", label: "huseynovlar-alerts-bot Webhook URL (/internal/webhooks/trading)" },
  { key: "alerts_bot_webhook_secret", label: "huseynovlar-alerts-bot Webhook Secret" },
  { key: "telegram_bot_token", label: "Отдельный Trading Telegram Bot Token (опционально)" },
  { key: "telegram_chat_id", label: "Telegram Chat ID (опционально)" },
];

function ProfileAndSecurityPage() {
  const [displayName, setDisplayName] = useState("Owner");
  const [bio, setBio] = useState("Exness MT5 Algo Desk — XAUUSD & USTEC");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [telegram, setTelegram] = useState("@huseynovlar");
  const [github, setGithub] = useState("https://github.com/Huseynovlar");
  const [vaultValues, setVaultValues] = useState<Record<string, string>>({});
  const [vaultConfigured, setVaultConfigured] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{
      display_name: string;
      bio: string;
      avatar_url: string;
      social_links: Record<string, string>;
    }>("/profile/me")
      .then((p) => {
        setDisplayName(p.display_name || "Owner");
        setBio(p.bio || "");
        setAvatarUrl(p.avatar_url || "");
        setTelegram(p.social_links?.telegram || "");
        setGithub(p.social_links?.github || "");
      })
      .catch(() => {});

    apiRequest<{ key: string; configured: boolean }[]>("/profile/vault")
      .then((rows) => {
        const map: Record<string, boolean> = {};
        for (const r of rows) map[r.key] = r.configured;
        setVaultConfigured(map);
      })
      .catch(() => {});
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      await apiRequest("/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName,
          bio,
          avatar_url: avatarUrl,
          social_links: { telegram, github },
        }),
      });
      setNotice("Профиль успешно сохранён.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка сохранения профиля");
    }
  }

  async function saveVaultKey(key: string) {
    const val = vaultValues[key]?.trim();
    if (!val) return;
    setNotice(null);
    try {
      await apiRequest(`/profile/vault/${key}`, { method: "PUT", body: JSON.stringify({ value: val }) });
      setVaultConfigured((prev) => ({ ...prev, [key]: true }));
      setVaultValues((prev) => ({ ...prev, [key]: "" }));
      setNotice(`Ключ ${key} зашифрован (AES-256-GCM) и сохранён.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка сохранения ключа");
    }
  }

  async function registerPasskey() {
    setNotice(null);
    if (!window.PublicKeyCredential) {
      setNotice("Браузер не поддерживает FIDO2 / WebAuthn Passkeys.");
      return;
    }
    try {
      const options = await apiRequest<PublicKeyCredentialCreationOptions>("/auth/webauthn/register/options", {
        method: "POST",
      });
      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) throw new Error("Регистрация Passkey отменена");
      await apiRequest("/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({ device_name: navigator.platform || "My Device", credential: cred }),
      });
      setNotice("Passkey (FIDO2/WebAuthn) успешно зарегистрирован!");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка регистрации Passkey");
    }
  }

  async function sendTestAlert() {
    setNotice(null);
    try {
      const res = await apiRequest<{ delivered: string[]; errors: string[] }>("/ops/alerts/test", {
        method: "POST",
        body: JSON.stringify({ title: "Huseynovlar Terminal", message: "Тест связи Telegram / Webhook успешен!" }),
      });
      setNotice(
        res.delivered.length > 0
          ? `Отправлено в: ${res.delivered.join(", ")}`
          : `Не настроены каналы или ошибка: ${res.errors.join("; ") || "добавьте ключи ниже"}`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка отправки теста");
    }
  }

  return (
    <TerminalPageShell
      title="Профиль, Безопасность (FIDO2) и Secret Vault"
      subtitle="Личные данные, аватар, соцсети, Passkeys (Face ID / Touch ID / YubiKey) и зашифрованное хранилище API-ключей."
      badge="AES-256-GCM"
      actions={
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={sendTestAlert}>
          <BellRing className="size-3.5 text-emerald-500" />
          Test Telegram Alert
        </Button>
      }
    >
      {notice ? <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{notice}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserRound className="size-4" />
              Личный профиль и соцсети
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="space-y-3 text-xs">
              <div className="space-y-1">
                <Label>Отображаемое имя</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>О себе / Био</Label>
                <Input value={bio} onChange={(e) => setBio(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>URL аватара</Label>
                <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Telegram</Label>
                  <Input value={telegram} onChange={(e) => setTelegram(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>GitHub / TradingView</Label>
                  <Input value={github} onChange={(e) => setGithub(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" className="gap-1.5">
                  <Save className="size-3.5" />
                  Сохранить профиль
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={registerPasskey}>
                  <Fingerprint className="size-3.5 text-emerald-500" />
                  Добавить Passkey (FIDO2)
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-amber-500" />
              Secret Vault (Google AI, Telegram, Alerts Webhook)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {VAULT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>{f.label}</Label>
                  <Badge variant={vaultConfigured[f.key] ? "default" : "secondary"} className="text-[10px]">
                    {vaultConfigured[f.key] ? "ЗАШИФРОВАН" : "НЕ ЗАДАН"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Введите новое значение..."
                    value={vaultValues[f.key] || ""}
                    onChange={(e) => setVaultValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="font-mono text-xs"
                  />
                  <Button size="sm" variant="secondary" onClick={() => saveVaultKey(f.key)}>
                    <ShieldCheck className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
