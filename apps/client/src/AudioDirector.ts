import type { HudState } from "./GameScene";
import type { MatchEvent } from "@clockwork/shared";

export class AudioDirector {
  private context: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private muted = false;
  setMuted(value: boolean) { this.muted = value; if (value) this.silence(); }
  silence() { if (this.context && this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, 0.05); }

  unlock() {
    if (this.context) { void this.context.resume(); return; }
    this.context = new AudioContext();
    this.engine = this.context.createOscillator();
    this.engine.type = "sawtooth";
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    const lowpass = this.context.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.frequency.value = 320;
    this.engine.connect(lowpass).connect(this.engineGain).connect(this.context.destination);
    this.engine.start();
  }

  update(hud: HudState) {
    if (!this.context || !this.engine || !this.engineGain) return;
    const time = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(48 + hud.speed * 1.15, time, 0.08);
    this.engineGain.gain.setTargetAtTime(!this.muted && hud.status === "active" ? 0.018 + hud.boost / 100 * 0.009 : 0, time, 0.12);
  }

  event(event: MatchEvent) {
    if (!this.context || this.muted) return;
    const frequencies: Partial<Record<MatchEvent["type"], number>> = {
      shot: 105, "rocket-fired": 185, damage: 62, destroyed: 38, pickup: 460, redeploy: 330, phase: 275, winner: 620, ping: 520, emote: 390,
    };
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.type = event.type === "damage" || event.type === "destroyed" ? "sawtooth" : "triangle";
    oscillator.frequency.setValueAtTime(frequencies[event.type] ?? 220, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, (frequencies[event.type] ?? 220) * 0.55), this.context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, this.context.currentTime); gain.gain.exponentialRampToValueAtTime(0.08, this.context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.2);
    oscillator.connect(gain).connect(this.context.destination); oscillator.start(); oscillator.stop(this.context.currentTime + 0.22);
  }

  dispose() { this.engine?.stop(); void this.context?.close(); this.context = null; }
}
