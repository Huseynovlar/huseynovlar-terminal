import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Banknote,
  BookOpen,
  Bot,
  Coins,
  Cpu,
  Gauge,
  Grid2x2,
  LayoutDashboard,
  Newspaper,
  Server,
  Settings,
  UserRound,
} from "lucide-react";

export type TerminalNavGroupId = "desk" | "assets" | "intelligence" | "operations" | "system";

export interface TerminalPageConfig {
  id: string;
  group: TerminalNavGroupId;
  titleRu: string;
  titleEn: string;
  descriptionRu: string;
  descriptionEn: string;
  route: string;
  icon: LucideIcon;
  hotkeyActionId?: string;
  badge?: "live" | "ai" | "new";
}

export const TERMINAL_NAV_GROUPS: Record<TerminalNavGroupId, { labelRu: string; labelEn: string }> = {
  desk: { labelRu: "Терминал", labelEn: "Trading Desk" },
  assets: { labelRu: "Хабы активов", labelEn: "Asset Hubs" },
  intelligence: { labelRu: "Рынок и ИИ", labelEn: "Market & AI" },
  operations: { labelRu: "Инфраструктура", labelEn: "Operations" },
  system: { labelRu: "Система", labelEn: "System" },
};

/**
 * Single declarative registry for Huseynovlar Terminal pages.
 * Adding a new page here automatically wires it into the Sidebar, Sidebar Customizer,
 * Cmd+K Command Palette, and Hotkey Editor.
 */
export const TERMINAL_PAGES: TerminalPageConfig[] = [
  {
    id: "overview",
    group: "desk",
    titleRu: "Общая сводка",
    titleEn: "Global Overview",
    descriptionRu: "Портфель Exness, баланс USD/USC, live-эквити и статус роботов",
    descriptionEn: "Exness portfolio, USD/USC balances, live equity & robot status",
    route: "/dashboard/crypto",
    icon: LayoutDashboard,
    hotkeyActionId: "nav.overview",
    badge: "live",
  },
  {
    id: "accounts_robots",
    group: "desk",
    titleRu: "Счета и роботы",
    titleEn: "Accounts & Robots",
    descriptionRu: "Профили Exness, мульти-счета USD/USC, MagicNumber и API-ключи",
    descriptionEn: "Exness profiles, USD/USC multi-accounts, MagicNumbers & API keys",
    route: "/dashboard/default",
    icon: Bot,
  },
  {
    id: "treasury",
    group: "desk",
    titleRu: "Казначейство и Хранилище",
    titleEn: "Treasury & Vault",
    descriptionRu: "Депозиты, выводы, переводы в Хранилище Exness и полные отчёты",
    descriptionEn: "Deposits, withdrawals, Exness Vault ledger & full statements",
    route: "/dashboard/finance",
    icon: Banknote,
  },
  {
    id: "asset_xauusd",
    group: "assets",
    titleRu: "XAUUSD (Золото)",
    titleEn: "XAUUSD (Gold)",
    descriptionRu: "Живой график M1–W1, ордера на свечах, USD+USC счета и новости золота",
    descriptionEn: "Live M1–W1 chart, on-chart orders, USD+USC accounts & gold news",
    route: "/dashboard/crypto",
    icon: Coins,
    hotkeyActionId: "nav.assets",
    badge: "live",
  },
  {
    id: "asset_ustec",
    group: "assets",
    titleRu: "USTEC (NASDAQ-100)",
    titleEn: "USTEC (NASDAQ-100)",
    descriptionRu: "Живой график M1–W1, ордера роботов, тех-сектор и новости США",
    descriptionEn: "Live M1–W1 chart, robot orders, US tech drivers & news",
    route: "/dashboard/crypto",
    icon: Cpu,
    badge: "live",
  },
  {
    id: "market_heatmap",
    group: "intelligence",
    titleRu: "Карта рынка (Treemap)",
    titleEn: "Market Heatmap",
    descriptionRu: "StockCharts/Finviz тремап: NASDAQ-100, S&P 500, мировые лидеры и золото",
    descriptionEn: "NASDAQ-100, S&P 500, global leaders & gold commodities treemap",
    route: "/dashboard/analytics",
    icon: Grid2x2,
    hotkeyActionId: "nav.heatmap",
    badge: "new",
  },
  {
    id: "analytics_risk",
    group: "intelligence",
    titleRu: "Аналитика и Risk Lab",
    titleEn: "Analytics & Risk Lab",
    descriptionRu: "TWR ROI, Drawdown, MAE/MFE, Execution TCA, корреляции и календарь PnL",
    descriptionEn: "TWR ROI, Drawdown, MAE/MFE, TCA, correlations & PnL calendar",
    route: "/dashboard/analytics",
    icon: Gauge,
  },
  {
    id: "news_ai",
    group: "intelligence",
    titleRu: "Мировые новости и Gemini AI",
    titleEn: "World News & Gemini AI",
    descriptionRu: "Лента новостей, эконом-календарь и Google AI Co-Pilot по портфелю",
    descriptionEn: "Global news feed, economic calendar & Google Gemini AI Co-Pilot",
    route: "/dashboard/chat",
    icon: Newspaper,
    hotkeyActionId: "nav.news",
    badge: "ai",
  },
  {
    id: "containers_ops",
    group: "operations",
    titleRu: "Контейнеры MT5 / ОС",
    titleEn: "MT5 / OS Containers",
    descriptionRu: "Мониторинг Docker-контейнеров, CPU/RAM, логи и безопасный Restart",
    descriptionEn: "Docker container status, CPU/RAM, live logs & safe Restart",
    route: "/dashboard/infrastructure",
    icon: Server,
    hotkeyActionId: "nav.containers",
  },
  {
    id: "instructions_wiki",
    group: "operations",
    titleRu: "Инструкции и Setup Wizard",
    titleEn: "Instructions & Setup Wizard",
    descriptionRu: "Мастер подключения MT5 (.set генератор), база знаний и регламенты",
    descriptionEn: "MT5 Setup Wizard (.set generator), knowledge base & playbooks",
    route: "/dashboard/academy",
    icon: BookOpen,
    hotkeyActionId: "nav.instructions",
  },
  {
    id: "profile",
    group: "system",
    titleRu: "Профиль и Безопасность",
    titleEn: "Profile & Security",
    descriptionRu: "Аватар, соцсети, FIDO2 Passkeys, 2FA TOTP и зашифрованные ключи",
    descriptionEn: "Avatar, social links, FIDO2 Passkeys, 2FA TOTP & Secret Vault",
    route: "/dashboard/profile",
    icon: UserRound,
  },
  {
    id: "settings",
    group: "system",
    titleRu: "Настройки и Горячие клавиши",
    titleEn: "Settings & Hotkeys",
    descriptionRu: "Левое меню, бегущая строка, Telegram-алерты и редактор макропада F13–F24",
    descriptionEn: "Sidebar customizer, ticker tape, Telegram alerts & F13–F24 keymap",
    route: "/dashboard/roles",
    icon: Settings,
  },
];

export const FALLBACK_ICON = Activity;
