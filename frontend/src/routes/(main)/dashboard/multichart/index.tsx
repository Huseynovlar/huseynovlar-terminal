import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/multichart/")({
  component: MultichartStubPage,
});

function MultichartStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Мультиграфик"
      badge="2×2 / 3×2 · KLineChart v10"
      description="Модуль синхронизированных графиков (2×2 / 3×2 + Bar Replay) — ожидает детальное ТЗ."
    />
  );
}
