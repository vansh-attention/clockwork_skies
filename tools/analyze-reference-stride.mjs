import fs from "node:fs";
import * as T from "three";
import { COURIER_LOOK, createFigure, createFigureMaterial, createFigurePose, poseFigure } from "../apps/client/src/courier/figure.ts";
import { createHumanGait, updateHumanGait, humanPose, relaxPose, gaitTables } from "../apps/client/src/courier/humanGait.ts";
import { WALK } from "../apps/client/src/courier/walker.ts";

const folder = ".claude/abeto-messenger/movement-reference/2026-11-10";
const reference = JSON.parse(fs.readFileSync(`${folder}/stride-samples.json`, "utf8"));
const cycles = JSON.parse(fs.readFileSync(`${folder}/clip-cycles.json`, "utf8"));
const vector = p => new T.Vector3(...p);
const bend = (a, b, c) => (Math.PI - vector(a).sub(vector(b)).angleTo(vector(c).sub(vector(b)))) * 180 / Math.PI;
const summary = samples => {
  const values = { lean: [], hip: [], knee: [], elbow: [] };
  for (const p of samples) {
    const trunk = vector(p[4]).sub(vector(p[0]));
    values.lean.push(Math.atan2(Math.abs(trunk.z), trunk.y) * 180 / Math.PI);
    for (const [hip, knee, ankle] of [[14, 15, 16], [18, 19, 20]]) {
      const thigh = vector(p[knee]).sub(vector(p[hip]));
      values.hip.push(Math.atan2(Math.abs(thigh.z), -thigh.y) * 180 / Math.PI);
      values.knee.push(bend(p[hip], p[knee], p[ankle]));
    }
    for (const [shoulder, elbow, hand] of [[7, 8, 9], [11, 12, 13]]) values.elbow.push(bend(p[shoulder], p[elbow], p[hand]));
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => {
    v.sort((a, b) => a - b);
    return [k, { p05: v[Math.floor(v.length * .05)], median: v[Math.floor(v.length * .5)], p95: v[Math.floor(v.length * .95)] }];
  }));
};
const result = { reference: {}, local: {} };
for (const stage of ["jog", "sprint"]) {
  const frames = reference.samples.filter(s => s.stage === stage);
  const start = frames[0].time;
  const stable = frames.filter(s => s.time - start > 650 && s.clip[1].weight + s.clip[2].weight > .9);
  const complete = cycles.samples.filter(s => s.stage === stage);
  result.reference[stage] = { liveFrames: stable.length, evaluatedFrames: complete.length, cycleSeconds: (23 / 24) / 1.1, ...summary(complete.map(s => s.joints)) };
}
const figure = createFigure(COURIER_LOOK, createFigureMaterial());
for (const stage of ["jog", "sprint"]) {
  const speed = stage === "jog" ? WALK.walkSpeed : WALK.runSpeed;
  const gait = createHumanGait();
  for (let i = 0; i < 600; i++) updateHumanGait(gait, { dt: 1 / 120, distance: speed / 120, speed, heading: 0, y: 0, reduced: false, scale: figure.scale, pace: figure.pace, leg: figure.leg });
  const samples = [];
  for (let i = 0; i < 120; i++) {
    gait.phase = i / 120;
    poseFigure(figure, relaxPose(gait, humanPose(gait, createFigurePose(), figure.leg)));
    figure.group.updateMatrixWorld(true);
    const b = figure.bones, point = bone => bone.getWorldPosition(new T.Vector3()).toArray();
    const p = [];
    p[0] = point(b.hips); p[4] = point(b.neck);
    for (const [side, leg, arm] of [[0, 14, 7], [1, 18, 11]]) {
      p[leg] = point(b.thigh[side]); p[leg + 1] = point(b.shin[side]); p[leg + 2] = point(b.foot[side]);
      p[arm] = point(b.upperArm[side]); p[arm + 1] = point(b.foreArm[side]); p[arm + 2] = point(b.hand[side]);
    }
    samples.push(p);
  }
  result.local[stage] = { cycleSeconds: gaitTables(figure.leg)[stage === "jog" ? "jog" : "run"].stride * figure.scale / speed, ...summary(samples) };
}
fs.writeFileSync(`${folder}/stride-comparison.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
