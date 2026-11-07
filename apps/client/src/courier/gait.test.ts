import { describe, expect, it } from "vitest";
import { createGait, gaitPose, resetGait, updateGait, type CourierPose, type Gait, type GaitInput } from "./gait";

type Drive = (t: number, dt: number) => Partial<Omit<GaitInput, "dt">>;

/** Runs the gait for `seconds` at `fps`, feeding speed/heading/height from `drive(t)` and distance = speed * dt. */
function simulate(gait: Gait, seconds: number, fps: number, drive: Drive, each?: (pose: CourierPose, t: number) => void) {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  for (let i = 1; i <= frames; i += 1) {
    const t = i * dt;
    const input = { speed: 0, heading: 0, y: 0, reduced: false, ...drive(t, dt) };
    updateGait(gait, { ...input, dt, distance: input.distance ?? input.speed * dt });
    each?.(gaitPose(gait), t);
  }
  return gaitPose(gait);
}

const walking: Drive = () => ({ speed: 10 });

describe("gait at rest", () => {
  it("settles to the rest pose when standing still", () => {
    const gait = createGait();
    simulate(gait, 1, 60, walking);
    const pose = simulate(gait, 2, 60, () => ({ speed: 0 }));
    for (const leg of pose.legs) {
      expect(Math.abs(leg.hip)).toBeLessThan(0.01);
      expect(Math.abs(leg.knee)).toBeLessThan(0.01);
    }
    for (const arm of pose.arms) expect(Math.abs(arm.swing)).toBeLessThan(0.01);
    expect(Math.abs(pose.hipsY)).toBeLessThan(0.01);
    expect(Math.abs(pose.torsoPitch)).toBeLessThan(0.01);
  });

  it("breathes and, after a while, looks around", () => {
    const gait = createGait();
    let breathe = 0;
    let look = 0;
    simulate(gait, 6, 60, () => ({ speed: 0 }), (pose) => {
      breathe = Math.max(breathe, Math.abs(pose.breathe));
      look = Math.max(look, Math.abs(pose.headYaw));
    });
    expect(breathe).toBeGreaterThan(0.005);
    expect(look).toBeGreaterThan(0.1);
  });
});

describe("walking and running", () => {
  it("swings the legs in opposition with the arms countering them, and bobs on each step", () => {
    const gait = createGait();
    let maxHip = 0;
    let lowest = 0;
    let checked = 0;
    simulate(gait, 2, 60, walking, (pose, t) => {
      if (t < 1) return;
      const [left, right] = pose.legs;
      expect(left.hip).toBeCloseTo(-right.hip, 6);
      maxHip = Math.max(maxHip, Math.abs(left.hip));
      lowest = Math.min(lowest, pose.hipsY);
      expect(pose.hipsY).toBeLessThanOrEqual(1e-9);
      if (Math.abs(left.hip) > 0.15) {
        expect(Math.sign(pose.arms[0].swing)).toBe(-Math.sign(left.hip));
        checked += 1;
      }
    });
    expect(maxHip).toBeGreaterThan(0.4);
    expect(maxHip).toBeLessThan(1);
    expect(lowest).toBeLessThan(-0.08);
    expect(checked).toBeGreaterThan(10);
  });

  it("bends the knee of the leg swinging forward, never backwards", () => {
    const gait = createGait();
    simulate(gait, 2, 60, walking, (pose, t) => {
      if (t < 1) return;
      for (const leg of pose.legs) expect(leg.knee).toBeLessThanOrEqual(1e-9);
    });
  });

  it("runs with bigger swings and longer strides", () => {
    const amplitude = (speed: number) => {
      const gait = createGait();
      let max = 0;
      simulate(gait, 3, 60, () => ({ speed }), (pose, t) => { if (t > 2) max = Math.max(max, Math.abs(pose.legs[0].hip)); });
      return { max, gait };
    };
    const walk = amplitude(10);
    const run = amplitude(18);
    expect(run.max).toBeGreaterThan(walk.max + 0.1);
    // Phase per unit distance: running covers more ground per cycle.
    const before = run.gait.phase;
    updateGait(run.gait, { dt: 1 / 60, distance: 0.3, speed: 18, heading: 0, y: 0, reduced: false });
    const runPerUnit = (run.gait.phase - before + Math.PI * 2) % (Math.PI * 2) / 0.3;
    const beforeWalk = walk.gait.phase;
    updateGait(walk.gait, { dt: 1 / 60, distance: 0.3, speed: 10, heading: 0, y: 0, reduced: false });
    const walkPerUnit = (walk.gait.phase - beforeWalk + Math.PI * 2) % (Math.PI * 2) / 0.3;
    expect(runPerUnit).toBeLessThan(walkPerUnit);
  });

  it("advances the stride with distance covered, not time (pushing against a wall does not march on the spot)", () => {
    const gait = createGait();
    simulate(gait, 1, 60, walking);
    const phase = gait.phase;
    simulate(gait, 0.5, 60, () => ({ speed: 10, distance: 0 }));
    expect(gait.phase).toBeCloseTo(phase, 9);
  });

  it("gives the same pose at 60 and 144 fps", () => {
    // Speed ramps at 12/s for 1.5 s; distance is the exact ground covered that frame (6t^2), so both rates walk equally far.
    const covered = (t: number) => 6 * t * t;
    const drive: Drive = (t, dt) => ({ speed: Math.min(18, t * 12), heading: t * 0.4, distance: covered(t) - covered(t - dt) });
    const a = simulate(createGait(), 1.5, 60, drive);
    const b = simulate(createGait(), 1.5, 144, drive);
    expect(a.legs[0].hip).toBeCloseTo(b.legs[0].hip, 1);
    expect(a.torsoPitch).toBeCloseTo(b.torsoPitch, 2);
    expect(a.torsoRoll).toBeCloseTo(b.torsoRoll, 2);
    expect(a.hipsY).toBeCloseTo(b.hipsY, 1);
  });
});

describe("leaning", () => {
  it("leans forward while speeding up, then eases back to a steady lean", () => {
    const gait = createGait();
    let accelLean = 0;
    simulate(gait, 0.4, 60, (t) => ({ speed: Math.min(18, t * 60) }), (pose) => { accelLean = Math.min(accelLean, pose.torsoPitch); });
    const steady = simulate(gait, 3, 60, () => ({ speed: 18 }));
    expect(accelLean).toBeLessThan(-0.12);
    expect(steady.torsoPitch).toBeLessThan(0);
    expect(steady.torsoPitch).toBeGreaterThan(accelLean + 0.03);
  });

  it("leans into turns: right turns roll right (negative), left turns roll left", () => {
    const right = simulate(createGait(), 1, 60, (t) => ({ speed: 10, heading: t * 2 }));
    const left = simulate(createGait(), 1, 60, (t) => ({ speed: 10, heading: -t * 2 }));
    expect(right.torsoRoll).toBeLessThan(-0.05);
    expect(left.torsoRoll).toBeGreaterThan(0.05);
  });

  it("does not lean when standing and turning on the spot", () => {
    const pose = simulate(createGait(), 1, 60, (t) => ({ speed: 0, heading: t * 3 }));
    expect(Math.abs(pose.torsoRoll)).toBeLessThan(0.01);
  });
});

describe("squash", () => {
  it("squashes after stepping down, then settles", () => {
    const gait = createGait();
    let lowest = 0;
    simulate(gait, 0.5, 60, () => ({ speed: 0, y: 1.2 }));
    simulate(gait, 1.5, 60, (t) => ({ speed: 0, y: t < 0.15 ? 1.2 - (t / 0.15) * 1.2 : 0 }), (pose) => { lowest = Math.min(lowest, pose.squash); });
    expect(lowest).toBeLessThan(-0.03);
    expect(lowest).toBeGreaterThan(-0.3);
    expect(Math.abs(gaitPose(gait).squash)).toBeLessThan(0.005);
  });
});

describe("robustness", () => {
  it("holds the rest pose under reduced motion", () => {
    const pose = simulate(createGait(), 2, 60, (t) => ({ speed: 18, heading: t, reduced: true }));
    expect(pose.legs[0].hip).toBe(0);
    expect(pose.arms[1].swing).toBe(0);
    expect(pose.hipsY).toBe(0);
    expect(pose.torsoPitch).toBe(0);
    expect(pose.torsoRoll).toBe(0);
    expect(pose.squash).toBe(0);
    expect(pose.headYaw).toBe(0);
  });

  it("ignores frames with bad time", () => {
    const gait = createGait();
    simulate(gait, 1, 60, walking);
    const before = JSON.stringify(gait);
    updateGait(gait, { dt: Number.NaN, distance: 1, speed: 10, heading: 0, y: 0, reduced: false });
    updateGait(gait, { dt: 0, distance: 1, speed: 10, heading: 0, y: 0, reduced: false });
    expect(JSON.stringify(gait)).toBe(before);
  });

  it("does not read a teleport as a turn or a fall after resetGait", () => {
    const gait = createGait();
    simulate(gait, 1, 60, () => ({ speed: 0, heading: 0, y: 50 }));
    resetGait(gait, 2.5, 0);
    const pose = simulate(gait, 0.2, 60, () => ({ speed: 0, heading: 2.5, y: 0 }));
    expect(Math.abs(pose.torsoRoll)).toBeLessThan(0.01);
    expect(Math.abs(pose.squash)).toBeLessThan(0.01);
  });
});

describe("jumping", () => {
  /** A hop like the walker's: up at 7.8, gravity 26, starting at t0; airborne until it lands back at y = 0. */
  const hop = (t0: number, speed = 0): Drive => (t) => {
    const s = t - t0;
    const y = s > 0 ? Math.max(0, 7.8 * s - 13 * s * s) : 0;
    return { speed, y, airborne: s > 0 && y > 0 };
  };

  it("tucks the lead knee up on the way up and braces both legs on the way down", () => {
    const gait = createGait();
    let rising: CourierPose | null = null;
    let falling: CourierPose | null = null;
    simulate(gait, 0.7, 60, hop(0.05), (pose, t) => {
      if (Math.abs(t - 0.2) < 1e-6) rising = structuredClone(pose);
      if (Math.abs(t - 0.6) < 1e-6) falling = structuredClone(pose);
    });
    expect(rising).not.toBeNull();
    expect(falling).not.toBeNull();
    const up = rising as unknown as CourierPose;
    const down = falling as unknown as CourierPose;
    expect(up.legs[0].hip).toBeGreaterThan(0.4);
    expect(up.legs[0].knee).toBeLessThan(-0.7);
    expect(up.legs[1].hip).toBeLessThan(0);
    // Falling: both knees come forward to meet the ground, the arms spread for balance.
    expect(down.legs[1].hip).toBeGreaterThan(up.legs[1].hip);
    expect(down.arms[0].spread).toBeGreaterThan(up.arms[0].spread);
  });

  it("stretches on take-off, squashes on landing, then settles back to the rest pose", () => {
    const gait = createGait();
    let stretch = 0;
    let squash = 0;
    simulate(gait, 0.65, 60, hop(0.05), (pose, t) => {
      if (t < 0.3) stretch = Math.max(stretch, pose.squash);
    });
    simulate(gait, 0.3, 60, () => ({ speed: 0, y: 0 }), (pose) => { squash = Math.min(squash, pose.squash); });
    expect(stretch).toBeGreaterThan(0.03);
    expect(squash).toBeLessThan(-0.05);
    const rest = simulate(gait, 1.5, 60, () => ({ speed: 0, y: 0 }));
    for (const leg of rest.legs) expect(Math.abs(leg.hip)).toBeLessThan(0.02);
    expect(Math.abs(rest.squash)).toBeLessThan(0.01);
  });

  it("holds the stride in the air, so the feet land where they left off", () => {
    const gait = createGait();
    simulate(gait, 1, 60, walking);
    const before = gait.phase;
    // Airborne for 0.5 s at running speed: on the ground this would be well over a full stride.
    simulate(gait, 0.5, 60, () => ({ speed: 16, y: 1, airborne: true }));
    const turned = (gait.phase - before + Math.PI * 2) % (Math.PI * 2);
    expect(turned).toBeLessThan(1.2);
  });

  it("shows no air pose under reduced motion", () => {
    const gait = createGait();
    const pose = simulate(gait, 0.3, 60, () => ({ speed: 0, y: 1, airborne: true, reduced: true }));
    for (const leg of pose.legs) expect(leg.hip).toBe(0);
    expect(pose.squash).toBe(0);
  });

  it("forgets the air pose on resetGait (a teleport mid-jump)", () => {
    const gait = createGait();
    simulate(gait, 0.2, 60, () => ({ speed: 0, y: 1, airborne: true }));
    expect(gait.air).toBeGreaterThan(0.5);
    resetGait(gait, 0, 0);
    expect(gait.air).toBe(0);
    expect(Math.abs(gaitPose(gait).legs[0].hip)).toBeLessThan(0.01);
  });
});
