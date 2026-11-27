import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/stat-arb/")({
  component: StatArbStubPage,
});

function StatArbStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Стат. арбитраж и Спреды"
      badge="Z-Score · Cointegration"
      description="Модуль парного трейдинга (BTC/ETH, XAU/XAG, USTEC/US500, базис, фандинг, Z-Score) — ожидает детальное ТЗ."
    />
  );
}
