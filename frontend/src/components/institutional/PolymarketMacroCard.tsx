import { useEffect, useState } from "react";

import { ExternalLink, RefreshCw } from "lucide-react";

import { apiRequest } from "@/framework/api-client";

interface PolymarketItem {
  id: string;
  question: string;
  category: string;
  yes_prob_pct: number;
  delta_24h_pct: number;
  volume_usd: number;
  end_date: string;
  url: string;
}

interface PolymarketResponse {
  source: string;
  updated_at: string;
  items: PolymarketItem[];
}

function fmtUsdCompact(v: number): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function PolymarketMacroCard() {
  const [data, setData] = useState<PolymarketResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiRequest<PolymarketResponse>("/pro/polymarket")
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]">
            Вероятности макро-событий (Polymarket CLOB)
          </h3>
          <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-[var(--text-muted)]">
            {data?.source === "polymarket_live" ? "● LIVE" : "○ CACHED"}
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <th className="px-3 py-2">Вопрос / Событие</th>
              <th className="px-3 py-2">Категория</th>
              <th className="w-44 px-3 py-2">Вероятность YES (%)</th>
              <th className="px-3 py-2 text-right">Δ 24ч</th>
              <th className="px-3 py-2 text-right">Объём ($)</th>
              <th className="px-3 py-2 text-right">Экспирация</th>
              <th className="px-3 py-2 text-right">Ссылка</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {!data?.items?.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[11.5px] text-[var(--text-muted)]">
                  {loading ? "Загрузка рынков предсказаний Polymarket..." : "Нет доступных рынков"}
                </td>
              </tr>
            ) : (
              data.items.map((m) => {
                const pos = m.delta_24h_pct >= 0;
                const barColor = m.yes_prob_pct >= 55 ? "var(--bull)" : "var(--accent-blue)";
                return (
                  <tr key={m.id} className="transition-colors hover:bg-[var(--bg-elevated)]">
                    <td className="max-w-[380px] px-3 py-2 font-medium text-[var(--text-primary)]">
                      {m.question}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {m.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      <div className="flex items-center justify-between text-[11px] font-semibold">
                        <span style={{ color: barColor }}>{m.yes_prob_pct.toFixed(1)}%</span>
                        <span className="text-[10px] text-[var(--text-muted)]">NO {(100 - m.yes_prob_pct).toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-[2px] bg-[var(--bg-canvas)]">
                        <div
                          className="h-full rounded-[2px]"
                          style={{ width: `${Math.min(100, Math.max(2, m.yes_prob_pct))}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-right font-mono text-[11.5px] font-semibold tabular-nums"
                      style={{ color: pos ? "var(--bull)" : "var(--bear)" }}
                    >
                      {pos ? "+" : ""}
                      {m.delta_24h_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-[var(--text-primary)]">
                      {fmtUsdCompact(m.volume_usd)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {m.end_date}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
                      >
                        CLOB
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
    </section>
  );
}
