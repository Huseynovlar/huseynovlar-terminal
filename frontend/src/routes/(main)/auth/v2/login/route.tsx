import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, Fingerprint, KeyRound, Languages, ShieldAlert } from "lucide-react";

import { AppLogo } from "@/components/app-logo";
import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { APP_CONFIG } from "@/config/app-config";
import { authApi, setAccessToken } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { formatTerminalClock, useUtcClock } from "@/framework/use-utc-clock";
import { prepareRequestOptions, serializeCredential } from "@/framework/webauthn";

export const Route = createFileRoute("/(main)/auth/v2/login")({
  component: LoginV2,
});

function LoginV2() {
  const { t, language } = useI18n();
  const cycleLanguage = useTerminalStore((s) => s.cycleLanguage);
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const clock = formatTerminalClock(now, timezone);

  const navigate = useNavigate();
  const [initialized, setInitialized] = useState<boolean>(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    authApi
      .status()
      .then((res) => setInitialized(res.initialized))
      .catch(() => {
        setInitialized(true);
      });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = initialized
        ? await authApi.login({ username, password, totp_code: totpCode || undefined })
        : await authApi.bootstrap({ username, email, password, display_name: displayName || username });
      setAccessToken(res.access_token);
      notify.success(t.auth.loginSuccess);
      await navigate({ to: "/dashboard/home" });
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

  async function handlePasskeyLogin() {
    setError(null);
    if (!window.PublicKeyCredential) {
      const msg = "WebAuthn / FIDO2 is not supported in this browser";
      setError(msg);
      notify.error(t.common.errorTitle, msg);
      return;
    }
    setPasskeyLoading(true);
    try {
      const { challenge_key, options } = await authApi.webauthnLoginOptions(username || undefined);
      const publicKey = prepareRequestOptions(options);
      const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Passkey authentication cancelled");
      const res = await authApi.webauthnLoginVerify(challenge_key, serializeCredential(cred));
      setAccessToken(res.access_token);
      notify.success(t.auth.loginSuccess);
      await navigate({ to: "/dashboard/home" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.errorTitle;
      setError(msg);
      notify.error(t.common.errorTitle, msg);
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs uppercase"
          onClick={cycleLanguage}
        >
          <Languages className="size-3.5" />
          {language}
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-[380px] flex-col justify-center space-y-5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <AppLogo className="size-16" />
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            {initialized ? t.auth.loginTitle : t.auth.bootstrapTitle}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {initialized ? t.auth.loginSubtitle : t.auth.bootstrapSubtitle}
          </p>
        </div>

        <div className="space-y-4">
          {initialized ? (
            <>
              <AsyncButton
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => void handlePasskeyLogin()}
                loading={passkeyLoading}
                loadingText={t.auth.passkeyLoading}
                disabled={loading}
              >
                <Fingerprint className="size-4 text-emerald-500" />
                {t.auth.signInPasskey}
              </AsyncButton>
              <div className="after:border-border relative text-center text-xs after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                <span className="bg-background text-muted-foreground relative z-10 px-2">•</span>
              </div>
            </>
          ) : null}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="username">{t.auth.username}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            {!initialized ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">{t.auth.displayName}</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t.auth.email}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="password">{t.auth.password}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={initialized ? "current-password" : "new-password"}
                required
              />
            </div>

            {initialized && needTotp ? (
              <div className="space-y-1.5">
                <Label htmlFor="totp">{t.auth.totpCode}</Label>
                <Input
                  id="totp"
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
              disabled={passkeyLoading}
            >
              <KeyRound className="size-4" />
              {initialized ? t.auth.signIn : t.auth.createAdmin}
            </AsyncButton>
          </form>
        </div>
      </div>

      <div className="absolute bottom-5 flex w-full items-center justify-between px-8">
        <div className="text-muted-foreground text-xs">{APP_CONFIG.copyright}</div>
        <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs tabular-nums">
          <Clock className="size-3.5" />
          <span>{clock.time}</span>
          <span>{clock.label}</span>
        </div>
      </div>
    </>
  );
}
