import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/derivatives/")({
  component: DerivativesStubPage,
});

function DerivativesStubPage() {
  return (
    <TerminalPageShell title="Деривативы и Ончейн" badge="Deribit · Binance · DefiLlama">
      <div className="rounded-[4px] border border-[#1E2634] bg-[#11161F] px-3 py-2.5 font-mono text-[12px] text-[#94A3B8]">
        Модуль опционов, OI/Funding, Long/Short, TVL и ончейн-метрик (Deribit, Binance/Bybit, DefiLlama, Mempool.space) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
