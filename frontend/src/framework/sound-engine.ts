/**
 * Institutional Web Audio API SoundEngine for Huseynovlar Terminal (Stage 6).
 * Zero external MP3 files — crisp synthesized tones, per-event cooldown anti-spam,
 * automatic AudioContext unlock on first user interaction, and localStorage persistence.
 */

export type SoundCategory = "charts" | "trades" | "news" | "infrastructure";

export type SoundEventKey =
  | "priceAlert"
  | "mt5ZoneEnter"
  | "levelClick"
  | "orderOpened"
  | "tradeProfit"
  | "tradeLoss"
  | "marginWarning"
  | "liquidationSpike"
  | "highImpactNews"
  | "bridgeDisconnect"
  | "bridgeReconnect";

export type SoundCueName =
  | "confirm"
  | "tradeOpen"
  | "tradeProfit"
  | "bigProfit"
  | "breakingNews"
  | "alertWarn"
  | SoundEventKey;

export interface SoundConfig {
  muted: boolean;
  volume: number; // 0..100
  categories: Record<SoundCategory, boolean>;
}

const STORAGE_KEY = "ht_sound_config_v2";

const DEFAULT_CONFIG: SoundConfig = {
  muted: false,
  volume: 70,
  categories: {
    charts: true,
    trades: true,
    news: true,
    infrastructure: true,
  },
};

const COOLDOWN_MS: Record<SoundEventKey, number> = {
  priceAlert: 1000,
  mt5ZoneEnter: 3000,
  levelClick: 100,
  orderOpened: 500,
  tradeProfit: 500,
  tradeLoss: 500,
  marginWarning: 10000,
  liquidationSpike: 2000,
  highImpactNews: 3000,
  bridgeDisconnect: 15000,
  bridgeReconnect: 5000,
};

const EVENT_CATEGORY: Record<SoundEventKey, SoundCategory> = {
  priceAlert: "charts",
  mt5ZoneEnter: "charts",
  levelClick: "charts",
  orderOpened: "trades",
  tradeProfit: "trades",
  tradeLoss: "trades",
  marginWarning: "trades",
  liquidationSpike: "charts",
  highImpactNews: "news",
  bridgeDisconnect: "infrastructure",
  bridgeReconnect: "infrastructure",
};

let audioCtx: AudioContext | null = null;
let unlocked = false;
const lastPlayedMap = new Map<string, number>();
const listeners = new Set<() => void>();

function loadConfig(): SoundConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG, categories: { ...DEFAULT_CONFIG.categories } };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG, categories: { ...DEFAULT_CONFIG.categories } };
    const parsed = JSON.parse(raw) as Partial<SoundConfig>;
    return {
      muted: Boolean(parsed.muted ?? DEFAULT_CONFIG.muted),
      volume: Math.max(0, Math.min(100, Number(parsed.volume ?? DEFAULT_CONFIG.volume))),
      categories: {
        charts: parsed.categories?.charts ?? true,
        trades: parsed.categories?.trades ?? true,
        news: parsed.categories?.news ?? true,
        infrastructure: parsed.categories?.infrastructure ?? true,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG, categories: { ...DEFAULT_CONFIG.categories } };
  }
}

let currentConfig: SoundConfig = loadConfig();

function persistConfig() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
    } catch {
      // ignore storage quota errors
    }
  }
  for (const fn of listeners) fn();
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Auto-unlock AudioContext on first pointer or keyboard interaction
if (typeof window !== "undefined") {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    getCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

function playTone(
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  baseVolume = 0.08,
  type: OscillatorType = "sine",
) {
  const ctx = getCtx();
  if (!ctx) return;
  const master = Math.max(0.001, (currentConfig.volume / 100) * baseVolume);
  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(master, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

function canPlay(key: SoundEventKey, bypassMute = false): boolean {
  if (!bypassMute) {
    if (currentConfig.muted || currentConfig.volume <= 0) return false;
    const cat = EVENT_CATEGORY[key];
    if (!currentConfig.categories[cat]) return false;
  }
  const now = performance.now();
  const last = lastPlayedMap.get(key) ?? 0;
  if (!bypassMute && now - last < COOLDOWN_MS[key]) return false;
  lastPlayedMap.set(key, now);
  return true;
}

function synthesize(key: SoundEventKey) {
  switch (key) {
    case "priceAlert":
      // Crystal double tone (880 Hz -> 1174 Hz)
      playTone(880, 0, 0.11, 0.09, "sine");
      playTone(1174.66, 0.1, 0.16, 0.09, "sine");
      break;
    case "mt5ZoneEnter":
      // Soft low pulse (330 Hz, 120ms)
      playTone(330, 0, 0.12, 0.08, "sine");
      break;
    case "levelClick":
      // Subtle tactile click (1200 Hz, 25ms)
      playTone(1200, 0, 0.025, 0.045, "triangle");
      break;
    case "orderOpened":
      // Ascending chord (523 Hz -> 659 Hz)
      playTone(523.25, 0, 0.1, 0.08, "sine");
      playTone(659.25, 0.08, 0.14, 0.08, "sine");
      break;
    case "tradeProfit":
      // Clean major signal (587 Hz -> 880 Hz)
      playTone(587.33, 0, 0.12, 0.09, "triangle");
      playTone(880, 0.09, 0.18, 0.09, "triangle");
      break;
    case "tradeLoss":
      // Muted descending tone (392 Hz -> 293 Hz)
      playTone(392, 0, 0.12, 0.07, "sine");
      playTone(293.66, 0.1, 0.18, 0.07, "sine");
      break;
    case "marginWarning":
      // Pulsing double warning
      playTone(440, 0, 0.14, 0.1, "sawtooth");
      playTone(349.23, 0.16, 0.16, 0.1, "sawtooth");
      playTone(440, 0.36, 0.14, 0.1, "sawtooth");
      break;
    case "liquidationSpike":
      // Low-frequency impact (160 Hz -> 110 Hz)
      playTone(160, 0, 0.12, 0.11, "triangle");
      playTone(110, 0.08, 0.18, 0.11, "sine");
      break;
    case "highImpactNews":
      // Bloomberg 3-pulse teletype beep (987 Hz)
      playTone(987.77, 0, 0.06, 0.07, "sine");
      playTone(987.77, 0.09, 0.06, 0.07, "sine");
      playTone(987.77, 0.18, 0.08, 0.07, "sine");
      break;
    case "bridgeDisconnect":
      // Two-tone alert (440 Hz -> 311 Hz)
      playTone(440, 0, 0.16, 0.09, "sawtooth");
      playTone(311.13, 0.18, 0.24, 0.09, "sawtooth");
      break;
    case "bridgeReconnect":
      // Short confirmation pulse (659 Hz, 80ms)
      playTone(659.25, 0, 0.08, 0.07, "sine");
      break;
  }
}

export const soundEngine = {
  getConfig(): SoundConfig {
    return { ...currentConfig, categories: { ...currentConfig.categories } };
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setMuted(muted: boolean) {
    currentConfig = { ...currentConfig, muted };
    persistConfig();
  },
  toggleMute(): boolean {
    const next = !currentConfig.muted;
    this.setMuted(next);
    if (!next) synthesize("bridgeReconnect");
    return next;
  },
  setVolume(volume: number) {
    currentConfig = { ...currentConfig, volume: Math.max(0, Math.min(100, Math.round(volume))) };
    persistConfig();
  },
  setCategoryEnabled(category: SoundCategory, enabled: boolean) {
    currentConfig = {
      ...currentConfig,
      categories: { ...currentConfig.categories, [category]: enabled },
    };
    persistConfig();
  },
  play(key: SoundEventKey, force = false) {
    if (!canPlay(key, force)) return;
    synthesize(key);
  },
  testCategory(category: SoundCategory) {
    const sample: Record<SoundCategory, SoundEventKey> = {
      charts: "priceAlert",
      trades: "tradeProfit",
      news: "highImpactNews",
      infrastructure: "bridgeReconnect",
    };
    synthesize(sample[category]);
  },

  // Backwards-compatible legacy API
  confirmEnable(enabled = true) {
    if (!enabled) return;
    this.play("bridgeReconnect", true);
  },
  tradeOpen(enabled: boolean) {
    if (!enabled) return;
    this.play("orderOpened");
  },
  tradeProfit(enabled: boolean) {
    if (!enabled) return;
    this.play("tradeProfit");
  },
  bigProfit(enabled: boolean) {
    if (!enabled) return;
    this.play("tradeProfit");
    playTone(1046.5, 0.2, 0.28, 0.09, "sine");
  },
  breakingNews(enabled: boolean) {
    if (!enabled) return;
    this.play("highImpactNews");
  },
  alertWarn(enabled: boolean) {
    if (!enabled) return;
    this.play("bridgeDisconnect");
  },
  previewCue(cue: SoundCueName) {
    switch (cue) {
      case "confirm":
        synthesize("bridgeReconnect");
        break;
      case "tradeOpen":
        synthesize("orderOpened");
        break;
      case "tradeProfit":
        synthesize("tradeProfit");
        break;
      case "bigProfit":
        synthesize("tradeProfit");
        playTone(1046.5, 0.2, 0.28, 0.09, "sine");
        break;
      case "breakingNews":
        synthesize("highImpactNews");
        break;
      case "alertWarn":
        synthesize("bridgeDisconnect");
        break;
      default:
        synthesize(cue);
        break;
    }
  },
};
