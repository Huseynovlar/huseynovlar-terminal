import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/multichart/")({
  component: MultichartStubPage,
});

function MultichartStubPage() {
  return (
    <TerminalPageShell title="Мультиграфик" badge="2×2 / 3×2 · KLineChart v10">
      <div className="rounded-[4px] border border-[#1E2634] bg-[#11161F] px-3 py-2.5 font-mono text-[12px] text-[#94A3B8]">
        Модуль синхронизированных графиков (2×2 / 3×2 + Bar Replay) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
