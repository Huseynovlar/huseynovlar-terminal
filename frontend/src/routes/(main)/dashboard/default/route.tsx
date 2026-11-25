import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/default")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/home", replace: true });
  },
});
