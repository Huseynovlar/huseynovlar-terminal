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

/**
 * Visual real-time indicator panel for MQL5 robots (GoldPulseReversion / NasdaqPulseReversion).
 * Renders ER H1, Session VWAP + Z-Score, Bollinger Bands (20,2), Vol-Shock ratio, Regime, and Profit Bank.
 */
export function RobotTelemetryPanel({ state, title = "Live Strategy Indicators (MQL5 Telemetry)" }: RobotTelemetryPanelProps) {
  const raw = state && typeof state === "object" ? state : {};
  const regime = strVal(raw, "regime");
  const signalBias = strVal(raw, "signal_bias");
  const erH1 = numVal(raw, "er_h1");
  const vwap = numVal(raw, "vwap");
  const vwapZ = numVal(raw, "vwap_z");
  const bbUpper = numVal(raw, "bb_upper");
  const bbMid = numVal(raw, "bb_mid");
  const bbLower = numVal(raw, "bb_lower");
  const volRatio = numVal(raw, "vol_ratio");
  const atr5 = numVal(raw, "atr5");
  const atr20 = numVal(raw, "atr20");
  const workBal = numVal(raw, "work_balance");
  const bankBal = numVal(raw, "bank_balance");
  const ddPct = numVal(raw, "dd_pct");

  const hasIndicators =
    regime !== null ||
    erH1 !== null ||
    vwap !== null ||
    bbMid !== null ||
    volRatio !== null ||
    workBal !== null;

  const regimeColor =
    regime === "MEAN_REVERSION" || regime === "ACTIVE"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : regime === "VOL_SHOCK" || regime === "TREND_BLOCKED"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
        : "border-amber-500/40 bg-amber-500/10 text-amber-500";

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Activity className="size-4 text-emerald-500" />
          {title}
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {regime ? (
            <Badge variant="outline" className={`font-mono text-[10px] ${regimeColor}`}>
              {regime}
            </Badge>
          ) : null}
          {signalBias ? (
            <Badge variant="secondary" className="inline-flex items-center gap-1 font-mono text-[10px]">
              {signalBias === "LONG" ? (
                <TrendingUp className="size-3 text-emerald-500" />
              ) : signalBias === "SHORT" ? (
                <TrendingDown className="size-3 text-rose-500" />
              ) : null}
              {signalBias}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasIndicators ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
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
                <div className="text-[10px] text-muted-foreground">Session VWAP / Z-Score</div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                  {vwap !== null ? vwap.toFixed(2) : "—"}
                </div>
                {vwapZ !== null ? (
                  <div
                    className={`mt-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                      Math.abs(vwapZ) >= 2 ? "text-amber-500" : "text-muted-foreground"
                    }`}
                  >
                    Z = {vwapZ >= 0 ? "+" : ""}
                    {vwapZ.toFixed(2)}σ
                  </div>
                ) : null}
              </div>
            ) : null}

            {bbMid !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="text-[10px] text-muted-foreground">Bollinger (20, 2.0)</div>
                <div className="mt-1 space-y-0.5 font-mono text-[11px] tabular-nums">
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

            {volRatio !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldAlert className="size-3" />
                  Vol-Shock (ATR5/20)
                </div>
                <div
                  className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                    volRatio >= 1.8 ? "text-rose-500" : "text-emerald-500"
                  }`}
                >
                  {volRatio.toFixed(2)}x
                </div>
                {atr5 !== null && atr20 !== null ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {atr5.toFixed(2)} / {atr20.toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {workBal !== null || bankBal !== null ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Vault className="size-3 text-emerald-500" />
                  Profit Bank (Work / Vault)
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
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
            Индикаторы стратегии ещё не поступали. Подключите <code className="font-mono">ExnessPanelHook.mqh</code> и
            вызовите <code className="font-mono">EP_ReportIndicators(...)</code> в <code className="font-mono">OnTimer()</code>{" "}
            робота — телеметрия появится здесь в реальном времени без нагрузки на <code className="font-mono">OnTick()</code>.
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
