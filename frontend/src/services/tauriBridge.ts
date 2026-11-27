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

const DEFAULT_HEALTH_URL = "https://terminal.huseynovlar.org/healthz";

function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke : null;
}

export function isTauriDesktop(): boolean {
  return getTauriInvoke() !== null;
}

async function checkHealthOverHttp(endpoint: string, invokeError?: unknown): Promise<VpnStatusResult> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 5000);

  try {
    const resp = await fetch(endpoint, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (resp.ok) {
      return {
        connected: true,
        latency_ms: Math.round(performance.now() - started),
        endpoint,
        message: "Сервер доступен — /healthz вернул успешный ответ",
      };
    }
    return {
      connected: false,
      endpoint,
      message: `Сервер ответил HTTP ${resp.status} на ${endpoint}`,
    };
  } catch (error) {
    const reason = error instanceof Error
      ? (error.name === "AbortError" ? "превышено время ожидания 5 секунд" : error.message)
      : String(error);
    const nativeReason = invokeError
      ? ` Не удалось выполнить нативную проверку: ${invokeError instanceof Error ? invokeError.message : String(invokeError)}.`
      : "";
    return {
      connected: false,
      endpoint,
      message: `Не удалось обратиться к ${endpoint}: ${reason}.${nativeReason}`,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkVpnStatus(endpoint?: string): Promise<VpnStatusResult> {
  const target = endpoint ?? DEFAULT_HEALTH_URL;
  const invoke = getTauriInvoke();

  if (invoke) {
    try {
      const nativeResult = await invoke<VpnStatusResult>("check_vpn_status", { endpoint: target });
      if (nativeResult.connected) return nativeResult;

      // Retry through the WebView as well: the native HTTP client and WebView
      // can have different DNS, proxy, and TLS paths on the user's Mac.
      const webResult = await checkHealthOverHttp(target);
      if (webResult.connected) return webResult;
      return {
        ...webResult,
        message: `Нативная проверка: ${nativeResult.message}. Проверка WebView: ${webResult.message}`,
      };
    } catch (err) {
      // Keep the app usable if the native command is unavailable in an older
      // desktop build; perform the same /healthz check from the WebView instead.
      return checkHealthOverHttp(target, err);
    }
  }

  return checkHealthOverHttp(endpoint ?? "/healthz");
}

export async function setNativeKeepAwake(enabled: boolean): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;

  try {
    return await invoke<boolean>("set_keep_awake", { enabled });
  } catch {
    // Never report success when the native power assertion was not acquired.
    try {
      return await invoke<boolean>("get_keep_awake");
    } catch {
      return false;
    }
  }
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

/**
 * Open an external HTTP(S) URL in a separate native Tauri webview window.
 * In a regular browser, fall back to the browser's normal new-tab behavior.
 */
export async function openExternalWindow(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const invoke = getTauriInvoke();
  if (!invoke) {
    if (typeof window !== "undefined") window.open(parsed.href, "_blank", "noopener,noreferrer");
    return true;
  }

  try {
    await invoke<void>("open_external_window", { url: parsed.href });
    return true;
  } catch (error) {
    console.error("Failed to open external window:", error);
    return false;
  }
}
