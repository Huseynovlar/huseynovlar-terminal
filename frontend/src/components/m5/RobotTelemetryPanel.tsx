import { Activity, Gauge, ShieldAlert, TrendingDown, TrendingUp, Vault } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RobotTelemetryPanelProps {
  state: Record<string, unknown> | null | undefined;
  title?: string;
}

function numVal(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function strVal(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function boolVal(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  return null;
}

/**
 * Full real-time MQL5 strategy telemetry panel for GoldPulseReversion v8.1.0 & NasdaqPulseReversion v3.01.
 * Displays every indicator, filter state, risk multiplier, Profit Bank, and daily accounting metric.
 */
export function RobotTelemetryPanel({
  state,
  title = "Live Strategy Indicators (MQL5 Telemetry)",
}: RobotTelemetryPanelProps) {
  const raw = state && typeof state === "object" ? state : {};
  const regime = strVal(raw, "regime");
  const signalBias = strVal(raw, "signal_bias");
  const waitReason = strVal(raw, "wait_reason");
  const riskMode = strVal(raw, "risk_mode");

  const rsiM5 = numVal(raw, "rsi_m5");
  const erH1 = numVal(raw, "er_h1");
  const vwap = numVal(raw, "vwap");
  const vwapZ = numVal(raw, "vwap_z");
  const atrPct = numVal(raw, "atr_pct");
  const atrVal = numVal(raw, "atr_val");
  const bbUpper = numVal(raw, "bb_upper");
  const bbMid = numVal(raw, "bb_mid");
  const bbLower = numVal(raw, "bb_lower");
  const spread = numVal(raw, "spread");
  const riskPct = numVal(raw, "risk_pct");
  const nextLot = numVal(raw, "next_lot");
  const edgeMult = numVal(raw, "edge_mult");
  const volMult = numVal(raw, "vol_mult");
  const shieldMult = numVal(raw, "shield_mult");

  const workBal = numVal(raw, "work_balance");
  const bankBal = numVal(raw, "bank_balance");
  const ddPct = numVal(raw, "dd_pct");
  const dayPnl = numVal(raw, "day_pnl");
  const dayTrades = numVal(raw, "day_trades");
  const dayWins = numVal(raw, "day_wins");
  const consecWins = numVal(raw, "consec_wins");
  const consecLoss = numVal(raw, "consec_loss");
  const dayBlocked = boolVal(raw, "day_blocked");
  const dayReason = strVal(raw, "day_reason");
  const paused = boolVal(raw, "paused");
  const algoEnabled = boolVal(raw, "algo_enabled");
  const marketOpen = boolVal(raw, "market_open");

  const hasIndicators =
    regime !== null ||
    rsiM5 !== null ||
    erH1 !== null ||
    vwapZ !== null ||
    bbMid !== null ||
    workBal !== null;

  const regimeColor =
    regime?.includes("ACTIVE") || regime?.includes("READY") || regime === "MEAN_REVERSION"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : regime?.includes("SHOCK") || regime?.includes("LOCK") || regime?.includes("WRONG") || regime?.includes("SPREAD")
        ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
        : "border-amber-500/40 bg-amber-500/10 text-amber-500";

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Activity className="size-4 text-emerald-500" />
          {title}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {regime ? (
            <Badge variant="outline" className={`font-mono text-[10px] ${regimeColor}`}>
              {regime}
            </Badge>
          ) : null}
          {signalBias ? (
            <Badge variant="secondary" className="inline-flex items-center gap-1 font-mono text-[10px]">
              {signalBias.toUpperCase().includes("LONG") || signalBias.toUpperCase().includes("BUY") ? (
                <TrendingUp className="size-3 text-emerald-500" />
              ) : signalBias.toUpperCase().includes("SHORT") || signalBias.toUpperCase().includes("SELL") ? (
                <TrendingDown className="size-3 text-rose-500" />
              ) : null}
              {signalBias}
            </Badge>
          ) : null}
          {riskMode ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {riskMode}
            </Badge>
          ) : null}
          {paused ? (
            <Badge variant="destructive" className="font-mono text-[10px]">
              PAUSED
            </Badge>
          ) : null}
          {algoEnabled !== null ? (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ${algoEnabled ? "text-emerald-500" : "text-rose-500"}`}
            >
              ALGO: {algoEnabled ? "ON" : "OFF"}
            </Badge>
          ) : null}
          {marketOpen !== null ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              MKT: {marketOpen ? "OPEN" : "CLOSED"}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {waitReason ? (
          <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Filter / Next:</span> {waitReason}
          </div>
        ) : null}

        {hasIndicators ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rsiM5 !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">RSI (M5)</div>
                <div
                  className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                    rsiM5 <= 30 ? "text-emerald-500" : rsiM5 >= 70 ? "text-rose-500" : ""
                  }`}
                >
                  {rsiM5.toFixed(1)}
                </div>
              </div>
            ) : null}

            {erH1 !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Gauge className="size-3" />
                  Kaufman ER (H1)
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums">{erH1.toFixed(3)}</div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${erH1 > 0.45 ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, Math.max(4, erH1 * 100))}%` }}
                  />
                </div>
              </div>
            ) : null}

            {vwap !== null || vwapZ !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">VWAP / Z-Score</div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                  {vwapZ !== null ? `${vwapZ >= 0 ? "+" : ""}${vwapZ.toFixed(2)}σ` : "—"}
                </div>
                {vwap !== null && vwap > 0 ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    VWAP: {vwap.toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {atrPct !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldAlert className="size-3" />
                  ATR % / Value
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums">{atrPct.toFixed(3)}%</div>
                {atrVal !== null && atrVal > 0 ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    ATR: {atrVal.toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {bbMid !== null && bbMid > 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">Bollinger (20, 2.0)</div>
                <div className="mt-1 space-y-0.5 font-mono text-[10px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">UP</span>
                    <span>{bbUpper !== null ? bbUpper.toFixed(2) : "—"}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-muted-foreground">MID</span>
                    <span>{bbMid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">LO</span>
                    <span>{bbLower !== null ? bbLower.toFixed(2) : "—"}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {riskPct !== null || nextLot !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">Risk % / Next Lot</div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                  {riskPct !== null ? `${riskPct.toFixed(2)}%` : "—"} / {nextLot !== null ? nextLot.toFixed(2) : "—"}
                </div>
                {spread !== null ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    Spread: {spread.toFixed(3)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {edgeMult !== null || volMult !== null || shieldMult !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">Sizing Multipliers</div>
                <div className="mt-1 font-mono text-[11px] font-semibold tabular-nums">
                  E:{(edgeMult ?? 1).toFixed(2)} • V:{(volMult ?? 1).toFixed(2)} • S:{(shieldMult ?? 1).toFixed(2)}
                </div>
              </div>
            ) : null}

            {workBal !== null || bankBal !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Vault className="size-3 text-emerald-500" />
                  Profit Bank (Work / Bank)
                </div>
                <div className="mt-1 font-mono text-xs font-bold tabular-nums">
                  ${(workBal ?? 0).toFixed(2)} / ${(bankBal ?? 0).toFixed(2)}
                </div>
                {ddPct !== null ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    DD: {ddPct.toFixed(2)}%
                  </div>
                ) : null}
              </div>
            ) : null}

            {dayPnl !== null || dayTrades !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">Day PnL / Trades</div>
                <div
                  className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                    (dayPnl ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {(dayPnl ?? 0) >= 0 ? "+" : "-"}${Math.abs(dayPnl ?? 0).toFixed(2)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {dayWins ?? 0}/{dayTrades ?? 0} wins • Streak W{consecWins ?? 0}/L{consecLoss ?? 0}
                </div>
                {dayBlocked && dayReason ? (
                  <div className="mt-0.5 font-mono text-[10px] text-rose-500">LOCK: {dayReason}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
            Индикаторы стратегии ещё не поступали. Скомпилируй обновлённый <code className="font-mono">.mq5</code> из{" "}
            <code className="font-mono">mql5/patched/</code> вместе с <code className="font-mono">ExnessPanelHook.mqh</code> —
            телеметрия появится здесь в реальном времени без нагрузки на <code className="font-mono">OnTick()</code>.
          </div>
        )}

        <details className="group">
          <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground hover:text-foreground">
            Raw Telemetry JSON ({Object.keys(raw).length} fields)
          </summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/40 p-2.5 font-mono text-[11px]">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
