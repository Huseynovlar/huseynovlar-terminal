import { useEffect, useMemo, useState } from "react";

import { Calculator, Check, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";

interface ContractSpec {
  symbol: string;
  name: string;
  category: string;
  contract_size: number;
  tick_size: number;
  tick_value: number;
  pip_size: number;
  min_lot: number;
  lot_step: number;
  default_leverage: number;
  default_price: number;
}

interface Mt5AccountSpec {
  id: string;
  name: string;
  mt5_login: string;
  broker: string;
  currency: string;
  account_type: "standard" | "raw" | "cent";
  balance_raw: number;
  equity_raw: number;
  balance_usd: number;
  equity_usd: number;
  leverage: number;
}

interface Mt5RiskCalcModalProps {
  open: boolean;
  initialSymbol?: string;
  onClose: () => void;
}

const FALLBACK_SPECS: ContractSpec[] = [
  { symbol: "XAUUSD", name: "Gold / US Dollar", category: "metals", contract_size: 100, tick_size: 0.01, tick_value: 1, pip_size: 0.1, min_lot: 0.01, lot_step: 0.01, default_leverage: 500, default_price: 2650 },
  { symbol: "USTEC", name: "US Tech 100", category: "indices", contract_size: 1, tick_size: 0.01, tick_value: 0.01, pip_size: 1, min_lot: 0.01, lot_step: 0.01, default_leverage: 200, default_price: 20800 },
  { symbol: "BTCUSD", name: "Bitcoin / USD", category: "crypto", contract_size: 1, tick_size: 0.01, tick_value: 0.01, pip_size: 1, min_lot: 0.01, lot_step: 0.01, default_leverage: 200, default_price: 95000 },
  { symbol: "EURUSD", name: "Euro / USD", category: "forex", contract_size: 100000, tick_size: 0.00001, tick_value: 1, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01, default_leverage: 500, default_price: 1.085 },
];

export function Mt5RiskCalcModal({ open, initialSymbol, onClose }: Mt5RiskCalcModalProps) {
  const [specs, setSpecs] = useState<ContractSpec[]>(FALLBACK_SPECS);
  const [accounts, setAccounts] = useState<Mt5AccountSpec[]>([]);
  const [accountId, setAccountId] = useState<string>("manual");
  const [symbol, setSymbol] = useState<string>(initialSymbol?.toUpperCase() || "XAUUSD");
  const [balanceUsd, setBalanceUsd] = useState<string>("10000");
  const [leverage, setLeverage] = useState<string>("500");
  const [riskMode, setRiskMode] = useState<"pct" | "usd">("pct");
  const [riskValue, setRiskValue] = useState<string>("1.0");
  const [entry, setEntry] = useState<string>("2650");
  const [stopLoss, setStopLoss] = useState<string>("2635");
  const [takeProfit, setTakeProfit] = useState<string>("2680");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiRequest<{ specs: ContractSpec[]; accounts: Mt5AccountSpec[] }>("/pro/contract-specs")
      .then((res) => {
        if (cancelled) return;
        if (res.specs?.length) setSpecs(res.specs);
        if (res.accounts?.length) {
          setAccounts(res.accounts);
          const first = res.accounts[0];
          setAccountId(first.id);
          setBalanceUsd(String(first.equity_usd || first.balance_usd || 10000));
          setLeverage(String(first.leverage || 500));
        }
      })
      .catch(() => {
        // use fallback specs
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const targetSym = (initialSymbol || symbol).toUpperCase();
    const spec = specs.find((s) => s.symbol === targetSym) ?? specs[0];
    if (spec) {
      setSymbol(spec.symbol);
      const px = spec.default_price;
      const step = spec.category === "forex" ? 0.003 : spec.category === "metals" ? 15 : px * 0.01;
      setEntry(String(px));
      setStopLoss(String(Number((px - step).toFixed(spec.category === "forex" ? 5 : 2))));
      setTakeProfit(String(Number((px + step * 2).toFixed(spec.category === "forex" ? 5 : 2))));
    }
  }, [open, initialSymbol, specs]);

  const activeSpec = useMemo(
    () => specs.find((s) => s.symbol === symbol) ?? specs[0] ?? FALLBACK_SPECS[0],
    [specs, symbol],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const handleAccountChange = (id: string) => {
    setAccountId(id);
    const acc = accounts.find((a) => a.id === id);
    if (acc) {
      setBalanceUsd(String(acc.equity_usd || acc.balance_usd));
      setLeverage(String(acc.leverage || 500));
    }
  };

  const handleSymbolChange = (nextSym: string) => {
    setSymbol(nextSym);
    const spec = specs.find((s) => s.symbol === nextSym);
    if (spec) {
      const px = spec.default_price;
      const step = spec.category === "forex" ? 0.003 : spec.category === "metals" ? 15 : px * 0.01;
      setEntry(String(px));
      setStopLoss(String(Number((px - step).toFixed(spec.category === "forex" ? 5 : 2))));
      setTakeProfit(String(Number((px + step * 2).toFixed(spec.category === "forex" ? 5 : 2))));
    }
  };

  const calc = useMemo(() => {
    const bal = Math.max(0, Number.parseFloat(balanceUsd) || 0);
    const lev = Math.max(1, Number.parseFloat(leverage) || activeSpec.default_leverage || 100);
    const rv = Math.max(0, Number.parseFloat(riskValue) || 0);
    const en = Number.parseFloat(entry) || 0;
    const sl = Number.parseFloat(stopLoss) || 0;
    const tp = Number.parseFloat(takeProfit) || 0;

    const riskUsd = riskMode === "pct" ? (bal * rv) / 100 : rv;
    const riskUsc = riskUsd * 100;
    const slDist = Math.abs(en - sl);
    const tpDist = Math.abs(tp - en);

    // USD loss per 1.00 standard lot for given price distance
    let usdPerLotPerUnit = activeSpec.contract_size;
    if (activeSpec.symbol === "USDJPY" && en > 0) {
      usdPerLotPerUnit = activeSpec.contract_size / en;
    }
    const lossPerStdLot = slDist * usdPerLotPerUnit;
    const rawStdLot = lossPerStdLot > 0 ? riskUsd / lossPerStdLot : 0;

    const roundLot = (v: number) => Math.max(0, Math.floor(v / activeSpec.lot_step) * activeSpec.lot_step);
    const stdLot = roundLot(rawStdLot);
    // Raw accounts share same contract size as Standard (1.00 lot = contract_size); Cent/USC contract is 1/100th (so 100x lots)
    const rawLot = stdLot;
    const centLot = roundLot(rawStdLot * 100);

    const rr = slDist > 0 && tpDist > 0 ? tpDist / slDist : 0;
    const rewardUsd = riskUsd * rr;
    const notionalUsd = stdLot * activeSpec.contract_size * (activeSpec.symbol.startsWith("USD") ? 1 : en);
    const requiredMarginUsd = lev > 0 ? notionalUsd / lev : 0;
    const marginPct = bal > 0 ? (requiredMarginUsd / bal) * 100 : 0;

    return {
      riskUsd,
      riskUsc,
      rewardUsd,
      rr,
      stdLot,
      rawLot,
      centLot,
      requiredMarginUsd,
      marginPct,
      slDist,
      direction: en > sl ? "BUY" : en < sl ? "SELL" : "—",
    };
  }, [balanceUsd, leverage, riskMode, riskValue, entry, stopLoss, takeProfit, activeSpec]);

  const copyLot = async (key: string, val: number) => {
    const txt = val.toFixed(2);
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedKey(key);
      notify.success("Лот скопирован", `${activeSpec.symbol}: ${txt} lot (${key})`);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      notify.info("Объём", `${txt} lot`);
    }
  };

  if (!open) return null;

  const accountOptions = [
    { value: "manual", label: "Ручной баланс (USD)" },
    ...accounts.map((a) => ({
      value: a.id,
      label: `${a.name} (#${a.mt5_login}) • $${a.equity_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}${a.currency === "USC" ? " [USC ÷100]" : ""}`,
    })),
  ];

  const symbolOptions = specs.map((s) => ({
    value: s.symbol,
    label: `${s.symbol} — ${s.name}`,
  }));

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-[var(--accent-blue)]" />
            <span className="text-[12px] font-semibold tracking-wide uppercase">
              Калькулятор риска и лота MT5 (CALC)
            </span>
            <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
              {calc.direction}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {/* Left inputs */}
          <div className="space-y-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Торговый счёт MT5 (USC ÷ 100 → USD)
              </label>
              <SearchSelect
                value={accountId}
                onValueChange={handleAccountChange}
                options={accountOptions}
                placeholder="Выберите счёт..."
              />
              {selectedAccount?.currency === "USC" && (
                <div className="mt-1 font-mono text-[10px] text-[var(--accent-amber)] tabular-nums">
                  Центовый счёт: {selectedAccount.equity_raw.toLocaleString("en-US")} USC ÷ 100 = $
                  {selectedAccount.equity_usd.toLocaleString("en-US")} USD
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Инструмент (Contract: {activeSpec.contract_size.toLocaleString("en-US")} | Tick: {activeSpec.tick_size})
              </label>
              <SearchSelect
                value={symbol}
                onValueChange={handleSymbolChange}
                options={symbolOptions}
                placeholder="Тикер..."
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Баланс / Эквити ($ USD)
                </label>
                <input
                  type="number"
                  step="any"
                  value={balanceUsd}
                  onChange={(e) => setBalanceUsd(e.target.value)}
                  className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[12px] tabular-nums focus:border-[var(--accent-blue)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Плечо (1:N)
                </label>
                <input
                  type="number"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[12px] tabular-nums focus:border-[var(--accent-blue)] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Риск на сделку
                </label>
                <div className="flex rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setRiskMode("pct")}
                    className={`rounded-[2px] px-2 py-0.5 font-semibold ${
                      riskMode === "pct" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    % Депозита
                  </button>
                  <button
                    type="button"
                    onClick={() => setRiskMode("usd")}
                    className={`rounded-[2px] px-2 py-0.5 font-semibold ${
                      riskMode === "usd" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    $ USD
                  </button>
                </div>
              </div>
              <input
                type="number"
                step="0.1"
                value={riskValue}
                onChange={(e) => setRiskValue(e.target.value)}
                className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[12px] tabular-nums focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Entry
                </label>
                <input
                  type="number"
                  step="any"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-mono text-[12px] tabular-nums focus:border-[var(--accent-blue)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--bear)]">
                  Stop-Loss
                </label>
                <input
                  type="number"
                  step="any"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  className="h-8 w-full rounded-[4px] border border-[var(--bear)]/40 bg-[var(--bg-canvas)] px-2 font-mono text-[12px] tabular-nums focus:border-[var(--bear)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--bull)]">
                  Take-Profit
                </label>
                <input
                  type="number"
                  step="any"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  className="h-8 w-full rounded-[4px] border border-[var(--bull)]/40 bg-[var(--bg-canvas)] px-2 font-mono text-[12px] tabular-nums focus:border-[var(--bull)] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Right outputs */}
          <div className="flex flex-col justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Рекомендуемый объём (MT5 Lots)
              </div>

              {(
                [
                  { key: "Standard", label: "Standard (USD)", lot: calc.stdLot, highlight: selectedAccount?.account_type === "standard" },
                  { key: "Raw", label: "Raw Spread (USD)", lot: calc.rawLot, highlight: selectedAccount?.account_type === "raw" },
                  { key: "Cent", label: "Cent / USC (×100)", lot: calc.centLot, highlight: selectedAccount?.account_type === "cent" },
                ] as const
              ).map((row) => (
                <div
                  key={row.key}
                  className={`flex items-center justify-between rounded-[4px] border px-2.5 py-2 ${
                    row.highlight
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  }`}
                >
                  <div>
                    <div className="text-[11px] font-medium text-[var(--text-secondary)]">{row.label}</div>
                    <div className="font-mono text-[18px] font-bold tabular-nums text-[var(--text-primary)]">
                      {row.lot.toFixed(2)} <span className="text-[11px] font-normal text-[var(--text-muted)]">lot</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => void copyLot(row.key, row.lot)}
                  >
                    {copiedKey === row.key ? <Check className="size-3 text-[var(--bull)]" /> : <Copy className="size-3" />}
                    <span>Копировать</span>
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] tabular-nums">
              <div>
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Риск ($ / USC)</div>
                <div className="font-mono font-semibold text-[var(--bear)]">
                  -${calc.riskUsd.toFixed(2)}
                </div>
                <div className="font-mono text-[10px] text-[var(--text-muted)]">
                  {calc.riskUsc.toLocaleString("en-US", { maximumFractionDigits: 0 })} USC
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Потенциал / R:R</div>
                <div className="font-mono font-semibold text-[var(--bull)]">
                  +${calc.rewardUsd.toFixed(2)}
                </div>
                <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                  1 : {calc.rr > 0 ? calc.rr.toFixed(2) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Требуемая маржа</div>
                <div className="font-mono font-semibold text-[var(--text-primary)]">
                  ${calc.requiredMarginUsd.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Загрузка маржи</div>
                <div
                  className="font-mono font-semibold"
                  style={{ color: calc.marginPct > 35 ? "var(--bear)" : "var(--text-primary)" }}
                >
                  {calc.marginPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
