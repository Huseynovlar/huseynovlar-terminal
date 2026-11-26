import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/crypto")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/hubs", replace: true });
  },
});
