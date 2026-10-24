#!/usr/bin/env node
import { chromium } from "@playwright/test";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const [key, value = "true"] = process.argv[i].split("=", 2);
  args.set(key.replace(/^--/, ""), value);
}
const quality = args.get("quality") === "low" ? "low" : "medium";
const drones = Math.max(1, Math.min(6, Number(args.get("drones") ?? 6)));
const port = args.get("port") ?? "4175";
const expected = quality === "low" ? [1280, 720] : [1920, 1080];
const seconds = Number(args.get("seconds") ?? 60);
const url = `http://127.0.0.1:${port}/?mode=local-space&benchmark=1&drones=${drones}&debug=1`;

if (process.env.PLAYWRIGHT_CHANNEL === "" || /swiftshader/i.test(process.env.PLAYWRIGHT_ARGS ?? "")) {
  throw new Error("Native benchmark refuses SwiftShader configuration");
}
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: expected[0], height: expected[1] }, deviceScaleFactor: 1 });
const errors = [];
const networkResourceFailures = [];
const browserResourceWarnings = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() !== "error") return;
  const source = message.location();
  errors.push(source.url ? `${message.text()} (${source.url}:${source.lineNumber}:${source.columnNumber})` : message.text());
  const resourceError = /^Failed to load resource: (.+)/.exec(message.text());
  if (resourceError && source.url) {
    const status = /status of (\d{3})/.exec(resourceError[1]);
    browserResourceWarnings.push({
      url: source.url, ...(status ? { status: Number(status[1]) } : { error: resourceError[1] }), source: "browser-console",
    });
  }
});
page.on("response", response => {
  if (response.status() < 400) return;
  const request = response.request();
  networkResourceFailures.push({
    method: request.method(), url: request.url(), resourceType: request.resourceType(), status: response.status(), source: "page-network",
  });
});
page.on("requestfailed", request => {
  networkResourceFailures.push({
    method: request.method(), url: request.url(), resourceType: request.resourceType(),
    error: request.failure()?.errorText ?? "Unknown network error", source: "page-network",
  });
});
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Keyboard flight" }).click();
  await page.waitForTimeout(5000);
  await page.waitForTimeout(seconds * 1000);
  const measured = await page.evaluate(() => window.__CLOCKWORK_SPACE__?.());
  if (!measured) throw new Error("No benchmark diagnostics exposed");
  const failures = [];
  if (measured.phase !== "playing") failures.push(`phase=${measured.phase}`);
  if (!measured.driverRunning) failures.push("driver not running");
  if (!measured.visible) failures.push("page not visible");
  if (measured.pauseCount !== 0) failures.push(`pauses=${measured.pauseCount}`);
  if (measured.width !== expected[0] || measured.height !== expected[1]) failures.push(`buffer=${measured.width}x${measured.height}`);
  if (measured.timing.medianMs <= 0 || measured.timing.p95Ms <= 0) failures.push("invalid frame timing");
  if (measured.timing.frames < seconds * 30) failures.push(`too few frames=${measured.timing.frames}`);
  const failedResourceRequests = [...networkResourceFailures, ...browserResourceWarnings.filter(warning =>
    !networkResourceFailures.some(failure => failure.url === warning.url &&
      (warning.status === undefined || failure.status === warning.status)))];
  if (failedResourceRequests.length) failures.push(`failed resource requests=${failedResourceRequests.length}`);
  const result = { quality, drones, seconds, expectedBuffer: expected, measured, errors, failedResourceRequests,
    status: failures.length ? "FAIL" : "PASS", failures };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
