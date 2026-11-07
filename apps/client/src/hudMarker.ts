/** The fields fitIndicator writes; any object with these (e.g. a HUD marker) can be passed. */
export type IndicatorOut = { x: number; y: number; bearing: number; offscreen: boolean };

/**
 * Turns a projected point (normalised device coordinates, -1..1) into a HUD marker position in percent of the canvas.
 * A point off screen, or behind the camera, is clamped to the screen edge and `bearing` (degrees, 0 = up) points at it.
 */
export function fitIndicator(x: number, y: number, behind: boolean, out: IndicatorOut): void {
  x = Number.isFinite(x) ? x : 0.8;
  y = Number.isFinite(y) ? y : 0;
  if (behind) { x *= -1; y *= -1; }
  out.offscreen = behind || Math.abs(x) > 0.8 || Math.abs(y) > 0.65;
  if (out.offscreen) {
    if (Math.abs(x) + Math.abs(y) < 1e-8) x = 0.8;
    const scale = 1 / Math.max(Math.abs(x) / 0.8, Math.abs(y) / 0.65);
    x *= scale; y *= scale;
  }
  out.bearing = Math.atan2(-y, x) * 180 / Math.PI + 90;
  out.x = 50 + x * 50;
  out.y = 50 - y * 50;
}
