import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, KeyRound, Pencil, Trash2 } from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import type { TradingAccountItem } from "@/routes/(main)/dashboard/accounts/index";

export const Route = createFileRoute("/(main)/dashboard/accounts/$accountId/")({
  component: AccountDetailPage,
});

function AccountDetailPage() {
  const { accountId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [account, setAccount] = useState<TradingAccountItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<TradingAccountItem>(`/accounts/${encodeURIComponent(accountId)}`);
      setAccount(res);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accountId, t.common.errorTitle]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  async function handleDownloadSet() {
    if (!account) return;
    setBusy(true);
    try {
      const fn = await apiDownload(
        `/ops/setup-wizard/${encodeURIComponent(account.mt5_login)}/bridge.set?url_mode=internal`,
        `bridge_${account.mt5_login}.set`,
      );
      notify.success(t.common.download, fn);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRotate() {
    if (!account) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ api_key?: string }>(
        `/accounts/${encodeURIComponent(account.id)}/rotate-key`,
        { method: "POST" },
      );
      if (res.api_key) setNewKey(res.api_key);
      notify.success(t.accounts.keyRotated);
      setRotateOpen(false);
      await loadAccount();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!account) return;
    setBusy(true);
    try {
      await apiRequest(`/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, account.name);
      void navigate({ to: "/dashboard/accounts" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!account) {
    return (
      <TerminalPageShell title={t.accounts.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  return (
    <TerminalPageShell
      title={account.name}
      subtitle={`MT5 #${account.mt5_login} • ${account.mt5_server}`}
      badge={`${account.account_type} • ${account.currency}`}
      actions={
        <>
          <Link
            to="/dashboard/accounts"
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <AsyncButton size="sm" variant="outline" loading={busy} onClick={() => void handleDownloadSet()}>
            <Download className="mr-1.5 size-3.5" />
            {t.accounts.downloadSet}
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => setRotateOpen(true)}>
            <KeyRound className="mr-1.5 size-3.5" />
            {t.accounts.rotateKey}
          </Button>
          <Link
            to="/dashboard/accounts/$accountId/edit"
            params={{ accountId: account.id }}
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      {newKey ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
            <code className="font-mono">{newKey}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(newKey);
                notify.success(t.common.copied);
              }}
            >
              {t.common.copy}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Balance</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(account.last_balance_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Equity</div><div className="mt-1 font-mono text-lg font-bold">{formatUsd(account.last_equity_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Floating PnL</div><div className={`mt-1 font-mono text-lg font-bold ${account.last_floating_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{formatSignedUsd(account.last_floating_pnl_usd, privacyMode)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Margin Level</div><div className="mt-1 font-mono text-lg font-bold">{account.last_margin_level.toFixed(1)}%</div></CardContent></Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.accounts.detailTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div><span className="text-muted-foreground">Bridge Key Prefix:</span> <code className="font-mono">{account.api_key_prefix}…</code></div>
          <div><span className="text-muted-foreground">Encrypted .set Key Ready:</span> <Badge variant="outline">{account.has_encrypted_key ? t.common.yes : t.common.no}</Badge></div>
          <div><span className="text-muted-foreground">Leverage:</span> <span className="font-mono">1:{account.leverage}</span></div>
          <div><span className="text-muted-foreground">Algo Trading:</span> <Badge variant={account.algo_trading_enabled ? "default" : "secondary"}>{account.algo_trading_enabled ? t.common.enabled : t.common.disabled}</Badge></div>
          <div><span className="text-muted-foreground">Last Ping:</span> <span className="font-mono">{account.last_ping_ms} ms</span></div>
          <div><span className="text-muted-foreground">Last Seen:</span> <span className="font-mono">{account.last_seen_at ?? "—"}</span></div>
        </CardContent>
      </Card>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.accounts.confirmDeleteTitle} description={t.accounts.confirmDeleteDesc} loading={busy} onConfirm={handleDelete} />
      <ConfirmDialog open={rotateOpen} onOpenChange={setRotateOpen} title={t.accounts.confirmRotateTitle} description={t.accounts.confirmRotateDesc} destructive={false} loading={busy} onConfirm={handleRotate} />
    </TerminalPageShell>
  );
}
