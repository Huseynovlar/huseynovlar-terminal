import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/roles")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/preferences", replace: true });
  },
});
