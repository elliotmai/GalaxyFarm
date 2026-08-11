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

/**
 * One secret for the runner and the server under test.
 *
 * The suite mints its own session cookies rather than driving the login form
 * (see `apps/web/e2e/session.ts`), and a cookie signed with a different secret
 * than the server verifies with decrypts to nothing — which presents as being
 * signed out, with nothing in any log to say why. So both sides read this.
 */
const AUTH_SECRET = process.env["AUTH_SECRET"] ?? "e2e-secret-not-for-production";

export default defineConfig({
  testDir: "./apps/web/e2e",
  globalSetup: "./apps/web/e2e/global-setup.ts",
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
    env: {
      AUTH_SECRET,
      // Never reached: every page reads from the device's own store (§4.2) and
      // the session is a JWT, so nothing in this suite touches Postgres. It is
      // set because the app refuses to boot without it, and a placeholder that
      // cannot connect anywhere is safer here than a real one.
      DATABASE_URL:
        process.env["E2E_DATABASE_URL"] ?? "postgresql://e2e:e2e@127.0.0.1:1/e2e?sslmode=disable",
    },
  },
});
