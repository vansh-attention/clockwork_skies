import * as THREE from "three";
import type { IllustratedStyle } from "@clockwork/render";

/**
 * The air over Little London, and how the picture is finished.
 *
 * Two looks, eased between as the camera comes down to the street and back up:
 * - "street" (walking): close, hazy and inked. Lines are dark and fade out into blue-grey haze down a long street, so
 *   the city is met in small successive compositions with the courier close in front.
 * - "town" (title, overview): the whole island in view, so the haze is thin and lines carry to the far side.
 *
 * Distances are in town units: the courier is 3.8 units tall, about 2.3 units to a metre.
 */
export type AtmosphereLook = Readonly<{
  /** Squared-exponential fog density (see illustratedEnvironment.uFogDensity). */
  fogDensity: number;
  /** Line pass: where the ink starts and finishes fading, how much is left far away, and its tint. */
  line: Readonly<Pick<IllustratedStyle, "fadeNear" | "fadeFar" | "fadeMin" | "inkTint">>;
  thickness: number;
}>;

export const ATMOSPHERE = {
  street: { fogDensity: 0.0034, line: { fadeNear: 45, fadeFar: 420, fadeMin: 0.14, inkTint: 0.08 }, thickness: 1.15 },
  town: { fogDensity: 0.00058, line: { fadeNear: 420, fadeFar: 3200, fadeMin: 0.3, inkTint: 0.18 }, thickness: 1.15 },
} as const satisfies Record<string, AtmosphereLook>;

/** The near haze: a cool grey with a little of the sky's mint in it. The far haze is the sky's horizon (sky.ts). */
export const FOG_NEAR = "#a3bdb4";
/** The ink: a dark blue slate, never black (the reference's darkest lines sit near hue 204°, value 0.22). */
export const INK = "#2e333d";
/**
 * Light from the open sky and from the ground, added to every surface by how much it faces each (linear RGB). The sky
 * term gives shade its cool blue lift; the ground term is a dim warm grey.
 */
export const SKY_LIGHT = new THREE.Color(0.003, 0.0095, 0.019);
export const GROUND_LIGHT = new THREE.Color(0.0038, 0.0034, 0.003);

/** How quickly the look follows the camera between street and town, per second. */
export const ATMOSPHERE_RATE = 1.6;

/** The look a fraction `street` (0 town .. 1 street) of the way from town to street. */
export function blendLook(street: number): AtmosphereLook {
  const t = THREE.MathUtils.clamp(Number.isFinite(street) ? street : 0, 0, 1);
  const a: AtmosphereLook = ATMOSPHERE.town;
  const b: AtmosphereLook = ATMOSPHERE.street;
  const mix = (x: number, y: number) => x + (y - x) * t;
  // Fog density blends geometrically, so the change reads evenly across two orders of magnitude.
  return {
    fogDensity: a.fogDensity * (b.fogDensity / a.fogDensity) ** t,
    line: {
      fadeNear: mix(a.line.fadeNear, b.line.fadeNear),
      fadeFar: mix(a.line.fadeFar, b.line.fadeFar),
      fadeMin: mix(a.line.fadeMin, b.line.fadeMin),
      inkTint: mix(a.line.inkTint, b.line.inkTint),
    },
    thickness: mix(a.thickness, b.thickness),
  };
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The London afternoon grade, applied to display (sRGB) colours through a look-up table (createGradeLut):
 * - a soft S-curve between a lifted toe and a held-back shoulder, so nothing is pure black or pure white;
 * - teal-green in the shade and a faint mint in the light, so greys lean green rather than blue or yellow (measured
 *   on the reference's frames: its shaded greys sit near hue 150°, its lit greys near 110°);
 * - a little less saturation overall, a little more taken out of yellow-greens (which also lean toward teal), while
 *   the reds of buses and pillar boxes keep their punch.
 */
export function londonGrade(r: number, g: number, b: number): [number, number, number] {
  const toe = 0.04;
  const shoulder = 0.97;
  const curve = (v: number) => {
    const s = v * v * (3 - 2 * v);
    return toe + (shoulder - toe) * (v + (s - v) * 0.46);
  };
  let R = curve(r), G = curve(g), B = curve(b);
  const luma = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const shade = 1 - smooth(0.05, 0.6, luma);
  const light = smooth(0.5, 1, luma);
  R += shade * -0.01 + light * -0.004;
  G += shade * 0.012 + light * 0.01;
  B += shade * 0.004 + light * -0.004;

  // Saturation by hue.
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const delta = max - min;
  if (delta > 1e-6) {
    let hue: number;
    if (max === R) hue = ((G - B) / delta + 6) % 6;
    else if (max === G) hue = (B - R) / delta + 2;
    else hue = (R - G) / delta + 4;
    hue /= 6;
    const red = Math.max(smooth(0.06, 0.0, hue), smooth(0.92, 1, hue));
    const green = smooth(0.14, 0.22, hue) * smooth(0.48, 0.38, hue);
    const keep = 0.92 + red * 0.1 - green * 0.07;
    const grey = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    R = grey + (R - grey) * keep;
    G = grey + (G - grey) * keep;
    B = grey + (B - grey) * keep;
    // Yellow-greens lean a touch toward teal.
    B += green * delta * 0.12;
  }
  const clamp = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
  return [clamp(R), clamp(G), clamp(B)];
}
