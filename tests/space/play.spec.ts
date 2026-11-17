import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) => page.evaluate(() => JSON.parse((window as unknown as { render_game_to_text(): string }).render_game_to_text()));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
/**
 * The courier's position once `frames` more frames have been drawn. The game advances a fixed slice of time per frame,
 * so on a slow renderer (software rendering manages about one frame a second) a wall-clock wait says little about how
 * far the game has moved on; counting frames does.
 */
const positionAfterFrames = (page: Page, frames: number) => page.evaluate((count) => new Promise<number[]>((resolve) => {
  const win = window as unknown as { render_game_to_text(): string };
  let left = count;
  const tick = () => {
    left -= 1;
    if (left <= 0) resolve(JSON.parse(win.render_game_to_text()).courier.position);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), frames);

test("the island supports free walking, jumping, guide pause and return to overview", async ({ page }) => {
  // Counting frames is slow where frames are slow: leave room for a software renderer.
  test.setTimeout(180_000);
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
  // The guide stops the keys, not the fall: the jump above may still be landing, so first wait until the courier has
  // come to rest (three frames without moving), then hold W for three drawn frames and check it goes nowhere.
  let paused = await positionAfterFrames(page, 2);
  await expect.poll(async () => {
    const now = await positionAfterFrames(page, 3);
    const moved = distance(paused, now);
    paused = now;
    return moved;
  }, { intervals: [0], timeout: 90_000 }).toBeLessThan(0.001);
  await page.keyboard.down("w");
  const held = await positionAfterFrames(page, 3);
  await page.keyboard.up("w");
  expect(distance(paused, held)).toBeLessThan(0.05);
  await page.getByRole("button", { name: "Close guide" }).click();
  await page.getByRole("button", { name: /VIEW THE ISLAND/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-phase", "explore");
  expect((await state(page)).courier).toBeNull();
  expect(errors).toEqual([]);
});
