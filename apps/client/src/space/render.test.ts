import { expect, it, vi } from "vitest";
import { Resources } from "./SpaceScene";

it("disposes each shared resource exactly once", () => {
  const resources = new Resources();
  const geometry = { dispose: vi.fn() };
  const material = { dispose: vi.fn() };
  resources.own(geometry);
  resources.own(material);
  resources.own(geometry);
  expect(resources.size).toBe(2);

  resources.dispose();
  resources.dispose();
  expect(geometry.dispose).toHaveBeenCalledTimes(1);
  expect(material.dispose).toHaveBeenCalledTimes(1);
  expect(resources.size).toBe(0);
});
