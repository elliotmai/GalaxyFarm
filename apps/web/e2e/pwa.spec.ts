import { expect, test, type Page } from "@playwright/test";

import { storageStatePath } from "./session.js";

/**
 * The app starts with the network off (issue #11, spec §3, §4.2).
 *
 * This is the one claim in the whole PWA story that cannot be checked anywhere
 * but here. Unit tests can prove the update policy decides correctly and that
 * the precache manifest names the right URLs; only a real browser, with a real
 * service worker, with the network genuinely cut, can show that the app boots
 * from nothing but what is on the device.
 *
 * The distinction being tested is easy to lose. The *data* layer has worked
 * offline since the sync engine landed — every screen reads IndexedDB. What
 * did not work was starting: with no worker there is nothing to serve the
 * document and the JavaScript that opens the store in the first place.
 */

test.describe("an installed app on a barn screen", () => {
  test.use({ storageState: storageStatePath("owner") });

  /** Load a page and wait until a worker is actually in charge of it. */
  async function underServiceWorker(page: Page, route: string) {
    await page.goto(route);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });
  }

  test("registers a worker that takes control of the surface", async ({ page }) => {
    await underServiceWorker(page, "/kiosk/pen-board");

    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });

    // The whole origin: a worker only controls paths below its own URL, and
    // anything narrower would leave half the app uncovered.
    expect(scope).toMatch(/\/$/);
  });

  test("boots a screen it has seen before with the network cut", async ({ page, context }) => {
    await underServiceWorker(page, "/kiosk/pen-board");

    /*
     * A second load, still online, and it is not padding.
     *
     * The first navigation to an origin fetches its document *before* the
     * worker exists — a worker cannot handle the request that installs it — so
     * that HTML never passes through the cache. Only from the next load on does
     * the app shell get written down. On a barn screen that distinction never
     * shows: it is opened, and then it is opened again every morning for a
     * year. Here it is the difference between testing the cache and testing the
     * fallback.
     */
    await page.reload();
    await expect(page.locator("main")).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    // The acceptance criterion, in as many words: usable after a cold start
    // with the network off.
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator('[data-surface="kiosk"]')).toBeVisible();
  });

  test("lands somewhere honest for a screen it has never seen", async ({ page, context }) => {
    await underServiceWorker(page, "/kiosk");

    await context.setOffline(true);
    // A board this device has never opened. There is no copy to serve and no
    // network to fetch one, which is exactly what the fallback is for.
    await page.goto("/admin/cattle/weights");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/not on the device yet/i);
  });

  test("keeps the fallback on the device rather than fetching it", async ({ page }) => {
    await underServiceWorker(page, "/kiosk");

    // Precached, so it is there before it is needed. Serwist stores a
    // revisioned entry under a search parameter, hence `ignoreSearch`.
    const precached = await page.evaluate(async () => {
      const match = await caches.match("/offline", { ignoreSearch: true });
      return match !== undefined;
    });

    expect(precached).toBe(true);
  });
});
