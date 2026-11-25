/**
 * Lightweight Web Audio API sound synthesizer for Huseynovlar Terminal.
 * Zero external MP3 files — crisp institutional acoustic cues.
 */

export type SoundCueName = "confirm" | "tradeOpen" | "tradeProfit" | "bigProfit" | "breakingNews" | "alertWarn";

let audioCtx: AudioContext | null = null;

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

function playTone(
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  volume = 0.08,
  type: OscillatorType = "sine",
) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

export const soundEngine = {
  confirmEnable(enabled = true) {
    if (!enabled) return;
    playTone(659.25, 0, 0.09, 0.06, "sine"); // E5
    playTone(987.77, 0.08, 0.14, 0.07, "sine"); // B5
  },
  tradeOpen(enabled: boolean) {
    if (!enabled) return;
    playTone(587.33, 0, 0.12, 0.06, "sine"); // D5
    playTone(880.0, 0.09, 0.16, 0.06, "sine"); // A5
  },
  tradeProfit(enabled: boolean) {
    if (!enabled) return;
    playTone(523.25, 0, 0.12, 0.07, "triangle"); // C5
    playTone(659.25, 0.08, 0.14, 0.07, "triangle"); // E5
    playTone(783.99, 0.16, 0.22, 0.08, "triangle"); // G5
  },
  bigProfit(enabled: boolean) {
    if (!enabled) return;
    playTone(523.25, 0, 0.16, 0.08, "triangle"); // C5
    playTone(659.25, 0.09, 0.16, 0.08, "triangle"); // E5
    playTone(783.99, 0.18, 0.18, 0.09, "triangle"); // G5
    playTone(1046.5, 0.27, 0.38, 0.1, "sine"); // C6
  },
  breakingNews(enabled: boolean) {
    if (!enabled) return;
    playTone(987.77, 0, 0.08, 0.05, "sine"); // B5
    playTone(987.77, 0.11, 0.08, 0.05, "sine");
  },
  alertWarn(enabled: boolean) {
    if (!enabled) return;
    playTone(349.23, 0, 0.15, 0.08, "sawtooth"); // F4
    playTone(293.66, 0.17, 0.2, 0.08, "sawtooth"); // D4
  },
  previewCue(cue: SoundCueName) {
    switch (cue) {
      case "confirm":
        this.confirmEnable(true);
        break;
      case "tradeOpen":
        this.tradeOpen(true);
        break;
      case "tradeProfit":
        this.tradeProfit(true);
        break;
      case "bigProfit":
        this.bigProfit(true);
        break;
      case "breakingNews":
        this.breakingNews(true);
        break;
      case "alertWarn":
        this.alertWarn(true);
        break;
    }
  },
};
