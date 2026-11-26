import { Link } from "@tanstack/react-router";
import { BadgeCheck, History, Lock, LogOut, MonitorSmartphone, Settings, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/toast";
import { authApi } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { useAuthImage } from "@/framework/use-auth-image";
import { useTerminalStore } from "@/framework/terminal-store";
import { getInitials } from "@/lib/utils";

import type { CurrentTerminalUser } from "../sidebar/app-sidebar";

export function AccountSwitcher({ user }: { readonly user: CurrentTerminalUser }) {
  const { t } = useI18n();
  const avatarSrc = useAuthImage(user.avatar);
  const setScreenLocked = useTerminalStore((s) => s.setScreenLocked);

  async function handleLogout() {
    try {
      await authApi.logout();
      notify.info(t.header.loggedOut);
    } catch {
      // authApi.logout() already clears client token in finally
    }
    window.location.replace("/auth/v2/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger nativeButton={false} render={<Avatar className="size-8 cursor-pointer rounded-lg ring-1 ring-border" />}>
        <AvatarImage src={avatarSrc} alt={user.name} />
        <AvatarFallback className="text-xs font-semibold">{getInitials(user.name)}</AvatarFallback>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={avatarSrc} alt={user.name} />
            <AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-xs leading-tight">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="text-muted-foreground truncate text-[11px]">{user.email}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/dashboard/profile" />}>
            <BadgeCheck />
            {t.nav.profile}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/dashboard/security" />}>
            <ShieldCheck />
            {t.nav.security}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/dashboard/sessions" />}>
            <MonitorSmartphone />
            {t.nav.sessions}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/dashboard/login-history" />}>
            <History />
            {t.nav.loginHistory}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/dashboard/preferences" />}>
            <Settings />
            {t.nav.preferences}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setScreenLocked(true)}>
          <Lock />
          {t.header.lockScreen}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">⇧L</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleLogout()}>
          <LogOut />
          {t.header.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
