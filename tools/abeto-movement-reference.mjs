import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

// Owned reference browser. Commands on stdin declare every action; REA attaches passively to port 9338.
const retained = ".claude/abeto-messenger/movement-reference";
const outputArg = process.argv.indexOf("--output");
const output = outputArg >= 0 ? process.argv[outputArg + 1] : retained;
if (!output) throw new Error("--output requires a directory");
await mkdir(output, { recursive: true });
if (process.argv.includes("--close-live")) {
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338", { timeout: 10000 });
  const session = await remote.newBrowserCDPSession();
  await session.send("Browser.close").catch(() => {});
  console.log("Closed the owned temporary reference browser.");
  process.exit(0);
}
if (process.argv.includes("--inspect-cycle")) {
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338", { timeout: 10000 });
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  const samples = await page.evaluate(() => {
    const root = window.__abetoMotion.character._localObject.animationProps.mixer._root;
    const bones = root.skeleton.bones;
    const saved = bones.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
    const result = [];
    try {
      for (const [stage, actionIndex] of [["jog", 1], ["sprint", 2]]) {
        const clip = window.__abetoMotion.character._localObject.animationProps.actions[actionIndex]._clip;
        const tracks = clip.tracks.map(track => ({ name: track.name, value: track.createInterpolant() }));
        for (let step = 0; step < 120; step++) {
          for (const track of tracks) {
            const [, index, property] = /bone_(\d+)\.(position|quaternion|scale)/.exec(track.name);
            bones[Number(index)][property].fromArray(track.value.evaluate(step / 120 * clip.duration));
          }
          root.updateMatrixWorld(true);
          const inverse = root.matrixWorld.clone().invert();
          result.push({ stage, phase: step / 120, time: step / 120 * clip.duration,
            joints: bones.map(b => b.getWorldPosition(b.position.clone()).applyMatrix4(inverse).toArray()) });
        }
      }
    } finally {
      bones.forEach((b, i) => { b.position.copy(saved[i].p); b.quaternion.copy(saved[i].q); b.scale.copy(saved[i].s); });
      root.updateMatrixWorld(true);
    }
    return result;
  });
  await writeFile(`${output}/clip-cycles.json`, JSON.stringify({ scope: "Controlled evaluation of the shipped run and sprint clips through a full cycle; live pose restored before returning", samples }));
  console.log(JSON.stringify({ samples: samples.length, cycles: 2 }));
  process.exit(0);
}
if (process.argv.includes("--measure-stride")) {
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338", { timeout: 10000 });
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  await page.evaluate(() => {
    const mesh = window.__abetoMotion.character._localObject.animationProps.mixer._root;
    window.__strideSamples = []; window.__strideStage = "idle"; window.__strideActive = true;
    const sample = (time) => {
      if (!window.__strideActive) return;
      mesh.updateMatrixWorld(true);
      const inverse = mesh.matrixWorld.clone().invert();
      const joints = mesh.skeleton.bones.map(b => b.getWorldPosition(b.position.clone()).applyMatrix4(inverse).toArray());
      const props = window.__abetoMotion.character._localObject.animationProps;
      window.__strideSamples.push({ time, stage: window.__strideStage, joints, clip: props.actions.map(a => ({ time: a.time, weight: a.getEffectiveWeight() })) });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const [stage, keys, duration] of [["idle", [], 500], ["jog", ["a"], 2100], ["release", [], 700], ["sprint", ["s", "Shift"], 1800], ["sprint", ["a", "Shift"], 1800], ["stop", [], 650]]) {
    await page.evaluate(stage => { window.__strideStage = stage; }, stage);
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.screenshot({ path: `${output}/stride-${stage}.png` });
    for (const key of keys) await page.keyboard.up(key);
  }
  const samples = await page.evaluate(() => { window.__strideActive = false; return window.__strideSamples; });
  await writeFile(`${output}/stride-samples.json`, JSON.stringify({ action_performer: "Playwright", samples }));
  console.log(JSON.stringify({ frames: samples.length, stages: [...new Set(samples.map(s => s.stage))] }));
  process.exit(0);
}
if (process.argv.includes("--inspect-rig")) {
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338", { timeout: 10000 });
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  const rig = await page.evaluate(() => {
    const m = window.__abetoMotion.character, props = m._localObject.animationProps, root = props.mixer._root;
    const nodes = []; root.traverse?.(node => { if (node.isBone || node.isSkinnedMesh) nodes.push({ name: node.name, type: node.type, bones: node.skeleton?.bones.map(b => b.name) }); });
    const bones = root.skeleton.bones.map((b, i) => ({ name: b.name, parent: b.parent?.name, rest: b.position.clone().setFromMatrixPosition(root.skeleton.boneInverses[i].clone().invert()).toArray() }));
    return { root: { type: root.type }, bones, nodes, clips: props.actions.map(a => ({ name: a._clip.name, duration: a._clip.duration, tracks: a._clip.tracks.map(t => ({ name: t.name, size: t.values.length, times: t.times.length })) })) };
  });
  await writeFile(`${output}/rig-inventory.json`, JSON.stringify(rig, null, 2));
  console.log(JSON.stringify({ bones: rig.bones, clips: rig.clips.map(c => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })) }));
  process.exit(0);
}
if (process.argv.includes("--inspect-live")) {
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338", { timeout: 10000 });
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  page.setDefaultTimeout(10000);
  const session = await page.context().newCDPSession(page);
  await session.send("Debugger.enable");
  await session.send("Debugger.resume").catch(() => {});
  await session.send("Debugger.disable");
  console.log(JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, scripts: performance.getEntriesByType("resource").filter(r => r.name.includes(".js")).map(r => r.name) }))));
  if (process.argv.includes("--enter")) {
    const begin = page.getByText(/begin|start|play|enter/i).first();
    if (await begin.count()) await begin.click({ timeout: 5000 });
    else await page.mouse.click(640, 615);
    await page.waitForTimeout(2500);
  }
  if (process.argv.includes("--dismiss-intro")) {
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.click(980, 635); await page.waitForTimeout(550);
      await page.screenshot({ path: `${output}/intro-${i}.png`, timeout: 10000 });
    }
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${output}/current-reference.png`, timeout: 10000 });
  console.log(JSON.stringify({ url: page.url(), text: await page.locator("body").innerText({ timeout: 5000 }) }));
  await session.detach();
  process.exit(0);
}
if (process.argv.includes("--probe")) {
  // Source-bound one-shot instrumentation of our isolated reference page. No application files are changed.
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338");
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  const session = await page.context().newCDPSession(page);
  const retainedSource = await readFile(`${retained}/sources/files/origins/c8fb610f33ee0a3113993263066321d0fafb162d90da47955a8a7eb7ca0af7bd/assets/App3D-DwM1eiaC.js`, "utf8");
  const source = await page.evaluate(async () => {
    const response = await fetch("/assets/App3D-DwM1eiaC.js", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Reference source HTTP ${response.status}`);
    return response.text();
  });
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const sameSource = sourceHash === createHash("sha256").update(retainedSource).digest("hex");
  console.log(JSON.stringify({ sourceHash, sameSource }));
  const offset = source.indexOf('emit("character_broadcast_position"');
  const lineNumber = source.slice(0, offset).split("\n").length - 1;
  const columnNumber = offset - source.lastIndexOf("\n", offset) - 1;
  await session.send("Debugger.enable");
  const paused = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Source-bound player breakpoint was not reached")), 15000);
    session.once("Debugger.paused", async ({ callFrames }) => {
      try {
        const r = await session.send("Debugger.evaluateOnCallFrame", { callFrameId: callFrames[0].callFrameId, expression: "(window.__abetoMotion = {character:this.mesh,camera:this.mesh._camera}, true)", returnByValue: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
        clearTimeout(timeout); resolve(true);
      } catch (e) { clearTimeout(timeout); reject(e); }
    });
  });
  const bp = await session.send("Debugger.setBreakpointByUrl", { url: "https://messenger.abeto.co/assets/App3D-DwM1eiaC.js", lineNumber, columnNumber });
  await paused;
  await session.send("Debugger.removeBreakpoint", { breakpointId: bp.breakpointId });
  await session.send("Debugger.resume");
  await session.send("Debugger.disable");
  await session.detach();
  const identity = await page.evaluate(() => {
    const m = window.__abetoMotion.character, p = m._collisionPhysics;
    const bounds = m._geometryInfo[0].boundingBox;
    const c = window.__abetoMotion.camera;
    window.__abetoSamples = [];
    window.__abetoStage = "settle";
    window.__abetoInputEvents = [];
    window.__abetoKeyProbe = (e) => window.__abetoInputEvents.push({ t: performance.now(), type: e.type, key: e.key });
    addEventListener("keydown", window.__abetoKeyProbe); addEventListener("keyup", window.__abetoKeyProbe);
    window.__abetoSampling = true;
    const sample = (t) => {
      if (!window.__abetoSampling) return;
      const o = m._localObject;
      window.__abetoSamples.push({ t, stage: window.__abetoStage, p: o.position.toArray(), heading: o.rotationHorizontal, velocity: p._velocityPhysics.toArray(), speed: o.velocityHorizontal, weights: [...o.animationProps.weights], camera: c.position.toArray(), cameraTarget: c.baseTarget.toArray(), cameraTheta: c._spherical.theta });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return { height: bounds.max.y - bounds.min.y, clips: m._localObject.animationProps.actions.map((a) => ({ name: a._clip.name, duration: a._clip.duration, speed: a.timeScale })), physics: { force: p._positionForce, movingDamp: p._velPhysicsDamp, idleDamp: p._velPhysicsIdleDamp, directionLerp: p._directionLerp, substeps: p._substeps }, camera: { radius: c._followedMeshDistance, offset: c._followedMeshOffset.toArray(), targetLerp: c._cameraTargetWorldLerp, rotateLerp: c._cameraSphericalRotationLerp } };
  });
  const sequence = [["settle", [], 600], ["forward", ["w"], 1200], ["release", [], 850], ["right", ["d"], 850], ["release-right", [], 600], ["diagonal", ["w", "d"], 1000], ["release-diagonal", [], 600], ["sprint", ["w", "Shift"], 1200], ["release-sprint", [], 850], ["reverse", ["s"], 850], ["release-reverse", [], 650]];
  const actions = [];
  for (const [name, keys, duration] of sequence) {
    await page.evaluate((name) => { window.__abetoStage = name; }, name);
    const started = Date.now();
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    for (const key of keys) await page.keyboard.up(key);
    actions.push({ name, keys, duration, started, ended: Date.now() });
    if (!process.argv.includes("--timing")) await page.screenshot({ path: `${output}/probe-${name}.png` });
  }
  const { samples, inputs } = await page.evaluate(() => { window.__abetoSampling = false; removeEventListener("keydown", window.__abetoKeyProbe); removeEventListener("keyup", window.__abetoKeyProbe); return { samples: window.__abetoSamples, inputs: window.__abetoInputEvents }; });
  await writeFile(`${output}/${process.argv.includes("--timing") ? "live-timing" : "live-motion"}.json`, JSON.stringify({ source: "App3D-DwM1eiaC.js", sourceHash, sameSource, action_performer: "Playwright; source binding and timing are controlled observations, not a REA capture", breakpoint: { offset, lineNumber, columnNumber }, identity, actions, inputs, samples }, null, 2));
  console.log(JSON.stringify({ identity, samples: samples.length, actions: actions.length }));
  // Disconnect this CDP client; the first process owns and will terminate the reference browser.
  process.exit(0);
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--remote-debugging-port=9338", "--remote-debugging-address=127.0.0.1", ...(process.argv.includes("--native") ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(process.argv.includes("--no-video") ? {} : { recordVideo: { dir: output, size: { width: 1280, height: 720 } } }) });
const page = await context.newPage();
const log = [], errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__movementFrames = [];
  const frame = (t) => { window.__movementFrames.push(t); if (window.__movementFrames.length > 3600) window.__movementFrames.shift(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
});
await page.goto("https://messenger.abeto.co/");
await page.waitForTimeout(5000);
await page.screenshot({ path: `${output}/00-title.png` });
console.log(JSON.stringify({ ready: true, cdp: "http://127.0.0.1:9338", title: await page.title(), resources: await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes(".js")).map((r) => r.name)) }));
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const command = JSON.parse(line);
    if (command.action === "close") break;
    const started = Date.now();
    if (command.action === "click") await page.mouse.click(command.x, command.y);
    if (command.action === "move") {
      for (const key of command.keys) await page.keyboard.down(key);
      const count = command.samples ?? 1;
      for (let i = 0; i < count; i += 1) {
        await page.waitForTimeout(command.ms / count);
        await page.screenshot({ path: `${output}/${command.name}-${i}.png` });
      }
      for (const key of command.keys) await page.keyboard.up(key);
    }
    if (command.action === "sequence") {
      await page.evaluate(() => { window.__movementFrames = []; });
      for (const [index, step] of command.steps.entries()) {
        for (const key of step.keys ?? []) await page.keyboard.down(key);
        await page.waitForTimeout(step.ms);
        if (step.capture) await page.screenshot({ path: `${output}/${command.name}-${index}.png` });
        for (const key of step.keys ?? []) await page.keyboard.up(key);
      }
    }
    if (command.action === "inspect") console.log(JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, globals: Object.keys(window).filter((k) => /app|game|player|world|experience|three|scene/i.test(k)), scripts: [...document.scripts].map((s) => ({ src: s.src, type: s.type })) }))));
    if (command.action === "rig") console.log(JSON.stringify(await page.evaluate(() => {
      const motion = window.__abetoMotion;
      if (!motion) return { error: "run --probe after verifying source identity" };
      const root = motion.character._localObject.animationProps.mixer._root;
      return { bones: root.skeleton.bones.map((b) => ({ name: b.name, position: b.position.toArray() })), root: root.type };
    })));
    await page.waitForTimeout(command.settle ?? 200);
    const frames = await page.evaluate(() => window.__movementFrames.slice(-240));
    const record = { ...command, started, ended: Date.now(), frames };
    log.push(record);
    await page.screenshot({ path: `${output}/${command.name ?? `action-${log.length}`}.png` });
    await writeFile(`${output}/actions.json`, JSON.stringify({ url: page.url(), actions: log, errors, action_performer: "Playwright; REA observation is passive" }, null, 2));
    console.log(JSON.stringify({ done: command.action, name: command.name, elapsed: Date.now() - started, errors }));
  }
} finally {
  await context.close();
  await browser.close();
  console.log("Owned reference browser terminated.");
}
