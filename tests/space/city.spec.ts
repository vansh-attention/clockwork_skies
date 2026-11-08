import { test, expect } from "@playwright/test";

test("the painted London island visits all eight places without clockwork or a backend", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/?debug=1");
  await expect(page).toHaveTitle("Little London");
  await expect(page.getByRole("heading", { name: /little.*london/i })).toBeVisible();
  await expect(page.getByText("TOWN CLOCK")).toHaveCount(0);
  await page.getByRole("button", { name: "VIEW THE ISLAND", exact: true }).click();
  const districts = page.getByRole("navigation", { name: "Districts" }).getByRole("button");
  await expect(districts).toHaveCount(8);
  for (const [i, name] of ["Regent's Park", "St Paul's", "Tower Wharf", "Battersea", "Westminster", "Kew Gardens", "Covent Garden", "Bloomsbury"].entries()) {
    await districts.nth(i).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".district-card")).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse((window as unknown as { render_game_to_text(): string }).render_game_to_text()));
  expect(state.population).toBe(32);
  expect(state.parts).toContain("Little London island");
  expect(state.parts.join(" ")).not.toMatch(/Clockwork hill town|Lanternfall|Launchers/);
  expect(state.calls).toBeGreaterThan(1);
  expect(state.objective).toBeNull();
  expect(errors).toEqual([]);
  expect(requests.some((url) => /:2567|\/api\//.test(url))).toBe(false);
});
