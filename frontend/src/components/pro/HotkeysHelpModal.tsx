import { Keyboard, Terminal, X } from "lucide-react";

import { COMMAND_HINTS } from "@/services/commandParser";

interface HotkeysHelpModalProps {
  open: boolean;
  onClose: () => void;
}

const GLOBAL_HOTKEYS = [
  { combo: "/  или  Cmd/Ctrl + K", desc: "Фокус в Bloomberg Command Bar" },
  { combo: "Esc", desc: "Закрыть автодополнение, док или модальное окно" },
  { combo: "Alt + 1..5", desc: "Переключение между сохранёнными Workspaces" },
  { combo: "Cmd/Ctrl + M", desc: "Mute / Unmute звуковой системы SoundEngine" },
  { combo: "Cmd/Ctrl + Shift + L", desc: "Переключение темы Dark ↔ Light" },
  { combo: "Cmd/Ctrl + Shift + A", desc: "Вкл/Выкл режим «Не гасить экран» (Keep-Awake)" },
  { combo: "Shift + M", desc: "Режим приватности (скрыть суммы)" },
  { combo: "?", desc: "Открыть/закрыть эту шпаргалку" },
];

export function HotkeysHelpModal({ open, onClose }: HotkeysHelpModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 text-[var(--accent-blue)]" />
            <span className="text-[12px] font-semibold uppercase tracking-wide">
              Шпаргалка Bloomberg Command Bar и Горячие клавиши
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid max-h-[calc(85vh-48px)] grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <Keyboard className="size-3.5" />
              Глобальные горячие клавиши
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {GLOBAL_HOTKEYS.map((hk) => (
                <div key={hk.combo} className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
                  <span className="text-[var(--text-secondary)]">{hk.desc}</span>
                  <kbd className="shrink-0 rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--text-primary)]">
                    {hk.combo}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <Terminal className="size-3.5" />
              Команды Bloomberg Command Bar
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {COMMAND_HINTS.slice(0, 14).map((cmd) => (
                <div key={cmd.code} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                  <span className="truncate text-[var(--text-secondary)]">{cmd.description}</span>
                  <code className="shrink-0 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent-amber)]">
                    {cmd.syntax}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
