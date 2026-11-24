import { Link } from "@tanstack/react-router";
import { BadgeCheck, LogOut, Settings } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authApi, setAccessToken } from "@/framework/api-client";
import { getInitials } from "@/lib/utils";

import type { CurrentTerminalUser } from "../sidebar/app-sidebar";

export function AccountSwitcher({ user }: { readonly user: CurrentTerminalUser }) {
  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setAccessToken(null);
    window.location.replace("/auth/v2/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger nativeButton={false} render={<Avatar className="size-9 cursor-pointer rounded-lg" />}>
        <AvatarImage src={user.avatar || undefined} alt={user.name} />
        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-9 rounded-lg">
            <AvatarImage src={user.avatar || undefined} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="text-muted-foreground truncate text-xs">{user.email}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/dashboard/profile" />}>
            <BadgeCheck />
            Профиль и Безопасность
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/dashboard/roles" />}>
            <Settings />
            Настройки и Хоткеи
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
