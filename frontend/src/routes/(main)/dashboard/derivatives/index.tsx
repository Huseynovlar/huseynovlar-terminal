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
    fear_greed_value: number;
    fear_greed_label: string;
    btc_hashrate_ehs: number;
    btc_difficulty_t: number;
  };
  stablecoin_series: Array<{ date: string; mcap_b: number }>;
  stablecoins_breakdown: Array<{
    symbol: string;
    name: string;
    mcap_b: number;
    share_pct: number;
    delta_7d_pct: number;
    delta_30d_pct: number;
  }>;
  top_chains: Array<{ name: string; tvl_usd: number; share_pct: number }>;
  top_protocols: Array<{
    name: string;
    category: string;
    chain: string;
    tvl_usd: number;
    change_1d_pct: number;
    change_7d_pct: number;
    fees_24h_usd: number;
    revenue_24h_usd: number;
  }>;
  derivatives: Array<{
    symbol: string;
    binance_symbol: string;
    mark_price: number;
    open_interest_usd: number;
    oi_change_24h_pct: number | null;
    funding_rate_pct: number;
    annualized_funding_pct: number;
    long_short_ratio: number;
  }>;
  deribit_options: Array<{
    asset: string;
    dvol: number;
    put_call_oi: number;
    put_call_vol: number;
    max_pain_usd: number;
    skew_25d_pct: number;
    skew_bias: string;
  }>;
  liquidations: Array<{
    window: string;
    longs_m: number;
    shorts_m: number;
    total_m: number;
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
    fee_min: number;
    fee_max: number;
    total_fees_btc: number;
    block_vsize_mb: number;
  }>;
}

function fmtCompact(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
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

  // Live Mempool.space WebSocket — fixed medianFee + feeRange + totalFees BTC, 3s throttled silent patches
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
          const blocks = msg["mempool-blocks"] as Array<Record<string, unknown>> | undefined;
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
              ? blocks.slice(0, 4).map((b, idx) => {
                  const range = Array.isArray(b.feeRange) ? (b.feeRange as number[]).filter((x) => Number.isFinite(x)) : [];
                  let rawMed = Number(b.medianFee ?? 0);
                  if (rawMed < 0.5 && range.length > 0) rawMed = range[Math.floor(range.length / 2)];
                  const medClean = rawMed >= 10 ? Math.round(rawMed) : Number(rawMed.toFixed(1));
                  const fMin = range.length > 0 ? Number(range[0].toFixed(1)) : medClean;
                  const fMax = range.length > 0 ? Number(range[range.length - 1].toFixed(1)) : medClean;
                  const totalBtc = Number((Number(b.totalFees ?? 0) / 1e8).toFixed(4));
                  return {
                    label: idx === 0 ? "Next Block" : `+${idx}`,
                    tx_count: Math.round(Number(b.nTx ?? 0)),
                    median_fee: medClean,
                    fee_min: fMin,
                    fee_max: fMax,
                    total_fees_btc: totalBtc,
                    block_vsize_mb: Number((Number(b.blockVSize ?? 0) / 1e6).toFixed(2)),
                  };
                })
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
      subtitle="DefiLlama Top-20 Protocols & Stablecoins · Deribit Options (DVOL/Max Pain/Skew) · Binance Futures & Liquidations · Mempool.space WS"
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
          {/* 7-Cell Expanded Live Metrics Strip (includes Fear & Greed + BTC Hashrate/Difficulty) */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4 lg:grid-cols-7">
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">Total DeFi TVL</span>
              <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                ${k.total_defi_tvl_b.toFixed(2)}B
              </span>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">Stablecoins (Δ 7d)</span>
              <div className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">${k.stablecoins_mcap_b.toFixed(1)}B</span>
                <span className="text-[10px] font-semibold" style={{ color: k.stablecoins_7d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {k.stablecoins_7d_pct >= 0 ? "+" : ""}{k.stablecoins_7d_pct.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">BTC Mempool Fee</span>
              <span className="text-[15px] font-semibold tabular-nums text-[var(--accent-amber)]">
                {k.btc_mempool_fee} <span className="text-[10px] font-normal text-[var(--text-muted)]">sat/vB</span>
              </span>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">BTC Funding (8h)</span>
              <span className="text-[15px] font-semibold tabular-nums" style={{ color: k.btc_funding_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                {k.btc_funding_pct >= 0 ? "+" : ""}{k.btc_funding_pct.toFixed(4)}%
              </span>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">Deribit DVOL</span>
              <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.deribit_dvol_btc.toFixed(2)}
              </span>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">Fear &amp; Greed</span>
              <span
                className="text-[14px] font-semibold tabular-nums"
                style={{ color: k.fear_greed_value >= 55 ? "var(--bull)" : k.fear_greed_value <= 40 ? "var(--bear)" : "var(--accent-amber)" }}
              >
                {k.fear_greed_value} <span className="text-[10px] font-normal">({k.fear_greed_label})</span>
              </span>
            </div>
            <div className="flex h-[54px] flex-col justify-center bg-[var(--bg-panel)] px-2.5">
              <span className="text-[9px] uppercase text-[var(--text-muted)]">BTC Hashrate / Diff</span>
              <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">
                {k.btc_hashrate_ehs} EH/s · {k.btc_difficulty_t}T
              </span>
            </div>
          </div>

          {/* Row 1: Stablecoins Chart + Stablecoins Breakdown (USDT/USDC/USDe/DAI/FDUSD) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 lg:col-span-7">
              <div className="mb-2 border-b border-[var(--border-subtle)] pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Капитализация стейблкоинов (90D · DefiLlama)
              </div>
              <StablecoinsMcapChart series={data.stablecoin_series} />
            </div>

            <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-5">
              <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Потоки стейблкоинов (USDT / USDC / USDe / DAI / FDUSD)
              </div>
              <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                <thead>
                  <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="px-3">Монета</th>
                    <th className="px-2 text-right">MCap</th>
                    <th className="px-2 text-right">Доля</th>
                    <th className="px-2 text-right">Δ 7d</th>
                    <th className="px-3 text-right">Δ 30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {data.stablecoins_breakdown.map((s) => (
                    <tr key={s.symbol} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                      <td className="px-3 font-semibold text-[var(--text-primary)]">{s.symbol}</td>
                      <td className="px-2 text-right text-[var(--text-secondary)]">${s.mcap_b.toFixed(1)}B</td>
                      <td className="px-2 text-right text-[var(--text-muted)]">{s.share_pct.toFixed(1)}%</td>
                      <td className="px-2 text-right font-semibold" style={{ color: s.delta_7d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                        {s.delta_7d_pct >= 0 ? "+" : ""}{s.delta_7d_pct.toFixed(2)}%
                      </td>
                      <td className="px-3 text-right font-semibold" style={{ color: s.delta_30d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                        {s.delta_30d_pct >= 0 ? "+" : ""}{s.delta_30d_pct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Row 2: Deribit Options & Volatility (BTC/ETH) + Liquidations (1h/4h/24h) + Fixed Mempool */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-8">
              {/* Deribit Options Panel */}
              <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Рынок опционов и волатильности (Deribit — BTC &amp; ETH)
                </div>
                <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                  <thead>
                    <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                      <th className="px-3">Актив</th>
                      <th className="px-2 text-right">DVOL</th>
                      <th className="px-2 text-right">Put/Call (OI)</th>
                      <th className="px-2 text-right">Put/Call (Vol)</th>
                      <th className="px-2 text-right">Max Pain</th>
                      <th className="px-3 text-right">25-Delta Skew</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.deribit_options.map((o) => (
                      <tr key={o.asset} className="h-9 hover:bg-[var(--bg-elevated)]/40">
                        <td className="px-3 font-semibold text-[var(--text-primary)]">{o.asset} Options</td>
                        <td className="px-2 text-right font-semibold text-[var(--accent-amber)]">{o.dvol.toFixed(2)}</td>
                        <td className="px-2 text-right text-[var(--text-secondary)]">{o.put_call_oi.toFixed(2)}</td>
                        <td className="px-2 text-right text-[var(--text-secondary)]">{o.put_call_vol.toFixed(2)}</td>
                        <td className="px-2 text-right font-semibold text-[var(--text-primary)]">
                          ${o.max_pain_usd.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 text-right font-semibold text-[var(--bull)]">
                          {o.skew_25d_pct.toFixed(1)}% ({o.skew_bias})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Liquidations 1h / 4h / 24h */}
              <div className="grid grid-cols-3 gap-2">
                {data.liquidations.map((liq) => {
                  const longPct = liq.total_m > 0 ? (liq.longs_m / liq.total_m) * 100 : 50;
                  return (
                    <div
                      key={liq.window}
                      className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5 tabular-nums"
                    >
                      <div className="flex items-center justify-between text-[10px] uppercase text-[var(--text-muted)]">
                        <span>Ликвидации {liq.window}</span>
                        <span className="font-semibold text-[var(--text-primary)]">${liq.total_m.toFixed(1)}M</span>
                      </div>
                      <div className="my-1.5 flex h-2 overflow-hidden rounded-[2px] bg-[var(--bg-canvas)]">
                        <div style={{ width: `${longPct}%`, backgroundColor: "var(--bear)" }} />
                        <div style={{ width: `${100 - longPct}%`, backgroundColor: "var(--bull)" }} />
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[var(--bear)]">Longs: ${liq.longs_m.toFixed(1)}M</span>
                        <span className="text-[var(--bull)]">Shorts: ${liq.shorts_m.toFixed(1)}M</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Fixed Bitcoin Mempool Block Cards */}
            <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 lg:col-span-4">
              <div className="mb-2 flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Bitcoin Mempool (Live)
                </span>
                <span className="text-[10px] font-semibold" style={{ color: mempoolWsLive ? "var(--bull)" : "var(--text-muted)" }}>
                  {mempoolWsLive ? "● WS" : "○ REST"}
                </span>
              </div>
              <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center tabular-nums">
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Fast</div>
                  <div className="text-[13px] font-semibold text-[var(--bear)]">{data.mempool_fees.fastest} sat/vB</div>
                </div>
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Medium</div>
                  <div className="text-[13px] font-semibold text-[var(--accent-amber)]">{data.mempool_fees.half_hour} sat/vB</div>
                </div>
                <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5">
                  <div className="text-[9px] uppercase text-[var(--text-muted)]">Economy</div>
                  <div className="text-[13px] font-semibold text-[var(--bull)]">{data.mempool_fees.economy} sat/vB</div>
                </div>
              </div>
              <div className="space-y-1.5 text-[11px] tabular-nums">
                {data.mempool_blocks.map((b) => (
                  <div
                    key={b.label}
                    className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2"
                  >
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {b.label} · <span className="text-[var(--accent-amber)]">~{b.median_fee} sat/vB</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {b.tx_count.toLocaleString("en-US")} tx · {b.block_vsize_mb} vMB · {b.total_fees_btc.toFixed(3)} BTC
                      </div>
                    </div>
                    <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                      {b.fee_min}–{b.fee_max} sat/vB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 3: Binance Futures Derivatives Table (with Annualized Funding %) */}
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Деривативы Binance Futures — OI, OI Δ 24h, Funding 8h &amp; Annualized (%)
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="px-3">Актив</th>
                  <th className="px-2 text-right">Mark Price</th>
                  <th className="px-2 text-right">Open Interest ($)</th>
                  <th className="px-2 text-right">OI Δ 24h</th>
                  <th className="px-2 text-right">Funding (8h)</th>
                  <th className="px-2 text-right">Funding (Годовых)</th>
                  <th className="px-3 text-right">Long / Short</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.derivatives.map((d) => (
                  <tr
                    key={d.symbol}
                    onClick={() => void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: d.symbol } })}
                    className="h-9 cursor-pointer hover:bg-[var(--bg-elevated)]/50"
                  >
                    <td className="px-3">
                      <div className="flex items-center gap-1.5">
                        <AssetLogo symbol={d.symbol} size={16} />
                        <span className="font-semibold text-[var(--text-primary)]">{d.symbol}</span>
                      </div>
                    </td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">${d.mark_price.toLocaleString("en-US")}</td>
                    <td className="px-2 text-right font-semibold text-[var(--text-primary)]">{fmtCompact(d.open_interest_usd)}</td>
                    <td
                      className="px-2 text-right font-semibold"
                      style={{
                        color:
                          d.oi_change_24h_pct === null
                            ? "var(--text-muted)"
                            : d.oi_change_24h_pct >= 0
                              ? "var(--bull)"
                              : "var(--bear)",
                      }}
                    >
                      {d.oi_change_24h_pct === null ? "—" : `${d.oi_change_24h_pct >= 0 ? "+" : ""}${d.oi_change_24h_pct.toFixed(2)}%`}
                    </td>
                    <td className="px-2 text-right font-semibold" style={{ color: d.funding_rate_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                      {d.funding_rate_pct >= 0 ? "+" : ""}{d.funding_rate_pct.toFixed(4)}%
                    </td>
                    <td className="px-2 text-right font-semibold" style={{ color: d.annualized_funding_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                      {d.annualized_funding_pct >= 0 ? "+" : ""}{d.annualized_funding_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 text-right font-semibold" style={{ color: d.long_short_ratio >= 1 ? "var(--bull)" : "var(--bear)" }}>
                      {d.long_short_ratio.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Row 4: Top-20 DeFi Protocols by TVL (DefiLlama) */}
          <div className="overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Топ-{data.top_protocols.length} DeFi протоколов по TVL (DefiLlama)
            </div>
            <table className="w-full border-collapse text-left text-[11px] tabular-nums">
              <thead>
                <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="px-3">Протокол</th>
                  <th className="px-2">Категория</th>
                  <th className="px-2">Сеть</th>
                  <th className="px-2 text-right">TVL ($)</th>
                  <th className="px-2 text-right">Δ 24h</th>
                  <th className="px-2 text-right">Δ 7d</th>
                  <th className="px-2 text-right">Fees 24h</th>
                  <th className="px-3 text-right">Revenue 24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.top_protocols.map((p) => (
                  <tr key={p.name} className="h-8 hover:bg-[var(--bg-elevated)]/40">
                    <td className="px-3 font-semibold text-[var(--text-primary)]">{p.name}</td>
                    <td className="px-2 text-[var(--text-muted)]">{p.category}</td>
                    <td className="px-2 text-[var(--text-secondary)]">{p.chain}</td>
                    <td className="px-2 text-right font-semibold text-[var(--text-primary)]">{fmtCompact(p.tvl_usd)}</td>
                    <td className="px-2 text-right font-semibold" style={{ color: p.change_1d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                      {p.change_1d_pct >= 0 ? "+" : ""}{p.change_1d_pct.toFixed(2)}%
                    </td>
                    <td className="px-2 text-right font-semibold" style={{ color: p.change_7d_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                      {p.change_7d_pct >= 0 ? "+" : ""}{p.change_7d_pct.toFixed(2)}%
                    </td>
                    <td className="px-2 text-right text-[var(--text-secondary)]">{fmtCompact(p.fees_24h_usd)}</td>
                    <td className="px-3 text-right text-[var(--bull)]">{fmtCompact(p.revenue_24h_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </TerminalPageShell>
  );
}
