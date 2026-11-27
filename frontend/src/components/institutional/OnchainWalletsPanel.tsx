import { useCallback, useEffect, useState } from "react";

import { Copy, ExternalLink, Fuel, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { SearchSelect } from "@/components/ui/search-select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { soundEngine } from "@/framework/sound-engine";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export interface OnchainWalletsResponse {
  updated_at_utc: string;
  summary: {
    total_usd: number;
    stablecoins_pct: number;
    crypto_pct: number;
    wallet_count: number;
  };
  gas_monitor: {
    btc_sat_vb: number;
    eth_gwei: number;
    trc20_trx: number;
    sol_fee: number;
  };
  wallets: Array<{
    id: string;
    label: string;
    network: string;
    address: string;
    short_address: string;
    assets_summary: string;
    usd_value: number;
    stable_usd: number;
    last_activity_utc: string;
    explorer_url: string;
  }>;
  transactions: Array<{
    id: string;
    timestamp_utc: string;
    status: string;
    tx_type: "DEPOSIT" | "WITHDRAWAL" | "SELF_TRANSFER" | string;
    wallet_label: string;
    network: string;
    asset_amount: string;
    usd_value: number;
    fee_text: string;
    tx_hash: string;
    explorer_url: string;
  }>;
}

const NETWORKS = [
  { id: "BTC", label: "Bitcoin (BTC)" },
  { id: "ETH", label: "Ethereum (ETH / ERC-20)" },
  { id: "ARB", label: "Arbitrum" },
  { id: "BASE", label: "Base" },
  { id: "POLYGON", label: "Polygon" },
  { id: "TRON", label: "TRON (TRX / USDT-TRC20)" },
  { id: "SOL", label: "Solana (SOL / SPL)" },
] as const;

export function OnchainWalletsPanel({
  onSummaryChange,
}: {
  onSummaryChange?: (totalUsd: number) => void;
}) {
  const [data, setData] = useState<OnchainWalletsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [network, setNetwork] = useState("BTC");
  const [address, setAddress] = useState("");

  const loadWallets = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiRequest<OnchainWalletsResponse>("/institutional/wallets");
        setData(res);
        onSummaryChange?.(res.summary.total_usd);
      } catch (err) {
        if (!silent) notify.error("Ошибка загрузки кошельков", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onSummaryChange],
  );

  useEffect(() => {
    void loadWallets(false);
  }, [loadWallets]);

  async function handleAddWallet() {
    if (!label.trim() || !address.trim()) {
      notify.error("Укажите метку и публичный адрес");
      return;
    }
    setAdding(true);
    try {
      const res = await apiRequest<OnchainWalletsResponse>("/institutional/wallets", {
        method: "POST",
        body: JSON.stringify({ label: label.trim(), network, address: address.trim() }),
      });
      setData(res);
      onSummaryChange?.(res.summary.total_usd);
      setLabel("");
      setAddress("");
      soundEngine.play("bridgeReconnect");
      notify.success("Кошелёк добавлен (Read-Only)");
    } catch (err) {
      notify.error("Ошибка добавления", err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteWallet(id: string) {
    try {
      const res = await apiRequest<OnchainWalletsResponse>(`/institutional/wallets/${id}`, {
        method: "DELETE",
      });
      setData(res);
      onSummaryChange?.(res.summary.total_usd);
      notify.success("Кошелёк удалён");
    } catch (err) {
      notify.error("Ошибка удаления", err instanceof Error ? err.message : String(err));
    }
  }

  if (loading && !data) return <PageSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Net Worth & Live Gas/Fee Monitor Strip */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-[var(--bg-panel)] p-3 tabular-nums">
          <div className="text-[10px] uppercase text-[var(--text-muted)]">Всего на кошельках ($ USD)</div>
          <div className="text-[18px] font-semibold text-[var(--text-primary)]">
            ${data.summary.total_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[var(--bg-panel)] p-3 tabular-nums">
          <div className="text-[10px] uppercase text-[var(--text-muted)]">Стейблкоины / Крипто</div>
          <div className="text-[15px] font-semibold text-[var(--text-primary)]">
            {data.summary.stablecoins_pct.toFixed(1)}%{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">/</span>{" "}
            {data.summary.crypto_pct.toFixed(1)}%
          </div>
        </div>
        <div className="bg-[var(--bg-panel)] p-3 sm:col-span-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase text-[var(--text-muted)]">
            <Fuel className="size-3 text-[var(--accent-amber)]" />
            Живой Gas / Fee монитор (выгодный вывод)
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold tabular-nums">
            <span className="text-[var(--accent-amber)]">BTC: {data.gas_monitor.btc_sat_vb} sat/vB</span>
            <span className="text-[var(--accent-blue)]">ETH: {data.gas_monitor.eth_gwei} Gwei</span>
            <span className="text-[var(--bull)]">TRC-20: ~{data.gas_monitor.trc20_trx} TRX</span>
            <span className="text-[var(--text-secondary)]">SOL: ~{data.gas_monitor.sol_fee} SOL</span>
          </div>
        </div>
      </div>

      {/* Add Read-Only Public Wallet Form */}
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
            <ShieldCheck className="size-3.5 text-[var(--bull)]" />
            Добавить Read-Only кошелёк (только публичный адрес, без приватных ключей)
          </span>
          <button
            type="button"
            onClick={() => void loadWallets(true)}
            className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[10px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw className="size-3" />
            Обновить балансы
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Метка (напр. Мой Ledger BTC)"
            className="h-8 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] md:col-span-3"
          />
          <div className="md:col-span-3">
            <SearchSelect
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
            >
              {NETWORKS.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </SearchSelect>
          </div>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Публичный адрес (bc1q... / 0x... / T... / Sol...)"
            className="h-8 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] md:col-span-4"
          />
          <AsyncButton
            size="sm"
            loading={adding}
            loadingText="Проверка..."
            onClick={() => void handleAddWallet()}
            className="h-8 rounded-[4px] bg-[var(--accent-blue)] text-xs font-semibold text-white md:col-span-2"
          >
            <Plus className="mr-1 size-3.5" />
            Добавить
          </AsyncButton>
        </div>
      </div>

      {/* Tracked Wallets Table */}
      <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          <span className="inline-flex items-center gap-1.5">
            <Wallet className="size-3.5 text-[var(--accent-blue)]" />
            Отслеживаемые кошельки ({data.wallets.length})
          </span>
        </div>
        <table className="w-full border-collapse text-left text-[11px] tabular-nums">
          <thead>
            <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
              <th className="px-3">Метка</th>
              <th className="px-2">Сеть</th>
              <th className="px-2">Адрес</th>
              <th className="px-2">Активы</th>
              <th className="px-2 text-right">Оценка ($ USD)</th>
              <th className="px-2 text-right">Активность UTC</th>
              <th className="px-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {data.wallets.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-[var(--text-muted)]">
                  Нет добавленных кошельков. Добавьте публичный адрес BTC / ETH / TRON / SOL выше.
                </td>
              </tr>
            ) : (
              data.wallets.map((w) => (
                <tr key={w.id} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                  <td className="px-3 font-semibold text-[var(--text-primary)]">{w.label}</td>
                  <td className="px-2">
                    <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-blue)]">
                      {w.network}
                    </span>
                  </td>
                  <td className="px-2 font-mono text-[var(--text-secondary)]">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(w.address);
                        notify.success("Адрес скопирован", w.short_address);
                      }}
                      className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
                    >
                      {w.short_address}
                      <Copy className="size-3 text-[var(--text-muted)]" />
                    </button>
                  </td>
                  <td className="px-2 text-[var(--text-primary)]">{w.assets_summary}</td>
                  <td className="px-2 text-right font-semibold text-[var(--text-primary)]">
                    ${w.usd_value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 text-right text-[var(--text-muted)]">
                    {formatTerminalDateTime(w.last_activity_utc, { timezone: "UTC" })}
                  </td>
                  <td className="px-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <a
                        href={w.explorer_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent-blue)] hover:underline"
                        title="Открыть в эксплорере"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleDeleteWallet(w.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--bear)]"
                        title="Удалить кошелёк"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* On-Chain Transactions Feed (DEPOSIT / WITHDRAWAL / SELF_TRANSFER) */}
      <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Лента ончейн-транзакций (авто-классификация DEPOSIT / WITHDRAWAL / SELF_TRANSFER)
        </div>
        <table className="w-full border-collapse text-left text-[11px] tabular-nums">
          <thead>
            <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
              <th className="px-3">Дата (UTC)</th>
              <th className="px-2">Статус</th>
              <th className="px-2">Тип</th>
              <th className="px-2">Кошелёк</th>
              <th className="px-2 text-right">Сумма</th>
              <th className="px-2 text-right">$ USD</th>
              <th className="px-2 text-right">Комиссия</th>
              <th className="px-3 text-right">Tx ↗</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {data.transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-xs text-[var(--text-muted)]">
                  Нет недавних ончейн-транзакций по отслеживаемым адресам
                </td>
              </tr>
            ) : (
              data.transactions.map((tx) => {
                const typeColor =
                  tx.tx_type === "DEPOSIT"
                    ? "var(--bull)"
                    : tx.tx_type === "WITHDRAWAL"
                      ? "var(--bear)"
                      : "var(--accent-amber)";
                return (
                  <tr key={tx.id} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                    <td className="px-3 text-[var(--text-secondary)]">
                      {formatTerminalDateTime(tx.timestamp_utc, { timezone: "UTC" })}
                    </td>
                    <td className="px-2 text-[10px] text-[var(--text-muted)]">{tx.status}</td>
                    <td className="px-2">
                      <span
                        className="rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${typeColor} 16%, transparent)`,
                          color: typeColor,
                        }}
                      >
                        {tx.tx_type}
                      </span>
                    </td>
                    <td className="px-2 font-medium text-[var(--text-primary)]">{tx.wallet_label}</td>
                    <td className="px-2 text-right font-semibold text-[var(--text-primary)]">{tx.asset_amount}</td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">
                      ${tx.usd_value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 text-right text-[var(--text-muted)]">{tx.fee_text}</td>
                    <td className="px-3 text-right">
                      <a
                        href={tx.explorer_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[var(--accent-blue)] hover:underline"
                      >
                        {tx.tx_hash}
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
