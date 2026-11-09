import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

// Repeatable rendered review of every London district, at desktop and phone sizes.
// Run alongside npm run dev: node tools/london-visual-tour.mjs [preview URL]
const url = process.argv[2] ?? "http://127.0.0.1:5173/?debug=1";
const output = "artifacts/little-london/tour";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
const review = [];
try {
  await page.addInitScript(() => localStorage.setItem("clockwork-reduced-motion", "true"));
  await page.goto(url);
  await page.locator("canvas").waitFor();
  await page.waitForFunction(() => (window.__CLOCKWORK_CITY__?.().calls ?? 0) > 0);
  await page.screenshot({ path: `${output}/00-title-desktop.png` });
  await page.getByRole("button", { name: "VIEW THE ISLAND", exact: true }).click();
  const districts = page.getByRole("navigation", { name: "Districts" }).getByRole("button");
  for (let i = 0; i < await districts.count(); i += 1) {
    await districts.nth(i).click();
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    review.push({ name: await page.locator(".district-card h2").innerText(), state });
    await page.screenshot({ path: `${output}/${String(i + 1).padStart(2, "0")}-district.png` });
  }
  await page.getByRole("button", { name: "GUIDE", exact: true }).click();
  await page.getByRole("button", { name: "BACK TO TITLE", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/09-title-phone.png` });
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth > innerWidth,
    controls: [...document.querySelectorAll(".launch,.look-around,.title-manual")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, width: r.width, height: r.height, withinViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    }),
  }));
  review.push({ mobile: overflow });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /TAKE A WALK/ }).click();
  await page.waitForFunction(() => window.__CLOCKWORK_CITY__?.().courier?.mode === "walk");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/10-walking.png` });
  await page.keyboard.down("w");
  await page.waitForTimeout(650);
  await page.keyboard.up("w");
  await page.screenshot({ path: `${output}/11-street.png` });
  if (await page.getByRole("region", { name: "Current task" }).count()) throw new Error("Retired clockwork objectives are visible");
  review.push({ play: await page.evaluate(() => JSON.parse(window.render_game_to_text())) });
  await writeFile(`${output}/review.json`, JSON.stringify({ url, errors, review }, null, 2));
  if (errors.length || overflow.width || overflow.controls.some((control) => !control.withinViewport || control.height < 36)) {
    throw new Error(`London visual tour failed; inspect ${output}/review.json`);
  }
  console.log(`Captured eight London places, mobile title and free walking in ${output}; no browser errors.`);
} finally {
  await browser.close();
}
