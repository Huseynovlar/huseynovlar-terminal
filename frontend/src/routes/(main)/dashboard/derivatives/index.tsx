import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/derivatives/")({
  component: DerivativesStubPage,
});

function DerivativesStubPage() {
  return (
    <TerminalPageShell title="Деривативы и Ончейн" badge="Deribit · Binance · DefiLlama">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
        Модуль опционов, OI/Funding, Long/Short, TVL и ончейн-метрик (Deribit, Binance/Bybit, DefiLlama, Mempool.space) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
