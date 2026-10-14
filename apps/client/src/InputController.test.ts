import { afterEach, describe, expect, it, vi } from "vitest";
import { InputController } from "./InputController";
import type { InputCommand } from "@clockwork/shared";

function harness() {
  const win = new EventTarget();
  let tick = () => {};
  const canvas = Object.assign(new EventTarget(), { focus: vi.fn(), requestPointerLock: vi.fn() });
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null, activeElement: canvas });
  vi.stubGlobal("window", Object.assign(win, { setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval: vi.fn(), innerWidth: 1000, innerHeight: 800 }));
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  const commands: InputCommand[] = [];
  const controller = new InputController(canvas as unknown as HTMLElement, { onInput: (command) => commands.push(command), getRocketTarget: () => null });
  controller.enable();
  const dispatch = (type: string, props: Record<string, unknown>) => win.dispatchEvent(Object.assign(new Event(type), props));
  return { controller, doc, canvas, commands, tick: () => tick(), dispatch };
}
afterEach(() => vi.unstubAllGlobals());
describe("flight input isolation", () => {
  it("does not consume gameplay keys when a settings control has focus", () => {
    const h = harness();
    Object.assign(h.doc, { activeElement: { tagName: "INPUT" } });
    h.dispatch("keydown", { code: "KeyW" }); h.tick();
    expect(h.commands[0]?.throttle).toBe(0);
    h.controller.disable();
  });
  it("continues sequence numbers after reopening the flight manual", () => {
    const h = harness(); h.controller.disable();
    const options = { onInput: (command: InputCommand) => h.commands.push(command), getRocketTarget: () => null, initialSequence: 90 };
    const resumed = new InputController(h.canvas as unknown as HTMLElement, options);
    resumed.enable(); h.tick();
    expect(h.commands[0]?.sequence).toBe(91);
    resumed.disable();
  });
  it("does not fire from a UI click and clears held controls on blur", () => {
    const h = harness();
    h.dispatch("mousedown", { button: 0 }); h.tick();
    expect(h.commands[0]?.cannon).toBe(false);
    h.dispatch("keydown", { code: "KeyW" }); h.tick();
    expect(h.commands[1]?.throttle).toBe(1);
    h.dispatch("blur", {}); h.tick();
    expect(h.commands[2]?.throttle).toBe(0);
    h.controller.disable();
  });
});
