import {
  Banknote,
  BookOpen,
  Bot,
  Calendar,
  Compass,
  FileSearch,
  Gauge,
  Grid2x2,
  History,
  Home,
  Keyboard,
  Layers,
  type LucideIcon,
  MonitorSmartphone,
  Newspaper,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

import { getDictionary, type TranslationDict } from "@/framework/i18n";
import type { LanguageMode } from "@/framework/terminal-store";

export type NavBadge = "new" | "updated" | "soon";
export type AppPath = string;

export interface NavSubItem {
  id: string;
  title: string;
  url: AppPath;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: AppPath;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export function applySidebarOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, idx) => [id, idx]));
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ra = rank.get(a.item.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.item.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.idx - b.idx;
    })
    .map((x) => x.item);
}

export function buildSidebarItems(
  dict: TranslationDict,
  hiddenPageIds: string[] = [],
  sidebarOrder: readonly string[] = [],
): NavGroup[] {
  const hidden = new Set(hiddenPageIds);
  const groups: NavGroup[] = [
    {
      id: 1,
      label: dict.nav.groupDesk,
      items: [
        { id: "home", title: dict.nav.home, url: "/dashboard/home", icon: Home },
        { id: "accounts", title: dict.nav.accounts, url: "/dashboard/accounts", icon: Layers },
        { id: "robots", title: dict.nav.robots, url: "/dashboard/robots", icon: Bot },
        { id: "journal", title: dict.nav.journal, url: "/dashboard/journal", icon: BookOpen },
        { id: "treasury", title: dict.nav.treasury, url: "/dashboard/treasury", icon: Banknote },
      ],
    },
    {
      id: 2,
      label: dict.nav.groupMarkets,
      items: [
        { id: "hubs", title: dict.nav.hubs, url: "/dashboard/hubs", icon: Layers },
        { id: "tickers", title: "Справочник тикеров", url: "/dashboard/tickers", icon: BookOpen },
        { id: "explorer", title: dict.nav.explorer, url: "/dashboard/explorer", icon: Compass },
        { id: "treemap", title: dict.nav.treemap, url: "/dashboard/treemap", icon: Grid2x2 },
        { id: "analytics", title: dict.nav.analytics, url: "/dashboard/analytics", icon: Gauge },
        { id: "calendar", title: dict.nav.calendar, url: "/dashboard/calendar", icon: Calendar },
      ],
    },
    {
      id: 3,
      label: dict.nav.groupIntelligence,
      items: [
        { id: "news", title: dict.nav.news, url: "/dashboard/news", icon: Newspaper },
        { id: "news-sources", title: dict.nav.newsSources, url: "/dashboard/news/sources", icon: ShieldCheck },
      ],
    },
    {
      id: 4,
      label: dict.nav.groupOperations,
      items: [
        { id: "containers", title: dict.nav.containers, url: "/dashboard/containers", icon: Server },
        { id: "setup", title: dict.nav.setup, url: "/dashboard/setup", icon: Wrench },
        { id: "wiki", title: dict.nav.wiki, url: "/dashboard/wiki", icon: BookOpen },
      ],
    },
    {
      id: 5,
      label: dict.nav.groupSystem,
      items: [
        { id: "users", title: dict.nav.users, url: "/dashboard/users", icon: Users },
        { id: "profile", title: dict.nav.profile, url: "/dashboard/profile", icon: UserRound },
        { id: "security", title: dict.nav.security, url: "/dashboard/security", icon: ShieldCheck },
        { id: "sessions", title: dict.nav.sessions, url: "/dashboard/sessions", icon: MonitorSmartphone },
        { id: "login-history", title: dict.nav.loginHistory, url: "/dashboard/login-history", icon: History },
        { id: "audit", title: dict.nav.audit, url: "/dashboard/audit", icon: FileSearch },
        { id: "preferences", title: dict.nav.preferences, url: "/dashboard/preferences", icon: Settings },
        { id: "hotkeys", title: dict.nav.hotkeys, url: "/dashboard/hotkeys", icon: Keyboard },
      ],
    },
  ];

  const orderedGroups =
    sidebarOrder.length > 0
      ? applySidebarOrder(
          groups.map((g) => ({ ...g, _sortId: String(g.id), id: String(g.id) })),
          sidebarOrder,
        ).map((g) => ({ id: Number(g._sortId), label: g.label, items: g.items }))
      : groups;

  return orderedGroups
    .map((group) => ({
      ...group,
      items: applySidebarOrder(
        group.items.filter((item) => !hidden.has(item.id)),
        sidebarOrder,
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export function getSidebarItemsForLang(lang: LanguageMode, hiddenPageIds: string[] = []): NavGroup[] {
  return buildSidebarItems(getDictionary(lang), hiddenPageIds);
}

export const sidebarItems: NavGroup[] = buildSidebarItems(getDictionary("ru"));
