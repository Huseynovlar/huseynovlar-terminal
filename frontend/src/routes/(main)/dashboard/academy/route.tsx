import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/academy")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/setup", replace: true });
  },
});
