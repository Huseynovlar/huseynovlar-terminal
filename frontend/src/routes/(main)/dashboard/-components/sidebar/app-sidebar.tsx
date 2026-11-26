import { useMemo } from "react";

import { Link } from "@tanstack/react-router";

import { useShallow } from "zustand/react/shallow";

import { AppLogo } from "@/components/app-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { buildSidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { NavMain } from "./nav-main";

export interface CurrentTerminalUser {
  readonly id: string;
  readonly username?: string;
  readonly name: string;
  readonly email: string;
  readonly avatar: string;
  readonly role: string;
}

/**
 * Clean floating Sidebar with 5 institutional groups and NO footer NavUser (F10, F11).
 */
export function AppSidebar({
  currentUser: _currentUser,
  ...props
}: React.ComponentProps<typeof Sidebar> & { readonly currentUser: CurrentTerminalUser }) {
  const { t } = useI18n();
  const hiddenPageIds = useTerminalStore((s) => s.hiddenPageIds);
  const sidebarOrder = useTerminalStore((s) => s.sidebarOrder);
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : (props.variant ?? "floating");
  const collapsible = isSynced ? sidebarCollapsible : (props.collapsible ?? "icon");
  const items = useMemo(() => buildSidebarItems(t, hiddenPageIds, sidebarOrder), [t, hiddenPageIds, sidebarOrder]);

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/dashboard/crypto" />}>
              <AppLogo />
              <span className="text-sm font-semibold tracking-tight">{APP_CONFIG.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
    </Sidebar>
  );
}
