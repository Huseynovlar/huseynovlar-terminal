import { createFileRoute } from "@tanstack/react-router";

import { SquarifiedTreemap } from "@/components/m5/SquarifiedTreemap";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/treemap")({
  component: TreemapPage,
});

function TreemapPage() {
  const { t } = useI18n();
  return (
    <TerminalPageShell title={t.treemap.title} subtitle={t.treemap.subtitle} badge="LIVE">
      <SquarifiedTreemap fullPage={true} />
    </TerminalPageShell>
  );
}
