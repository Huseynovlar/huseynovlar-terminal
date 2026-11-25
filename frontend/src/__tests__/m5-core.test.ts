import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calcBollinger,
  calcEMA,
  calcRSI,
  calcVWAP,
  formatCountdown,
  formatPct,
  formatSignedUsd,
  formatUsd,
  type OhlcBar,
} from "../components/m5/chart-indicators.ts";
import {
  computeSquarifiedLayout,
  formatCompactNumber,
  treemapTileClass,
} from "../components/m5/treemap-layout.ts";

describe("Squarified 2D Treemap Layout Engine (F05)", () => {
  it("packs all weighted items within [0..100] x [0..100] and conserves total area", () => {
    const items = [
      { item: "NVDA", weight: 100 },
      { item: "AAPL", weight: 95 },
      { item: "MSFT", weight: 90 },
      { item: "AMZN", weight: 65 },
      { item: "META", weight: 40 },
      { item: "AMD", weight: 20 },
    ];
    const rects = computeSquarifiedLayout(items, 100, 100);
    assert.equal(rects.length, items.length);

    let totalArea = 0;
    for (const r of rects) {
      assert.ok(r.x >= -0.001 && r.y >= -0.001, `Negative coord: ${r.x},${r.y}`);
      assert.ok(r.w > 0 && r.h > 0, `Non-positive dim: ${r.w}x${r.h}`);
      assert.ok(r.x + r.w <= 100.01, `Out of X bounds: ${r.x + r.w}`);
      assert.ok(r.y + r.h <= 100.01, `Out of Y bounds: ${r.y + r.h}`);
      totalArea += r.w * r.h;
    }
    assert.ok(Math.abs(totalArea - 10000) < 1, `Expected total area ~10000, got ${totalArea}`);
  });

  it("handles empty input and formats compact market cap/volume", () => {
    assert.deepEqual(computeSquarifiedLayout([]), []);
    assert.equal(formatCompactNumber(3_250_000_000_000), "3.25T");
    assert.equal(formatCompactNumber(14_500_000_000), "14.50B");
    assert.equal(formatCompactNumber(null), "—");
    assert.ok(treemapTileClass(3.5).includes("emerald"));
    assert.ok(treemapTileClass(-3.5).includes("rose"));
  });
});

describe("Technical Indicators & Terminal Formatters (F15, F26, F27)", () => {
  const bars: OhlcBar[] = Array.from({ length: 30 }, (_, idx) => ({
    time: 1_700_000_000 + idx * 3600,
    open: 100 + idx,
    high: 102 + idx,
    low: 99 + idx,
    close: 101 + idx,
    volume: 1000 + idx * 10,
  }));

  it("computes EMA, Bollinger Bands, RSI, and VWAP deterministically", () => {
    const ema10 = calcEMA(bars, 10);
    assert.equal(ema10.length, 21);
    assert.ok(ema10[ema10.length - 1]!.value > ema10[0]!.value);

    const bb = calcBollinger(bars, 20, 2);
    assert.equal(bb.upper.length, 11);
    assert.ok(bb.upper[0]!.value > bb.middle[0]!.value);
    assert.ok(bb.lower[0]!.value < bb.middle[0]!.value);

    const rsi = calcRSI(bars, 14);
    assert.equal(rsi.length, 16);
    assert.equal(rsi[rsi.length - 1]!.value, 100);

    const vwap = calcVWAP(bars);
    assert.equal(vwap.length, bars.length);
  });

  it("formats USD, signed USD, percentages, privacy masking, and countdowns", () => {
    assert.equal(formatUsd(1234.5, false), "$1,234.50");
    assert.equal(formatUsd(1234.5, true), "$••••••");
    assert.equal(formatSignedUsd(42.1, false), "+$42.10");
    assert.equal(formatSignedUsd(-42.1, false), "-$42.10");
    assert.equal(formatPct(2.345), "+2.35%");
    assert.equal(formatPct(-1.2), "-1.20%");

    const now = new Date("2026-11-25T12:00:00Z");
    assert.equal(formatCountdown("2026-11-25T13:05:10Z", now), "01:05:10");
  });
});
