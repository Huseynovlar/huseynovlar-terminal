import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/macro/")({
  component: MacroStubPage,
});

function MacroStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Макро, Облигации и COT"
      badge="FRED · U.S. Treasury · CFTC · Polymarket"
      description="Модуль кривой доходностей США (GC/YAS), отчётов CFTC COT и вероятностей ставки ФРС (Polymarket CLOB) — ожидает детальное ТЗ."
    />
  );
}
