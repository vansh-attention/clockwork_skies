import { test, expect } from "@playwright/test";

test("local space opens without multiplayer services", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose your flight" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch training" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(requests.some(url => /\/api\/|:2567|ws:/i.test(url))).toBe(false);
});

test("keyboard flight starts and pauses intentionally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Keyboard flight" }).click();
  await expect(page.locator("main[data-phase='playing']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("main[data-phase='paused']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume keyboard flight" })).toBeVisible();
});
