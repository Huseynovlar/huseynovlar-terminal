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

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
