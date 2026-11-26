const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

const AUTH_NO_REFRESH_PATHS = [
  "/auth/login",
  "/auth/bootstrap",
  "/auth/refresh",
  "/auth/status",
  "/auth/webauthn/login/options",
  "/auth/webauthn/login/verify",
];

let accessToken: string | null =
  typeof window !== "undefined" ? window.sessionStorage.getItem("ht_access_token") : null;

let refreshInFlight: Promise<string | null> | null = null;
let redirectingToLogin = false;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      window.sessionStorage.setItem("ht_access_token", token);
      redirectingToLogin = false;
    } else {
      window.sessionStorage.removeItem("ht_access_token");
    }
  }
}

export function clearAccessToken() {
  setAccessToken(null);
}

export function getAccessToken(): string | null {
  if (!accessToken && typeof window !== "undefined") {
    accessToken = window.sessionStorage.getItem("ht_access_token");
  }
  return accessToken;
}

export function isAuthNoRefreshPath(path: string): boolean {
  const cleanPath = path.split("?")[0] ?? path;
  return AUTH_NO_REFRESH_PATHS.some((p) => cleanPath === p || cleanPath.endsWith(p));
}

function redirectToLoginIfProtected() {
  if (typeof window === "undefined") return;
  const pathname = window.location.pathname || "";
  if (pathname.startsWith("/dashboard") && !redirectingToLogin) {
    redirectingToLogin = true;
    window.location.replace("/auth/v2/login");
  }
}

async function performSingleFlightRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        clearAccessToken();
        return null;
      }
      const data = (await res.json()) as { access_token?: string };
      if (data?.access_token) {
        setAccessToken(data.access_token);
        return data.access_token;
      }
      clearAccessToken();
      return null;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export interface WsRpcEnvelope {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  data: unknown;
}

interface PendingRpc {
  resolve: (res: WsRpcEnvelope) => void;
  reject: (err: Error) => void;
  timer: number;
}

let activeRpcSocket: WebSocket | null = null;
let wsRpcConnecting = false;
let wsOpenWaiters: Array<(ws: WebSocket | null) => void> = [];
const pendingRpcMap = new Map<string, PendingRpc>();
let rpcSeq = 0;

export function markWsRpcConnecting() {
  wsRpcConnecting = true;
}

/**
 * Registers the live WebSocket instance from `LiveSocketProvider` so all JSON API calls
 * (`apiRequest` and `apiRequestPaged`) travel over WebSocket with zero HTTP `fetch()` calls.
 */
export function registerWsRpcSocket(ws: WebSocket | null) {
  activeRpcSocket = ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsRpcConnecting = false;
    const waiters = wsOpenWaiters;
    wsOpenWaiters = [];
    for (const resolve of waiters) {
      resolve(ws);
    }
  } else if (!ws) {
    for (const [id, pending] of pendingRpcMap.entries()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("WebSocket disconnected"));
      pendingRpcMap.delete(id);
    }
  }
}

export function handleWsRpcResponse(frame: Record<string, unknown>): boolean {
  if (frame.type !== "rpc_response") return false;
  const id = String(frame.id ?? "");
  const pending = pendingRpcMap.get(id);
  if (!pending) return true;
  pendingRpcMap.delete(id);
  window.clearTimeout(pending.timer);
  pending.resolve({
    status: Number(frame.status ?? 200),
    ok: Boolean(frame.ok),
    headers: (frame.headers as Record<string, string>) ?? {},
    data: frame.data,
  });
  return true;
}

function isRpcEligibleRequest(path: string, init: RequestInit): boolean {
  if (typeof window === "undefined") return false;
  if (init.body instanceof FormData || init.body instanceof Blob || init.body instanceof ArrayBuffer) return false;
  // Cookie-setting auth endpoints must use HTTP so browser stores HttpOnly Set-Cookie
  const clean = path.split("?")[0] ?? path;
  if (clean.startsWith("/auth/")) return false;
  return true;
}

async function ensureWsRpcReady(path: string, init: RequestInit, timeoutMs = 4500): Promise<boolean> {
  if (!isRpcEligibleRequest(path, init)) return false;
  if (activeRpcSocket && activeRpcSocket.readyState === WebSocket.OPEN) return true;

  const onDashboard = (window.location.pathname || "").startsWith("/dashboard");
  const shouldWait =
    wsRpcConnecting ||
    (activeRpcSocket !== null && activeRpcSocket.readyState === WebSocket.CONNECTING) ||
    (onDashboard && Boolean(getAccessToken()));

  if (!shouldWait) return false;

  const ws = await new Promise<WebSocket | null>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        wsOpenWaiters = wsOpenWaiters.filter((fn) => fn !== done);
        resolve(activeRpcSocket && activeRpcSocket.readyState === WebSocket.OPEN ? activeRpcSocket : null);
      }
    }, timeoutMs);
    const done = (sock: WebSocket | null) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(sock);
      }
    };
    wsOpenWaiters.push(done);
  });

  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function sendWsRpc(path: string, init: RequestInit = {}): Promise<WsRpcEnvelope> {
  return new Promise<WsRpcEnvelope>((resolve, reject) => {
    if (!activeRpcSocket || activeRpcSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket not open"));
      return;
    }
    rpcSeq += 1;
    const id = `rpc_${Date.now()}_${rpcSeq}`;
    const headersObj: Record<string, string> = {};
    const h = buildHeaders(init, getAccessToken());
    h.forEach((v, k) => {
      headersObj[k] = v;
    });

    const timer = window.setTimeout(() => {
      if (pendingRpcMap.has(id)) {
        pendingRpcMap.delete(id);
        reject(new Error("WebSocket RPC timeout"));
      }
    }, 20000);

    pendingRpcMap.set(id, { resolve, reject, timer });
    try {
      activeRpcSocket.send(
        JSON.stringify({
          type: "rpc",
          id,
          method: (init.method || "GET").toUpperCase(),
          path,
          headers: headersObj,
          body: typeof init.body === "string" ? init.body : null,
        }),
      );
    } catch (err) {
      pendingRpcMap.delete(id);
      window.clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function apiRequestRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  let res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: buildHeaders(init, token),
    credentials: "include",
  });

  if (res.status === 401 && !isAuthNoRefreshPath(path)) {
    const nextToken = await performSingleFlightRefresh();
    if (nextToken) {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: buildHeaders(init, nextToken),
        credentials: "include",
      });
    }
    if (res.status === 401 || !nextToken) {
      clearAccessToken();
      redirectToLoginIfProtected();
    }
  }

  return res;
}

function extractRpcError(status: number, data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
    if (d !== undefined) return JSON.stringify(d);
  }
  return `HTTP ${status}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (await ensureWsRpcReady(path, init)) {
    try {
      let rpcRes = await sendWsRpc(path, init);
      if (rpcRes.status === 401 && !isAuthNoRefreshPath(path)) {
        const nextToken = await performSingleFlightRefresh();
        if (nextToken && (await ensureWsRpcReady(path, init, 2500))) {
          rpcRes = await sendWsRpc(path, init);
        } else if (!nextToken) {
          clearAccessToken();
          redirectToLoginIfProtected();
        }
      }
      if (!rpcRes.ok) {
        throw new Error(extractRpcError(rpcRes.status, rpcRes.data));
      }
      if (rpcRes.status === 204) return undefined as T;
      return rpcRes.data as T;
    } catch (err) {
      // Only fall back to HTTP if the WebSocket transport itself dropped mid-flight
      if (
        !(err instanceof Error) ||
        (!err.message.includes("WebSocket") && !err.message.includes("RPC timeout"))
      ) {
        throw err;
      }
    }
  }

  const res = await apiRequestRaw(path, init);

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) {
        detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function extractFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const basicMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  if (basicMatch?.[1]) return basicMatch[1].trim();
  return fallback;
}

export async function apiDownload(path: string, fallbackFilename: string): Promise<string> {
  const res = await apiRequestRaw(path, { method: "GET" });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = String(data.detail);
    } catch {
      // ignore non-JSON
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const filename = extractFilename(res.headers.get("Content-Disposition"), fallbackFilename);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return filename;
}

export async function getDirectDownloadUrl(path: string): Promise<string> {
  const res = await apiRequest<{ dl_token: string; expires_in?: number }>("/auth/download-token", {
    method: "POST",
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fullPath = path.startsWith("/api/") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const sep = fullPath.includes("?") ? "&" : "?";
  return `${origin}${fullPath}${sep}dl_token=${encodeURIComponent(res.dl_token)}`;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  username: string;
  role: string;
  totp_enabled: boolean;
}

export const authApi = {
  status: () => apiRequest<{ initialized: boolean }>("/auth/status"),
  bootstrap: (payload: { username: string; email: string; password: string; display_name: string }) =>
    apiRequest<AuthTokenResponse>("/auth/bootstrap", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: { username: string; password: string; totp_code?: string }) =>
    apiRequest<AuthTokenResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  refresh: () => performSingleFlightRefresh(),
  logout: async () => {
    try {
      return await apiRequest<{ status: string }>("/auth/logout", { method: "POST" });
    } finally {
      clearAccessToken();
    }
  },
  webauthnLoginOptions: (username?: string) =>
    apiRequest<{ challenge_key: string; options: Record<string, unknown> }>("/auth/webauthn/login/options", {
      method: "POST",
      body: JSON.stringify({ username: username || null }),
    }),
  webauthnLoginVerify: (challenge_key: string, credential: unknown) =>
    apiRequest<AuthTokenResponse>("/auth/webauthn/login/verify", {
      method: "POST",
      body: JSON.stringify({ challenge_key, credential }),
    }),
};

export interface PagedResult<T> {
  items: T[];
  total: number;
}

/** GET a list endpoint that returns a plain array plus X-Total-Count header (over WebSocket RPC when connected). */
export async function apiRequestPaged<T>(path: string, page: number, pageSize: number): Promise<PagedResult<T>> {
  const sep = path.includes("?") ? "&" : "?";
  const fullPath = `${path}${sep}limit=${pageSize}&offset=${(page - 1) * pageSize}`;
  const init: RequestInit = { method: "GET" };

  if (await ensureWsRpcReady(fullPath, init)) {
    try {
      let rpcRes = await sendWsRpc(fullPath, init);
      if (rpcRes.status === 401 && !isAuthNoRefreshPath(fullPath)) {
        const nextToken = await performSingleFlightRefresh();
        if (nextToken && (await ensureWsRpcReady(fullPath, init, 2500))) {
          rpcRes = await sendWsRpc(fullPath, init);
        } else if (!nextToken) {
          clearAccessToken();
          redirectToLoginIfProtected();
        }
      }
      if (!rpcRes.ok) {
        throw new Error(extractRpcError(rpcRes.status, rpcRes.data));
      }
      const list = Array.isArray(rpcRes.data) ? (rpcRes.data as T[]) : [];
      const header = Number(rpcRes.headers["x-total-count"]);
      return { items: list, total: Number.isFinite(header) && header > 0 ? header : list.length };
    } catch (err) {
      if (
        !(err instanceof Error) ||
        (!err.message.includes("WebSocket") && !err.message.includes("RPC timeout"))
      ) {
        throw err;
      }
    }
  }

  const res = await apiRequestRaw(fullPath, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }
  const items = (await res.json()) as T[];
  const list = Array.isArray(items) ? items : [];
  const header = Number(res.headers.get("X-Total-Count"));
  return { items: list, total: Number.isFinite(header) && header > 0 ? header : list.length };
}
