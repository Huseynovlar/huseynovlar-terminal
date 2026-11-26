import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { Copy, Fingerprint, KeyRound, QrCode, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PromptDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { prepareCreationOptions, serializeCredential } from "@/framework/webauthn";

export const Route = createFileRoute("/(main)/dashboard/security/")({
  component: SecurityPage,
});

interface PasskeyItem {
  id: string;
  device_name: string;
  sign_count?: number;
  transports?: string[];
  created_at?: string;
  last_used_at?: string | null;
}

interface TotpSetupState {
  secret: string;
  provisioning_uri: string;
  qr_svg: string;
}

function SecurityPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pwSaving, setPwSaving] = useState(false);

  // 2FA TOTP
  const [totpSetup, setTotpSetup] = useState<TotpSetupState | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);

  // Passkeys
  const [deviceName, setDeviceName] = useState("");
  const [pkBusy, setPkBusy] = useState(false);
  const [deletePkTarget, setDeletePkTarget] = useState<PasskeyItem | null>(null);
  const [deletePkLoading, setDeletePkLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [me, creds] = await Promise.all([
        apiRequest<{ totp_enabled?: boolean }>("/profile/me"),
        apiRequest<PasskeyItem[]>("/auth/webauthn/credentials").catch(() => [] as PasskeyItem[]),
      ]);
      setTotpEnabled(Boolean(me.totp_enabled));
      setPasskeys(Array.isArray(creds) ? creds : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      notify.error(t.common.errorTitle, t.security.passwordMismatch);
      return;
    }
    setPwSaving(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          revoke_other_sessions: revokeOthers,
        }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify.success(t.common.savedSuccess);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setPwSaving(false);
    }
  }

  async function handleStart2fa() {
    setTotpBusy(true);
    try {
      const res = await apiRequest<TotpSetupState>("/auth/2fa/setup", { method: "POST" });
      setTotpSetup(res);
      setBackupCodes([]);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleVerify2fa(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    try {
      const res = await apiRequest<{ ok: boolean; totp_enabled: boolean; backup_codes?: string[] }>("/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ code: totpVerifyCode.trim() }),
      });
      setTotpEnabled(Boolean(res.totp_enabled));
      setBackupCodes(res.backup_codes ?? []);
      setTotpSetup(null);
      setTotpVerifyCode("");
      notify.success(t.security.totpEnabled);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleDisable2fa(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    try {
      await apiRequest("/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password: disablePw, code: disableCode.trim() }),
      });
      setTotpEnabled(false);
      setDisablePw("");
      setDisableCode("");
      notify.info(t.security.totpDisabled);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleRegisterPasskey(e: FormEvent) {
    e.preventDefault();
    if (!window.PublicKeyCredential) {
      notify.error(t.common.errorTitle, "WebAuthn / FIDO2 is not supported in this browser");
      return;
    }
    setPkBusy(true);
    try {
      const { options } = await apiRequest<{ options: Record<string, unknown> }>(
        "/auth/webauthn/register/options",
        { method: "POST" },
      );
      const publicKey = prepareCreationOptions(options);
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Passkey registration cancelled");
      await apiRequest("/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({
          device_name: deviceName.trim() || "Hardware Passkey",
          credential: serializeCredential(cred),
        }),
      });
      setDeviceName("");
      notify.success(t.common.createdSuccess, "Passkey");
      await loadAll();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setPkBusy(false);
    }
  }

  async function handleDeletePasskey(totpCode: string) {
    if (!deletePkTarget) return;
    setDeletePkLoading(true);
    try {
      const qs = totpCode ? `?totp_code=${encodeURIComponent(totpCode)}` : "";
      await apiRequest(`/auth/webauthn/credentials/${encodeURIComponent(deletePkTarget.id)}${qs}`, {
        method: "DELETE",
      });
      notify.success(t.common.deletedSuccess, deletePkTarget.device_name);
      setDeletePkTarget(null);
      await loadAll();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeletePkLoading(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell title={t.security.title} subtitle={t.security.subtitle} badge="ZERO-TRUST">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" />
              {t.security.passwordSection}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sec-cur-pw">{t.security.currentPassword}</Label>
                <Input
                  id="sec-cur-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sec-new-pw">{t.security.newPassword}</Label>
                <Input
                  id="sec-new-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sec-cnf-pw">{t.security.confirmPassword}</Label>
                <Input
                  id="sec-cnf-pw"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sec-revoke-others"
                  checked={revokeOthers}
                  onCheckedChange={(v) => setRevokeOthers(Boolean(v))}
                />
                <Label htmlFor="sec-revoke-others" className="text-xs">
                  {t.security.revokeOthersOnChange}
                </Label>
              </div>
              <AsyncButton type="submit" loading={pwSaving} loadingText={t.common.saving}>
                {t.security.changePasswordBtn}
              </AsyncButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <QrCode className="size-4 text-primary" />
                {t.security.totpSection}
              </CardTitle>
              <Badge variant={totpEnabled ? "default" : "secondary"}>
                {totpEnabled ? t.security.totpEnabled : t.security.totpDisabled}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!totpEnabled && !totpSetup ? (
              <AsyncButton loading={totpBusy} onClick={() => void handleStart2fa()}>
                <ShieldCheck className="mr-1.5 size-4" />
                {t.security.setup2faBtn}
              </AsyncButton>
            ) : null}

            {totpSetup ? (
              <div className="space-y-3">
                {totpSetup.qr_svg ? (
                  <div
                    className="mx-auto aspect-square w-56 max-w-full rounded-xl bg-white p-3 [&>svg]:block [&>svg]:size-full"
                    // Server-generated SVG QR code from /auth/2fa/setup
                    dangerouslySetInnerHTML={{ __html: totpSetup.qr_svg }}
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <code className="bg-muted flex-1 truncate rounded border px-2 py-1 font-mono text-xs">
                    {totpSetup.secret}
                  </code>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(totpSetup.secret);
                      notify.success(t.common.copied);
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <form onSubmit={(e) => void handleVerify2fa(e)} className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={totpVerifyCode}
                    onChange={(e) => setTotpVerifyCode(e.target.value)}
                    required
                  />
                  <AsyncButton type="submit" loading={totpBusy} loadingText={t.common.processing}>
                    {t.security.verify2faBtn}
                  </AsyncButton>
                </form>
              </div>
            ) : null}

            {backupCodes.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-xs font-semibold text-amber-500">{t.security.backupCodesTitle}</div>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
                  {backupCodes.map((code) => (
                    <div key={code} className="rounded bg-background/80 px-2 py-1 text-center">
                      {code}
                    </div>
                  ))}
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(backupCodes.join("\n"));
                    notify.success(t.common.copied);
                  }}
                >
                  <Copy className="mr-1 size-3" />
                  {t.common.copy}
                </Button>
              </div>
            ) : null}

            {totpEnabled ? (
              <form onSubmit={(e) => void handleDisable2fa(e)} className="space-y-2.5 border-t border-border/60 pt-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="password"
                    placeholder={t.auth.password}
                    value={disablePw}
                    onChange={(e) => setDisablePw(e.target.value)}
                    required
                  />
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="2FA Code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    required
                  />
                </div>
                <AsyncButton type="submit" variant="destructive" size="sm" loading={totpBusy}>
                  <ShieldOff className="mr-1.5 size-3.5" />
                  {t.security.disable2faBtn}
                </AsyncButton>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Fingerprint className="size-4 text-emerald-500" />
            {t.security.passkeysSection}
          </CardTitle>
          <CardDescription>WebAuthn / FIDO2 • Touch ID • Face ID • YubiKey</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={(e) => void handleRegisterPasskey(e)} className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="max-w-md"
              placeholder={t.security.deviceName}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            />
            <AsyncButton type="submit" loading={pkBusy} loadingText={t.auth.passkeyLoading}>
              <Fingerprint className="mr-1.5 size-4" />
              {t.security.registerPasskeyBtn}
            </AsyncButton>
          </form>

          <div className="divide-y divide-border/60 rounded-lg border border-border/60">
            {passkeys.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-xs">{t.common.noData}</div>
            ) : (
              passkeys.map((pk) => (
                <div key={pk.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                  <div className="space-y-0.5">
                    <div className="font-semibold">{pk.device_name}</div>
                    <div className="text-muted-foreground flex flex-wrap gap-3 font-mono text-[11px]">
                      <span>
                        {t.security.signCount}: {pk.sign_count ?? 0}
                      </span>
                      {pk.last_used_at ? (
                        <span>
                          {t.security.lastUsed}: {new Date(pk.last_used_at).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeletePkTarget(pk)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <PromptDialog
        open={Boolean(deletePkTarget)}
        onOpenChange={(open) => !open && setDeletePkTarget(null)}
        title={t.security.totpPromptTitle}
        description={t.security.totpPromptDesc}
        placeholder="000000"
        destructive
        loading={deletePkLoading}
        confirmLabel={t.common.delete}
        onSubmit={handleDeletePasskey}
      />
    </TerminalPageShell>
  );
}
