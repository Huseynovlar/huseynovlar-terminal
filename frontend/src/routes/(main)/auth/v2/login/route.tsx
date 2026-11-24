import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fingerprint, Globe, KeyRound, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_CONFIG } from "@/config/app-config";
import { authApi, setAccessToken } from "@/framework/api-client";

export const Route = createFileRoute("/(main)/auth/v2/login")({
  component: LoginV2,
});

function LoginV2() {
  const navigate = useNavigate();
  const [initialized, setInitialized] = useState<boolean>(true);
  const [username, setUsername] = useState("owner");
  const [email, setEmail] = useState("owner@huseynovlar.org");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authApi
      .status()
      .then((res) => setInitialized(res.initialized))
      .catch(() => {
        // Offline/static preview fallback
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
        : await authApi.bootstrap({ username, email, password, display_name: "Owner" });
      setAccessToken(res.access_token);
      navigate({ to: "/dashboard/crypto" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка входа";
      if (msg.toLowerCase().includes("totp")) {
        setNeedTotp(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setError(null);
    if (!window.PublicKeyCredential) {
      setError("Браузер не поддерживает FIDO2 / WebAuthn Passkeys");
      return;
    }
    setLoading(true);
    try {
      const { challenge_key, options } = await authApi.webauthnLoginOptions(username || undefined);
      const cred = await navigator.credentials.get({ publicKey: options });
      if (!cred) throw new Error("Вход по Passkey отменён");
      const res = await authApi.webauthnLoginVerify(challenge_key, cred);
      setAccessToken(res.access_token);
      navigate({ to: "/dashboard/crypto" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка Passkey авторизации");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[360px]">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {initialized ? "Вход в терминал" : "Первичная настройка владельца"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {initialized
              ? "Используйте Passkey (Face ID / Touch ID) или пароль + 2FA."
              : "Создайте учётную запись владельца Huseynovlar Terminal."}
          </p>
        </div>

        <div className="space-y-4">
          {initialized ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handlePasskeyLogin}
                disabled={loading}
              >
                <Fingerprint className="size-4 text-emerald-500" />
                Войти по Passkey (FIDO2 / WebAuthn)
              </Button>
              <div className="after:border-border relative text-center text-xs after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                <span className="bg-background text-muted-foreground relative z-10 px-2">или по паролю</span>
              </div>
            </>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="username">Логин</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            {!initialized ? (
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
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
                <Label htmlFor="totp">Код 2FA (TOTP 6 цифр)</Label>
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

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              <KeyRound className="size-4" />
              {loading ? "Проверка..." : initialized ? "Войти" : "Создать владельца и войти"}
            </Button>
          </form>
        </div>
      </div>

      <div className="absolute bottom-5 flex w-full justify-between px-10">
        <div className="text-muted-foreground text-xs">{APP_CONFIG.copyright}</div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Globe className="size-3.5" />
          Asia/Baku • NetBird
        </div>
      </div>
    </>
  );
}
