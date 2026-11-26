import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Download,
  Eye,
  Info,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/accounts/")({
  component: AccountsListPage,
});

export interface TradingAccountItem {
  id: string;
  profile_id: string | null;
  primary_asset_id: string | null;
  container_id: string | null;
  name: string;
  platform: string;
  mt5_login: string;
  mt5_server: string;
  account_type: string;
  currency: string;
  currency_divisor: number;
  leverage: number;
  is_demo: boolean;
  is_active: boolean;
  api_key_prefix: string;
  has_encrypted_key: boolean;
  algo_trading_enabled: boolean;
  terminal_connected: boolean;
  last_ping_ms: number;
  last_seen_at: string | null;
  last_balance_usd: number;
  last_equity_usd: number;
  last_floating_pnl_usd: number;
  last_margin_level: number;
  robots_count?: number;
  created_at: string;
}

function AccountsListPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [accounts, setAccounts] = useState<TradingAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TradingAccountItem | null>(null);
  const [rotateTarget, setRotateTarget] = useState<TradingAccountItem | null>(null);
  const [revealedKey, setRevealedKey] = useState<{ name: string; key: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<TradingAccountItem[]>("/accounts");
      setAccounts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t.common.errorTitle]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useLiveEvents("snapshot", () => {
    void loadAccounts();
  });

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(`del:${deleteTarget.id}`);
    try {
      await apiRequest(`/accounts/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.name);
      setDeleteTarget(null);
      await loadAccounts();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRotateKey() {
    if (!rotateTarget) return;
    setBusyId(`rot:${rotateTarget.id}`);
    try {
      const res = await apiRequest<{ api_key?: string; api_key_prefix?: string }>(
        `/accounts/${encodeURIComponent(rotateTarget.id)}/rotate-key`,
        { method: "POST" },
      );
      notify.success(t.accounts.keyRotated, rotateTarget.name);
      if (res.api_key) {
        setRevealedKey({ name: rotateTarget.name, key: res.api_key });
      }
      setRotateTarget(null);
      await loadAccounts();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadSet(acc: TradingAccountItem) {
    setBusyId(`set:${acc.id}`);
    try {
      const filename = await apiDownload(
        `/ops/setup-wizard/${encodeURIComponent(acc.mt5_login)}/bridge.set?url_mode=internal`,
        `bridge_${acc.mt5_login}.set`,
      );
      notify.success(t.common.download, filename);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <TerminalPageShell
      title={t.accounts.title}
      subtitle={t.accounts.subtitle}
      badge={`${accounts.length}`}
      actions={
        <>
          <Link
            to="/dashboard/profiles"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            <UserCheck className="mr-1.5 size-3.5" />
            {t.accounts.profilesBtn}
          </Link>
          <Button size="sm" variant="outline" onClick={() => void loadAccounts()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
          <Link
            to="/dashboard/accounts/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 size-3.5" />
            {t.accounts.newBtn}
          </Link>
        </>
      }
    >
      {/* Inline Key Architecture Clarification */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-2.5 p-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="space-y-0.5">
            <div className="font-semibold text-foreground">{t.accounts.keyExplainTitle}</div>
            <p className="text-muted-foreground">{t.accounts.keyExplainBody}</p>
          </div>
        </CardContent>
      </Card>

      {revealedKey ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold text-emerald-500">
              {t.accounts.keyRotated}: {revealedKey.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
            <code className="rounded bg-background px-2 py-1 font-mono text-xs">{revealedKey.key}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(revealedKey.key);
                notify.success(t.common.copied);
              }}
            >
              {t.common.copy}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <TableSkeleton rows={5} cols={8} />
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            {t.common.noData}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">MT5 Login / Server</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Equity</th>
                  <th className="px-3 py-2 text-right">Float PnL</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <Link
                        to="/dashboard/accounts/$accountId"
                        params={{ accountId: acc.id }}
                        title={String(acc.id)}
                        className="text-primary hover:underline"
                      >
                        {String(acc.id).slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        to="/dashboard/accounts/$accountId"
                        params={{ accountId: acc.id }}
                        className="hover:text-primary hover:underline"
                      >
                        {acc.name}
                      </Link>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {acc.api_key_prefix}…
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <div>#{acc.mt5_login}</div>
                      <div className="text-[10px] text-muted-foreground">{acc.mt5_server}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {acc.account_type} • {acc.currency}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatUsd(acc.last_balance_usd, privacyMode)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {formatUsd(acc.last_equity_usd, privacyMode)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold ${
                        acc.last_floating_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {formatSignedUsd(acc.last_floating_pnl_usd, privacyMode)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={acc.terminal_connected ? "default" : "secondary"}
                        className={`font-mono text-[10px] ${acc.terminal_connected ? "bg-emerald-600 text-white" : ""}`}
                      >
                        {acc.terminal_connected ? t.common.online : t.common.offline}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <AsyncButton
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          loading={busyId === `set:${acc.id}`}
                          loadingText="..."
                          onClick={() => void handleDownloadSet(acc)}
                          title={t.accounts.downloadSet}
                        >
                          <Download className="size-3.5" />
                        </AsyncButton>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => setRotateTarget(acc)}
                          title={t.accounts.rotateKey}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                        <Link
                          to="/dashboard/accounts/$accountId"
                          params={{ accountId: acc.id }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          title={t.common.view}
                        >
                          <Eye className="size-3.5" />
                        </Link>
                        <Link
                          to="/dashboard/accounts/$accountId/edit"
                          params={{ accountId: acc.id }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          title={t.common.edit}
                        >
                          <Pencil className="size-3.5" />
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => setDeleteTarget(acc)}
                          title={t.common.delete}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.accounts.confirmDeleteTitle}
        description={`${t.accounts.confirmDeleteDesc} (${deleteTarget?.name ?? ""})`}
        loading={busyId === `del:${deleteTarget?.id ?? ""}`}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={Boolean(rotateTarget)}
        onOpenChange={(open) => !open && setRotateTarget(null)}
        title={t.accounts.confirmRotateTitle}
        description={`${t.accounts.confirmRotateDesc} (${rotateTarget?.name ?? ""})`}
        destructive={false}
        loading={busyId === `rot:${rotateTarget?.id ?? ""}`}
        onConfirm={handleRotateKey}
      />
    </TerminalPageShell>
  );
}
