export interface VpnStatusResult {
  connected: boolean;
  latency_ms?: number | null;
  endpoint?: string;
  message: string;
}

export interface DesktopUpdateInfo {
  version: string;
  notes: string;
  pubDate?: string;
}

type TauriInvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriInternals {
  invoke?: TauriInvokeFn;
}

function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke : null;
}

export function isTauriDesktop(): boolean {
  return getTauriInvoke() !== null;
}

export async function checkVpnStatus(endpoint?: string): Promise<VpnStatusResult> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      return await invoke<VpnStatusResult>("check_vpn_status", { endpoint: endpoint ?? null });
    } catch (err) {
      return {
        connected: false,
        message: err instanceof Error ? err.message : "Ошибка проверки доступности сервера",
      };
    }
  }

  // Browser fallback: use the same /healthz-only access criterion.
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(endpoint ?? "/healthz", {
      method: "GET",
      signal: ctrl.signal,
      credentials: "same-origin",
    });
    if (resp.ok) {
      return {
        connected: true,
        latency_ms: Math.round(performance.now() - started),
        endpoint: endpoint ?? "/healthz",
        message: "Сервер доступен — /healthz вернул успешный ответ",
      };
    }
    return {
      connected: false,
      endpoint: endpoint ?? "/healthz",
      message: `Сервер ответил HTTP ${resp.status} на /healthz`,
    };
  } catch {
    return {
      connected: false,
      endpoint: endpoint ?? "/healthz",
      message: "Сервер недоступен: проверьте сеть и доступ к /healthz",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function setNativeKeepAwake(enabled: boolean): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      return await invoke<boolean>("set_keep_awake", { enabled });
    } catch {
      return enabled;
    }
  }
  return enabled;
}

export async function syncNativeWindowTheme(mode: "dark" | "light"): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke("plugin:window|set_theme", { label: "main", value: mode });
  } catch {
    // ignore if window plugin command differs
  }
}

export async function toggleNativeFullscreen(): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const current = await invoke<boolean>("plugin:window|is_fullscreen", { label: "main" });
      await invoke("plugin:window|set_fullscreen", { label: "main", value: !current });
      return !current;
    } catch {
      // fall through to browser Fullscreen API
    }
  }
  if (typeof document === "undefined") return false;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      return true;
    }
    await document.exitFullscreen();
    return false;
  } catch {
    return Boolean(document.fullscreenElement);
  }
}

export async function secureStoreSet(key: string, value: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    await invoke("secure_store_set", { key, value });
  }
}

export async function secureStoreGet(key: string): Promise<string | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return await invoke<string | null>("secure_store_get", { key });
  }
  return null;
}

export async function secureStoreDelete(key: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (invoke) {
    await invoke("secure_store_delete", { key });
  }
}
