import { useEffect, useState } from "react";

import { useLocation, useNavigate } from "@tanstack/react-router";
import { ExternalLink, LayoutGrid, Plus, Trash2 } from "lucide-react";

import { notify } from "@/components/ui/toast";

export interface TerminalWorkspace {
  id: string;
  name: string;
  path: string;
  dockOpen: boolean;
}

const STORAGE_KEY = "ht_pro_workspaces_v1";

const DEFAULT_WORKSPACES: TerminalWorkspace[] = [
  { id: "ws-1", name: "Trading", path: "/dashboard/home", dockOpen: true },
  { id: "ws-2", name: "Stat-Arb", path: "/dashboard/stat-arb", dockOpen: false },
  { id: "ws-3", name: "Macro & BMAP", path: "/dashboard/global-map", dockOpen: false },
];

export function loadWorkspaces(): TerminalWorkspace[] {
  if (typeof window === "undefined") return DEFAULT_WORKSPACES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 5);
  } catch {
    // ignore
  }
  return DEFAULT_WORKSPACES;
}

function saveWorkspaces(list: TerminalWorkspace[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    // ignore
  }
}

interface WorkspacesBarProps {
  dockOpen: boolean;
  onSetDockOpen: (open: boolean) => void;
}

export function WorkspacesBar({ dockOpen, onSetDockOpen }: WorkspacesBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>(() => loadWorkspaces());

  const activateWorkspace = (ws: TerminalWorkspace) => {
    onSetDockOpen(ws.dockOpen);
    void navigate({ to: ws.path as never });
  };

  // Global Alt+1..5 workspace switching
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const num = Number.parseInt(e.key, 10);
      if (num >= 1 && num <= 5) {
        const ws = workspaces[num - 1];
        if (ws) {
          e.preventDefault();
          activateWorkspace(ws);
          notify.info(`Workspace [${num}]`, ws.name);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspaces]);

  const handleSaveCurrent = () => {
    if (workspaces.length >= 5) {
      notify.info("Лимит Workspaces", "Максимум 5 сохранённых раскладок (Alt+1..5)");
      return;
    }
    const seg = location.pathname.split("/").filter(Boolean).pop() || "Screen";
    const name = seg.charAt(0).toUpperCase() + seg.slice(1);
    const next: TerminalWorkspace[] = [
      ...workspaces,
      { id: `ws-${Date.now()}`, name, path: location.pathname, dockOpen },
    ];
    setWorkspaces(next);
    saveWorkspaces(next);
    notify.success("Workspace сохранён", `[${next.length}] ${name}`);
  };

  const handleDelete = (id: string) => {
    if (workspaces.length <= 1) return;
    const next = workspaces.filter((w) => w.id !== id);
    setWorkspaces(next);
    saveWorkspaces(next);
  };

  const handlePopOut = () => {
    const url = window.location.href;
    window.open(url, "_blank", "noopener,noreferrer,width=1360,height=840");
  };

  return (
    <div className="hidden items-center gap-1 xl:flex">
      {workspaces.map((ws, idx) => {
        const active = location.pathname === ws.path;
        return (
          <div
            key={ws.id}
            className={`group flex h-7 items-center gap-1 rounded-[4px] border px-2 text-[11px] font-medium transition-colors ${
              active
                ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/12 text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <button
              type="button"
              onClick={() => activateWorkspace(ws)}
              className="flex items-center gap-1"
              title={`Workspace ${ws.name} (Alt+${idx + 1})`}
            >
              <span className="font-mono text-[10px] text-[var(--accent-amber)]">[{idx + 1}]</span>
              <span className="max-w-[92px] truncate">{ws.name}</span>
            </button>
            {idx >= 3 && (
              <button
                type="button"
                onClick={() => handleDelete(ws.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--bear)]"
                title="Удалить Workspace"
              >
                <Trash2 className="size-2.5" />
              </button>
            )}
          </div>
        );
      })}
      {workspaces.length < 5 && (
        <button
          type="button"
          onClick={handleSaveCurrent}
          title="Сохранить текущий экран как Workspace"
          className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          <Plus className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => void navigate({ to: "/dashboard/multichart" as never })}
        title="Сплит-экран графиков (2×1 / 2×2)"
        className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        <LayoutGrid className="size-3" />
      </button>
      <button
        type="button"
        onClick={handlePopOut}
        title="↗ Вынести окно (на второй монитор / Tauri)"
        className="flex h-7 items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 text-[10px] font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        <ExternalLink className="size-3" />
      </button>
    </div>
  );
}
