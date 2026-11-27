import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(main)/auth/v2")({
  component: Layout,
});

/**
 * Minimalist Pro institutional auth canvas (Stage 6 §2):
 * Pure theme background (#0B0E14 / [data-theme="light"]), zero decorative showcase clutter.
 */
function Layout() {
  return (
    <main className="relative flex min-h-dvh w-full items-center justify-center bg-[var(--bg-canvas)] p-4">
      <Outlet />
    </main>
  );
}
