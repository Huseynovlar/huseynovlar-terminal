import { type CSSProperties, useEffect, useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";

import { cn } from "cn";

import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { apiRequest, type AuthTokenResponse, getAccessToken, setAccessToken } from "@/framework/api-client";
import { BloombergTickerTape } from "@/framework/components/BloombergTickerTape";
import { HotkeyEngine } from "@/framework/components/HotkeyEngine";
import { TerminalHeaderControls } from "@/framework/components/TerminalHeaderControls";
import { getDashboardLayout } from "@/server/server-actions";

import { AccountSwitcher } from "./-components/header/account-switcher";
import { LayoutControls } from "./-components/header/layout-controls";
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

  useEffect(() => {
    let cancelled = false;
    async function verifySession() {
      try {
        if (!getAccessToken()) {
          const refreshed = await apiRequest<AuthTokenResponse>("/auth/refresh", { method: "POST" });
          if (refreshed?.access_token) {
            setAccessToken(refreshed.access_token);
          }
        }
        const profile = await apiRequest<{
          id: string;
          username: string;
          email: string;
          display_name: string;
          avatar_url: string;
          role: string;
        }>("/profile/me");
        if (!cancelled) {
          setCurrentUser({
            id: profile.id,
            name: profile.display_name || profile.username,
            email: profile.email,
            avatar: profile.avatar_url || "",
            role: profile.role || "owner",
          });
        }
      } catch {
        setAccessToken(null);
        if (!cancelled) {
          window.location.replace("/auth/v2/login");
        }
      }
    }
    verifySession();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!currentUser) {
    return (
      <div className="bg-background text-muted-foreground flex h-dvh w-full items-center justify-center font-mono text-xs">
        Проверка доступа (Zero-Trust Session Guard)...
      </div>
    );
  }

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 68)",
        } as CSSProperties
      }
    >
      <HotkeyEngine />
      <AppSidebar variant={variant} collapsible={collapsible} currentUser={currentUser} />
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
            "[html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
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
              <LayoutControls />
              <ThemeSwitcher />
              <AccountSwitcher user={currentUser} />
            </div>
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-4 has-data-[content-padding=false]:p-0 md:p-6 md:has-data-[content-padding=false]:p-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
