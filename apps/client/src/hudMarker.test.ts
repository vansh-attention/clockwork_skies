import { describe, expect, it } from "vitest";
import { fitIndicator, type IndicatorOut } from "./hudMarker";
import { fitIndicator as fromSpaceScene } from "./space/SpaceScene";

const blank = (): IndicatorOut => ({ x: 0, y: 0, bearing: 0, offscreen: false });

describe("fitIndicator", () => {
  it("is still exported from SpaceScene", () => {
    expect(fromSpaceScene).toBe(fitIndicator);
  });

  it("maps an on-screen point to canvas percentages", () => {
    const out = blank();
    fitIndicator(0.4, 0.2, false, out);
    expect(out.offscreen).toBe(false);
    expect(out.x).toBeCloseTo(70);
    expect(out.y).toBeCloseTo(40);
  });

  it("clamps a point beyond the right edge to the edge and points right", () => {
    const out = blank();
    fitIndicator(2, 0, false, out);
    expect(out.offscreen).toBe(true);
    expect(out.x).toBeCloseTo(90);
    expect(out.y).toBeCloseTo(50);
    expect(out.bearing).toBeCloseTo(90);
  });

  it("flips points behind the camera and marks them off screen", () => {
    const out = blank();
    fitIndicator(0.2, 0.2, true, out);
    expect(out.offscreen).toBe(true);
    expect(out.x).toBeLessThan(50);
    expect(out.y).toBeGreaterThan(50);
  });

  it("survives non-finite input", () => {
    const out = blank();
    fitIndicator(Number.NaN, Number.POSITIVE_INFINITY, false, out);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.bearing)).toBe(true);
  });
});
