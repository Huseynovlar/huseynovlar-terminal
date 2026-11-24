import {
  Banknote,
  BookOpen,
  Bot,
  Calendar,
  Coins,
  Cpu,
  Gauge,
  Grid2x2,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Newspaper,
  Server,
  Settings,
  UserRound,
} from "lucide-react";

import type { FileRoutesByTo } from "@/routeTree.gen";

export type NavBadge = "new" | "updated" | "soon";
export type AppPath = keyof FileRoutesByTo;

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

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Терминал",
    items: [
      {
        id: "overview",
        title: "Общая сводка",
        url: "/dashboard/crypto",
        icon: LayoutDashboard,
      },
      {
        id: "accounts-robots",
        title: "Счета и роботы",
        url: "/dashboard/default",
        icon: Bot,
      },
      {
        id: "treasury",
        title: "Казначейство и Хранилище",
        url: "/dashboard/finance",
        icon: Banknote,
      },
    ],
  },
  {
    id: 2,
    label: "Хабы активов",
    items: [
      {
        id: "asset-xauusd",
        title: "XAUUSD (Золото)",
        url: "/dashboard/crypto",
        icon: Coins,
      },
      {
        id: "asset-ustec",
        title: "USTEC (NASDAQ-100)",
        url: "/dashboard/crypto",
        icon: Cpu,
      },
    ],
  },
  {
    id: 3,
    label: "Рынок и ИИ",
    items: [
      {
        id: "market-heatmap",
        title: "Карта рынка (Treemap)",
        url: "/dashboard/analytics",
        icon: Grid2x2,
      },
      {
        id: "analytics-risk",
        title: "Аналитика и Risk Lab",
        url: "/dashboard/analytics",
        icon: Gauge,
      },
      {
        id: "econ-calendar",
        title: "Календарь и PnL",
        url: "/dashboard/calendar",
        icon: Calendar,
      },
      {
        id: "news-ai",
        title: "Новости и Gemini AI",
        url: "/dashboard/chat",
        icon: Newspaper,
      },
    ],
  },
  {
    id: 4,
    label: "Инфраструктура",
    items: [
      {
        id: "containers-ops",
        title: "Контейнеры MT5 / ОС",
        url: "/dashboard/infrastructure",
        icon: Server,
      },
      {
        id: "instructions-wiki",
        title: "Инструкции и Setup Wizard",
        url: "/dashboard/academy",
        icon: BookOpen,
      },
    ],
  },
  {
    id: 5,
    label: "Система",
    items: [
      {
        id: "profile",
        title: "Профиль и Безопасность",
        url: "/dashboard/profile",
        icon: UserRound,
      },
      {
        id: "settings-hotkeys",
        title: "Настройки и Хоткеи",
        url: "/dashboard/roles",
        icon: Settings,
      },
      {
        id: "auth-login",
        title: "Экран входа (Passkey)",
        url: "/auth/v2/login",
        icon: Lock,
      },
    ],
  },
];
