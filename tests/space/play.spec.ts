import { test, expect, type Locator, type Page } from "@playwright/test";

type CourierDiagnostics = {
  mode: "walk" | "fly";
  position: number[];
  taskId: string | null;
  stepIndex: number;
  done: boolean;
  prompt: string | null;
};
type CityDiagnostics = { mode: string; courier: CourierDiagnostics | null };
type DebugWindow = Window & {
  __CLOCKWORK_CITY__?: () => CityDiagnostics;
  __CLOCKWORK_COURIER__?: { teleportToObjective: () => void };
};

const diagnostics = (page: Page) => page.evaluate(() => (window as DebugWindow).__CLOCKWORK_CITY__?.() ?? null);
const courierOf = async (page: Page) => (await diagnostics(page))?.courier ?? null;
/** The courier diagnostics, or a clear failure when the debug hooks are missing or play is not running. */
async function requireCourier(page: Page): Promise<CourierDiagnostics> {
  const diag = await diagnostics(page);
  if (!diag) throw new Error("window.__CLOCKWORK_CITY__ is missing: load the page with ?debug=1");
  if (!diag.courier) throw new Error(`No courier diagnostics: the city is in mode "${diag.mode}", not play`);
  return diag.courier;
}
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));

/** Press Space and return how high the courier rose, sampled every frame in the page (a hop lasts about 0.6 s). */
async function hopHeight(page: Page): Promise<number> {
  await page.evaluate(() => {
    const read = () => (window as DebugWindow).__CLOCKWORK_CITY__?.()?.courier?.position[1] ?? 0;
    const ground = read();
    const probe = window as unknown as { __hop?: number };
    probe.__hop = 0;
    const end = performance.now() + 1500;
    const sample = () => {
      probe.__hop = Math.max(probe.__hop ?? 0, read() - ground);
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("Space");
  await page.waitForTimeout(1600);
  return page.evaluate(() => (window as unknown as { __hop?: number }).__hop ?? 0);
}

/** Whether a real mousedown on `button` is cancelled (so it cannot move keyboard focus onto the button). */
const mouseDownPrevented = (button: Locator) => button.evaluate((element) => {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
  element.dispatchEvent(event);
  return event.defaultPrevented;
});

async function holdKey(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test("the courier walks, picks up a parcel, suspends under the guide and leaves play cleanly", async ({ page }, testInfo) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /GL_INVALID_OPERATION|missing fragment shader outputs/.test(message.text())) errors.push(message.text());
  });

  await page.goto("/?debug=1");
  await page.getByRole("button", { name: /start the round/i }).click();
  await expect(page.locator("main[data-phase='play']")).toBeVisible();

  await expect.poll(async () => (await courierOf(page))?.taskId).toBe("market-parcel");
  const start = await requireCourier(page);
  expect(start.mode).toBe("walk");
  expect(start.stepIndex).toBe(0);

  const panel = page.getByRole("region", { name: "Current task" });
  await expect(panel.getByText("TASK 1 OF 3")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Market parcel" })).toBeVisible();

  // Walk with W; clicking the canvas must focus it without opening a district card.
  const canvas = page.locator("canvas");
  await canvas.click();
  await expect(page.getByRole("heading", { name: "The Bell Observatory" })).toHaveCount(0);
  await expect(page.locator(".district-card")).toHaveCount(0);
  const before = (await requireCourier(page)).position;
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => distance(before, (await requireCourier(page)).position)).toBeGreaterThan(3);
  } finally {
    await page.keyboard.up("w");
  }
  await expect(page.locator(".district-card")).toHaveCount(0);
  await testInfo.attach("play-walking", { body: await page.screenshot(), contentType: "image/png" });

  // Move next to the pickup and act.
  await page.evaluate(() => (window as DebugWindow).__CLOCKWORK_COURIER__?.teleportToObjective());
  const prompt = page.locator(".courier-prompt");
  await expect(prompt).toContainText("E");
  await expect(prompt).toContainText("Pick up parcel");
  await page.keyboard.press("e");
  await expect.poll(async () => (await courierOf(page))?.stepIndex).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: /picked up/i })).toBeVisible();

  // A mouse press on the HUD's GUIDE button never takes focus from the town (the click still opens the guide).
  expect(await mouseDownPrevented(page.getByRole("button", { name: "GUIDE", exact: true }))).toBe(true);

  // The open guide suspends the courier, and Esc closes it.
  await page.getByRole("button", { name: "GUIDE", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Guide" });
  await expect(guide).toBeVisible();
  const parked = (await requireCourier(page)).position;
  await holdKey(page, "w", 800);
  expect(distance(parked, (await requireCourier(page)).position)).toBeLessThan(0.05);
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);

  // Closing a guide opened from its button hands focus back to the town, so W walks and Space jumps straight away.
  await expect(canvas).toBeFocused();
  expect(await hopHeight(page)).toBeGreaterThan(0.6);
  const resumed = (await requireCourier(page)).position;
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => distance(resumed, (await requireCourier(page)).position)).toBeGreaterThan(3);
  } finally {
    await page.keyboard.up("w");
  }

  // Leave through the guide.
  await page.getByRole("button", { name: "GUIDE", exact: true }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "BACK TO TITLE" }).click();
  await expect(page.locator("main[data-phase='title']")).toBeVisible();
  await expect.poll(async () => (await diagnostics(page))?.courier ?? null).toBeNull();
  expect((await diagnostics(page))?.mode).not.toBe("play");

  expect(errors).toEqual([]);
  expect(requests.some((url) => /:2567|\/api\/|^wss?:/i.test(url))).toBe(false);
});
