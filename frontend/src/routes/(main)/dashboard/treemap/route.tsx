import { createFileRoute } from "@tanstack/react-router";

import { MarketTreemap } from "@/framework/components/MarketTreemap";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/treemap")({
  component: MarketTreemapPage,
});

function MarketTreemapPage() {
  return (
    <TerminalPageShell
      title="Карта рынка (Market Treemap)"
      subtitle="Тепловая карта секторов и лидеров рынка (NASDAQ-100, S&P 500, Золото и сырьё)."
      badge="TREEMAP"
    >
      <MarketTreemap />
    </TerminalPageShell>
  );
}
