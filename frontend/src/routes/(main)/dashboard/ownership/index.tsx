import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/ownership/")({
  component: OwnershipStubPage,
});

function OwnershipStubPage() {
  return (
    <TerminalPageShell title="Владение и Фонды" badge="SEC EDGAR · 13F-HR · Form 4">
      <div className="rounded-[4px] border border-[#1E2634] bg-[#11161F] px-3 py-2.5 font-mono text-[12px] text-[#94A3B8]">
        Модуль графа владений фондов (ECharts graph/chord по SEC EDGAR 13F-HR / 13D / Form 4) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
