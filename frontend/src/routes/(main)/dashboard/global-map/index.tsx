import { createFileRoute } from "@tanstack/react-router";

import { TerminalSectionPlaceholder } from "@/framework/templates";

export const Route = createFileRoute("/(main)/dashboard/global-map/")({
  component: GlobalMapStubPage,
});

function GlobalMapStubPage() {
  return (
    <TerminalSectionPlaceholder
      title="Глобальная карта (BMAP)"
      badge="MapLibre GL · AISStream · GDELT · World Bank"
      description="Модуль WebGL-карты мира (танкеры AISStream.io, геополитические вспышки GDELT, макро-хороплет World Bank) — ожидает детальное ТЗ."
    />
  );
}
