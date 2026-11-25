import { createFileRoute } from "@tanstack/react-router";

import { LiveChartsDeskView } from "@/routes/(main)/dashboard/charts/index";

export const Route = createFileRoute("/(main)/dashboard/charts/$symbol/")({
  component: ChartSymbolPage,
});

function ChartSymbolPage() {
  const { symbol } = Route.useParams();
  return <LiveChartsDeskView symbol={symbol} />;
}
