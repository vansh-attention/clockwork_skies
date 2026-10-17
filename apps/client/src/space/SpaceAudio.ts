import type { Event as GameEvent } from "./types";

export class SpaceAudio {
  muted = false;
  unlock(): void {}
  motion(_speed: number, _playing: boolean): void {}
  event(_event: GameEvent): void {}
  silence(): void {}
  dispose(): void {}
}
