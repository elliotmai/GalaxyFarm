import { expect, test } from "@playwright/test";

import { storageStatePath } from "./session.js";

/**
 * Smoke coverage over the surfaces from spec §4 and §7.
 *
 * Deliberately shallow: it asserts that every surface boots, routes resolve,
 * and each one renders the theme its spec assigns it. Feature behaviour belongs
 * in the unit and component suites — the job here is to catch the class of
 * breakage that only shows up once the app is actually assembled and served.
 *
 * **Everything below the public surfaces needs a session.** §4.3 puts a
 * middleware gate in front of admin, account and sitter, so a suite with no
 * cookie tests one thing on every page: that it redirects to `/login`. That is
 * worth asserting once, and it is what this whole file had quietly become —
 * every admin assertion was running against the sign-in page. The sessions are
 * minted in `global-setup.ts`; see `session.ts` for why that is a signed cookie
 * rather than a scripted login.
 */

const ADMIN_ROUTES = [
  "/admin",
  "/admin/map",
  "/admin/pastures",
  "/admin/calendar",
  "/admin/chores",
  "/admin/cattle",
  "/admin/cattle/breeding",
  "/admin/cattle/calving",
  "/admin/feed",
  "/admin/chickens/flock",
  "/admin/chickens/eggs",
  "/admin/supplies",
  "/admin/contacts",
  "/admin/settings",
  "/admin/equipment/candidates",
  "/admin/cattle/candidates",
  "/admin/horses",
  "/admin/horses/roadmap",
  "/admin/horses/candidates",
  "/admin/horses/herd",
];

const KIOSK_BOARDS = [
  "/kiosk",
  "/kiosk/pen-board",
  "/kiosk/chores",
  "/kiosk/eggs",
  "/kiosk/program-day",
];

test.describe("admin surface", () => {
  test.use({ storageState: storageStatePath("owner") });

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
      // Deliberately not asserting the placeholder any more. Half of these are
      // built screens now and the rest are on their way, so a test that
      // required a placeholder would have to be edited every time one is
      // finished — and a test edited on every feature is one that stops being
      // read. That §7 maps a route to a file is checked statically in
      // `tests/architecture/route-map.test.ts`; what is worth checking here is
      // that the assembled app serves it and it renders something.
      await expect(page.locator("main")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });
  }
});

test.describe("kiosk surface", () => {
  test.use({ storageState: storageStatePath("owner") });

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

test.describe("public surfaces", () => {
  // Signed out on purpose: these are the pages a stranger sees.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an invitation link nobody can act on renders rather than 500ing", async ({ page }) => {
    // This suite runs with `DATABASE_URL` pointing nowhere on purpose, so this
    // exercises the unreachable-database path. Both outcomes are a rendered
    // page with an explanation: a link that cannot be checked and a link that
    // is not real need opposite advice, and neither needs a stack trace.
    const response = await page.goto("/invite/not-a-real-token");

    expect(response?.status()).toBe(200);
    await expect(page.getByText(/does not work|cannot check that link/i)).toBeVisible();
  });

  for (const route of ["/", "/book", "/login"] as const) {
    test(`${route} renders Bluebonnet Linen`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response?.status()).toBe(200);
      await expect(page.locator('[data-surface="public"]')).toHaveAttribute(
        "data-theme",
        "bluebonnet-linen",
      );
    });
  }
});

test.describe("the customer portal", () => {
  // A customer's cookie, not an owner's. §4.3 sends an owner reaching
  // `/account` to their own home surface, so this would assert the redirect.
  test.use({ storageState: storageStatePath("customer") });

  test("/account renders Bluebonnet Linen", async ({ page }) => {
    const response = await page.goto("/account");

    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-surface="account"]')).toHaveAttribute(
      "data-theme",
      "bluebonnet-linen",
    );
  });
});

test.describe("the housesitter surface", () => {
  test.use({ storageState: storageStatePath("housesitter") });

  test("/sitter renders Bluebonnet Linen", async ({ page }) => {
    const response = await page.goto("/sitter");

    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-surface="sitter"]')).toHaveAttribute(
      "data-theme",
      "bluebonnet-linen",
    );
  });
});

test.describe("the gate itself", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sends a signed-out visitor to the login page, carrying where they were going", async ({
    page,
  }) => {
    // §4.3: signing in should land somebody where they were headed rather than
    // on a dashboard they immediately navigate away from.
    await page.goto("/admin/cattle");

    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fcattle/);
  });

  test("the sync endpoints refuse an unauthenticated caller", async ({ request }) => {
    // These used to answer 501 as stubs. They are implemented now, and the
    // property worth asserting is the one that matters: a device with no
    // session gets nothing, rather than another property's records.
    for (const endpoint of ["/api/sync/push", "/api/sync/pull"]) {
      const response = await request.post(endpoint, { data: {} });
      expect(response.status(), `${endpoint} should refuse`).toBe(401);
    }
  });

  test("the weather route refuses an unauthenticated caller", async ({ request }) => {
    expect((await request.get("/api/weather")).status()).toBe(401);
  });
});

test.describe("routing behaviour", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("an unknown route 404s rather than rendering a blank page", async ({ page }) => {
    const response = await page.goto("/admin/does-not-exist");

    expect(response?.status()).toBe(404);
  });

  test("the PWA manifest is served", async ({ request }) => {
    const response = await request.get("/manifest.json");

    expect(response.status()).toBe(200);
    expect((await response.json())["display"]).toBe("standalone");
  });

  test("the app icons the manifest promises actually exist", async ({ request }) => {
    // A manifest naming an icon that 404s installs as a blank square on a home
    // screen, and nothing anywhere reports it.
    const manifest = (await (await request.get("/manifest.json")).json()) as {
      icons: { src: string }[];
    };

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} should be served`).toBe(200);
    }
  });
});

test.describe("the landing page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("speaks to a customer, and offers the staff door quietly", async ({ page }) => {
    await page.goto("/");

    // The heading is about the farm, not about the app.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The customer-facing calls to action are the prominent ones.
    await expect(page.getByRole("link", { name: /ask about boarding/i })).toBeVisible();

    // The admin link exists and lives in the footer, not the header — visible
    // to whoever needs it, and not one of two equal choices at the top of the
    // page for somebody reading about the farm.
    const staffDoor = page.locator("footer").getByRole("link", { name: /farm login/i });
    await expect(staffDoor).toBeVisible();
    await expect(staffDoor).toHaveAttribute("href", "/admin");
    await expect(page.locator("header").getByRole("link", { name: /farm login/i })).toHaveCount(0);
  });

  test("the staff door leads to the admin surface, through the gate", async ({ page }) => {
    await page.goto("/");
    await page
      .locator("footer")
      .getByRole("link", { name: /farm login/i })
      .click();

    // Signed out, so §4.3 sends them to sign in first — and back to /admin
    // afterwards rather than dropping them on the landing page again.
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  });
});

test.describe("page metadata", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("titles are branded through BrandingConfig, not hardcoded per page", async ({ page }) => {
    await page.goto("/admin/cattle");

    // Spec §5.1: the farm name is injected into every page title from one place.
    await expect(page).toHaveTitle(/Herd · /);
  });
});
