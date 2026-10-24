import { afterEach, expect, it, vi } from "vitest";
import { SpaceAudio } from "./SpaceAudio";

afterEach(() => vi.unstubAllGlobals());

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn(); setValueAtTime = vi.fn(); cancelScheduledValues = vi.fn();
  linearRampToValueAtTime = vi.fn(); exponentialRampToValueAtTime = vi.fn();
}
class FakeNode {
  type = "sine"; gain = new FakeParam(); frequency = new FakeParam();
  connect = vi.fn((node: unknown) => node); start = vi.fn(); stop = vi.fn(); disconnect = vi.fn();
}
class FakeContext {
  currentTime = 0; destination = {};
  oscillators: FakeNode[] = []; gains: FakeNode[] = [];
  createOscillator = vi.fn(() => { const node = new FakeNode(); this.oscillators.push(node); return node; });
  createGain = vi.fn(() => { const node = new FakeNode(); this.gains.push(node); return node; });
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
}

it("creates no audio before interaction and reuses one engine plus four voices", () => {
  const contexts: FakeContext[] = [];
  vi.stubGlobal("AudioContext", class extends FakeContext { constructor() { super(); contexts.push(this); } });
  const audio = new SpaceAudio();
  expect(contexts).toHaveLength(0);
  audio.unlock(); audio.unlock();
  expect(contexts).toHaveLength(1);
  const context = contexts[0]!;
  expect(context.oscillators).toHaveLength(5);
  expect(context.gains).toHaveLength(5);
  for (let i = 0; i < 100; i++) audio.event({ kind: "shot", owner: "player" });
  audio.event({ kind: "shot", owner: "drone-0" });
  expect(context.oscillators).toHaveLength(5);
  audio.silence();
  expect(context.gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.03);
  audio.dispose(); audio.dispose();
  expect(context.close).toHaveBeenCalledTimes(1);
  for (const node of context.oscillators) {
    expect(node.stop).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalledTimes(1);
  }
  for (const node of context.gains) expect(node.disconnect).toHaveBeenCalledTimes(1);
});
