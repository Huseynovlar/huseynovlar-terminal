import { type FormEvent, useState } from "react";

import { Fingerprint, KeyRound, Lock, LogOut, ShieldAlert } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { authApi, setAccessToken } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { formatTerminalClock, useUtcClock } from "@/framework/use-utc-clock";
import { prepareRequestOptions, serializeCredential } from "@/framework/webauthn";

export interface LockScreenUser {
  id: string;
  username?: string;
  name: string;
  email: string;
}

export function LockScreenOverlay({ user }: { user: LockScreenUser }) {
  const { t } = useI18n();
  const screenLocked = useTerminalStore((s) => s.screenLocked);
  const setScreenLocked = useTerminalStore((s) => s.setScreenLocked);
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone);

  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  if (!screenLocked) return null;

  const loginIdentifier = user.username || user.email || user.name;

  async function handlePasswordUnlock(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login({
        username: loginIdentifier,
        password,
        totp_code: totpCode || undefined,
      });
      setAccessToken(res.access_token);
      setPassword("");
      setTotpCode("");
      setScreenLocked(false);
      notify.success(t.auth.unlockedSuccess);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.errorTitle;
      if (msg.toLowerCase().includes("totp")) {
        setNeedTotp(true);
      }
      setError(msg);
      notify.error(t.common.errorTitle, msg);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyUnlock() {
    setError(null);
    if (!window.PublicKeyCredential) {
      setError("WebAuthn / FIDO2 is not supported in this browser");
      return;
    }
    setPasskeyLoading(true);
    try {
      const { challenge_key, options } = await authApi.webauthnLoginOptions(loginIdentifier);
      const publicKey = prepareRequestOptions(options);
      const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Passkey authentication cancelled");
      const res = await authApi.webauthnLoginVerify(challenge_key, serializeCredential(cred));
      setAccessToken(res.access_token);
      setScreenLocked(false);
      notify.success(t.auth.unlockedSuccess);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.errorTitle;
      setError(msg);
      notify.error(t.common.errorTitle, msg);
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setScreenLocked(false);
    window.location.replace("/auth/v2/login");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-xl">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="space-y-1.5 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Lock className="size-6" />
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {clock.time} <span className="text-muted-foreground text-xs font-normal">{clock.label}</span>
          </div>
          <h2 className="text-lg font-semibold">{t.auth.lockTitle}</h2>
          <p className="text-muted-foreground text-xs">{t.auth.lockSubtitle}</p>
          <p className="text-xs font-medium text-foreground/80">
            {user.name} ({loginIdentifier})
          </p>
        </div>

        <AsyncButton
          type="button"
          variant="outline"
          className="w-full gap-2"
          loading={passkeyLoading}
          loadingText={t.auth.passkeyLoading}
          onClick={() => void handlePasskeyUnlock()}
        >
          <Fingerprint className="size-4 text-emerald-500" />
          {t.auth.unlockWithPasskey}
        </AsyncButton>

        <form onSubmit={(e) => void handlePasswordUnlock(e)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lock-password">{t.auth.password}</Label>
            <Input
              id="lock-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {needTotp ? (
            <div className="space-y-1">
              <Label htmlFor="lock-totp">{t.auth.totpCode}</Label>
              <Input
                id="lock-totp"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
              />
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <ShieldAlert className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <AsyncButton
            type="submit"
            className="w-full gap-2"
            loading={loading}
            loadingText={t.common.authenticating}
          >
            <KeyRound className="size-4" />
            {t.auth.unlock}
          </AsyncButton>
        </form>

        <div className="border-t border-border/60 pt-3 text-center">
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={() => void handleSignOut()}>
            <LogOut className="size-3.5" />
            {t.auth.switchAccount}
          </Button>
        </div>
      </div>
    </div>
  );
}
