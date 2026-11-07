import { test, expect, type Page, type TestInfo } from "@playwright/test";

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

/** The courier diagnostics, or a clear failure when the debug hooks are missing or play is not running. */
async function courierOf(page: Page): Promise<CourierDiagnostics> {
  const diag = await page.evaluate(() => (window as DebugWindow).__CLOCKWORK_CITY__?.() ?? null);
  if (!diag) throw new Error("window.__CLOCKWORK_CITY__ is missing: load the page with ?debug=1");
  if (!diag.courier) throw new Error(`No courier diagnostics: the city is in mode "${diag.mode}", not play`);
  return diag.courier;
}

const teleport = (page: Page) => page.evaluate(() => (window as DebugWindow).__CLOCKWORK_COURIER__?.teleportToObjective());
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

/** Teleport to the current step, wait for its prompt, press E. */
async function act(page: Page, action: RegExp) {
  await teleport(page);
  const prompt = page.locator(".courier-prompt");
  await expect(prompt.locator("kbd")).toHaveText("E");
  await expect(prompt).toContainText(action);
  await page.keyboard.press("e");
}

test("the courier plays a whole round: parcel, escapement, letter to Lanternfall", async ({ page }, testInfo) => {
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
  await expect.poll(async () => (await courierOf(page)).taskId).toBe("market-parcel");
  const start = await courierOf(page);
  expect(start.mode).toBe("walk");
  expect(start.stepIndex).toBe(0);
  const panel = page.getByRole("region", { name: "Current task" });
  await expect(panel.getByText("TASK 1 OF 3")).toBeVisible();

  // Walk a little with W.
  await page.locator("canvas").click();
  const before = (await courierOf(page)).position;
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => distance(before, (await courierOf(page)).position)).toBeGreaterThan(3);
  } finally {
    await page.keyboard.up("w");
  }
  await shot(page, testInfo, "1-walking");

  // Task 1: market parcel.
  await act(page, /pick up parcel/i);
  await expect.poll(async () => (await courierOf(page)).stepIndex).toBe(1);
  await expect(page.getByRole("status")).toHaveText(/picked up/i);
  await act(page, /deliver parcel/i);
  await expect.poll(async () => (await courierOf(page)).taskId).toBe("oil-escapement");
  await expect(page.getByRole("status")).toHaveText(/market parcel complete/i);
  await expect(panel.getByText("TASK 2 OF 3")).toBeVisible();

  // Task 2: oil the escapement, pressing just after each whole second.
  await teleport(page);
  await expect(page.locator(".courier-prompt")).toContainText(/oil on the tick/i);
  await shot(page, testInfo, "2-tick-prompt");
  let tries = 0;
  while ((await courierOf(page)).taskId === "oil-escapement") {
    if (++tries > 12) throw new Error("the escapement was not oiled in 12 presses");
    await page.waitForFunction(() => {
      const phase = Date.now() % 1000;
      return phase >= 20 && phase <= 150;
    }, undefined, { polling: 5 });
    await page.keyboard.press("e");
    // Leave this tick's window so the next press is a separate beat.
    await page.waitForFunction(() => Date.now() % 1000 > 300, undefined, { polling: 5 });
  }
  await expect.poll(async () => (await courierOf(page)).taskId).toBe("lanternfall-letter");
  await expect(panel.getByText("TASK 3 OF 3")).toBeVisible();

  // Task 3: collect the letter, launch, fly through Lanternfall's gate, deliver.
  await act(page, /collect letter/i);
  await expect.poll(async () => (await courierOf(page)).stepIndex).toBe(1);
  await expect(page.getByRole("status")).toHaveText(/picked up/i);
  await act(page, /launch/i);
  await expect.poll(async () => (await courierOf(page)).mode).toBe("fly");
  await expect(page.getByLabel("Flight instruments")).toBeVisible();
  await expect.poll(async () => (await courierOf(page)).position[1] ?? 0).toBeGreaterThan(50);
  await shot(page, testInfo, "3-mid-flight");

  await teleport(page);
  await expect.poll(async () => (await courierOf(page)).mode).toBe("walk");
  await expect.poll(async () => (await courierOf(page)).stepIndex).toBe(3);
  await expect(panel.getByRole("listitem").filter({ hasText: "Deliver the letter to the lighthouse keeper" })).toHaveAttribute("aria-current", "step");
  await act(page, /deliver letter/i);

  // Round complete.
  const card = page.locator(".courier-complete");
  await expect(card.getByRole("heading", { name: /round complete/i })).toBeVisible();
  await expect(card.getByRole("button", { name: "START AGAIN" })).toBeVisible();
  await expect(card.getByRole("button", { name: "LOOK AROUND" })).toBeVisible();
  expect((await courierOf(page)).done).toBe(true);
  await shot(page, testInfo, "4-round-complete");

  // Mouse presses on the card's buttons never take focus from the town.
  for (const name of ["START AGAIN", "LOOK AROUND"]) {
    const prevented = await card.getByRole("button", { name }).evaluate((element) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  }

  // Start again with the mouse: the keyboard is the town's at once (no stray focus on a button eating W or Space).
  await card.getByRole("button", { name: "START AGAIN" }).click();
  await expect(card).toBeHidden();
  await expect.poll(async () => (await courierOf(page)).stepIndex).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("CANVAS");
  const restart = (await courierOf(page)).position;
  await page.keyboard.press("Space");
  await page.keyboard.down("w");
  await expect.poll(async () => distance((await courierOf(page)).position, restart)).toBeGreaterThan(2);
  await page.keyboard.up("w");

  expect(errors).toEqual([]);
  expect(requests.filter((url) => /:2567|\/api\/|^wss?:/i.test(url))).toEqual([]);
});
