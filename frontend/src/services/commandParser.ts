export type ParsedCommand =
  | { kind: "ticker"; symbol: string; mode: "market" | "portfolio" }
  | { kind: "stat_arb"; symA?: string; symB?: string }
  | { kind: "multi"; symbols?: string[]; timeframes?: string[] }
  | { kind: "news"; query: string }
  | { kind: "alert_price"; symbol: string; price: number }
  | { kind: "alert_arb"; symA: string; symB: string; zScore: number }
  | { kind: "alerts_open" }
  | { kind: "note"; symbol: string; text: string }
  | { kind: "route"; path: string; label: string }
  | { kind: "calc"; symbol?: string }
  | { kind: "scanner" }
  | { kind: "theme"; mode: "dark" | "light" }
  | { kind: "mute"; muted: boolean }
  | { kind: "awake"; enabled: boolean }
  | { kind: "help" }
  | { kind: "unknown"; raw: string };

export interface CommandHint {
  code: string;
  syntax: string;
  description: string;
  category: "Разделы" | "График" | "Алерты и Заметки" | "Инструменты" | "Система";
}

export const SECTION_ROUTES: Record<string, { path: string; label: string }> = {
  DASH: { path: "/dashboard/home", label: "Дашборд" },
  HOME: { path: "/dashboard/home", label: "Дашборд" },
  ACC: { path: "/dashboard/accounts", label: "Счета MT5" },
  EA: { path: "/dashboard/robots", label: "Торговые роботы" },
  JRN: { path: "/dashboard/journal", label: "Журнал сделок" },
  TRES: { path: "/dashboard/treasury", label: "Казначейство" },
  RISK: { path: "/dashboard/analytics", label: "Аналитика риска" },
  CAL: { path: "/dashboard/calendar", label: "Экономический календарь" },
  HEAT: { path: "/dashboard/treemap", label: "Тепловая карта (Treemap)" },
  MACRO: { path: "/dashboard/macro", label: "Макроэкономика и ЦБ" },
  COT: { path: "/dashboard/macro", label: "Отчёты CFTC COT" },
  "13F": { path: "/dashboard/ownership", label: "13F / Институционалы" },
  ONCHAIN: { path: "/dashboard/derivatives", label: "Ончейн и Деривативы" },
  BMAP: { path: "/dashboard/global-map", label: "Глобальная карта (BMAP)" },
  INFRA: { path: "/dashboard/infrastructure", label: "Инфраструктура" },
  SET: { path: "/dashboard/settings", label: "Настройки" },
  SPLIT: { path: "/dashboard/multichart", label: "Мультичарт (Сплит)" },
  MULTI: { path: "/dashboard/multichart", label: "Мультичарт (Сплит)" },
  ASSETS: { path: "/dashboard/default", label: "Мои активы" },
  NEWS: { path: "/dashboard/news", label: "Лента новостей" },
  TICKERS: { path: "/dashboard/tickers", label: "Справочник рынков" },
};

export const COMMAND_HINTS: CommandHint[] = [
  { code: "XAUUSD GP", syntax: "<TICKER> [GP]", description: "Открыть график и стакан актива", category: "График" },
  { code: "XAUUSD PORT", syntax: "<TICKER> PORT", description: "Портфель актива со слоем зон MT5", category: "График" },
  { code: "ARB", syntax: "ARB [A] [B]", description: "Стат-арбитраж (пара A/B или сканер)", category: "Инструменты" },
  { code: "CALC", syntax: "CALC [TICKER]", description: "Калькулятор риска и лота MT5 (USD/USC)", category: "Инструменты" },
  { code: "SCAN", syntax: "SCAN", description: "Скринер аномалий (RVOL / ATR / Funding)", category: "Инструменты" },
  { code: "ALERTS", syntax: "ALERTS", description: "Открыть единый центр алертов", category: "Алерты и Заметки" },
  { code: "ALERT", syntax: "ALERT <SYM> <PRICE>", description: "Создать ценовой алерт (звук + Telegram)", category: "Алерты и Заметки" },
  { code: "ALERT ARB", syntax: "ALERT ARB <A> <B> <Z>", description: "Создать алерт стат-арбитража по |Z|", category: "Алерты и Заметки" },
  { code: "NOTE", syntax: "NOTE <SYM> <ТЕКСТ>", description: "Быстрая UTC-заметка к активу", category: "Алерты и Заметки" },
  { code: "NEWS", syntax: "NEWS <ЗАПРОС>", description: "Открыть новости с фильтром по теме", category: "Разделы" },
  { code: "DASH", syntax: "DASH", description: "Главный дашборд портфеля", category: "Разделы" },
  { code: "ACC", syntax: "ACC", description: "Счета MT5", category: "Разделы" },
  { code: "EA", syntax: "EA", description: "Торговые роботы (EA)", category: "Разделы" },
  { code: "JRN", syntax: "JRN", description: "Журнал сделок", category: "Разделы" },
  { code: "TRES", syntax: "TRES", description: "Казначейство и ончейн-кошельки", category: "Разделы" },
  { code: "RISK", syntax: "RISK", description: "Аналитика риска", category: "Разделы" },
  { code: "CAL", syntax: "CAL", description: "Экономический календарь", category: "Разделы" },
  { code: "HEAT", syntax: "HEAT", description: "Тепловая карта (Treemap)", category: "Разделы" },
  { code: "MACRO", syntax: "MACRO", description: "Макроэкономика и ЦБ", category: "Разделы" },
  { code: "COT", syntax: "COT", description: "Позиции CFTC COT", category: "Разделы" },
  { code: "13F", syntax: "13F", description: "Институционалы (13F)", category: "Разделы" },
  { code: "ONCHAIN", syntax: "ONCHAIN", description: "Ончейн-потоки и деривативы", category: "Разделы" },
  { code: "BMAP", syntax: "BMAP", description: "Глобальная карта потоков", category: "Разделы" },
  { code: "SPLIT", syntax: "SPLIT", description: "Мультичарт (2×1 / 2×2 сплит)", category: "Разделы" },
  { code: "INFRA", syntax: "INFRA", description: "Инфраструктура и контейнеры", category: "Разделы" },
  { code: "SET", syntax: "SET", description: "Настройки терминала", category: "Разделы" },
  { code: "THEME DARK", syntax: "THEME DARK | LIGHT", description: "Переключить тему оформления", category: "Система" },
  { code: "MUTE", syntax: "MUTE | UNMUTE", description: "Выключить / включить звук SoundEngine", category: "Система" },
  { code: "AWAKE ON", syntax: "AWAKE ON | OFF", description: "Режим «Не гасить экран» (Keep-Awake)", category: "Система" },
  { code: "HELP", syntax: "HELP", description: "Шпаргалка команд и горячих клавиш", category: "Система" },
];

const HISTORY_KEY = "ht_bloomberg_cmd_history_v1";
const MAX_HISTORY = 30;

export function loadCommandHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function pushCommandHistory(cmd: string): string[] {
  const clean = cmd.trim();
  if (!clean) return loadCommandHistory();
  const prev = loadCommandHistory().filter((x) => x.toUpperCase() !== clean.toUpperCase());
  const next = [clean, ...prev].slice(0, MAX_HISTORY);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota
  }
  return next;
}

export function parseBloombergCommand(rawInput: string): ParsedCommand {
  const trimmed = rawInput.trim();
  if (!trimmed) return { kind: "unknown", raw: "" };

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0].toUpperCase();
  const second = tokens[1]?.toUpperCase() ?? "";

  // System commands
  if (first === "HELP" || first === "?") {
    return { kind: "help" };
  }
  if (first === "MUTE") {
    return { kind: "mute", muted: true };
  }
  if (first === "UNMUTE") {
    return { kind: "mute", muted: false };
  }
  if (first === "THEME") {
    if (second === "LIGHT") return { kind: "theme", mode: "light" };
    if (second === "DARK") return { kind: "theme", mode: "dark" };
  }
  if (first === "AWAKE") {
    if (second === "ON" || second === "1") return { kind: "awake", enabled: true };
    if (second === "OFF" || second === "0") return { kind: "awake", enabled: false };
    return { kind: "awake", enabled: true };
  }

  // Tools
  if (first === "CALC") {
    return { kind: "calc", symbol: second || undefined };
  }
  if (first === "SCAN" || first === "RVOL") {
    return { kind: "scanner" };
  }
  if (first === "ALERTS") {
    return { kind: "alerts_open" };
  }

  // Alerts creation: ALERT ARB ETH BTC 2.2 | ALERT XAUUSD 2650
  if (first === "ALERT") {
    if (second === "ARB" && tokens.length >= 5) {
      const z = Number.parseFloat(tokens[4].replace(",", "."));
      if (Number.isFinite(z) && z > 0) {
        return { kind: "alert_arb", symA: tokens[2].toUpperCase(), symB: tokens[3].toUpperCase(), zScore: z };
      }
    }
    if (tokens.length >= 3) {
      const px = Number.parseFloat(tokens[2].replace(",", "."));
      if (Number.isFinite(px) && px > 0) {
        return { kind: "alert_price", symbol: second, price: px };
      }
    }
    return { kind: "alerts_open" };
  }

  // Quick Note: NOTE XAUUSD Жду ретест
  if (first === "NOTE" && tokens.length >= 3) {
    const noteText = trimmed.replace(/^note\s+\S+\s+/i, "").trim();
    if (noteText) {
      return { kind: "note", symbol: second, text: noteText };
    }
  }

  // News with keyword filter
  if (first === "NEWS") {
    const query = trimmed.replace(/^news\s*/i, "").trim();
    return { kind: "news", query };
  }

  // Stat-Arbitrage: ARB | ARB SCAN | ARB ETH BTC
  if (first === "ARB") {
    if (!second || second === "SCAN") {
      return { kind: "stat_arb" };
    }
    if (tokens.length >= 3) {
      return { kind: "stat_arb", symA: second, symB: tokens[2].toUpperCase() };
    }
    return { kind: "stat_arb", symA: second };
  }

  // Multi-Chart: MULTI XAUUSD USTEC BTCUSD DXY | MULTI XAUUSD M5 M15 H1 H4
  if (first === "MULTI" || first === "SPLIT") {
    if (tokens.length === 1) {
      return { kind: "multi" };
    }
    const tfSet = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);
    const rest = tokens.slice(1).map((t) => t.toUpperCase());
    const tfs = rest.filter((t) => tfSet.has(t));
    const syms = rest.filter((t) => !tfSet.has(t));
    return {
      kind: "multi",
      symbols: syms.length > 0 ? syms : undefined,
      timeframes: tfs.length > 0 ? tfs : undefined,
    };
  }

  // Section routes
  const section = SECTION_ROUTES[first];
  if (section && tokens.length === 1) {
    return { kind: "route", path: section.path, label: section.label };
  }

  // Ticker commands: XAUUSD | XAUUSD GP | XAUUSD PORT
  if (/^[A-Z0-9._/-]{2,16}$/i.test(first)) {
    if (second === "PORT") {
      return { kind: "ticker", symbol: first, mode: "portfolio" };
    }
    if (!second || second === "GP" || second === "CHART") {
      return { kind: "ticker", symbol: first, mode: "market" };
    }
  }

  return { kind: "unknown", raw: trimmed };
}
