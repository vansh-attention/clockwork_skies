import { test, expect } from "@playwright/test";

test("two real browser pilots enter the same authoritative bot-filled match", async ({ browser, baseURL }) => {
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await first.newPage();
  const b = await second.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) {
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" || /GL_INVALID_OPERATION|missing fragment shader outputs/.test(message.text())) errors.push(message.text()); });
  }
  try {
    await Promise.all([a.goto(`${baseURL!}?mode=legacy-online`), b.goto(`${baseURL!}?mode=legacy-online`)]);
    await Promise.all([expect(a.getByRole("heading", { name: /clockwork.*skies/i })).toBeVisible(), expect(b.getByRole("heading", { name: /clockwork.*skies/i })).toBeVisible()]);
    await a.screenshot({ path: "test-results/title.png" });
    await a.getByLabel("CALLSIGN", { exact: true }).fill("TEST ALPHA");
    await b.getByLabel("CALLSIGN", { exact: true }).fill("TEST BRAVO");
    await Promise.all([a.getByRole("button", { name: /enter the skies/i }).click(), b.getByRole("button", { name: /enter the skies/i }).click()]);
    await Promise.all([expect(a.locator("main.in-flight")).toBeVisible(), expect(b.locator("main.in-flight")).toBeVisible()]);
    await expect(a.locator("main")).toHaveAttribute("data-room-id", /.+/);
    await expect(b.locator("main")).toHaveAttribute("data-room-id", /.+/);
    const roomA = await a.locator("main").getAttribute("data-room-id");
    const roomB = await b.locator("main").getAttribute("data-room-id");
    expect(roomA).toBe(roomB);
    expect(await a.locator("main").getAttribute("data-player-id")).not.toBe(await b.locator("main").getAttribute("data-player-id"));
    await expect(a.locator("main")).toHaveAttribute("data-phase", /deploying|open|closing-1|closing-2|close-combat|final|complete/, { timeout: 45_000 });
    await expect(a.locator(".counter strong")).toHaveText("16");
    await expect(b.locator(".counter strong")).toHaveText("16");
    await a.screenshot({ path: "test-results/cockpit.png" });
    await expect(a.locator("main")).toHaveAttribute("data-phase", /open|closing-1|closing-2|close-combat|final|complete/, { timeout: 25_000 });
    const canvas = a.locator("canvas");
    await a.bringToFront();
    await canvas.click({ position: { x: 720, y: 450 } });
    await a.mouse.down();
    const heat = a.locator(".left-instruments .instrument").filter({ hasText: "CANNON HEAT" }).locator("strong");
    await expect.poll(async () => Number.parseFloat(await heat.innerText())).toBeGreaterThan(0);
    await a.mouse.up();
    await a.keyboard.down("Space");
    const boost = a.locator(".left-instruments .instrument").filter({ hasText: "BOOST" }).locator("strong");
    await expect.poll(async () => Number.parseFloat(await boost.innerText())).toBeLessThan(99);
    await a.keyboard.up("Space");
    await a.keyboard.press("q");
    await a.keyboard.press("1");
    await a.evaluate(() => document.exitPointerLock());
    await a.getByRole("button", { name: /flight manual/i }).click();
    await expect(a.getByRole("region", { name: /flight manual/i })).toBeVisible();
    await a.screenshot({ path: "test-results/manual.png" });
    await a.getByRole("button", { name: /close flight manual/i }).click();
    await a.keyboard.press("q");
    await a.keyboard.press("1");
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ room: roomA, distinctPilots: true, playerCount: 16, browserErrors: errors.length }));
  } finally {
    if (errors.length) console.error(JSON.stringify({ browserErrors: errors }));
    await first.close();
    await second.close();
  }
});
