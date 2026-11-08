import { describe, expect, it } from "vitest";
import { BASE_LEG, createFigurePose } from "./figure";
import { createHumanGait, GAIT_SPEEDS, GAITS, humanPose, legReach, updateHumanGait, type HumanGait } from "./humanGait";
import { createWalker, stepWalker, WALK, type WalkInput } from "./walker";
import type { WalkWorld } from "./walkWorld";

/** Run at a steady speed for `seconds`, calling `each` after every frame with the gait and the distance so far. */
function steady(speed: number, seconds: number, hz = 60, each?: (gait: HumanGait, distance: number) => void): HumanGait {
  const gait = createHumanGait();
  const dt = 1 / hz;
  let travelled = 0;
  for (let i = 0; i < seconds * hz; i += 1) {
    travelled += speed * dt;
    updateHumanGait(gait, { dt, distance: speed * dt, speed, heading: 0, y: 0, reduced: false });
    each?.(gait, travelled);
  }
  return gait;
}

/** World-forward position of each foot's heel and toe, and the height of its lowest sole point above the ground. */
function feet(gait: HumanGait, travelled: number) {
  const pose = humanPose(gait, createFigurePose());
  const hipHeight = BASE_LEG.hip + pose.hips.y;
  return pose.legs.map((leg) => {
    const reach = legReach(leg.hip, leg.knee, leg.ankle);
    return { height: hipHeight - reach.down, heel: travelled + reach.heel, toe: travelled + reach.toe };
  });
}

describe("human gaits", () => {
  it("step at a natural rhythm: about one stride a second at the courier's jog, faster when sprinting", () => {
    const jogCadence = WALK.walkSpeed / GAITS.jog.stride;
    const runCadence = WALK.runSpeed / GAITS.run.stride;
    // The reference courier's locomotion clip cycles about every 0.87 s (1.15 strides a second).
    expect(jogCadence).toBeGreaterThan(1.0);
    expect(jogCadence).toBeLessThan(1.45);
    expect(runCadence).toBeGreaterThan(jogCadence);
    expect(runCadence).toBeLessThan(1.7);
    // A stroll (as residents walk) takes slower, shorter strides.
    expect(2.2 / GAITS.walk.stride).toBeGreaterThan(0.55);
    expect(2.2 / GAITS.walk.stride).toBeLessThan(1.1);
    expect(GAITS.walk.stride).toBeLessThan(GAITS.jog.stride);
    expect(GAITS.jog.stride).toBeLessThan(GAITS.run.stride);
  });

  it("choose walk, jog and run by speed", () => {
    const walk = steady(2.2, 3);
    expect(walk.walk).toBeGreaterThan(0.95);
    const jog = steady(WALK.walkSpeed, 3);
    expect(jog.jog).toBeGreaterThan(0.95);
    const run = steady(WALK.runSpeed, 3);
    expect(run.run).toBeGreaterThan(0.9);
    expect(GAIT_SPEEDS.runFull).toBeLessThan(WALK.runSpeed);
  });

  it("keep the supporting foot on the ground while walking, and never push a foot through it", () => {
    let lowest = Infinity, highestSupport = -Infinity;
    steady(2.2, 4, 60, (gait, travelled) => {
      if (gait.time < 2) return;
      const [left, right] = feet(gait, travelled);
      const support = Math.min(left!.height, right!.height);
      lowest = Math.min(lowest, support);
      highestSupport = Math.max(highestSupport, support);
    });
    expect(lowest).toBeGreaterThan(-0.005);
    expect(highestSupport).toBeLessThan(0.005);
  });

  it("let a jog float a little between steps, and land back on the ground", () => {
    let lowest = Infinity, highest = -Infinity;
    steady(WALK.walkSpeed, 4, 60, (gait, travelled) => {
      if (gait.time < 2.5) return;
      const support = Math.min(...feet(gait, travelled).map((foot) => foot.height));
      lowest = Math.min(lowest, support);
      highest = Math.max(highest, support);
    });
    expect(lowest).toBeGreaterThan(-0.005);
    expect(lowest).toBeLessThan(0.005);
    expect(highest).toBeGreaterThan(0.02);
    expect(highest).toBeLessThan(0.25);
  });

  it("do not slide the planted foot: through mid-stance it stays where it landed", () => {
    for (const speed of [2.2, WALK.walkSpeed, WALK.runSpeed]) {
      const gait0 = steady(speed, 3);
      const table = gait0.walk > 0.9 ? GAITS.walk : gait0.jog > 0.9 ? GAITS.jog : GAITS.run;
      const midStance: number[] = [];
      steady(speed, 6, 120, (gait, travelled) => {
        if (gait.time < 3) return;
        // The middle of the left foot's stance, where the sole is flat on the ground.
        const into = gait.phase / table.keys.stance;
        if (into < 0.3 || into > 0.6) return;
        midStance.push(feet(gait, travelled)[0]!.heel);
      });
      // Group by step (a jump of more than a unit means a new step) and measure each step's slip.
      let start = midStance[0]!, worst = 0;
      for (let i = 1; i < midStance.length; i += 1) {
        if (Math.abs(midStance[i]! - midStance[i - 1]!) > 1) start = midStance[i]!;
        worst = Math.max(worst, Math.abs(midStance[i]! - start));
      }
      // A slip this small (a few centimetres, against a stride of several units) does not read on screen.
      expect(worst, `speed ${speed}`).toBeLessThan(0.22);
    }
  });

  it("swing each arm against the opposite leg", () => {
    const gait = steady(WALK.walkSpeed, 3);
    gait.phase = 0.05; // just after the left heel strikes: left leg forward
    const pose = humanPose(gait, createFigurePose());
    expect(pose.legs[0].hip).toBeGreaterThan(pose.legs[1].hip);
    expect(pose.arms[1].swing).toBeGreaterThan(pose.arms[0].swing);
    // A jogger's elbows are well bent; a stroller's barely.
    expect(pose.arms[0].elbow).toBeGreaterThan(1.1);
    const stroll = humanPose(steady(2.2, 3), createFigurePose());
    expect(stroll.arms[0].elbow).toBeLessThan(0.7);
  });

  it("lean into the pace without bouncing or squashing", () => {
    const still = humanPose(steady(0, 2), createFigurePose());
    const jog = humanPose(steady(WALK.walkSpeed, 3), createFigurePose());
    expect(jog.spine.pitch + jog.chest.pitch).toBeLessThan(still.spine.pitch + still.chest.pitch - 0.05);
    // The pelvis moves by centimetres, never a cartoon bob.
    let lowest = Infinity, highest = -Infinity;
    steady(WALK.walkSpeed, 4, 60, (gait) => {
      if (gait.time < 2) return;
      const y = humanPose(gait, createFigurePose()).hips.y;
      lowest = Math.min(lowest, y); highest = Math.max(highest, y);
    });
    expect(highest - lowest).toBeGreaterThan(0.03);
    expect(highest - lowest).toBeLessThan(0.3);
  });

  it("ease into motion and settle out of it with the walker, as the reference's clip weights do", () => {
    // Driven by the real walker from standing, as in the game. The reference's clip weights (live-timing.json, its
    // ordinary starts and every release) are half in 0.11–0.28 s after the key goes down and 90% in by 0.36–0.55 s;
    // after release half out by 0.21–0.35 s and down to a tenth by 0.47–0.61 s.
    const flat: WalkWorld = { surfaceAt: () => ({ height: 0, walkable: true }), blocked: () => false };
    const walker = createWalker(0, 0, flat);
    const gait = createHumanGait();
    const dt = 1 / 60;
    const trace: { t: number; move: number }[] = [];
    const drive = (input: WalkInput, seconds: number, from: number) => {
      for (let i = 1; i <= seconds * 60; i += 1) {
        const x = walker.x, z = walker.z;
        stepWalker(walker, input, dt, flat);
        const distance = Math.hypot(walker.x - x, walker.z - z);
        updateHumanGait(gait, { dt, distance, speed: distance / dt, heading: walker.heading, y: 0, reduced: false });
        trace.push({ t: from + i * dt, move: gait.move });
      }
    };
    const idle: WalkInput = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };
    drive({ ...idle, forward: 1 }, 1.2, 0);
    drive(idle, 1, 1.2);
    const first = (test: (move: number) => boolean, after: number) => trace.find((s) => s.t > after && test(s.move))!.t - after;
    expect(first((m) => m >= 0.5, 0)).toBeGreaterThan(0.11);
    expect(first((m) => m >= 0.5, 0)).toBeLessThan(0.28);
    expect(first((m) => m >= 0.9, 0)).toBeGreaterThan(0.36);
    expect(first((m) => m >= 0.9, 0)).toBeLessThan(0.55);
    expect(first((m) => m <= 0.5, 1.2)).toBeGreaterThan(0.21);
    expect(first((m) => m <= 0.5, 1.2)).toBeLessThan(0.35);
    expect(first((m) => m <= 0.1, 1.2)).toBeGreaterThan(0.47);
    expect(first((m) => m <= 0.1, 1.2)).toBeLessThan(0.61);
    // Never a jump from one frame to the next.
    for (let i = 1; i < trace.length; i += 1) expect(Math.abs(trace[i]!.move - trace[i - 1]!.move)).toBeLessThan(0.1);
  });

  it("gives the same pose at any frame rate", () => {
    const run = (hz: number) => {
      const gait = createHumanGait();
      for (let i = 0; i < hz * 2; i += 1) updateHumanGait(gait, { dt: 1 / hz, distance: WALK.walkSpeed / hz, speed: WALK.walkSpeed, heading: 0, y: 0, reduced: false });
      return { phase: gait.phase, move: gait.move, jog: gait.jog };
    };
    const base = run(60);
    for (const hz of [30, 144]) {
      const other = run(hz);
      // The stride is integrated per frame while its gait blend eases, so phase may drift by a hair (< 0.02 cycle).
      expect(Math.abs(other.phase - base.phase)).toBeLessThan(0.02);
      expect(other.move).toBeCloseTo(base.move, 2);
      expect(other.jog).toBeCloseTo(base.jog, 2);
    }
  });

  it("holds one calm pose under reduced motion", () => {
    const gait = createHumanGait();
    updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: 0, y: 0, reduced: true });
    const a = JSON.stringify(humanPose(gait, createFigurePose()));
    for (let i = 0; i < 120; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: 0.5, y: 0, reduced: true });
    expect(JSON.stringify(humanPose(gait, createFigurePose()))).toBe(a);
  });

  it("tucks for a jump and reaches down to land, then the knees give", () => {
    const gait = steady(WALK.walkSpeed, 2);
    const dt = 1 / 60;
    let y = 0, vy = 7.8;
    let tucked = 0;
    for (let i = 0; i < 60 && (i === 0 || y > 0); i += 1) {
      vy -= 26 * dt; y = Math.max(0, y + vy * dt);
      updateHumanGait(gait, { dt, distance: WALK.walkSpeed * dt, speed: WALK.walkSpeed, heading: 0, y, reduced: false, airborne: y > 0 });
      const pose = humanPose(gait, createFigurePose());
      tucked = Math.max(tucked, Math.max(pose.legs[0].knee, pose.legs[1].knee));
    }
    expect(tucked).toBeGreaterThan(1);
    let gave = 0;
    for (let i = 0; i < 20; i += 1) {
      updateHumanGait(gait, { dt, distance: WALK.walkSpeed * dt, speed: WALK.walkSpeed, heading: 0, y: 0, reduced: false });
      gave = Math.max(gave, gait.give.value);
    }
    expect(gave).toBeGreaterThan(0.1);
  });
});
