const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

let accessToken: string | null =
  typeof window !== "undefined" ? window.sessionStorage.getItem("ht_access_token") : null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) window.sessionStorage.setItem("ht_access_token", token);
    else window.sessionStorage.removeItem("ht_access_token");
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = String(data.detail);
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
  logout: () => apiRequest<{ status: string }>("/auth/logout", { method: "POST" }),
  webauthnLoginOptions: (username?: string) =>
    apiRequest<{ challenge_key: string; options: PublicKeyCredentialRequestOptions }>("/auth/webauthn/login/options", {
      method: "POST",
      body: JSON.stringify({ username: username || null }),
    }),
  webauthnLoginVerify: (challenge_key: string, credential: unknown) =>
    apiRequest<AuthTokenResponse>("/auth/webauthn/login/verify", {
      method: "POST",
      body: JSON.stringify({ challenge_key, credential }),
    }),
};
