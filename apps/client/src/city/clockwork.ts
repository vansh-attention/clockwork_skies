const TAU = Math.PI * 2;

/** How long each once-a-second kick takes before the gears hold still again. */
export const TICK_KICK_MS = 150;

/** Hand angles in radians, clockwise from twelve. The minute hand jumps once a minute, like a tower clock. */
export function handAngles(date: Date): { hour: number; minute: number } {
  const hours = date.getHours() % 12;
  const minutes = date.getMinutes();
  return { hour: (hours + minutes / 60) / 12 * TAU, minute: minutes / 60 * TAU };
}

function kick(ms: number) {
  const second = Math.floor(ms / 1000);
  const progress = Math.min(1, (ms - second * 1000) / TICK_KICK_MS);
  return { second, eased: 1 - (1 - progress) ** 3 };
}

/** Whole seconds elapsed, advancing in one short eased kick at the start of each second. */
export function tickValue(ms: number): number {
  const { second, eased } = kick(ms);
  return second - 1 + eased;
}

/** The escapement anchor rocks to the opposite side on every tick. */
export function anchorSwing(ms: number, amplitude = 0.14): number {
  const { second, eased } = kick(ms);
  const to = second % 2 === 0 ? amplitude : -amplitude;
  return -to + 2 * to * eased;
}

/** Milliseconds into the current twelve-hour cycle, so gear angles stay small numbers. */
export function cycleMs(epochMs: number): number {
  return epochMs % 43_200_000;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
