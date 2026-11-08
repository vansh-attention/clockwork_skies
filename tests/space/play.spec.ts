import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) => page.evaluate(() => JSON.parse((window as unknown as { render_game_to_text(): string }).render_game_to_text()));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

test("the island supports free walking, jumping, guide pause and return to overview", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: /TAKE A WALK/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-phase", "play");
  await expect.poll(async () => (await state(page)).courier?.mode).toBe("walk");
  await expect(page.getByRole("region", { name: "Current task" })).toHaveCount(0);
  expect((await state(page)).parts).not.toContain("courierPlane");
  const start = (await state(page)).courier.position;
  await page.keyboard.down("w");
  try { await expect.poll(async () => distance(start, (await state(page)).courier.position)).toBeGreaterThan(2); }
  finally { await page.keyboard.up("w"); }
  await page.evaluate(() => {
    const win = window as unknown as { render_game_to_text(): string; __islandJump: number };
    const floor = JSON.parse(win.render_game_to_text()).courier.position[1];
    win.__islandJump = 0;
    const until = performance.now() + 1500;
    const sample = () => {
      win.__islandJump = Math.max(win.__islandJump, JSON.parse(win.render_game_to_text()).courier.position[1] - floor);
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("Space"); await page.waitForTimeout(1600);
  expect(await page.evaluate(() => (window as unknown as { __islandJump: number }).__islandJump)).toBeGreaterThan(0.2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Guide" })).toBeVisible();
  const paused = (await state(page)).courier.position;
  await page.keyboard.down("w"); await page.waitForTimeout(400); await page.keyboard.up("w");
  expect(distance(paused, (await state(page)).courier.position)).toBeLessThan(0.05);
  await page.getByRole("button", { name: "Close guide" }).click();
  await page.getByRole("button", { name: /VIEW THE ISLAND/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-phase", "explore");
  expect((await state(page)).courier).toBeNull();
  expect(errors).toEqual([]);
});
