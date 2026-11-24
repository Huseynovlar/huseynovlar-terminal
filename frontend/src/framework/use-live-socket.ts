import { useEffect, useState } from "react";

import { soundEngine } from "@/framework/sound-engine";
import { useTerminalStore } from "@/framework/terminal-store";

export interface LiveWsEvent {
  type: "snapshot" | "trade_event" | "breaking_news" | "alert";
  data: Record<string, unknown>;
}

export function useLiveTerminalSocket(onEvent?: (evt: LiveWsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LiveWsEvent | null>(null);
  const soundEnabled = useTerminalStore((s) => s.soundEnabled);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/v1/ws/live`;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          if (!disposed) {
            reconnectTimer = window.setTimeout(connect, 5000);
          }
        };
        ws.onerror = () => {
          ws?.close();
        };
        ws.onmessage = (msg) => {
          try {
            const evt = JSON.parse(msg.data) as LiveWsEvent;
            setLastEvent(evt);
            if (evt.type === "trade_event") {
              const pnl = Number(evt.data.net_profit_usd ?? 0);
              const entryType = Number(evt.data.entry_type ?? 0);
              if (entryType === 0) {
                soundEngine.tradeOpen(soundEnabled);
              } else if (pnl >= 100) {
                soundEngine.bigProfit(soundEnabled);
              } else if (pnl > 0) {
                soundEngine.tradeProfit(soundEnabled);
              }
            } else if (evt.type === "breaking_news") {
              soundEngine.breakingNews(soundEnabled);
            } else if (evt.type === "alert") {
              soundEngine.alertWarn(soundEnabled);
            }
            onEvent?.(evt);
          } catch {
            // ignore malformed frame
          }
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [soundEnabled, onEvent]);

  return { connected, lastEvent };
}
