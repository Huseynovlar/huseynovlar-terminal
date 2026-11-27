import { useCallback, useEffect, useRef, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { StablecoinsMcapChart } from "@/components/institutional/InstitutionalCharts";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/derivatives/")({
  component: OnchainDerivativesPage,
});

interface OnchainResponse {
  updated_at_utc: string;
  kpis: {
    total_defi_tvl_b: number;
    stablecoins_mcap_b: number;
    stablecoins_7d_pct: number;
    btc_mempool_fee: number;
    btc_funding_pct: number;
    deribit_dvol_btc: number;
  };
  stablecoin_series: Array<{ date: string; mcap_b: number }>;
  top_chains: Array<{ name: string; tvl_usd: number; share_pct: number }>;
  derivatives: Array<{
    symbol: string;
    binance_symbol: string;
    mark_price: number;
    open_interest_usd: number;
    funding_rate_pct: number;
    long_short_ratio: number;
  }>;
  mempool_fees: {
    fastest: number;
    half_hour: number;
    hour: number;
    economy: number;
  };
  mempool_blocks: Array<{
    label: string;
    tx_count: number;
    median_fee: number;
    block_vsize_mb: number;
  }>;
}

function fmtBillions(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${usd.toFixed(0)}`;
}

function OnchainDerivativesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OnchainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mempoolWsLive, setMempoolWsLive] = useState(false);
  const lastWsPatchRef = useRef(0);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest<OnchainResponse>("/institutional/onchain");
      setData(res);
    } catch (err) {
      if (!silent) notify.error("Ошибка загрузки ончейн-данных", err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Live Mempool.space WebSocket — throttled silent patches (3s), zero flicker, clean unsubscribe on unmount
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket("wss://mempool.space/api/v1/ws");
      ws.onopen = () => {
        if (!alive) {
          ws?.close();
          return;
        }
        setMempoolWsLive(true);
        ws?.send(JSON.stringify({ action: "want", data: ["mempool-blocks", "stats"] }));
      };
      ws.onmessage = (ev) => {
        if (!alive) return;
        const now = performance.now();
        if (now - lastWsPatchRef.current < 3000) return;
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const fees = msg.fees as Record<string, number> | undefined;
          const blocks = msg["mempool-blocks"] as Array<Record<string, number>> | undefined;
          if (!fees && !blocks) return;
          lastWsPatchRef.current = now;
          setData((prev) => {
            if (!prev) return prev;
            const nextFees = fees
              ? {
                  fastest: Math.round(fees.fastestFee ?? prev.mempool_fees.fastest),
                  half_hour: Math.round(fees.halfHourFee ?? prev.mempool_fees.half_hour),
                  hour: Math.round(fees.hourFee ?? prev.mempool_fees.hour),
                  economy: Math.round(fees.economyFee ?? prev.mempool_fees.economy),
                }
              : prev.mempool_fees;
            const nextBlocks = Array.isArray(blocks)
              ? blocks.slice(0, 4).map((b, idx) => ({
                  label: idx === 0 ? "Next Block" : `+${idx}`,
                  tx_count: Math.round(b.nTx ?? 0),
                  median_fee: Number((b.medianFee ?? 0).toFixed(1)),
                  block_vsize_mb: Number(((b.blockVSize ?? 0) / 1e6).toFixed(2)),
                }))
              : prev.mempool_blocks;
            return {
              ...prev,
              kpis: { ...prev.kpis, btc_mempool_fee: nextFees.fastest },
              mempool_fees: nextFees,
              mempool_blocks: nextBlocks,
            };
          });
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => setMempoolWsLive(false);
      ws.onerror = () => setMempoolWsLive(false);
    } catch {
      // ignore ws init failure
    }

    return () => {
      alive = false;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ action: "want", data: [] }));
          } catch {
            // ignore
          }
        }
        ws.close();
      }
    };
  }, []);

  const k = data?.kpis;

  return (
    <TerminalPageShell
      title="Ончейн и деривативы"
      subtitle="DefiLlama TVL & Stablecoins · Binance Futures OI / Funding / L-S · Deribit DVOL · Mempool.space WS"
      badge={mempoolWsLive ? "● MEMPOOL WS" : "CACHED"}
      actions={
        <button
          type="button"
          onClick={() => void loadData(false)}
          className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Обновить
        </button>
      }
    >
      {loading && !data ? (
        <PageSkeleton />
      ) : data && k ? (
        <div className="space-y-3">
          {/* 5-Cell Live Metrics Strip */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Total DeFi TVL
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                ${k.total_defi_tvl_b.toFixed(2)}B
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Stablecoins MCap (Δ 7d)
              </span>
              <div className="flex items-baseline gap-2 tabular-nums">
                <span className="text-[16px] font-semibold text-[var(--text-primary)]">
                  ${k.stablecoins_mcap_b.toFixed(1)}B
                </span>
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: k.stablecoins_7d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                >
                  {k.stablecoins_7d_pct >= 0 ? "+" : ""}
                  {k.stablecoins_7d_pct.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                BTC Mempool Fee
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--accent-amber)]">
                {k.btc_mempool_fee} <span className="text-[11px] font-normal text-[var(--text-muted)]">sat/vB</span>
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                BTC Funding (8h)
              </span>
              <span
                className="text-[16px] font-semibold tabular-nums"
                style={{ color: k.btc_funding_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
              >
                {k.btc_funding_pct >= 0 ? "+" : ""}
                {k.btc_funding_pct.toFixed(4)}%
              </span>
            </div>
            <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Deribit DVOL (BTC)
              </span>
              <span className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.deribit_dvol_btc > 0 ? k.deribit_dvol_btc.toFixed(2) : "—"}
              </span>
            </div>
          </div>

          {/* Block 1: Stablecoins MCap Chart + Top-10 Chains TVL */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 lg:col-span-7">
              <div className="mb-2 border-b border-[var(--border-subtle)] pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Капитализация стейблкоинов (90D · DefiLlama)
              </div>
              <StablecoinsMcapChart series={data.stablecoin_series} />
            </div>

            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Топ-10 блокчейнов по TVL
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Сеть</th>
                    <th className="px-2 text-right">TVL</th>
                    <th className="px-3 text-right">Доля %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.top_chains.map((c) => (
                    <tr key={c.name} className="h-7 hover:bg-[var(--bg-elevated)]/50">
                      <td className="px-3 font-medium text-[var(--text-primary)]">{c.name}</td>
                      <td className="px-2 text-right font-semibold text-[var(--text-secondary)]">
                        {fmtBillions(c.tvl_usd)}
                      </td>
                      <td className="px-3 text-right text-[var(--text-muted)]">
                        {c.share_pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Block 2 & 3: Derivatives Table + Live Bitcoin Mempool */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-8">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Деривативы Binance Futures (клик → график актива)
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Актив</th>
                    <th className="px-2 text-right">Mark Price</th>
                    <th className="px-2 text-right">Open Interest ($)</th>
                    <th className="px-2 text-right">Funding Rate</th>
                    <th className="px-3 text-right">Long / Short</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.derivatives.map((d) => (
                    <tr
                      key={d.symbol}
                      onClick={() =>
                        void navigate({
                          to: "/dashboard/tickers/$symbol",
                          params: { symbol: d.symbol },
                        })
                      }
                      className="h-9 cursor-pointer transition-colors hover:bg-[var(--bg-elevated)]/60"
                    >
                      <td className="px-3">
                        <div className="flex items-center gap-1.5">
                          <AssetLogo symbol={d.symbol} size={16} />
                          <span className="font-semibold text-[var(--text-primary)]">{d.symbol}</span>
                        </div>
                      </td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">
                        ${d.mark_price.toLocaleString("en-US")}
                      </td>
                      <td className="px-2 text-right font-semibold text-[var(--text-primary)]">
                        {fmtBillions(d.open_interest_usd)}
                      </td>
                      <td
                        className="px-2 text-right font-semibold"
                        style={{ color: d.funding_rate_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {d.funding_rate_pct >= 0 ? "+" : ""}
                        {d.funding_rate_pct.toFixed(4)}%
                      </td>
                      <td className="px-3 text-right">
                        <span
                          className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-semibold"
                          style={{
                            color: d.long_short_ratio >= 1 ? "var(--bull)" : "var(--bear)",
                          }}
                        >
                          {d.long_short_ratio.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Live Bitcoin Mempool Queue */}
            <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 lg:col-span-4">
              <div className="mb-2 flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Bitcoin Mempool (Live)
                </span>
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: mempoolWsLive ? "var(--bull)" : "var(--text-muted)" }}
                >
                  {mempoolWsLive ? "● WS" : "○ REST"}
                </span>
              </div>

              {/* Fee Tiers */}
              <div className="mb-3 grid grid-cols-3 gap-1.5 text-center tabular-nums">
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Fast</div>
                  <div className="text-[14px] font-semibold text-[var(--bear)]">
                    {data.mempool_fees.fastest}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">sat/vB</div>
                </div>
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Medium</div>
                  <div className="text-[14px] font-semibold text-[var(--accent-amber)]">
                    {data.mempool_fees.half_hour}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">sat/vB</div>
                </div>
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Economy</div>
                  <div className="text-[14px] font-semibold text-[var(--bull)]">
                    {data.mempool_fees.economy}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">sat/vB</div>
                </div>
              </div>

              {/* Upcoming Blocks Queue */}
              <div className="space-y-1.5 text-[11px] tabular-nums">
                {data.mempool_blocks.map((b) => (
                  <div
                    key={b.label}
                    className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2"
                  >
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">{b.label}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {b.tx_count.toLocaleString("en-US")} tx · {b.block_vsize_mb} vMB
                      </div>
                    </div>
                    <span className="rounded-[3px] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-amber)]">
                      ~{b.median_fee} sat/vB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </TerminalPageShell>
  );
}
