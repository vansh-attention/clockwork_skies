import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

// Real WebGL readback: every sampled visible surface must match the nearest raycast hit,
// even when foliage, masonry and clothing intersect across the camera-to-player sight line.
// Run against the local Vite server: node tools/london-character-check.mjs [URL]
const motionCheck = process.argv.includes("--motion");
const native = process.argv.includes("--native");
const output = motionCheck ? "artifacts/cute-courier-motion" : "artifacts/character-intersections";
await mkdir(output, { recursive: true });
const browser = await chromium.launch(native ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--enable-unsafe-swiftshader"] } : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...(motionCheck ? { recordVideo: { dir: output, size: { width: 1280, height: 800 } } } : {}) });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.goto(process.argv.slice(2).find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:5173/?debug=1");
  await page.getByRole("button", { name: /TAKE A WALK/ }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).courier?.mode === "walk");
  await page.waitForFunction(() => {
    const { camera, courier } = JSON.parse(window.render_game_to_text());
    return courier && Math.hypot(...camera.map((v, i) => v - courier.position[i])) < 25 && camera[1] - courier.position[1] < 12;
  });
  await page.screenshot({ path: `${output}/playable-rear.png` });
  const start = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await page.keyboard.down("w");
  await page.waitForTimeout(550);
  await page.screenshot({ path: `${output}/playable-walking.png` });
  await page.keyboard.up("w");
  const walked = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  let motion = null;
  if (motionCheck) {
    await page.evaluate(() => {
      window.__localMotion = []; window.__motionStage = "settle"; window.__motionSampling = true;
      const sample = (t) => {
        if (!window.__motionSampling) return;
        const state = JSON.parse(window.render_game_to_text());
        window.__localMotion.push({ t, stage: window.__motionStage, position: state.courier?.position, camera: state.camera });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const [stage, keys, duration] of [["settle", [], 700], ["forward", ["w"], 600], ["release", [], 700], ["right", ["d"], 500], ["release-right", [], 500], ["diagonal", ["w", "d"], 600], ["release-diagonal", [], 600], ["sprint", ["w", "Shift"], 700], ["release-sprint", [], 700], ["reverse", ["s"], 650], ["release-reverse", [], 600]]) {
      await page.evaluate((stage) => { window.__motionStage = stage; }, stage);
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(duration);
      for (const key of keys) await page.keyboard.up(key);
    }
    await page.keyboard.press("Space");
    await page.waitForTimeout(800);
    motion = await page.evaluate(() => { window.__motionSampling = false; return { samples: window.__localMotion, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }; });
    await page.screenshot({ path: `${output}/after-motion.png` });
  }
  await page.mouse.move(400, 420);
  await page.mouse.down();
  await page.mouse.move(970, 420, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/playable-front.png` });

  const proof = await page.evaluate(async (root) => {
    const resource = performance.getEntriesByType("resource").find((r) => /\/three\.js\?/.test(r.name));
    const T = await import(resource.name);
    const { Palette } = await import("/src/city/kit.ts");
    const { createCourierModel, animateCourier } = await import("/src/courier/models.ts");
    const { createGait, updateGait, gaitPose, createPose } = await import("/src/courier/gait.ts");
    const { IllustratedComposer, illustratedEnvironment } = await import(`/@fs${root}/packages/render/dist/index.js`);
    const palette = new Palette();
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(46, 1, 0.15, 100);
    const renderer = new T.WebGLRenderer({ antialias: false });
    renderer.setSize(512, 512);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.setClearColor(0xe4ddc9, 1);
    const target = new T.WebGLRenderTarget(128, 128, { count: 2 });
    const solids = [];
    for (const [key, position, size] of [
      ["leaf0", [0, 2, 2], [2, 2, 2]],
      ["wall1", [1.4, 2, 1.6], [2, 3, 2]],
      ["stone", [-1, 1, 0.5], [2.4, 2, 2.3]],
      ["coat", [0.3, 2, -0.3], [1.6, 3.5, 1.4]],
    ]) {
      const geometry = key === "leaf0" ? new T.SphereGeometry(2, 32, 20) : new T.BoxGeometry(...size);
      const mesh = new T.Mesh(geometry, palette.get(key));
      mesh.material.uniforms.uFocus.value.set(0, 2, 0);
      mesh.material.uniforms.uSeeThrough.value = 3.2;
      mesh.position.set(...position);
      solids.push(mesh);
      scene.add(mesh);
    }
    // Deliberately recreate the old walking uniform. Default foliage must remain solid anyway.
    illustratedEnvironment.uFocus.value.set(0, 2, 0);
    illustratedEnvironment.uSeeThrough.value = 3.2;
    const pixels = new Uint8Array(128 * 128 * 4);
    const ray = new T.Raycaster();
    const views = [];
    for (const position of [[0, 2, 8], [6, 3, 7], [-6, 3, 7], [0, 5, -8]]) {
      camera.position.set(...position);
      camera.lookAt(0, 2, 1);
      camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
      let samples = 0;
      const missing = [];
      const materials = new Set();
      for (let y = 13; y < 116; y += 6) for (let x = 13; x < 116; x += 6) {
        ray.setFromCamera(new T.Vector2((x + 0.5) / 128 * 2 - 1, (y + 0.5) / 128 * 2 - 1), camera);
        const hit = ray.intersectObjects(solids, false)[0];
        if (!hit) continue;
        // Reject silhouette/triangle coverage boundaries: GPU rasterization and a floating-point
        // ray can choose opposite sides of an edge. A one-pixel interior footprint must agree.
        const interior = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].every(([sx, sy]) => {
          ray.setFromCamera(new T.Vector2((sx + 0.5) / 128 * 2 - 1, (sy + 0.5) / 128 * 2 - 1), camera);
          return ray.intersectObjects(solids, false)[0]?.object === hit.object;
        });
        if (!interior) continue;
        const expected = Math.round(hit.object.material.uniforms.uSurfaceId.value * 255);
        const actual = pixels[(y * 128 + x) * 4 + 3];
        samples += 1;
        materials.add(expected);
        if (Math.abs(expected - actual) > 1) missing.push({ x, y, expected, actual });
      }
      views.push({ position, samples, materials: [...materials], missing });
    }
    // Positive control: the former default leaf define must reproduce the hole in this fixture.
    // Otherwise a passing readback could be testing a view that never exercises the original bug.
    camera.position.set(0, 2, 8); camera.lookAt(0, 2, 1); camera.updateMatrixWorld(true);
    const leaf = solids[0].material;
    leaf.defines.ILLUSTRATED_SEE_THROUGH = "";
    leaf.needsUpdate = true;
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
    const cutout = pixels[(64 * 128 + 64) * 4 + 3];
    delete leaf.defines.ILLUSTRATED_SEE_THROUGH;
    leaf.needsUpdate = true;
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
    const solid = pixels[(64 * 128 + 64) * 4 + 3];
    const regression = { cutout, solid, expected: Math.round(leaf.uniforms.uSurfaceId.value * 255) };
    target.dispose();
    renderer.setRenderTarget(null);
    const composer = new IllustratedComposer(renderer);
    composer.resize(512, 512);
    composer.setThickness(0.7);
    camera.position.set(6, 3, 7); camera.lookAt(0, 2, 1);
    composer.render(scene, camera);
    renderer.domElement.className = "render-proof";
    renderer.domElement.style.cssText = "position:fixed;inset:0;margin:auto;z-index:9999;width:700px;height:700px;background:#e4ddc9";
    document.body.append(renderer.domElement);
    const character = createCourierModel(palette, true);
    const floor = new T.Mesh(new T.CircleGeometry(3.3, 64), palette.get("paving"));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02;
    const portrait = new T.Scene();
    portrait.add(character.group, floor);
    const pose = createPose();
    const show = (angle, mode) => {
      if (mode === "idle") animateCourier(character, createPose(), 0, true);
      else {
        const gait = createGait();
        for (let i = 0; i < 70; i += 1) updateGait(gait, { dt: 1 / 60, distance: 9 / 60, speed: 9, heading: 0, y: 0, reduced: false, airborne: mode === "jump" });
        animateCourier(character, gaitPose(gait, pose), 1);
      }
      camera.position.set(Math.sin(angle) * 9, 3.7, -Math.cos(angle) * 9);
      camera.lookAt(0, 2.5, 0);
      composer.render(portrait, camera);
    };
    window.__characterProof = { show, renderer, composer, camera, scene, portrait };
    return { views, regression, character: { height: new T.Box3().setFromObject(character.group).getSize(new T.Vector3()).y, meshes: (() => {let n=0;character.group.traverse(o=>{if(o.isMesh)n++;});return n;})() } };
  }, process.cwd());
  await page.locator(".render-proof").screenshot({ path: `${output}/intersections.png` });
  for (const [name, angle, pose] of [["front", 0, "idle"], ["three-quarter", 0.65, "idle"], ["rear", Math.PI - 0.45, "idle"], ["stride", 0.65, "walk"], ["jump-pose", 0.65, "jump"]]) {
    await page.evaluate(({ angle, pose }) => window.__characterProof.show(angle, pose), { angle, pose });
    await page.locator(".render-proof").screenshot({ path: `${output}/character-${name}.png` });
  }
  const gpu = await page.evaluate(() => { const gl = document.querySelector("canvas").getContext("webgl2"); const extension = gl?.getExtension("WEBGL_debug_renderer_info"); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unavailable"; });
  const report = { start, walked, ...proof, motion, gpu, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (proof.views.some((view) => view.samples < 40 || view.missing.length)) throw new Error("Intersecting surfaces disappeared; inspect report.json");
  if (proof.regression.cutout === proof.regression.expected || proof.regression.solid !== proof.regression.expected) throw new Error("Disappearance regression control did not reproduce and resolve the original defect");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  if (Math.hypot(...start.courier.position.map((n, i) => n - walked.courier.position[i])) < 1) throw new Error("Character did not walk");
  console.log(`Character + four rendered intersection views verified; ${proof.views.reduce((n, view) => n + view.samples, 0)} visible-surface samples matched nearest geometry.`);
} finally {
  await browser.close();
}
