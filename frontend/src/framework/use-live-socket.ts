import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getAccessToken } from "@/framework/api-client";
import { soundEngine } from "@/framework/sound-engine";
import { useTerminalStore } from "@/framework/terminal-store";

export type LiveWsEventType =
  | "welcome"
  | "heartbeat"
  | "pong"
  | "snapshot"
  | "trade_event"
  | "bar_update"
  | "tick"
  | "orderbook"
  | "robot_state"
  | "robot_telemetry"
  | "account_update"
  | "treasury_update"
  | "breaking_news"
  | "calendar_alert"
  | "container_event"
  | "macro_quotes"
  | "alert";

export interface LiveWsEvent {
  type: LiveWsEventType;
  ts?: string;
  server_time_msc?: number;
  portfolio?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export type LiveSocketStatus = "connecting" | "live" | "reconnecting" | "offline";

type EventListener = (evt: LiveWsEvent) => void;

interface LiveSocketContextValue {
  connected: boolean;
  status: LiveSocketStatus;
  rttMs: number | null;
  lastEvent: LiveWsEvent | null;
  lastHeartbeatAt: number | null;
  subscribe: (listener: EventListener) => () => void;
}

const LiveSocketContext = createContext<LiveSocketContextValue | null>(null);

export function LiveSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<LiveSocketStatus>("connecting");
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [lastEvent, setLastEvent] = useState<LiveWsEvent | null>(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number | null>(null);

  const listenersRef = useRef<Set<EventListener>>(new Set());
  const pingSentAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    let disposed = false;
    let attempt = 0;

    const buildWsUrl = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = getAccessToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      return `${proto}//${window.location.host}/api/v1/ws/live${qs}`;
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      try {
        const socket = new WebSocket(buildWsUrl());
        ws = socket;

        socket.onopen = () => {
          if (disposed) {
            socket.close();
            return;
          }
          attempt = 0;
          setConnected(true);
          setStatus("live");
          pingSentAtRef.current = performance.now();
          try {
            socket.send(JSON.stringify({ type: "ping", client_ts: Date.now() }));
          } catch {
            // ignore
          }
          pingTimer = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              pingSentAtRef.current = performance.now();
              try {
                socket.send(JSON.stringify({ type: "ping", client_ts: Date.now() }));
              } catch {
                // ignore
              }
            }
          }, 15000);
        };

        socket.onclose = (ev) => {
          setConnected(false);
          if (pingTimer !== undefined) window.clearInterval(pingTimer);
          if (!disposed) {
            attempt += 1;
            setStatus("reconnecting");
            const backoff = Math.min(15000, 1500 * Math.min(attempt, 6));
            if (ev.code === 1008) {
              void import("@/framework/api-client")
                .then(({ authApi }) => authApi.refresh())
                .catch(() => null)
                .finally(() => {
                  if (!disposed) {
                    reconnectTimer = window.setTimeout(connect, Math.min(backoff, 2000));
                  }
                });
              return;
            }
            reconnectTimer = window.setTimeout(connect, backoff);
          } else {
            setStatus("offline");
          }
        };

        socket.onerror = () => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        };

        socket.onmessage = (msg) => {
          try {
            const raw = JSON.parse(msg.data) as LiveWsEvent;
            const evt: LiveWsEvent = {
              ...raw,
              data: raw.data ?? (raw.portfolio ? raw.portfolio : {}),
            };

            if (evt.type === "pong") {
              if (pingSentAtRef.current !== null) {
                setRttMs(Math.max(1, Math.round(performance.now() - pingSentAtRef.current)));
                pingSentAtRef.current = null;
              }
              setLastHeartbeatAt(Date.now());
              return;
            }

            if (evt.type === "welcome" || evt.type === "heartbeat") {
              setLastHeartbeatAt(Date.now());
            }

            if (raw.portfolio && typeof raw.portfolio === "object") {
              const p = raw.portfolio as Record<string, unknown>;
              useTerminalStore.getState().setLivePortfolio({
                total_balance_usd: Number(p.total_balance_usd ?? 0),
                total_equity_usd: Number(p.total_equity_usd ?? 0),
                total_floating_pnl_usd: Number(p.total_floating_pnl_usd ?? 0),
                accounts_count: Number(p.accounts_count ?? 0),
                open_positions_count: Number(p.open_positions_count ?? 0),
                active_robots_count: Number(p.active_robots_count ?? 0),
              });
            }

            setLastEvent(evt);

            const soundEnabled = useTerminalStore.getState().soundEnabled;
            if (evt.type === "trade_event") {
              const payload = evt.data ?? {};
              const pnl = Number(payload.net_profit_usd ?? 0);
              const entryType = Number(payload.entry_type ?? 0);
              if (entryType === 0) {
                soundEngine.tradeOpen(soundEnabled);
              } else if (pnl >= 100) {
                soundEngine.bigProfit(soundEnabled);
              } else if (pnl > 0) {
                soundEngine.tradeProfit(soundEnabled);
              }
            } else if (evt.type === "breaking_news") {
              soundEngine.breakingNews(soundEnabled);
            } else if (evt.type === "alert" || evt.type === "calendar_alert") {
              soundEngine.alertWarn(soundEnabled);
            }

            for (const listener of listenersRef.current) {
              try {
                listener(evt);
              } catch {
                // isolate subscriber errors
              }
            }
          } catch {
            // ignore malformed frame
          }
        };
      } catch {
        attempt += 1;
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  const value = useMemo<LiveSocketContextValue>(
    () => ({
      connected,
      status,
      rttMs,
      lastEvent,
      lastHeartbeatAt,
      subscribe: (listener: EventListener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [connected, status, rttMs, lastEvent, lastHeartbeatAt],
  );

  return createElement(LiveSocketContext.Provider, { value }, children);
}

export function useLiveSocket() {
  const ctx = useContext(LiveSocketContext);
  if (!ctx) {
    return {
      connected: false,
      status: "offline" as LiveSocketStatus,
      rttMs: null as number | null,
      lastEvent: null as LiveWsEvent | null,
      lastHeartbeatAt: null as number | null,
      subscribe: () => () => {},
    };
  }
  return ctx;
}

export function useLiveEvents(
  types: LiveWsEventType | LiveWsEventType[],
  handler: (evt: LiveWsEvent) => void,
) {
  const { subscribe } = useLiveSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const typeKey = Array.isArray(types) ? types.join(",") : types;

  useEffect(() => {
    const allowed = new Set(typeKey.split(","));
    return subscribe((evt) => {
      if (allowed.has(evt.type)) {
        handlerRef.current(evt);
      }
    });
  }, [subscribe, typeKey]);
}

/**
 * Backwards-compatible hook used by existing M5 pages.
 */
export function useLiveTerminalSocket(onEvent?: (evt: LiveWsEvent) => void) {
  const { connected, status, rttMs, lastEvent, subscribe } = useLiveSocket();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!onEventRef.current) return;
    return subscribe((evt) => {
      onEventRef.current?.(evt);
    });
  }, [subscribe]);

  return { connected, status, rttMs, lastEvent };
}
