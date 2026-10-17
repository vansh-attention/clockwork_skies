import type { Event as GameEvent } from "./types";

export class SpaceAudio {
  private context: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private voices: { oscillator: OscillatorNode; gain: GainNode }[] = [];
  private cursor = 0;
  muted = false;

  unlock(): void {
    if (!this.context) {
      if (typeof AudioContext === "undefined") return;
      const context = new AudioContext();
      this.context = context;
      this.engine = context.createOscillator();
      this.engine.type = "triangle";
      this.engineGain = context.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(this.engineGain).connect(context.destination);
      this.engine.start();
      for (let i = 0; i < 4; i++) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        gain.gain.value = 0;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        this.voices.push({ oscillator, gain });
      }
    }
    void this.context.resume().catch(() => {});
  }

  motion(speed: number, playing: boolean): void {
    const context = this.context;
    if (!context || !this.engine || !this.engineGain) return;
    this.engine.frequency.setTargetAtTime(55 + Math.min(110, speed) * 0.8, context.currentTime, 0.06);
    this.engineGain.gain.setTargetAtTime(playing && !this.muted ? 0.009 : 0, context.currentTime, 0.03);
  }

  event(event: GameEvent): void {
    if (!this.context || this.muted || !this.voices.length) return;
    if (event.kind === "shot" && event.owner !== "player") return;
    const voice = this.voices[this.cursor++ % this.voices.length]!;
    const now = this.context.currentTime;
    const frequency = event.kind === "shot" ? 240 : event.kind === "hit" ? 110 :
      event.kind === "destroyed" ? 70 : event.kind === "rocket" ? 340 : 620;
    voice.oscillator.frequency.setValueAtTime(frequency, now);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(0.018, now + 0.008);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    voice.gain.gain.setValueAtTime(0, now + 0.14);
  }

  silence(): void {
    const context = this.context;
    if (!context) return;
    this.motion(0, false);
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setValueAtTime(0, context.currentTime);
    }
  }

  dispose(): void {
    this.silence();
    this.engine?.stop(); this.engine?.disconnect(); this.engineGain?.disconnect();
    for (const voice of this.voices) {
      voice.oscillator.stop(); voice.oscillator.disconnect(); voice.gain.disconnect();
    }
    this.voices.length = 0;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null; this.engine = null; this.engineGain = null;
  }
}
