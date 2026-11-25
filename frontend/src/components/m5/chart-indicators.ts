export interface OhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export function calcEMA(bars: OhlcBar[], period: number): LinePoint[] {
  const out: LinePoint[] = [];
  if (bars.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period;
  out.push({ time: bars[period - 1]!.time, value: Number(ema.toFixed(4)) });
  for (let i = period; i < bars.length; i += 1) {
    ema = bars[i]!.close * k + ema * (1 - k);
    out.push({ time: bars[i]!.time, value: Number(ema.toFixed(4)) });
  }
  return out;
}

export function calcBollinger(
  bars: OhlcBar[],
  period = 20,
  mult = 2,
): { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (bars.length < period || period <= 0) return { upper, middle, lower };

  for (let i = period - 1; i < bars.length; i += 1) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, b) => sum + b.close, 0) / period;
    const variance = slice.reduce((sum, b) => sum + (b.close - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const t = bars[i]!.time;
    upper.push({ time: t, value: Number((mean + mult * std).toFixed(4)) });
    middle.push({ time: t, value: Number(mean.toFixed(4)) });
    lower.push({ time: t, value: Number((mean - mult * std).toFixed(4)) });
  }
  return { upper, middle, lower };
}

export function calcRSI(bars: OhlcBar[], period = 14): LinePoint[] {
  const out: LinePoint[] = [];
  if (bars.length <= period || period <= 0) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = bars[i]!.close - bars[i - 1]!.close;
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const pushPoint = (idx: number, gain: number, loss: number) => {
    const rs = loss === 0 ? 100 : gain / loss;
    const rsi = loss === 0 ? 100 : 100 - 100 / (1 + rs);
    out.push({ time: bars[idx]!.time, value: Number(rsi.toFixed(2)) });
  };

  pushPoint(period, avgGain, avgLoss);
  for (let i = period + 1; i < bars.length; i += 1) {
    const diff = bars[i]!.close - bars[i - 1]!.close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    pushPoint(i, avgGain, avgLoss);
  }
  return out;
}

export function calcVWAP(bars: OhlcBar[]): LinePoint[] {
  const out: LinePoint[] = [];
  let cumPv = 0;
  let cumVol = 0;
  for (const b of bars) {
    const typical = (b.high + b.low + b.close) / 3;
    const vol = b.volume && b.volume > 0 ? b.volume : 1;
    cumPv += typical * vol;
    cumVol += vol;
    if (cumVol > 0) {
      out.push({ time: b.time, value: Number((cumPv / cumVol).toFixed(4)) });
    }
  }
  return out;
}

export function formatUsd(value: number | null | undefined, privacyMode = false): string {
  if (privacyMode) return "$••••••";
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedUsd(value: number | null | undefined, privacyMode = false): string {
  if (privacyMode) return "$••••";
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0.00";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatCountdown(targetIso: string | null | undefined, nowDate: Date): string {
  if (!targetIso) return "—";
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return "—";
  const diffSec = Math.max(0, Math.floor((targetMs - nowDate.getTime()) / 1000));
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}
