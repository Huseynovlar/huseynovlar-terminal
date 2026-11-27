import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { Bell, BellRing, Check, History, Plus, Star, Trash2, Volume2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { soundEngine, type SoundEventKey } from "@/framework/sound-engine";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export interface ProAlertItem {
  id: string;
  alert_type: "price_cross" | "stat_arb_z" | "mt5_risk" | "macro_pre";
  symbol: string;
  pair_symbol?: string | null;
  condition: "above" | "below" | "abs_gte" | "lt" | "offline" | "pre_15m";
  threshold: number;
  note: string;
  channel_sound: boolean;
  sound_tone: string;
  channel_telegram: boolean;
  channel_os: boolean;
  repeatable: boolean;
  enabled: boolean;
  triggered_count: number;
  last_triggered_at?: string | null;
  created_at: string;
}

export interface ProAlertHistoryItem {
  id: string;
  alert_id: string;
  alert_type: string;
  symbol: string;
  condition: string;
  threshold: number;
  trigger_price?: number | null;
  message: string;
  telegram_sent: boolean;
  triggered_at: string;
}

type DockTab = "watchlist" | "alerts";
type AlertSubTab = "active" | "history";
type WatchlistGroup = "my" | "crypto" | "metals_indices" | "favorites";

const CRYPTO_LIST = ["BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD", "XRPUSD", "LINKUSD", "AVAXUSD", "DOGEUSD"];
const METALS_INDICES_LIST = ["XAUUSD", "XAGUSD", "USTEC", "US500", "US30", "USOIL", "EURUSD", "GBPUSD"];
const FAV_STORAGE_KEY = "ht_watchlist_favorites_v1";

function loadFavorites(): string[] {
  if (typeof window === "undefined") return ["XAUUSD", "USTEC", "BTCUSD", "ETHUSD"];
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // ignore
  }
  return ["XAUUSD", "USTEC", "BTCUSD", "ETHUSD"];
}

function fmtCompactPrice(val?: number | null): string {
  if (val == null || !Number.isFinite(val) || val <= 0) return "—";
  if (val >= 1000) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(4);
}

function MicroSparkline({ points, positive }: { points: number[]; positive: boolean }) {
  if (points.length < 2) {
    return (
      <svg width="36" height="14" className="shrink-0 opacity-40">
        <line x1="0" y1="7" x2="36" y2="7" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 36;
      const y = 13 - ((v - min) / span) * 11;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width="36" height="14" className="shrink-0">
      <path d={path} fill="none" stroke={positive ? "var(--bull)" : "var(--bear)"} strokeWidth="1.25" />
    </svg>
  );
}

interface WatchlistAlertsDockProps {
  open: boolean;
  activeTab: DockTab;
  onTabChange: (tab: DockTab) => void;
  onClose: () => void;
  refreshSignal?: number;
}

export function WatchlistAlertsDock({
  open,
  activeTab,
  onTabChange,
  onClose,
  refreshSignal = 0,
}: WatchlistAlertsDockProps) {
  const navigate = useNavigate();
  const [group, setGroup] = useState<WatchlistGroup>("favorites");
  const [myAssets, setMyAssets] = useState<string[]>(["XAUUSD", "USTEC", "BTCUSD"]);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const sparkMapRef = useRef<Record<string, number[]>>({});

  // Unified Alerts state
  const [alertSubTab, setAlertSubTab] = useState<AlertSubTab>("active");
  const [alerts, setAlerts] = useState<ProAlertItem[]>([]);
  const [history, setHistory] = useState<ProAlertHistoryItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add alert form state
  const [newType, setNewType] = useState<ProAlertItem["alert_type"]>("price_cross");
  const [newSymbol, setNewSymbol] = useState("XAUUSD");
  const [newPairSymbol, setNewPairSymbol] = useState("BTCUSD");
  const [newCond, setNewCond] = useState<ProAlertItem["condition"]>("above");
  const [newThreshold, setNewThreshold] = useState("2650");
  const [newTone, setNewTone] = useState("priceAlert");
  const [newSound, setNewSound] = useState(true);
  const [newTelegram, setNewTelegram] = useState(true);
  const [newOs, setNewOs] = useState(true);
  const [newRepeatable, setNewRepeatable] = useState(false);

  const triggeredLockRef = useRef<Record<string, number>>({});

  const loadAlerts = useCallback(async () => {
    try {
      const res = await apiRequest<{ alerts: ProAlertItem[]; history: ProAlertHistoryItem[] }>("/pro/alerts");
      setAlerts(res.alerts || []);
      setHistory(res.history || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts, refreshSignal]);

  useEffect(() => {
    apiRequestPaged<{ code: string }>("/assets", 1, 100)
      .then((res) => {
        const codes = res.items.map((x) => canonicalMarketSymbol(x.code)).filter(Boolean);
        if (codes.length > 0) setMyAssets(Array.from(new Set(codes)));
      })
      .catch(() => {
        // fallback defaults
      });
  }, []);

  const currentSymbols = useMemo(() => {
    switch (group) {
      case "my":
        return myAssets;
      case "crypto":
        return CRYPTO_LIST;
      case "metals_indices":
        return METALS_INDICES_LIST;
      case "favorites":
        return favorites;
    }
  }, [group, myAssets, favorites]);

  const alertSymbols = useMemo(
    () =>
      alerts
        .filter((a) => a.enabled && a.alert_type === "price_cross")
        .map((a) => canonicalMarketSymbol(a.symbol)),
    [alerts],
  );

  const streamSymbols = useMemo(
    () => Array.from(new Set([...(open ? currentSymbols : []), ...alertSymbols])),
    [open, currentSymbols, alertSymbols],
  );

  const liveQuotes = useMarketListStream(streamSymbols);

  // Maintain micro-sparkline buffers from live WS frames
  useEffect(() => {
    for (const [sym, q] of Object.entries(liveQuotes)) {
      if (q?.price && Number.isFinite(q.price)) {
        const arr = sparkMapRef.current[sym] ?? [];
        if (arr[arr.length - 1] !== q.price) {
          sparkMapRef.current[sym] = [...arr.slice(-19), q.price];
        }
      }
    }
  }, [liveQuotes]);

  // Real-time client-side Price Cross evaluator (Zero REST polling — pure /ws/market driven)
  useEffect(() => {
    const now = Date.now();
    for (const alert of alerts) {
      if (!alert.enabled || alert.alert_type !== "price_cross") continue;
      const canon = canonicalMarketSymbol(alert.symbol);
      const q = liveQuotes[canon];
      if (!q?.price || !Number.isFinite(q.price)) continue;

      const hit =
        (alert.condition === "above" && q.price >= alert.threshold) ||
        (alert.condition === "below" && q.price <= alert.threshold);
      if (!hit) continue;

      const lastLock = triggeredLockRef.current[alert.id] ?? 0;
      if (now - lastLock < 15_000) continue;
      triggeredLockRef.current[alert.id] = now;

      if (alert.channel_sound) {
        soundEngine.play((alert.sound_tone as SoundEventKey) || "priceAlert");
      }
      const msg = `${alert.symbol} ${alert.condition === "above" ? "≥" : "≤"} ${alert.threshold} (Цена: ${fmtCompactPrice(q.price)})`;
      notify.info("Сработал ценовой алерт", msg);
      if (alert.channel_os && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`Huseynovlar Alert: ${alert.symbol}`, { body: msg });
      }

      void apiRequest<{ alert: ProAlertItem; event: ProAlertHistoryItem }>(`/pro/alerts/${alert.id}/trigger`, {
        method: "POST",
        body: JSON.stringify({ trigger_price: q.price, message: msg }),
      })
        .then((res) => {
          setAlerts((prev) => prev.map((a) => (a.id === alert.id ? res.alert : a)));
          setHistory((prev) => [res.event, ...prev].slice(0, 200));
        })
        .catch(() => {
          // silent
        });
    }
  }, [liveQuotes, alerts]);

  const toggleFavorite = (sym: string) => {
    setFavorites((prev) => {
      const next = prev.includes(sym) ? prev.filter((x) => x !== sym) : [...prev, sym];
      try {
        window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const thr = Number.parseFloat(newThreshold.replace(",", "."));
    if (!newSymbol.trim() || !Number.isFinite(thr)) {
      notify.error("Ошибка", "Укажите символ и корректный порог");
      return;
    }
    try {
      const created = await apiRequest<ProAlertItem>("/pro/alerts", {
        method: "POST",
        body: JSON.stringify({
          alert_type: newType,
          symbol: newSymbol.trim().toUpperCase(),
          pair_symbol: newType === "stat_arb_z" ? newPairSymbol.trim().toUpperCase() : null,
          condition:
            newType === "stat_arb_z"
              ? "abs_gte"
              : newType === "mt5_risk"
                ? "lt"
                : newType === "macro_pre"
                  ? "pre_15m"
                  : newCond,
          threshold: thr,
          channel_sound: newSound,
          sound_tone: newTone,
          channel_telegram: newTelegram,
          channel_os: newOs,
          repeatable: newRepeatable,
        }),
      });
      setAlerts((prev) => [created, ...prev]);
      setShowAddForm(false);
      soundEngine.play("levelClick");
      notify.success("Алерт создан", `${created.symbol} (${created.threshold})`);
    } catch (err) {
      notify.error("Ошибка", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      await apiRequest(`/pro/alerts/${id}`, { method: "DELETE" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silent
    }
  };

  const handleToggleAlert = async (a: ProAlertItem) => {
    try {
      const updated = await apiRequest<ProAlertItem>(`/pro/alerts/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } catch {
      // silent
    }
  };

  if (!open) return null;

  const activeAlertsCount = alerts.filter((a) => a.enabled).length;

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
      {/* Dock Header Tabs */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTabChange("watchlist")}
            className={`rounded-[3px] px-2 py-1 text-[11px] font-semibold transition-colors ${
              activeTab === "watchlist"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Watchlist
          </button>
          <button
            type="button"
            onClick={() => onTabChange("alerts")}
            className={`flex items-center gap-1 rounded-[3px] px-2 py-1 text-[11px] font-semibold transition-colors ${
              activeTab === "alerts"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Bell className="size-3" />
            <span>Алерты</span>
            {activeAlertsCount > 0 && (
              <span className="rounded-full bg-[var(--accent-blue)] px-1.5 font-mono text-[9px] text-white">
                {activeAlertsCount}
              </span>
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Скрыть панель (Esc)"
          className="rounded-[3px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* WATCHLIST TAB */}
      {activeTab === "watchlist" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[var(--border-subtle)] p-2">
            <SearchSelect
              value={group}
              onValueChange={(v) => setGroup(v as WatchlistGroup)}
              options={[
                { value: "favorites", label: "Избранное" },
                { value: "my", label: "Мои активы" },
                { value: "crypto", label: "Крипто" },
                { value: "metals_indices", label: "Металлы и Индексы" },
              ]}
              placeholder="Список наблюдения..."
            />
          </div>
          <div className="min-h-0 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
            {currentSymbols.map((sym) => {
              const canon = canonicalMarketSymbol(sym);
              const q = liveQuotes[canon];
              const pct = q?.changePct ?? 0;
              const online = Boolean(q?.price && q.price > 0);
              const isFav = favorites.includes(sym);
              return (
                <div
                  key={sym}
                  onClick={() =>
                    void navigate({
                      to: "/dashboard/tickers/$symbol" as never,
                      params: { symbol: sym } as never,
                    })
                  }
                  className="group flex cursor-pointer items-center justify-between gap-1.5 px-2.5 py-2 transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: online ? "var(--bull)" : "var(--text-muted)" }}
                      />
                      <span className="truncate font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                        {sym}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(sym);
                        }}
                        className="opacity-40 hover:opacity-100"
                        title="В избранное"
                      >
                        <Star
                          className={`size-2.5 ${isFav ? "fill-[var(--accent-amber)] text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}
                        />
                      </button>
                    </div>
                    <div
                      className="mt-0.5 font-mono text-[10px] tabular-nums"
                      style={{ color: pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                    >
                      {online ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "OFFLINE"}
                    </div>
                  </div>
                  <MicroSparkline points={sparkMapRef.current[canon] ?? []} positive={pct >= 0} />
                  <div className="text-right font-mono text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {fmtCompactPrice(q?.price)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ALERTS TAB */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2 py-1.5">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setAlertSubTab("active")}
                className={`rounded-[3px] px-2 py-0.5 text-[10px] font-semibold ${
                  alertSubTab === "active"
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Активные ({alerts.length})
              </button>
              <button
                type="button"
                onClick={() => setAlertSubTab("history")}
                className={`flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[10px] font-semibold ${
                  alertSubTab === "history"
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <History className="size-2.5" />
                История ({history.length})
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => setShowAddForm((s) => !s)}
            >
              <Plus className="size-3" />
            </Button>
          </div>

          {showAddForm && (
            <form
              onSubmit={(e) => void handleCreateAlert(e)}
              className="space-y-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 text-[11px]"
            >
              <SearchSelect
                value={newType}
                onValueChange={(v) => setNewType(v as ProAlertItem["alert_type"])}
                options={[
                  { value: "price_cross", label: "Ценовой (Price Cross)" },
                  { value: "stat_arb_z", label: "Стат-Арбитраж (|Z-Score|)" },
                  { value: "mt5_risk", label: "Счёт MT5 (Margin / Bridge)" },
                  { value: "macro_pre", label: "Макро (за 15 мин до High)" },
                ]}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="XAUUSD"
                  className="h-7 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] uppercase focus:border-[var(--accent-blue)] focus:outline-none"
                />
                {newType === "stat_arb_z" ? (
                  <input
                    value={newPairSymbol}
                    onChange={(e) => setNewPairSymbol(e.target.value.toUpperCase())}
                    placeholder="BTCUSD"
                    className="h-7 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] uppercase focus:border-[var(--accent-blue)] focus:outline-none"
                  />
                ) : (
                  <SearchSelect
                    value={newCond}
                    onValueChange={(v) => setNewCond(v as ProAlertItem["condition"])}
                    options={[
                      { value: "above", label: "Выше ≥" },
                      { value: "below", label: "Ниже ≤" },
                    ]}
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  step="any"
                  value={newThreshold}
                  onChange={(e) => setNewThreshold(e.target.value)}
                  placeholder="Порог"
                  className="h-7 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] tabular-nums focus:border-[var(--accent-blue)] focus:outline-none"
                />
                <SearchSelect
                  value={newTone}
                  onValueChange={setNewTone}
                  options={[
                    { value: "priceAlert", label: "Тон: Price" },
                    { value: "mt5ZoneEnter", label: "Тон: StatArb" },
                    { value: "highImpactNews", label: "Тон: Macro" },
                    { value: "orderOpened", label: "Тон: Fill" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-secondary)]">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={newSound} onChange={(e) => setNewSound(e.target.checked)} />
                  Звук
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={newTelegram} onChange={(e) => setNewTelegram(e.target.checked)} />
                  Telegram
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={newOs} onChange={(e) => setNewOs(e.target.checked)} />
                  OS
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={newRepeatable} onChange={(e) => setNewRepeatable(e.target.checked)} />
                  Повтор
                </label>
              </div>
              <Button type="submit" size="sm" className="h-7 w-full text-[11px]">
                Создать алерт
              </Button>
            </form>
          )}

          {alertSubTab === "active" ? (
            <div className="min-h-0 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
                  Нет алертов. Создайте через <code className="font-mono text-[var(--accent-amber)]">ALERT XAUUSD 2650</code> или «+».
                </div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="space-y-1 px-2.5 py-2 text-[11px]">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 font-mono font-semibold">
                        <BellRing
                          className="size-3 shrink-0"
                          style={{ color: a.enabled ? "var(--accent-amber)" : "var(--text-muted)" }}
                        />
                        <span>{a.pair_symbol ? `${a.symbol}/${a.pair_symbol}` : a.symbol}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleToggleAlert(a)}
                          className={`rounded-[3px] px-1.5 py-0.5 text-[9px] font-semibold ${
                            a.enabled
                              ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                              : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                          }`}
                        >
                          {a.enabled ? "ON" : "OFF"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteAlert(a.id)}
                          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--bear)]"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)] tabular-nums">
                      <span>
                        {a.alert_type} • {a.condition} {a.threshold}
                      </span>
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        {a.channel_sound && <Volume2 className="size-2.5" />}
                        {a.channel_telegram && <span>TG</span>}
                        {a.repeatable && <span>↻</span>}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
              {history.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
                  История срабатываний пуста
                </div>
              ) : (
                history.map((h) => (
                  <div key={h.id} className="space-y-0.5 px-2.5 py-2 text-[10px]">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-semibold text-[var(--text-primary)]">{h.symbol}</span>
                      <span className="text-[var(--text-muted)]">
                        {new Date(h.triggered_at).toISOString().slice(11, 19)} UTC
                      </span>
                    </div>
                    <div className="text-[var(--text-secondary)]">{h.message}</div>
                    {h.telegram_sent && (
                      <div className="inline-flex items-center gap-1 text-[9px] text-[var(--bull)]">
                        <Check className="size-2.5" /> Telegram отправлен
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
