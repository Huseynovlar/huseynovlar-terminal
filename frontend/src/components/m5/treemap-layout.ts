export interface TreemapItem {
  ticker: string;
  name?: string;
  weight: number;
  price?: number | null;
  change_pct: number;
  market_cap?: number | null;
  volume?: number | null;
  sector?: string;
  logo_url?: string;
}

export interface TreemapRect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WeightedNode<T> {
  item: T;
  value: number;
}

function worstAspect(row: WeightedNode<unknown>[], sideLength: number, totalArea: number, sumValues: number): number {
  if (row.length === 0 || sideLength <= 0 || sumValues <= 0 || totalArea <= 0) return Number.POSITIVE_INFINITY;
  const rowSum = row.reduce((acc, n) => acc + n.value, 0);
  const rowArea = (rowSum / sumValues) * totalArea;
  const stripThickness = rowArea / sideLength;
  if (stripThickness <= 0) return Number.POSITIVE_INFINITY;

  let worst = 0;
  for (const node of row) {
    const area = (node.value / sumValues) * totalArea;
    const len = area / stripThickness;
    if (len <= 0) continue;
    const ratio = Math.max(len / stripThickness, stripThickness / len);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/**
 * Bruls–Huizing–van Wijk squarified treemap layout operating in percentage coordinates [0..100].
 * Returns proportional 2D rectangles with near-square aspect ratios and zero overlap.
 */
export function computeSquarifiedLayout<T>(
  items: Array<{ item: T; weight: number }>,
  width = 100,
  height = 100,
): TreemapRect<T>[] {
  const valid: WeightedNode<T>[] = items
    .map((entry) => ({
      item: entry.item,
      value: Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 1,
    }))
    .sort((a, b) => b.value - a.value);

  if (valid.length === 0 || width <= 0 || height <= 0) return [];

  const result: TreemapRect<T>[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let remaining = [...valid];

  while (remaining.length > 0 && w > 0.001 && h > 0.001) {
    const remSum = remaining.reduce((acc, n) => acc + n.value, 0);
    const remArea = w * h;
    const horizontal = w >= h;
    const shortSide = horizontal ? h : w;

    const row: WeightedNode<T>[] = [remaining[0]!];
    let idx = 1;
    while (idx < remaining.length) {
      const candidate = [...row, remaining[idx]!];
      if (worstAspect(candidate, shortSide, remArea, remSum) <= worstAspect(row, shortSide, remArea, remSum)) {
        row.push(remaining[idx]!);
        idx += 1;
      } else {
        break;
      }
    }

    const rowSum = row.reduce((acc, n) => acc + n.value, 0);
    const rowFraction = remSum > 0 ? rowSum / remSum : 1;

    if (horizontal) {
      const stripW = w * rowFraction;
      let cursorY = y;
      for (const node of row) {
        const frac = rowSum > 0 ? node.value / rowSum : 1 / row.length;
        const rectH = h * frac;
        result.push({ item: node.item, x, y: cursorY, w: stripW, h: rectH });
        cursorY += rectH;
      }
      x += stripW;
      w -= stripW;
    } else {
      const stripH = h * rowFraction;
      let cursorX = x;
      for (const node of row) {
        const frac = rowSum > 0 ? node.value / rowSum : 1 / row.length;
        const rectW = w * frac;
        result.push({ item: node.item, x: cursorX, y, w: rectW, h: stripH });
        cursorX += rectW;
      }
      y += stripH;
      h -= stripH;
    }

    remaining = remaining.slice(idx);
  }

  return result;
}

export function treemapTileClass(pct: number): string {
  if (pct >= 3.0) return "bg-emerald-600 text-white border-emerald-400/50 hover:brightness-110";
  if (pct >= 1.2) return "bg-emerald-700/95 text-emerald-50 border-emerald-500/40 hover:brightness-110";
  if (pct > 0.05) return "bg-emerald-900/85 text-emerald-100 border-emerald-600/30 hover:brightness-110";
  if (pct <= -3.0) return "bg-rose-600 text-white border-rose-400/50 hover:brightness-110";
  if (pct <= -1.2) return "bg-rose-700/95 text-rose-50 border-rose-500/40 hover:brightness-110";
  if (pct < -0.05) return "bg-rose-900/85 text-rose-100 border-rose-600/30 hover:brightness-110";
  return "bg-zinc-800/90 text-zinc-100 border-zinc-700/60 hover:brightness-110";
}

export function formatCompactNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
  return val.toFixed(2);
}
