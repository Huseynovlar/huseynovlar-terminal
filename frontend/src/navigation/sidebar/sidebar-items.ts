import {
  Activity,
  Banknote,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  Gauge,
  Globe,
  Grid2x2,
  Home,
  Landmark,
  Layers,
  LayoutGrid,
  type LucideIcon,
  Newspaper,
  Scale,
  Server,
  Settings,
  Wallet,
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

/**
 * Final 4-block, 19-item Bloomberg-grade navigation architecture (terminal_architecture_map.md §2).
 */
export function buildSidebarItems(
  dict: TranslationDict,
  hiddenPageIds: string[] = [],
  sidebarOrder: readonly string[] = [],
): NavGroup[] {
  const hidden = new Set(hiddenPageIds);
  const groups: NavGroup[] = [
    {
      id: 1,
      label: "Терминал",
      items: [
        { id: "home", title: dict.nav.home, url: "/dashboard/home", icon: Home },
        { id: "hubs", title: dict.nav.hubs, url: "/dashboard/hubs", icon: Layers },
        { id: "accounts", title: "Счета и Брокеры", url: "/dashboard/accounts", icon: Wallet },
        { id: "robots", title: dict.nav.robots, url: "/dashboard/robots", icon: Bot },
        { id: "journal", title: dict.nav.journal, url: "/dashboard/journal", icon: BookOpen },
        { id: "treasury", title: dict.nav.treasury, url: "/dashboard/treasury", icon: Banknote },
      ],
    },
    {
      id: 2,
      label: "Рынки и Аналитика",
      items: [
        { id: "tickers", title: "Справочник рынков", url: "/dashboard/tickers", icon: BookOpen },
        { id: "multichart", title: "Мультиграфик", url: "/dashboard/multichart", icon: LayoutGrid },
        { id: "treemap", title: dict.nav.treemap, url: "/dashboard/treemap", icon: Grid2x2 },
        { id: "stat-arb", title: "Стат. арбитраж и Спреды", url: "/dashboard/stat-arb", icon: Scale },
        { id: "derivatives", title: "Деривативы и Ончейн", url: "/dashboard/derivatives", icon: Activity },
        { id: "analytics", title: dict.nav.analytics, url: "/dashboard/analytics", icon: Gauge },
      ],
    },
    {
      id: 3,
      label: "Институционал, Макро и Новости",
      items: [
        { id: "macro", title: "Макро, Облигации и COT", url: "/dashboard/macro", icon: Landmark },
        { id: "ownership", title: "Владение и Фонды", url: "/dashboard/ownership", icon: Building2 },
        { id: "global-map", title: "Глобальная карта (BMAP)", url: "/dashboard/global-map", icon: Globe },
        { id: "calendar", title: "Календари", url: "/dashboard/calendar", icon: Calendar },
        { id: "news", title: dict.nav.news, url: "/dashboard/news", icon: Newspaper },
      ],
    },
    {
      id: 4,
      label: "Система",
      items: [
        { id: "infrastructure", title: "Инфраструктура MT5", url: "/dashboard/infrastructure", icon: Server },
        { id: "settings", title: "Настройки", url: "/dashboard/settings", icon: Settings },
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
