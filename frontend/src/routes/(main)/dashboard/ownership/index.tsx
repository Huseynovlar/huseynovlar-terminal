import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/ownership/")({
  component: OwnershipStubPage,
});

function OwnershipStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Владение и Фонды"
      badge="SEC EDGAR · 13F-HR · Form 4"
      description="Модуль графа владений фондов (ECharts graph/chord по SEC EDGAR 13F-HR / 13D / Form 4) — ожидает детальное ТЗ."
    />
  );
}
