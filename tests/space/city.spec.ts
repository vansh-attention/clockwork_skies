import { test, expect } from "@playwright/test";

type CityDiagnostics = { mode: string; focused: number | null; calls: number; triangles: number; parts: string[] };

test("the hill town opens, visits a district and returns to the overview with the client alone", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /GL_INVALID_OPERATION|missing fragment shader outputs/.test(message.text())) errors.push(message.text());
  });

  await page.goto("/?debug=1");
  await expect(page.getByRole("heading", { name: /clockwork.*skies/i })).toBeVisible();
  await expect(page.getByText("TOWN CLOCK")).toBeVisible();
  await page.getByRole("button", { name: /look around/i }).click();
  await expect(page.locator("main[data-phase='explore']")).toBeVisible();

  const districts = page.getByRole("navigation", { name: "Districts" }).getByRole("button");
  await expect(districts).toHaveCount(8);
  await page.getByRole("button", { name: /bell observatory/i }).click();
  await expect(page.getByRole("heading", { name: "The Bell Observatory" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-district", "landmark-2");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "The Bell Observatory" })).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute("data-district", /.+/);

  const diagnostics = await page.evaluate(() => (window as unknown as { __CLOCKWORK_CITY__?: () => CityDiagnostics }).__CLOCKWORK_CITY__?.());
  expect(diagnostics?.mode).toBe("explore");
  expect(diagnostics?.calls ?? 0).toBeGreaterThan(1);
  expect(diagnostics?.triangles ?? 0).toBeGreaterThan(1000);
  // The second island, the home launcher and both landing gates are part of the world, not just the flight maths.
  expect(diagnostics?.parts).toEqual(expect.arrayContaining(["Clockwork hill town", "Lanternfall Isle", "Launchers and gates"]));
  expect(errors).toEqual([]);
  expect(requests.some((url) => /:2567|\/api\/|ws:/i.test(url))).toBe(false);
});
