import { useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Copy, Download, Link2, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest, getDirectDownloadUrl } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/setup/")({
  component: SetupWizardPage,
});

interface AccountRow {
  id: string;
  name: string;
  mt5_login: string;
  currency?: string;
}

interface IntegrationsStatus {
  integrations_env?: {
    path?: string;
    exists?: boolean;
  };
  gemini?: {
    configured?: boolean;
    model?: string;
    source?: string;
  };
  telegram_webhook?: {
    configured?: boolean;
    url_configured?: boolean;
    secret_configured?: boolean;
    url_host?: string;
  };
}

interface IntegrationTestResult {
  ok?: boolean;
  detail?: string;
  message?: string;
  errors?: string[];
  model?: string;
  reply?: string;
}

const INTERNAL_INGEST_URL = "http://ingest.terminal.local:8000/api/v1/ingest";
const EXTERNAL_INGEST_URL = "https://terminal.huseynovlar.org/api/v1/ingest";

function SetupWizardPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [urlMode, setUrlMode] = useState<"internal" | "external">("internal");
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<AccountRow[]>("/accounts").catch(() => [] as AccountRow[]),
      apiRequest<IntegrationsStatus>("/ops/integrations/status").catch(() => ({} as IntegrationsStatus)),
    ])
      .then(([accs, st]) => {
        const list = Array.isArray(accs) ? accs : [];
        setAccounts(list);
        if (list[0]) setSelectedAccount(list[0].mt5_login || list[0].id);
        setStatus(st);
      })
      .finally(() => setLoading(false));
  }, []);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify.success(t.common.copied, text);
    } catch {
      notify.error(t.common.errorTitle, "Clipboard unavailable");
    }
  }

  async function handleDownload(key: string, path: string, fallbackName: string) {
    setBusy(key);
    try {
      const saved = await apiDownload(path, fallbackName);
      notify.success(t.common.download, saved);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyDirectLink() {
    if (!selectedAccount) return;
    setBusy("copy-link");
    try {
      const url = await getDirectDownloadUrl(
        `/ops/setup-wizard/${encodeURIComponent(selectedAccount)}/bridge.set?url_mode=${urlMode}`,
      );
      await copyText(url);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleTestIntegration(kind: "gemini" | "telegram") {
    setBusy(kind);
    try {
      const endpoint = kind === "gemini" ? "/ops/integrations/gemini-test" : "/ops/alerts/test";
      const res = await apiRequest<IntegrationTestResult>(endpoint, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.ok === false) {
        throw new Error(res.errors?.join("; ") || res.detail || res.message || t.common.errorTitle);
      }
      notify.success(t.common.test, res.message || res.detail || res.reply || "OK");
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <TerminalPageShell title={t.setup.title} subtitle={t.setup.subtitle} badge="MT5 & /ETC">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.setup.step1Title}</CardTitle>
            <CardDescription>{t.setup.step1Desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-emerald-500">{t.setup.internalUrlLabel}</div>
              <div className="flex items-center gap-2">
                <code className="bg-muted flex-1 truncate rounded-md border px-2.5 py-1.5 font-mono text-xs">
                  {INTERNAL_INGEST_URL}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copyText(INTERNAL_INGEST_URL)}>
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t.setup.externalUrlLabel}</div>
              <div className="flex items-center gap-2">
                <code className="bg-muted flex-1 truncate rounded-md border px-2.5 py-1.5 font-mono text-xs">
                  {EXTERNAL_INGEST_URL}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copyText(EXTERNAL_INGEST_URL)}>
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.setup.step2Title}</CardTitle>
            <CardDescription>{t.setup.step2Desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-[11px] text-foreground">
              Chart 1: USTECc (M5) → Your Trading EA (e.g. NasdaqPulse v3.01)
              <br />
              Chart 2: USTECc (M1) → ExnessPanelBridge.mq5 (Zero-Latency Telemetry)
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.setup.step3Title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="setup-account">{t.setup.selectAccount}</Label>
              <SearchSelect
                id="setup-account"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
              >
                {accounts.length === 0 ? (
                  <option value="">{t.common.noData}</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.mt5_login || acc.id}>
                      {acc.name} — #{acc.mt5_login} ({acc.currency || "USD"})
                    </option>
                  ))
                )}
              </SearchSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="setup-url-mode">{t.setup.urlMode}</Label>
              <SearchSelect
                id="setup-url-mode"
                value={urlMode}
                onChange={(e) => setUrlMode(e.target.value as "internal" | "external")}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="internal">{t.setup.urlModeInternal}</option>
                <option value="external">{t.setup.urlModeExternal}</option>
              </SearchSelect>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <AsyncButton
              disabled={!selectedAccount}
              loading={busy === "set"}
              loadingText={t.common.loading}
              onClick={() =>
                void handleDownload(
                  "set",
                  `/ops/setup-wizard/${encodeURIComponent(selectedAccount)}/bridge.set?url_mode=${urlMode}`,
                  `bridge_${selectedAccount}.set`,
                )
              }
            >
              <Download className="mr-1.5 size-4" />
              {t.setup.downloadSet}
            </AsyncButton>

            <AsyncButton
              variant="outline"
              disabled={!selectedAccount}
              loading={busy === "copy-link"}
              onClick={() => void handleCopyDirectLink()}
            >
              <Link2 className="mr-1.5 size-4" />
              {t.setup.copyDirectLink}
            </AsyncButton>

            <AsyncButton
              variant="outline"
              loading={busy === "mq5"}
              onClick={() =>
                void handleDownload("mq5", "/ops/downloads/ExnessPanelBridge.mq5", "ExnessPanelBridge.mq5")
              }
            >
              <Download className="mr-1.5 size-4" />
              {t.setup.downloadBridge}
            </AsyncButton>

            <AsyncButton
              variant="outline"
              loading={busy === "mqh"}
              onClick={() => void handleDownload("mqh", "/ops/downloads/ExnessPanelHook.mqh", "ExnessPanelHook.mqh")}
            >
              <Download className="mr-1.5 size-4" />
              {t.setup.downloadHook}
            </AsyncButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            {t.setup.integrationsTitle}
          </CardTitle>
          <CardDescription>{t.setup.integrationsDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border/70 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" />
                    {t.setup.geminiStatus}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {status?.gemini?.configured ? (
                      <Badge className="gap-1 bg-emerald-600">
                        <CheckCircle2 className="size-3" />
                        {t.setup.configured}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <XCircle className="size-3" />
                        {t.setup.notConfigured}
                      </Badge>
                    )}
                    {status?.gemini?.model ? (
                      <span className="text-muted-foreground font-mono">{status.gemini.model}</span>
                    ) : null}
                  </div>
                </div>
                <AsyncButton
                  size="sm"
                  variant="outline"
                  loading={busy === "gemini"}
                  onClick={() => void handleTestIntegration("gemini")}
                >
                  {t.setup.testGemini}
                </AsyncButton>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Send className="size-4 text-sky-500" />
                    {t.setup.telegramStatus}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {status?.telegram_webhook?.configured ? (
                      <Badge className="gap-1 bg-emerald-600">
                        <CheckCircle2 className="size-3" />
                        {t.setup.configured}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <XCircle className="size-3" />
                        {t.setup.notConfigured}
                      </Badge>
                    )}
                  </div>
                </div>
                <AsyncButton
                  size="sm"
                  variant="outline"
                  loading={busy === "telegram"}
                  onClick={() => void handleTestIntegration("telegram")}
                >
                  {t.setup.testTelegram}
                </AsyncButton>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
