import { type CSSProperties, useEffect, useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";

import { cn } from "cn";

import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { apiRequest, authApi, clearAccessToken, getAccessToken } from "@/framework/api-client";
import { BloombergTickerTape } from "@/framework/components/BloombergTickerTape";
import { HotkeyEngine } from "@/framework/components/HotkeyEngine";
import { LockScreenOverlay } from "@/framework/components/LockScreenOverlay";
import { HeaderUtcClock, TerminalHeaderControls } from "@/framework/components/TerminalHeaderControls";
import { queueServerPreferenceSync, useTerminalStore } from "@/framework/terminal-store";
import { LiveSocketProvider } from "@/framework/use-live-socket";
import { getDashboardLayout } from "@/server/server-actions";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { registerPreferencesServerSync } from "@/stores/preferences/preferences-store";

import { AccountSwitcher } from "./-components/header/account-switcher";
import { SearchDialog } from "./-components/header/search-dialog";
import { ThemeSwitcher } from "./-components/header/theme-switcher";
import { AppSidebar, type CurrentTerminalUser } from "./-components/sidebar/app-sidebar";

export const Route = createFileRoute("/(main)/dashboard")({
  loader: () => getDashboardLayout(),
  component: DashboardLayout,
});

function DashboardLayout() {
  const { defaultOpen, variant, collapsible } = Route.useLoaderData();
  const [currentUser, setCurrentUser] = useState<CurrentTerminalUser | null>(null);
  const hydrateTerminal = useTerminalStore((s) => s.hydrateFromServer);
  const hydratePreferences = usePreferencesStore((s) => s.hydrateFromServer);

  useEffect(() => {
    registerPreferencesServerSync((patch) => {
      queueServerPreferenceSync(patch as Record<string, unknown>);
    });
    return () => {
      registerPreferencesServerSync(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function verifySession() {
      try {
        if (!getAccessToken()) {
          await authApi.refresh();
        }
        const profile = await apiRequest<{
          id: string;
          username: string;
          email: string;
          display_name: string;
          avatar_url: string;
          role: string;
          preferences?: Record<string, unknown>;
        }>("/profile/me");

        let serverPrefs = profile.preferences;
        if (!serverPrefs) {
          try {
            const res = await apiRequest<{ preferences?: Record<string, unknown> }>("/profile/preferences");
            serverPrefs = res.preferences;
          } catch {
            // optional fallback
          }
        }

        if (!cancelled) {
          if (serverPrefs && typeof serverPrefs === "object") {
            hydrateTerminal(serverPrefs);
            hydratePreferences(serverPrefs as Record<string, string | null | undefined>);
          }
          setCurrentUser({
            id: profile.id,
            username: profile.username,
            name: profile.display_name || profile.username,
            email: profile.email || "",
            avatar: profile.avatar_url || "",
            role: profile.role || "ADMIN",
          });
        }
      } catch {
        clearAccessToken();
        if (!cancelled) {
          window.location.replace("/auth/v2/login");
        }
      }
    }
    void verifySession();
    return () => {
      cancelled = true;
    };
  }, [hydrateTerminal, hydratePreferences]);

  if (!currentUser) {
    return (
      <div className="bg-background min-h-dvh w-full p-6">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <LiveSocketProvider>
      <SidebarProvider
        defaultOpen={defaultOpen}
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 68)",
          } as CSSProperties
        }
      >
        <HotkeyEngine />
        <LockScreenOverlay user={currentUser} />
        <AppSidebar variant={variant ?? "floating"} collapsible={collapsible ?? "icon"} currentUser={currentUser} />
        <SidebarInset
          className={cn(
            "[html[data-content-layout=centered]_&>*]:mx-auto",
            "[html[data-content-layout=centered]_&>*]:w-full",
            "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
            "peer-data-[variant=inset]:border",
            "[--dashboard-header-height:--spacing(12)]",
            "min-w-0 overflow-x-clip",
          )}
        >
          <BloombergTickerTape />
          <header
            className={cn(
              "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
              "[html[data-navbar-style=sticky]_&]:bg-background/60 [html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
            )}
          >
            <div className="flex w-full items-center justify-between px-4 lg:px-6">
              <div className="flex items-center gap-1 lg:gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
                />
                <SearchDialog />
              </div>
              <div className="flex items-center gap-2">
                <TerminalHeaderControls />
                <Separator
                  orientation="vertical"
                  className="mx-1 hidden data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center md:block"
                />
                <ThemeSwitcher />
                <HeaderUtcClock />
                <AccountSwitcher user={currentUser} />
              </div>
            </div>
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-3 has-data-[content-padding=false]:p-0 md:p-5 md:has-data-[content-padding=false]:p-0">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LiveSocketProvider>
  );
}
