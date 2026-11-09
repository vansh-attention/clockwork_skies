import { test, expect } from "@playwright/test";

test("the small-island title keeps phone controls visible and supports keyboard entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?debug=1");
  for (const name of [/TAKE A WALK/, /^VIEW THE ISLAND$/, /^GUIDE/]) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(box!.height).toBeGreaterThanOrEqual(36);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: /TAKE A WALK/ }).focus(); await page.keyboard.press("Enter");
  await expect(page.locator("main")).toHaveAttribute("data-phase", "play");
  await expect(page.getByRole("button", { name: /^GUIDE/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Guide" })).toBeVisible();
  await expect(page.getByText(/oil|launch|sky flight/i)).toHaveCount(0);
});
