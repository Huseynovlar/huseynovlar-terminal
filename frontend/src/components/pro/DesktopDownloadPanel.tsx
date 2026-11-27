import { useEffect, useMemo, useState } from "react";

import { CheckCircle2, Download, ExternalLink, Laptop, Monitor, ShieldCheck } from "lucide-react";

import { apiRequest } from "@/framework/api-client";
import { isTauriDesktop } from "@/services/tauriBridge";

interface ReleaseManifest {
  version: string;
  notes?: string;
  pub_date?: string;
}

const RELEASES_URL = "https://github.com/Huseynovlar/huseynovlar-terminal/releases";

function detectUserOs(): "macos" | "windows" | "linux" {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

export function DesktopDownloadPanel() {
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const userOs = useMemo(() => detectUserOs(), []);
  const inDesktop = isTauriDesktop();

  useEffect(() => {
    apiRequest<ReleaseManifest>("/pro/releases/latest.json")
      .then((res) => setManifest(res))
      .catch(() => {
        setManifest({ version: "2.0.0", notes: "Huseynovlar Terminal Desktop (Tauri v2)" });
      });
  }, []);

  const version = manifest?.version || "2.0.0";

  const platforms = [
    {
      id: "macos" as const,
      title: "macOS (Apple Silicon & Intel)",
      files: "Huseynovlar Terminal .dmg (aarch64 / x64)",
      badge: "macOS 12+",
      recommended: userOs === "macos",
    },
    {
      id: "windows" as const,
      title: "Windows 10 / 11 (64-bit)",
      files: "NSIS Установщик (.exe) и MSI (.msi)",
      badge: "x64",
      recommended: userOs === "windows",
    },
    {
      id: "linux" as const,
      title: "Linux (Ubuntu / Debian)",
      files: "Универсальный .AppImage и пакет .deb",
      badge: "x86_64",
      recommended: userOs === "linux",
    },
  ];

  return (
    <div className="space-y-4 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex items-center gap-2">
          <Monitor className="size-4 text-[var(--accent-blue)]" />
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Десктоп-клиент Huseynovlar Terminal (Tauri v2)
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Нативное приложение с VPN Pre-Flight проверкой, OS Keychain, Keep-Awake и автообновлением (Ed25519)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-[3px] border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/15 px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--accent-blue)]">
            v{version}
          </span>
          {inDesktop && (
            <span className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--bull)]/40 bg-[var(--bull)]/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--bull)]">
              <CheckCircle2 className="size-3" /> Установлено
            </span>
          )}
        </div>
      </div>

      {manifest?.notes && (
        <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">
          <span className="mr-1.5 font-mono text-[10px] font-semibold uppercase text-[var(--accent-amber)]">
            Changelog:
          </span>
          {manifest.notes}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {platforms.map((p) => (
          <div
            key={p.id}
            className={`flex flex-col justify-between rounded-[4px] border p-3.5 ${
              p.recommended
                ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/8"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]">
                  <Laptop className="size-3.5 text-[var(--accent-blue)]" />
                  {p.title}
                </div>
                <span className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--text-muted)]">
                  {p.badge}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{p.files}</p>
            </div>

            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-[4px] px-3 text-[11.5px] font-semibold transition-colors ${
                p.recommended
                  ? "bg-[var(--accent-blue)] text-white hover:opacity-90"
                  : "border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
              }`}
            >
              <Download className="size-3.5" />
              <span>{p.recommended ? "Скачать для вашей ОС" : "Скачать релиз"}</span>
              <ExternalLink className="size-3 opacity-75" />
            </a>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-[var(--bull)]" />
          <span>
            Обновления подписаны Ed25519. Перед запуском убедитесь, что подключён корпоративный VPN.
          </span>
        </div>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-[var(--accent-blue)] hover:underline"
        >
          Все релизы на GitHub
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
