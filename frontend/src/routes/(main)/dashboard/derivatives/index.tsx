import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/derivatives/")({
  component: DerivativesStubPage,
});

function DerivativesStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Деривативы и Ончейн"
      badge="Deribit · Binance · DefiLlama"
      description="Модуль опционов, OI/Funding, Long/Short, TVL и ончейн-метрик (Deribit, Binance/Bybit, DefiLlama, Mempool.space) — ожидает детальное ТЗ."
    />
  );
}
