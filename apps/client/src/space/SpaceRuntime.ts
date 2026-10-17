import { SpaceSession } from "./SpaceSession";
import { SpaceScene } from "./SpaceScene";
import { SpaceInput } from "./SpaceInput";
import { SpaceAudio } from "./SpaceAudio";
import type { HUD, Mode, Phase } from "./types";

export type RuntimeOptions = {
  sceneFactory?: (mount: HTMLElement) => SpaceScene;
  inputFactory?: (canvas: HTMLCanvasElement, pause: () => void) => SpaceInput;
  audioFactory?: () => SpaceAudio;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
};
export class SpaceRuntime {
  readonly session = new SpaceSession();
  readonly scene!: SpaceScene;
  readonly input!: SpaceInput;
  readonly audio!: SpaceAudio;
  phase: Phase = "menu";
  constructor(_mount: HTMLElement, _publish: (hud: HUD) => void, _failed: (message: string) => void,
    _options: RuntimeOptions = {}) {}
  async launch(_mode: Mode, _keyboard = false): Promise<void> {}
  async resume(_keyboard = false): Promise<void> {}
  pause(): void {}
  dispose(): void {}
}
