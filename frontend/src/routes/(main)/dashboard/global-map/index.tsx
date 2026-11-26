import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/global-map/")({
  component: GlobalMapStubPage,
});

function GlobalMapStubPage() {
  return (
    <TerminalPageShell title="Глобальная карта (BMAP)" badge="MapLibre GL · AISStream · GDELT · World Bank">
      <div className="rounded-[4px] border border-[#1E2634] bg-[#11161F] px-3 py-2.5 font-mono text-[12px] text-[#94A3B8]">
        Модуль WebGL-карты мира (танкеры AISStream.io, геополитические вспышки GDELT, макро-хороплет World Bank) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
