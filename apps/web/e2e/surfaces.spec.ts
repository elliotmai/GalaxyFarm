import { expect, test } from "@playwright/test";

/**
 * Smoke coverage over the surfaces from spec §4 and §7.
 *
 * Deliberately shallow: it asserts that every surface boots, routes resolve,
 * and each one renders the theme its spec assigns it. Feature behaviour belongs
 * in the unit and component suites — the job here is to catch the class of
 * breakage that only shows up once the app is actually assembled and served.
 */

const ADMIN_ROUTES = [
  "/admin",
  "/admin/map",
  "/admin/calendar",
  "/admin/cattle",
  "/admin/cattle/breeding",
  "/admin/feed",
  "/admin/supplies",
  "/admin/contacts",
  "/admin/settings",
  "/admin/equipment/candidates",
  "/admin/cattle/candidates",
];

const KIOSK_BOARDS = [
  "/kiosk",
  "/kiosk/pen-board",
  "/kiosk/chores",
  "/kiosk/eggs",
  "/kiosk/program-day",
];

test.describe("admin surface", () => {
  test("the dashboard renders", async ({ page }) => {
    const response = await page.goto("/admin");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("renders Midnight Nebula, per spec §8", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.locator('[data-surface="admin"]')).toHaveAttribute(
      "data-theme",
      "midnight-nebula",
    );
  });

  for (const route of ADMIN_ROUTES) {
    test(`${route} resolves`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response?.status(), `${route} should not 404`).toBe(200);
      await expect(page.locator("[data-testid=page-placeholder]")).toHaveAttribute(
        "data-route",
        route,
      );
    });
  }
});

test.describe("kiosk surface", () => {
  test("renders Midnight Nebula with the barn boards reachable", async ({ page }) => {
    await page.goto("/kiosk");

    await expect(page.locator('[data-surface="kiosk"]')).toHaveAttribute(
      "data-theme",
      "midnight-nebula",
    );
  });

  for (const board of KIOSK_BOARDS) {
    test(`${board} resolves`, async ({ page }) => {
      const response = await page.goto(board);

      expect(response?.status(), `${board} should not 404`).toBe(200);
    });
  }
});

test.describe("customer-facing surfaces", () => {
  for (const [route, surface] of [
    ["/", "public"],
    ["/book", "public"],
    ["/login", "public"],
    ["/account", "account"],
    ["/sitter", "sitter"],
  ] as const) {
    test(`${route} renders Bluebonnet Linen`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response?.status()).toBe(200);
      await expect(page.locator(`[data-surface="${surface}"]`)).toHaveAttribute(
        "data-theme",
        "bluebonnet-linen",
      );
    });
  }
});

test.describe("routing behaviour", () => {
  test("an unknown route 404s rather than rendering a blank page", async ({ page }) => {
    const response = await page.goto("/admin/does-not-exist");

    expect(response?.status()).toBe(404);
  });

  test("unimplemented sync endpoints answer 501, not 404", async ({ request }) => {
    // A 404 here would be indistinguishable from a routing bug once the sync
    // engine starts calling them.
    for (const endpoint of ["/api/sync/push", "/api/sync/pull"]) {
      const response = await request.get(endpoint);
      expect(response.status(), `${endpoint} should report "not implemented"`).toBe(501);
    }
  });

  test("the PWA manifest is served", async ({ request }) => {
    const response = await request.get("/manifest.json");

    expect(response.status()).toBe(200);
    expect((await response.json())["display"]).toBe("standalone");
  });
});

test.describe("page metadata", () => {
  test("titles are branded through BrandingConfig, not hardcoded per page", async ({ page }) => {
    await page.goto("/admin/cattle");

    // Spec §5.1: the farm name is injected into every page title from one place.
    await expect(page).toHaveTitle(/Herd · /);
  });
});
