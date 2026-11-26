import type { LucideIcon } from "lucide-react";
import {
  Activity,
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
  MonitorSmartphone,
  Newspaper,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

export type TerminalNavGroupId = "desk" | "markets" | "intelligence" | "operations" | "system";

export interface TerminalPageConfig {
  id: string;
  group: TerminalNavGroupId;
  titleRu: string;
  titleEn: string;
  titleAz: string;
  route: string;
  icon: LucideIcon;
  hotkeyActionId?: string;
}

export const TERMINAL_NAV_GROUPS: Record<TerminalNavGroupId, { labelRu: string; labelEn: string; labelAz: string }> = {
  desk: { labelRu: "Терминал", labelEn: "Desk", labelAz: "Terminal" },
  markets: { labelRu: "Активы и Рынок", labelEn: "Markets & Analytics", labelAz: "Bazarlar və Analitika" },
  intelligence: { labelRu: "Новости и ИИ", labelEn: "Intelligence & AI", labelAz: "Xəbərlər və Sİ" },
  operations: { labelRu: "Инфраструктура", labelEn: "Operations", labelAz: "İnfrastruktur" },
  system: { labelRu: "Система и Доступ", labelEn: "System & Security", labelAz: "Sistem və Təhlükəsizlik" },
};

export const TERMINAL_PAGES: TerminalPageConfig[] = [
  { id: "home", group: "desk", titleRu: "Главная панель", titleEn: "Home Command", titleAz: "Əsas panel", route: "/dashboard/home", icon: Home, hotkeyActionId: "nav.home" },
  { id: "accounts", group: "desk", titleRu: "Счета Exness", titleEn: "Exness Accounts", titleAz: "Exness hesabları", route: "/dashboard/accounts", icon: Layers },
  { id: "robots", group: "desk", titleRu: "Торговые роботы", titleEn: "Trading Robots", titleAz: "Ticarət robotları", route: "/dashboard/robots", icon: Bot },
  { id: "journal", group: "desk", titleRu: "Журнал сделок", titleEn: "Deals Journal", titleAz: "Əməliyyat jurnalı", route: "/dashboard/journal", icon: BookOpen },
  { id: "treasury", group: "desk", titleRu: "Казна и переводы", titleEn: "Treasury & Transfers", titleAz: "Xəzinə və köçürmələr", route: "/dashboard/treasury", icon: Banknote },
  { id: "hubs", group: "markets", titleRu: "Хабы активов", titleEn: "Asset Hubs", titleAz: "Aktiv habları", route: "/dashboard/hubs", icon: Layers, hotkeyActionId: "nav.assets" },
  { id: "tickers", group: "markets", titleRu: "Справочник тикеров", titleEn: "Market Tickers", titleAz: "Tikerlər kataloqu", route: "/dashboard/tickers", icon: BookOpen },
  { id: "explorer", group: "markets", titleRu: "Поиск активов", titleEn: "Asset Explorer", titleAz: "Aktiv axtarışı", route: "/dashboard/explorer", icon: Compass },
  { id: "treemap", group: "markets", titleRu: "Карта рынка", titleEn: "Market Treemap", titleAz: "Bazar xəritəsi", route: "/dashboard/treemap", icon: Grid2x2, hotkeyActionId: "nav.heatmap" },
  { id: "analytics", group: "markets", titleRu: "Аналитика и риски", titleEn: "Analytics & Risk Lab", titleAz: "Analitika və risklər", route: "/dashboard/analytics", icon: Gauge },
  { id: "calendar", group: "markets", titleRu: "Экономический календарь", titleEn: "Economic Calendar", titleAz: "İqtisadi təqvim", route: "/dashboard/calendar", icon: Calendar },
  { id: "news", group: "intelligence", titleRu: "Лента новостей", titleEn: "News Wire", titleAz: "Xəbər lenti", route: "/dashboard/news", icon: Newspaper, hotkeyActionId: "nav.news" },
  { id: "news-sources", group: "intelligence", titleRu: "Проверенные источники", titleEn: "Verified Sources", titleAz: "Təsdiqlənmiş mənbələr", route: "/dashboard/news/sources", icon: ShieldCheck },
  { id: "containers", group: "operations", titleRu: "Docker контейнеры MT5", titleEn: "MT5 Docker Containers", titleAz: "MT5 Docker konteynerləri", route: "/dashboard/containers", icon: Server, hotkeyActionId: "nav.containers" },
  { id: "setup", group: "operations", titleRu: "Мастер настройки и /etc", titleEn: "Setup Wizard & /etc", titleAz: "Quraşdırma və /etc", route: "/dashboard/setup", icon: Wrench, hotkeyActionId: "nav.instructions" },
  { id: "wiki", group: "operations", titleRu: "База знаний (Wiki)", titleEn: "Knowledge Base (Wiki)", titleAz: "Bilik bazası (Wiki)", route: "/dashboard/wiki", icon: BookOpen, hotkeyActionId: "nav.wiki" },
  { id: "users", group: "system", titleRu: "Пользователи (RBAC)", titleEn: "Users (RBAC)", titleAz: "İstifadəçilər (RBAC)", route: "/dashboard/users", icon: Users },
  { id: "profile", group: "system", titleRu: "Мой профиль", titleEn: "My Profile", titleAz: "Mənim profilim", route: "/dashboard/profile", icon: UserRound },
  { id: "security", group: "system", titleRu: "Безопасность и 2FA", titleEn: "Security & 2FA", titleAz: "Təhlükəsizlik və 2FA", route: "/dashboard/security", icon: ShieldCheck },
  { id: "sessions", group: "system", titleRu: "Активные сессии", titleEn: "Active Sessions", titleAz: "Aktiv sessiyalar", route: "/dashboard/sessions", icon: MonitorSmartphone },
  { id: "login-history", group: "system", titleRu: "История входов", titleEn: "Login History", titleAz: "Giriş tarixçəsi", route: "/dashboard/login-history", icon: History },
  { id: "audit", group: "system", titleRu: "Журнал аудита", titleEn: "Audit Log", titleAz: "Audit jurnalı", route: "/dashboard/audit", icon: FileSearch },
  { id: "preferences", group: "system", titleRu: "Настройки терминала", titleEn: "Terminal Preferences", titleAz: "Terminal ayarları", route: "/dashboard/preferences", icon: Settings, hotkeyActionId: "nav.preferences" },
  { id: "hotkeys", group: "system", titleRu: "Горячие клавиши", titleEn: "Hotkeys", titleAz: "Qısa yollar", route: "/dashboard/hotkeys", icon: Keyboard },
];

export const FALLBACK_ICON = Activity;
