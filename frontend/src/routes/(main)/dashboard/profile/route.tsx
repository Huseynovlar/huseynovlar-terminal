import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import {
  BellRing,
  Fingerprint,
  Globe,
  History,
  KeyRound,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

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

interface SessionRow {
  id: string;
  ip_address: string;
  user_agent: string;
  is_current: boolean;
  created_at: string;
  expires_at: string;
}

interface LoginHistoryRow {
  id: string;
  action: string;
  ip_address: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface PasskeyRow {
  id: string;
  device_name: string;
  sign_count: number;
  created_at: string;
  last_used_at: string | null;
}

interface IpGeoInfo {
  ip: string;
  is_private: boolean;
  is_netbird: boolean;
  country: string;
  country_code: string;
  city: string;
  region: string;
  isp: string;
  lat: number;
  lon: number;
}

function ProfileAndSecurityPage() {
  const [displayName, setDisplayName] = useState("Owner");
  const [bio, setBio] = useState("Exness MT5 Algo Desk — XAUUSD & USTEC");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [telegram, setTelegram] = useState("@huseynovlar");
  const [github, setGithub] = useState("https://github.com/Huseynovlar");
  const [vaultValues, setVaultValues] = useState<Record<string, string>>({});
  const [vaultConfigured, setVaultConfigured] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Security: Active Sessions, Login History, Passkeys & IP Geo Map
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryRow[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [selectedGeo, setSelectedGeo] = useState<IpGeoInfo | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  function loadSecurityData() {
    apiRequest<SessionRow[]>("/auth/sessions")
      .then((rows) => {
        setSessions(rows);
        if (rows.length > 0 && !selectedGeo) {
          lookupIp(rows[0].ip_address);
        }
      })
      .catch(() => {});

    apiRequest<LoginHistoryRow[]>("/auth/login-history")
      .then((rows) => setLoginHistory(rows))
      .catch(() => {});

    apiRequest<PasskeyRow[]>("/auth/webauthn/credentials")
      .then((rows) => setPasskeys(rows))
      .catch(() => {});
  }

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

    loadSecurityData();
  }, []);

  async function lookupIp(ip: string) {
    if (!ip) return;
    setGeoLoading(true);
    try {
      const geo = await apiRequest<IpGeoInfo>(`/auth/ip-lookup/${encodeURIComponent(ip)}`);
      setSelectedGeo(geo);
    } catch {
      setSelectedGeo(null);
    } finally {
      setGeoLoading(false);
    }
  }

  async function revokeSession(sessionId: string) {
    if (!window.confirm("Завершить выбранную сессию? Устройство будет разлогинено немедленно.")) return;
    setNotice(null);
    try {
      await apiRequest(`/auth/sessions/${sessionId}`, { method: "DELETE" });
      setNotice("Сессия успешно завершена и записана в Audit Log.");
      loadSecurityData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка завершения сессии");
    }
  }

  async function deletePasskey(credId: string, deviceName: string) {
    const totp = window.prompt(
      `Удаление WebAuthn-ключа «${deviceName}».\nЕсли у вас включён 2FA, введите текущий 6-значный код TOTP (или оставьте пустым, если 2FA выключен):`,
    );
    if (totp === null) return;
    setNotice(null);
    try {
      const qs = totp.trim() ? `?totp_code=${encodeURIComponent(totp.trim())}` : "";
      await apiRequest(`/auth/webauthn/credentials/${credId}${qs}`, { method: "DELETE" });
      setNotice(`Passkey «${deviceName}» удалён.`);
      loadSecurityData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ошибка удаления Passkey (проверьте 2FA код)");
    }
  }

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
      loadSecurityData();
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

  const osmUrl =
    selectedGeo && (selectedGeo.lat !== 0 || selectedGeo.lon !== 0)
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${selectedGeo.lon - 0.12}%2C${selectedGeo.lat - 0.08}%2C${selectedGeo.lon + 0.12}%2C${selectedGeo.lat + 0.08}&layer=mapnik&marker=${selectedGeo.lat}%2C${selectedGeo.lon}`
      : null;

  return (
    <TerminalPageShell
      title="Профиль, Безопасность (FIDO2), Сессии и Secret Vault"
      subtitle="Управление активными сессиями, интерактивная карта геолокации IP, Passkeys (WebAuthn + 2FA), история входов и зашифрованное хранилище."
      badge="ZERO-TRUST"
      actions={
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={sendTestAlert}>
          <BellRing className="size-3.5 text-emerald-500" />
          Test Telegram Alert
        </Button>
      }
    >
      {notice ? <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{notice}</div> : null}

      {/* Active Sessions + Interactive IP Geolocation Map */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <MonitorSmartphone className="size-4 text-emerald-500" />
                Активные сессии ({sessions.length})
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                ТЕКУЩАЯ ЗАЩИЩЕНА
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {sessions.length === 0 ? (
              <div className="text-muted-foreground py-4 text-center">Нет активных сессий или требуется вход.</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="font-semibold">{s.ip_address || "unknown"}</span>
                      {s.is_current ? (
                        <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                          ТЕКУЩАЯ
                        </Badge>
                      ) : null}
                      {s.ip_address?.startsWith("100.104.") ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] text-emerald-500">
                          NetBird VPN
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground truncate text-[11px]">{s.user_agent || "Browser"}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">
                      Вход: {s.created_at.replace("T", " ").slice(0, 19)} UTC
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => lookupIp(s.ip_address)}
                    >
                      <MapPin className="size-3 text-blue-500" />
                      Карта
                    </Button>
                    {!s.is_current ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() => revokeSession(s.id)}
                      >
                        <LogOut className="size-3" />
                        Завершить
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Interactive IP Geolocation Map */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-blue-500" />
              Карта геолокации IP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            {geoLoading ? (
              <div className="text-muted-foreground py-8 text-center">Определение координат IP...</div>
            ) : selectedGeo ? (
              <>
                <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{selectedGeo.ip}</span>
                    <Badge variant={selectedGeo.is_netbird ? "default" : "outline"} className="text-[10px]">
                      {selectedGeo.country_code || "GEO"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    {selectedGeo.country} • {selectedGeo.city}
                  </div>
                  <div className="text-muted-foreground text-[10px]">
                    ISP: {selectedGeo.isp || "—"} • ({selectedGeo.lat.toFixed(4)}, {selectedGeo.lon.toFixed(4)})
                  </div>
                </div>
                {osmUrl ? (
                  <div className="overflow-hidden rounded-lg border border-border/60">
                    <iframe
                      title={`IP Map ${selectedGeo.ip}`}
                      src={osmUrl}
                      className="h-48 w-full border-0"
                      loading="lazy"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-muted-foreground py-8 text-center">
                Нажмите «Карта» на любой сессии или записи из истории входов.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* WebAuthn Passkeys (with 2FA delete) + Login History */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Fingerprint className="size-4 text-emerald-500" />
              WebAuthn / Passkeys ({passkeys.length})
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={registerPasskey}>
              <Fingerprint className="size-3.5 text-emerald-500" />
              Добавить ключ
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {passkeys.length === 0 ? (
              <div className="text-muted-foreground py-3">
                Ключи Passkey ещё не добавлены. Привяжите Touch ID / Face ID / YubiKey.
              </div>
            ) : (
              passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-2.5"
                >
                  <div>
                    <div className="font-medium">{pk.device_name}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">
                      Использований: {pk.sign_count} • Добавлен: {pk.created_at.slice(0, 10)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-rose-500 hover:text-rose-600"
                    onClick={() => deletePasskey(pk.id, pk.device_name)}
                  >
                    <Trash2 className="size-3.5" />
                    Удалить (2FA)
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-4 text-amber-500" />
              История входов и событий безопасности (UTC)
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-60 overflow-auto text-xs">
            {loginHistory.length === 0 ? (
              <div className="text-muted-foreground py-3">События безопасности появятся после входа.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {loginHistory.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 py-2 font-mono text-[11px]">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={h.action.includes("failed") ? "destructive" : "secondary"}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {h.action}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => lookupIp(h.ip_address)}
                        className="text-blue-400 underline-offset-2 hover:underline"
                      >
                        {h.ip_address || "—"}
                      </button>
                    </div>
                    <span className="text-muted-foreground">{h.created_at.replace("T", " ").slice(0, 19)} UTC</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Profile & Secret Vault */}
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
