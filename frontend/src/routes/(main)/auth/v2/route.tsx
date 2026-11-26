import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AuthShowcasePanel } from "@/framework/components/AuthShowcasePanel";

export const Route = createFileRoute("/(main)/auth/v2")({
  component: Layout,
});

/**
 * Institutional split-screen auth layout (#44, #47).
 * Right panel displays the real dark/light terminal screenshot inside a polished frame
 * with concise platform highlights underneath.
 */
function Layout() {
  return (
    <main>
      <div className="grid h-dvh justify-center p-2 lg:grid-cols-2">
        <AuthShowcasePanel />
        <div className="relative order-1 flex h-full">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
