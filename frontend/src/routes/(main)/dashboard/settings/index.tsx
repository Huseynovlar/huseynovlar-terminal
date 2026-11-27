import { useCallback, useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  CheckCircle2,
  Database,
  KeyRound,
  Play,
  Save,
  Send,
  ShieldCheck,
  Sliders,
  Volume2,
  VolumeX,
} from "lucide-react";

import { SettingsSecurityPanels } from "@/components/pro/SettingsSecurityPanels";
import { AsyncButton } from "@/components/ui/async-button";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { type SoundCategory, type SoundConfig, soundEngine } from "@/framework/sound-engine";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/settings/")({
  component: SettingsHubPage,
});

type ActiveTile = "profile" | "ui_sound" | "ai" | "market_keys" | "telegram";

interface AiSettingsDto {
  provider: "openai" | "anthropic" | "gemini" | "custom_openai";
  base_url: string;
  model_name: string;
  timeout_sec: number;
  api_key_configured: boolean;
  api_key_masked: string;
}

interface MarketKeyItem {
  id: string;
  label: string;
  configured: boolean;
  status: string;
  source: string;
  masked: string;
}

interface TelegramSettingsDto {
  internal_url: string;
  docker_network: string;
  secret_configured: boolean;
  secret_masked: string;
  notify_mt5_trades: boolean;
  notify_high_impact_news: boolean;
  notify_bridge_disconnect: boolean;
  notify_price_alerts: boolean;
}

const HUB_TILES: Array<{
  id: ActiveTile;
  title: string;
  meta: string;
  icon: typeof ShieldCheck;
}> = [
  { id: "profile", title: "Профиль и безопасность", meta: "Пароль, 2FA (TOTP), активные сессии, RBAC", icon: ShieldCheck },
  { id: "ui_sound", title: "Интерфейс и звук", meta: "Тема, часовой пояс, SoundEngine (громкость и тест)", icon: Sliders },
  { id: "ai", title: "AI-провайдеры (LLM Adapter)", meta: "OpenAI, Anthropic, Gemini, Custom OpenAI-Compatible", icon: Bot },
  { id: "market_keys", title: "Источники рыночных данных", meta: "Alpaca, Finnhub, FRED, AISStream, CoinMarketCal, Exness", icon: Database },
  { id: "telegram", title: "Уведомления и Telegram Bot", meta: "Внутренняя Docker-сеть huseynovlar_webhooks и алерты", icon: Bell },
];

const SOUND_CATEGORIES: Array<{ id: SoundCategory; label: string; desc: string }> = [
  { id: "charts", label: "Графики и алерты", desc: "Price Alert (880→1174 Hz), Зоны MT5, клики уровней, ликвидации" },
  { id: "trades", label: "Сделки и счёт", desc: "Открытие ордера, закрытие в прибыль/убыток, предупреждение маржи" },
  { id: "news", label: "High-Impact новости", desc: "Выход CPI / FOMC / Breaking News (Bloomberg 3-импульсный бип)" },
  { id: "infrastructure", label: "Инфраструктура", desc: "Потеря и восстановление связи с ExnessPanelBridge" },
];

function SettingsHubPage() {
  const navigate = useNavigate();
  const [activeTile, setActiveTile] = useState<ActiveTile>("ui_sound");

  // UI & Sound state
  const [soundCfg, setSoundCfg] = useState<SoundConfig>(() => soundEngine.getConfig());
  const [timezone, setTimezone] = useState<string>(() => localStorage.getItem("ht_tz") || "UTC");
  const [isLight, setIsLight] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") === "light" : false,
  );

  // AI Settings state
  const [aiCfg, setAiCfg] = useState<AiSettingsDto>({
    provider: "gemini",
    base_url: "",
    model_name: "gemini-2.5-flash",
    timeout_sec: 60,
    api_key_configured: false,
    api_key_masked: "",
  });
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; detail: string; latency_ms: number } | null>(null);

  // Market Data Keys state
  const [marketKeys, setMarketKeys] = useState<MarketKeyItem[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState(false);

  // Telegram Docker state
  const [tgCfg, setTgCfg] = useState<TelegramSettingsDto>({
    internal_url: "http://telegram-bot:8080/api/notify",
    docker_network: "huseynovlar_webhooks",
    secret_configured: false,
    secret_masked: "",
    notify_mt5_trades: true,
    notify_high_impact_news: true,
    notify_bridge_disconnect: true,
    notify_price_alerts: true,
  });
  const [tgSecretInput, setTgSecretInput] = useState("");
  const [savingTg, setSavingTg] = useState(false);
  const [testingTg, setTestingTg] = useState(false);

  useEffect(() => {
    return soundEngine.subscribe(() => setSoundCfg(soundEngine.getConfig()));
  }, []);

  const loadBackendSettings = useCallback(async () => {
    try {
      const [ai, mk, tg] = await Promise.all([
        apiRequest<AiSettingsDto>("/ops/settings/ai"),
        apiRequest<{ items: MarketKeyItem[] }>("/ops/settings/market-keys"),
        apiRequest<TelegramSettingsDto>("/ops/settings/telegram"),
      ]);
      if (ai) setAiCfg(ai);
      if (mk?.items) setMarketKeys(mk.items);
      if (tg) setTgCfg(tg);
    } catch {
      // ignore initial load error if non-operator
    }
  }, []);

  useEffect(() => {
    void loadBackendSettings();
  }, [loadBackendSettings]);

  function applyTheme(light: boolean) {
    const root = document.documentElement;
    if (light) {
      root.setAttribute("data-theme", "light");
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.setAttribute("data-theme", "dark");
      root.classList.remove("light");
      root.classList.add("dark");
    }
    setIsLight(light);
  }

  async function handleSaveAi() {
    setSavingAi(true);
    try {
      const res = await apiRequest<AiSettingsDto>("/ops/settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          provider: aiCfg.provider,
          base_url: aiCfg.base_url,
          model_name: aiCfg.model_name,
          timeout_sec: aiCfg.timeout_sec,
          api_key: aiKeyInput.trim() || null,
        }),
      });
      setAiCfg(res);
      setAiKeyInput("");
      notify.success("AI-адаптер сохранён");
    } catch (err) {
      notify.error("Ошибка сохранения AI", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAi(false);
    }
  }

  async function handleTestAi() {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const res = await apiRequest<{ ok: boolean; detail: string; latency_ms: number }>("/ops/settings/ai/test", {
        method: "POST",
      });
      setAiTestResult(res);
      if (res.ok) notify.success("AI подключён", `${res.latency_ms} ms`);
      else notify.error("Ошибка пинга AI", res.detail);
    } catch (err) {
      notify.error("Ошибка проверки AI", err instanceof Error ? err.message : String(err));
    } finally {
      setTestingAi(false);
    }
  }

  async function handleSaveMarketKeys() {
    setSavingKeys(true);
    try {
      const res = await apiRequest<{ items: MarketKeyItem[] }>("/ops/settings/market-keys", {
        method: "PUT",
        body: JSON.stringify({ keys: keyDrafts }),
      });
      if (res?.items) setMarketKeys(res.items);
      setKeyDrafts({});
      notify.success("API-ключи зашифрованы и сохранены");
    } catch (err) {
      notify.error("Ошибка сохранения ключей", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKeys(false);
    }
  }

  async function handleSaveTelegram() {
    setSavingTg(true);
    try {
      const res = await apiRequest<TelegramSettingsDto>("/ops/settings/telegram", {
        method: "PUT",
        body: JSON.stringify({
          internal_url: tgCfg.internal_url,
          webhook_secret: tgSecretInput.trim() || null,
          notify_mt5_trades: tgCfg.notify_mt5_trades,
          notify_high_impact_news: tgCfg.notify_high_impact_news,
          notify_bridge_disconnect: tgCfg.notify_bridge_disconnect,
          notify_price_alerts: tgCfg.notify_price_alerts,
        }),
      });
      setTgCfg(res);
      setTgSecretInput("");
      notify.success("Настройки Telegram сохранены");
    } catch (err) {
      notify.error("Ошибка настроек Telegram", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTg(false);
    }
  }

  async function handleTestTelegram() {
    setTestingTg(true);
    try {
      const res = await apiRequest<{ ok: boolean; delivered?: string[]; errors?: string[] }>("/ops/alerts/test", {
        method: "POST",
        body: JSON.stringify({
          title: "Huseynovlar Terminal — Тест Docker-сети",
          message: "Проверка канала уведомлений через внутреннюю сеть huseynovlar_webhooks",
          severity: "info",
        }),
      });
      if (res.ok) notify.success("Тестовое сообщение отправлено в Telegram");
      else notify.error("Ошибка отправки", (res.errors || []).join("; ") || "Нет ответа от бота");
    } catch (err) {
      notify.error("Ошибка Telegram", err instanceof Error ? err.message : String(err));
    } finally {
      setTestingTg(false);
    }
  }

  return (
    <TerminalPageShell
      title="Настройки"
      subtitle="Единый хаб управления профилем, звуковой системой SoundEngine, AI-адаптером, API-ключами и Telegram Docker-сетью"
      badge="5 разделов"
    >
      <div className="space-y-3">
        {/* Horizontal div-tile Hub Selector */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {HUB_TILES.map((tile) => {
            const Icon = tile.icon;
            const active = activeTile === tile.id;
            return (
              <div
                key={tile.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveTile(tile.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveTile(tile.id);
                  }
                }}
                className={`flex cursor-pointer items-start gap-2.5 rounded-[4px] border px-3 py-2.5 transition-colors ${
                  active
                    ? "border-[var(--accent-blue)] bg-[var(--bg-elevated)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60"
                }`}
              >
                <div
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[4px] border"
                  style={{
                    borderColor: active ? "var(--accent-blue)" : "var(--border-subtle)",
                    color: active ? "var(--accent-blue)" : "var(--text-secondary)",
                  }}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{tile.title}</div>
                  <div className="line-clamp-2 text-[10px] leading-snug text-[var(--text-muted)]">{tile.meta}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* TILE 1: Profile & Security */}
        {activeTile === "profile" ? (
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
            <div className="mb-3 border-b border-[var(--border-subtle)] pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Профиль и безопасность
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { title: "Мой профиль и пароль", desc: "Смена пароля, аватар и личные данные", to: "/dashboard/profile" },
                { title: "Двухфакторная защита (2FA / Passkey)", desc: "QR-код TOTP, резервные коды и FIDO2 ключи", to: "/dashboard/security" },
                { title: "Активные сессии", desc: "Просмотр устройств и кнопка «Завершить все»", to: "/dashboard/sessions" },
                { title: "История входов", desc: "Гео-лог авторизаций и IP-адреса", to: "/dashboard/login-history" },
                { title: "Журнал аудита", desc: "Все действия пользователей и изменения ключей", to: "/dashboard/audit" },
                { title: "Пользователи и роли (RBAC)", desc: "Управление правами доступа", to: "/dashboard/users" },
              ].map((card) => (
                <div
                  key={card.title}
                  role="button"
                  tabIndex={0}
                  onClick={() => void navigate({ to: card.to })}
                  onKeyDown={(e) => e.key === "Enter" && void navigate({ to: card.to })}
                  className="cursor-pointer rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 hover:border-[var(--accent-blue)]"
                >
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">{card.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{card.desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <SettingsSecurityPanels />
            </div>
          </div>
        ) : null}

        {/* TILE 2: Interface & SoundEngine */}
        {activeTile === "ui_sound" ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="space-y-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 lg:col-span-5">
              <div className="border-b border-[var(--border-subtle)] pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Интерфейс терминала
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Тема оформления</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => applyTheme(false)}
                    className={`h-9 rounded-[4px] border text-xs font-semibold ${
                      !isLight
                        ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
                    }`}
                  >
                    Dark Pro (#0B0E14)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTheme(true)}
                    className={`h-9 rounded-[4px] border text-xs font-semibold ${
                      isLight
                        ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
                    }`}
                  >
                    Light Pro (#F8FAFC)
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Часовой пояс</label>
                <select
                  value={timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    localStorage.setItem("ht_tz", e.target.value);
                    notify.success("Часовой пояс обновлён", e.target.value);
                  }}
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="UTC">UTC (Рекомендуется)</option>
                  <option value="Asia/Baku">Asia/Baku (UTC+4)</option>
                  <option value="local">Локальное время браузера</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 lg:col-span-7">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                  Звуковая система (SoundEngine · Web Audio API)
                </span>
                <button
                  type="button"
                  onClick={() => soundEngine.toggleMute()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-[11px] font-semibold text-[var(--text-primary)]"
                >
                  {soundCfg.muted ? <VolumeX className="size-3.5 text-[var(--bear)]" /> : <Volume2 className="size-3.5 text-[var(--bull)]" />}
                  {soundCfg.muted ? "Muted" : "Active"}
                </button>
              </div>

              {/* Master Volume Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] tabular-nums">
                  <span className="text-[var(--text-secondary)]">Общая громкость</span>
                  <span className="font-semibold text-[var(--text-primary)]">{soundCfg.volume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={soundCfg.volume}
                  onChange={(e) => soundEngine.setVolume(Number(e.target.value))}
                  className="w-full accent-[var(--accent-blue)]"
                />
              </div>

              {/* Category Toggles + Test Buttons */}
              <div className="space-y-2">
                {SOUND_CATEGORIES.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between gap-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={soundCfg.categories[cat.id]}
                        onChange={(e) => soundEngine.setCategoryEnabled(cat.id, e.target.checked)}
                        className="mt-0.5 accent-[var(--accent-blue)]"
                      />
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-[var(--text-primary)]">{cat.label}</div>
                        <div className="truncate text-[10px] text-[var(--text-muted)]">{cat.desc}</div>
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => soundEngine.testCategory(cat.id)}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 text-[10px] font-semibold text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
                    >
                      <Play className="size-3" />
                      Тест звука
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* TILE 3: AI Providers (LLM Adapter) */}
        {activeTile === "ai" ? (
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                AI-провайдеры (Provider-Agnostic LLM Adapter)
              </span>
              {aiCfg.api_key_configured ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--bull)]">
                  <CheckCircle2 className="size-3.5" />
                  Ключ задан ({aiCfg.api_key_masked})
                </span>
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">Ключ не задан</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Провайдер</label>
                <select
                  value={aiCfg.provider}
                  onChange={(e) =>
                    setAiCfg((prev) => ({
                      ...prev,
                      provider: e.target.value as AiSettingsDto["provider"],
                    }))
                  }
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="custom_openai">Custom OpenAI-Compatible (Ollama / vLLM / DeepSeek)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Model Name</label>
                <input
                  type="text"
                  value={aiCfg.model_name}
                  onChange={(e) => setAiCfg((prev) => ({ ...prev, model_name: e.target.value }))}
                  placeholder="gemini-2.5-flash / gpt-4o / claude-3-5-sonnet"
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Base URL (опционально)</label>
                <input
                  type="text"
                  value={aiCfg.base_url}
                  onChange={(e) => setAiCfg((prev) => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  API Key (хранится зашифрованным на сервере)
                </label>
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder={aiCfg.api_key_masked || "sk-... / AIza..."}
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">Timeout (сек)</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={aiCfg.timeout_sec}
                  onChange={(e) => setAiCfg((prev) => ({ ...prev, timeout_sec: Number(e.target.value) || 60 }))}
                  className="h-9 w-36 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs tabular-nums text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
              <AsyncButton
                size="sm"
                loading={savingAi}
                loadingText="Сохранение..."
                onClick={() => void handleSaveAi()}
                className="h-8 rounded-[4px] bg-[var(--accent-blue)] text-xs text-white"
              >
                <Save className="mr-1.5 size-3.5" />
                Сохранить
              </AsyncButton>
              <AsyncButton
                size="sm"
                variant="outline"
                loading={testingAi}
                loadingText="Проверка..."
                onClick={() => void handleTestAi()}
                className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
              >
                Проверить соединение
              </AsyncButton>
              {aiTestResult ? (
                <span
                  className="text-xs font-semibold tabular-nums"
                  style={{ color: aiTestResult.ok ? "var(--bull)" : "var(--bear)" }}
                >
                  {aiTestResult.ok ? `● OK (${aiTestResult.latency_ms} ms)` : `✕ ${aiTestResult.detail}`}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* TILE 4: Market Data API Keys */}
        {activeTile === "market_keys" ? (
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
            <div className="mb-3 border-b border-[var(--border-subtle)] pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Источники рыночных данных (Серверное шифрованное хранилище)
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {marketKeys.map((item) => (
                <div
                  key={item.id}
                  className="space-y-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]">
                      <KeyRound className="size-3.5 text-[var(--text-muted)]" />
                      {item.label}
                    </span>
                    <span
                      className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor: item.configured
                          ? "color-mix(in srgb, var(--bull) 15%, transparent)"
                          : "var(--bg-elevated)",
                        color: item.configured ? "var(--bull)" : "var(--text-muted)",
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={keyDrafts[item.id] ?? ""}
                    onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder={item.masked || `Введите API Key для ${item.label}`}
                    className="h-8 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
              <AsyncButton
                size="sm"
                loading={savingKeys}
                loadingText="Сохранение..."
                onClick={() => void handleSaveMarketKeys()}
                className="h-8 rounded-[4px] bg-[var(--accent-blue)] text-xs text-white"
              >
                <Save className="mr-1.5 size-3.5" />
                Сохранить ключи
              </AsyncButton>
            </div>
          </div>
        ) : null}

        {/* TILE 5: Notifications & Telegram Bot (Docker Network) */}
        {activeTile === "telegram" ? (
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Уведомления и Telegram Bot (Docker-сеть {tgCfg.docker_network})
              </span>
              <span className="rounded-[3px] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-amber)]">
                127.0.0.1 / localhost заблокирован
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  TELEGRAM_BOT_INTERNAL_URL (имя сервиса в Docker-сети)
                </label>
                <input
                  type="text"
                  value={tgCfg.internal_url}
                  onChange={(e) => setTgCfg((prev) => ({ ...prev, internal_url: e.target.value }))}
                  placeholder="http://telegram-bot:8080/api/notify"
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  X-Trading-Webhook-Secret ({tgCfg.secret_configured ? tgCfg.secret_masked : "не задан"})
                </label>
                <input
                  type="password"
                  value={tgSecretInput}
                  onChange={(e) => setTgSecretInput(e.target.value)}
                  placeholder={tgCfg.secret_masked || "Секрет вебхука"}
                  className="h-9 w-full rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { key: "notify_mt5_trades", label: "Сделки и закрытия MT5" },
                { key: "notify_high_impact_news", label: "High-Impact новости (CPI / FOMC)" },
                { key: "notify_bridge_disconnect", label: "Потеря связи моста ExnessPanelBridge" },
                { key: "notify_price_alerts", label: "Срабатывание ценовых уровней" },
              ].map((f) => (
                <label
                  key={f.key}
                  className="flex cursor-pointer items-center gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(tgCfg[f.key as keyof TelegramSettingsDto])}
                    onChange={(e) => setTgCfg((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                    className="accent-[var(--accent-blue)]"
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
              <AsyncButton
                size="sm"
                loading={savingTg}
                loadingText="Сохранение..."
                onClick={() => void handleSaveTelegram()}
                className="h-8 rounded-[4px] bg-[var(--accent-blue)] text-xs text-white"
              >
                <Save className="mr-1.5 size-3.5" />
                Сохранить
              </AsyncButton>
              <AsyncButton
                size="sm"
                variant="outline"
                loading={testingTg}
                loadingText="Отправка..."
                onClick={() => void handleTestTelegram()}
                className="h-8 rounded-[4px] border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
              >
                <Send className="mr-1.5 size-3.5" />
                Отправить тест в Telegram
              </AsyncButton>
            </div>
          </div>
        ) : null}
      </div>
    </TerminalPageShell>
  );
}
