import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/space",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4183",
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build:space && npm run preview:space -- --port 4183",
    url: "http://127.0.0.1:4183",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
