import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Escape hatch for sandboxes and dev containers that ship a preinstalled
 * Chromium whose build number does not match this Playwright release. CI does
 * a normal `playwright install`, so this is unset there.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
const launchOptions = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  // A committed `.only` silently narrows the suite to one test and turns the
  // e2e gate green for the wrong reason.
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...launchOptions } },
    // The barn kiosks and one-thumb mobile logging are distinct density modes
    // (spec §8), so they get their own passes rather than being assumed.
    { name: "mobile", use: { ...devices["Pixel 7"], ...launchOptions } },
    {
      name: "kiosk",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        ...launchOptions,
      },
    },
  ],

  webServer: {
    command: `pnpm --filter @galaxy-farm/web build && pnpm --filter @galaxy-farm/web start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
