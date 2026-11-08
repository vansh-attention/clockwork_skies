import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

// Owned reference browser. Commands on stdin declare every action; REA attaches passively to port 9338.
const output = ".claude/abeto-messenger/movement-reference";
await mkdir(output, { recursive: true });
if (process.argv.includes("--probe")) {
  // Source-bound one-shot instrumentation of our isolated reference page. No application files are changed.
  const remote = await chromium.connectOverCDP("http://127.0.0.1:9338");
  const page = remote.contexts()[0].pages().find((p) => p.url().startsWith("https://messenger.abeto.co/"));
  const session = await page.context().newCDPSession(page);
  const source = await readFile(`${output}/sources/files/origins/c8fb610f33ee0a3113993263066321d0fafb162d90da47955a8a7eb7ca0af7bd/assets/App3D-DwM1eiaC.js`, "utf8");
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
  await writeFile(`${output}/${process.argv.includes("--timing") ? "live-timing" : "live-motion"}.json`, JSON.stringify({ source: "App3D-DwM1eiaC.js", breakpoint: { offset, lineNumber, columnNumber }, identity, actions, inputs, samples }, null, 2));
  console.log(JSON.stringify({ identity, samples: samples.length, actions: actions.length }));
  // Disconnect this CDP client; the first process owns and will terminate the reference browser.
  process.exit(0);
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--remote-debugging-port=9338", "--remote-debugging-address=127.0.0.1", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
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
