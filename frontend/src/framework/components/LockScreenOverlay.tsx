import { type FormEvent, useState } from "react";

import { Fingerprint, KeyRound, Lock, LogOut, ShieldAlert } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { authApi, setAccessToken } from "@/framework/api-client";
import { AuthShowcasePanel } from "@/framework/components/AuthShowcasePanel";
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

/**
 * Full-screen split-layout Lock Screen matching `/auth/v2/login` (#46).
 */
export function LockScreenOverlay({ user }: { user: LockScreenUser }) {
  const { t } = useI18n();
  const screenLocked = useTerminalStore((s) => s.screenLocked);
  const setScreenLocked = useTerminalStore((s) => s.setScreenLocked);
  const timezone = useTerminalStore((s) => s.timezone);
  const timeFormat = useTerminalStore((s) => s.timeFormat);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone, timeFormat);

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
    <div className="bg-background fixed inset-0 z-[100] grid h-dvh p-2 lg:grid-cols-2">
      {/* Right branded panel identical to Login Screen */}
      <AuthShowcasePanel footerRight={`${clock.time} ${clock.label}`} />

      {/* Left unlock panel matching Login Screen */}
      <div className="relative order-1 flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Lock className="size-3.5 text-primary" />
                <span>{t.auth.lockTitle}</span>
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {clock.time} {clock.label}
              </span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{user.name}</h2>
            <p className="text-muted-foreground font-mono text-xs">{loginIdentifier}</p>
          </div>

          <form onSubmit={(e) => void handlePasswordUnlock(e)} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="lock-password">{t.auth.password}</Label>
              <Input
                id="lock-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>

            {needTotp ? (
              <div className="space-y-1.5">
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

          <div className="border-t border-border/60 pt-4 text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-3.5" />
              {t.auth.switchAccount}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
