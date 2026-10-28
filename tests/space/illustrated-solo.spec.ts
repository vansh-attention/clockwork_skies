import { test, expect } from "@playwright/test";

test("illustrated globe launches and flies with the client alone", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /clockwork.*skies/i })).toBeVisible();
  await expect(page.getByLabel("ROOM ACCESS CODE")).toHaveCount(0);
  await page.getByRole("button", { name: /enter the skies/i }).click();
  await expect(page.locator("main.in-flight")).toHaveAttribute("data-player-id", "local-pilot");
  await expect(page.getByText("FREE FLIGHT")).toBeVisible();
  const speed = page.locator(".right-instruments").locator("strong").last();
  await expect.poll(async () => Number.parseFloat(await speed.innerText())).toBeGreaterThan(30);
  await page.keyboard.down("Space");
  const boost = page.locator(".left-instruments .instrument").filter({ hasText: "BOOST" }).locator("strong");
  await expect.poll(async () => Number.parseFloat(await boost.innerText())).toBeLessThan(99);
  await page.keyboard.up("Space");
  expect(requests.some(url => /:2567|\/api\/|ws:/i.test(url))).toBe(false);
});
