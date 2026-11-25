import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/dashboard/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/news", replace: true });
  },
});
