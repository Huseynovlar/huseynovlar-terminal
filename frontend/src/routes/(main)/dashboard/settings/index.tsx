import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  FileSearch,
  History,
  KeyRound,
  Keyboard,
  MonitorSmartphone,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/settings/")({
  component: SettingsHubPage,
});

const SETTINGS_TILES = [
  { title: "Мой профиль", meta: "Учётная запись и аватар", url: "/dashboard/profile", icon: UserRound },
  { title: "Безопасность и 2FA", meta: "Passkey FIDO2, TOTP и резервные коды", url: "/dashboard/security", icon: ShieldCheck },
  { title: "Активные сессии", meta: "Устройства, IP и отзыв токенов", url: "/dashboard/sessions", icon: MonitorSmartphone },
  { title: "История входов", meta: "Гео-лог авторизаций по ID сессии", url: "/dashboard/login-history", icon: History },
  { title: "Журнал аудита", meta: "Действия пользователей и API", url: "/dashboard/audit", icon: FileSearch },
  { title: "Пользователи (RBAC)", meta: "Роли и права доступа", url: "/dashboard/users", icon: Users },
  { title: "API-ключи и Exness Gateway", meta: "Exness account_id, Ed25519 и интеграции", url: "/dashboard/accounts", icon: KeyRound },
  { title: "Уведомления Telegram", meta: "Триггеры внутреннего Docker-бота", url: "/dashboard/preferences", icon: Bell },
  { title: "Настройки терминала", meta: "Язык, часовой пояс и тема", url: "/dashboard/preferences", icon: Settings },
  { title: "Горячие клавиши", meta: "Cmd+K, таймфреймы и инструменты графика", url: "/dashboard/hotkeys", icon: Keyboard },
] as const;

function SettingsHubPage() {
  const navigate = useNavigate();
  return (
    <TerminalPageShell title="Настройки" badge={`${SETTINGS_TILES.length} разделов`}>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <div
              key={tile.title}
              role="button"
              tabIndex={0}
              onClick={() => void navigate({ to: tile.url })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void navigate({ to: tile.url });
                }
              }}
              className="flex cursor-pointer items-center gap-3 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 transition-colors duration-75 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{tile.title}</div>
                <div className="truncate text-[11px] text-[var(--text-muted)]">{tile.meta}</div>
              </div>
            </div>
          );
        })}
      </div>
    </TerminalPageShell>
  );
}
