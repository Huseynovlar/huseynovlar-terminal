import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/infrastructure")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/containers", replace: true });
  },
});
