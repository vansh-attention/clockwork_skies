import type { InputCommand } from "@clockwork/shared";
import { InputController } from "../InputController";
import type { FlightInput } from "./skyFlight";

export type InputSource = { enable(): void; disable(): void };
export type PointerLockDoc = Pick<Document, "pointerLockElement" | "exitPointerLock">;
export type InputSourceFactory = (element: HTMLElement, onInput: (command: InputCommand) => void) => InputSource;

export const NEUTRAL_FLIGHT: Readonly<FlightInput> = Object.freeze({ aimX: 0, aimY: 0, throttle: 0, fineRoll: 0, boost: false });

const defaultFactory: InputSourceFactory = (element, onInput) =>
  new InputController(element, { onInput, getRocketTarget: () => null });

/** Holds only the latest flight command from InputController; never steps physics itself. */
export class FlightInputLatch {
  private readonly source: InputSource;
  /** Only ever replaced, never mutated, so `latest()` can hand it out without copying. */
  private current: Readonly<FlightInput> = NEUTRAL_FLIGHT;
  private active = false;

  constructor(
    private readonly element: HTMLElement,
    factory: InputSourceFactory = defaultFactory,
    private readonly doc?: PointerLockDoc,
  ) {
    this.source = factory(element, (command) => {
      if (!this.active) return;
      this.current = {
        aimX: command.aimX,
        aimY: command.aimY,
        throttle: command.throttle,
        fineRoll: command.fineRoll,
        boost: command.boost,
      };
    });
  }

  get enabled(): boolean { return this.active; }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.source.enable();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.source.disable();
    this.current = NEUTRAL_FLIGHT;
    // InputController never releases pointer lock itself; free the cursor for walking mode.
    const doc = this.doc ?? (typeof document === "undefined" ? undefined : document);
    if (doc && doc.pointerLockElement === this.element) doc.exitPointerLock?.();
  }

  /** The latest command's flight fields, or neutral. Treat as immutable; no allocation per call. */
  latest(): Readonly<FlightInput> {
    return this.current;
  }
}
