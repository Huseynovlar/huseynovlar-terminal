import { useEffect, useRef, useState } from "react";

import { getAccessToken } from "@/framework/api-client";

export interface LiveNewsItem {
  id: string;
  title: string;
  source: string;
  sentiment: string;
  impact_score: number;
  is_breaking: boolean;
  affected_assets: string[];
  published_at: string;
}

export function stripHtmlSafe(input: string): string {
  if (!input) return "";
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNewsWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getAccessToken();
  const base = `${proto}//${window.location.host}/api/v1/ws/news`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * Dedicated `/api/v1/ws/news` stream hook.
 * Subscribes on mount and explicitly sends `unsubscribe` + closes on unmount.
 */
export function useNewsStream(onItem: (item: LiveNewsItem) => void): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const onItemRef = useRef(onItem);
  onItemRef.current = onItem;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      if (!alive) return;
      const socket = new WebSocket(buildNewsWsUrl());
      ws = socket;

      socket.onopen = () => {
        if (!alive) {
          socket.close();
          return;
        }
        setConnected(true);
        try {
          socket.send(JSON.stringify({ type: "subscribe", channel: "news" }));
        } catch {
          // ignore
        }
      };

      socket.onmessage = (evt) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
          if (msg.type === "breaking_news") {
            const d = (msg.data && typeof msg.data === "object"
              ? msg.data
              : msg) as Record<string, unknown>;
            const title = stripHtmlSafe(String(d.title ?? ""));
            if (!title) return;
            onItemRef.current({
              id: String(d.id ?? `ws-${Date.now()}`),
              title,
              source: String(d.source ?? "WS News"),
              sentiment: String(d.sentiment ?? "NEUTRAL"),
              impact_score: Number(d.impact_score ?? 5),
              is_breaking: Boolean(d.is_breaking ?? true),
              affected_assets: Array.isArray(d.affected_assets)
                ? d.affected_assets.map(String)
                : [],
              published_at: String(d.published_at ?? new Date().toISOString()),
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        setConnected(false);
        ws = null;
        if (!alive) return;
        retryTimer = window.setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      };
    };

    connect();

    return () => {
      alive = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "unsubscribe", channel: "news" }));
          } catch {
            // ignore
          }
        }
        ws.close();
        ws = null;
      }
    };
  }, []);

  return { connected };
}
