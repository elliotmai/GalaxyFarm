import { expect, test } from "@playwright/test";

import { storageStatePath } from "./session.js";

/**
 * The Kit screens, driven rather than looked at (spec §5.6, §5.11).
 *
 * `surfaces.spec.ts` is deliberately shallow and stays that way: it asks
 * whether every route boots. This asks the question that only has an answer
 * once the app is assembled and served — whether a value typed into one of
 * these screens reaches the device's store and comes back out of a derivation.
 *
 * That path has no smaller test. The domain functions are covered on pure
 * objects in the module suites, the store is covered on its own, and neither
 * knows whether this screen passes the right records to the right function.
 * Three journeys, each ending on a number nobody typed in:
 *
 *   - a rule comes due against a meter, and recording the work clears it;
 *   - a supply crosses its reorder point by being used;
 *   - a candidate's all-in cost crosses a budget, and buying it makes a
 *     machine.
 */

test.describe("kit", () => {
  test.use({ storageState: storageStatePath("owner") });

  // Not on a phone. `DataTable` renders a card list below the `sm` breakpoint
  // and a table above it, from the same columns — so every control in a cell is
  // in the DOM twice and which copy is visible depends on the viewport. What is
  // under test here is the wiring behind the screens rather than the
  // breakpoint, and `surfaces.spec.ts` already loads every one of these routes
  // on all three projects.
  test.skip(
    ({ isMobile }) => isMobile === true,
    "behaviour, not layout — the phone renders cards where these assertions read a table",
  );

  test("a rule comes due against the meter, and the work clears it", async ({ page }) => {
    await page.goto("/admin/equipment");

    await page.getByLabel("Name").fill("Gooseneck trailer");
    await page.getByLabel("Make").fill("Titan");
    await page.getByLabel("Year").fill("2019");
    await page.getByRole("button", { name: "Add machine" }).click();
    await expect(page.getByText("2019 Titan")).toBeVisible();

    await page.getByRole("link", { name: "Gooseneck trailer" }).click();
    await expect(page.getByRole("heading", { name: "Gooseneck trailer" })).toBeVisible();

    await page.getByLabel("Meter", { exact: true }).selectOption("miles");
    await page.getByLabel("Reading").fill("40000");
    await page.getByRole("button", { name: "Record reading" }).click();
    await expect(page.getByRole("cell", { name: "40,000" })).toBeVisible();

    // A rule the meter has already blown past: 40,000 miles against a 10,000
    // mile interval that has never been done.
    await page.getByRole("tab", { name: "Maintenance" }).click();
    await page.getByLabel("Job").fill("Repack wheel bearings");
    await page.getByLabel("Every N miles").fill("10000");
    await page.getByRole("button", { name: "Add rule" }).click();

    await expect(page.getByText("1 job overdue")).toBeVisible();
    // The trigger that fired is named, not just the fact that one did.
    await expect(page.getByText("Repack wheel bearings (on miles)")).toBeVisible();

    // Recording it carries the meter across, and the next interval counts from
    // there — so the rule stops asking.
    await page.getByRole("button", { name: "Record this job" }).click();
    await expect(page.getByLabel("Job")).toHaveValue("Repack wheel bearings");
    await page.getByLabel("Cost ($)").fill("180");
    await page.getByRole("button", { name: "Record service" }).click();

    await expect(page.getByText("1 job overdue")).toBeHidden();
    await expect(page.getByText("$180.00").first()).toBeVisible();
  });

  test("a supply crosses its reorder point by being used", async ({ page }) => {
    await page.goto("/admin/supplies");

    await page.getByRole("tab", { name: "Items" }).click();
    // The item form lives in a side dialog now, behind "Add an item" — the
    // catalog is the thing the tab is for, and the form was pushing it below
    // the fold.
    await page.getByRole("button", { name: "Add an item" }).click();
    const item = page.getByRole("dialog");
    await item.getByLabel("Name").fill("Pine shavings");
    await item.getByLabel("Unit").selectOption("bag");
    await item.getByLabel("Opening count").fill("10");
    await item.getByLabel("Reorder at").fill("4");
    await item.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("cell", { name: "Pine shavings" })).toBeVisible();

    await page.getByRole("tab", { name: "Used" }).click();
    // Behind a button, like the item form: the tab is for the log, not the
    // form that adds to it.
    await page.getByRole("button", { name: "Record usage" }).click();
    const usage = page.getByRole("dialog");
    await usage.getByLabel(/^Item/).selectOption({ label: "Pine shavings (bag)" });
    await usage.getByLabel("Quantity").fill("7");
    await usage.getByRole("button", { name: "Record usage" }).click();

    // Ten less seven is three, which is under the reorder point of four. The
    // count is derived — nothing anywhere stores it.
    await expect(page.getByText("1 to reorder")).toBeVisible();
    await expect(page.getByText("Pine shavings — 3 bag")).toBeVisible();
  });

  test("a candidate's all-in cost crosses the budget, and buying it makes a machine", async ({
    page,
  }) => {
    await page.goto("/admin/equipment/roadmap");

    // Behind a button now, like the rest of the Kit forms.
    await page.getByRole("button", { name: "Add to the roadmap" }).click();
    const wish = page.getByRole("dialog");
    await wish.getByLabel("What").fill("Three-quarter-ton truck");
    await wish.getByLabel("Priority").selectOption("need");
    await wish.getByLabel("Budget ($)").fill("35000");
    await wish.getByRole("button", { name: "Add to roadmap" }).click();
    await expect(page.getByText("Three-quarter-ton truck", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Find one" }).click();
    await expect(page).toHaveURL(/\/admin\/equipment\/candidates\?item=/);

    await page.getByRole("button", { name: "Add a candidate" }).click();
    const candidate = page.getByRole("dialog");
    await candidate.getByLabel("What it is").fill("2018 F-250");
    await candidate.getByLabel("Asking ($)").fill("34500");
    await candidate.getByLabel("Mileage").fill("96000");
    // Hauling, itemised — the whole reason the comparison does not sort on the
    // asking price.
    await candidate.getByPlaceholder("$").first().fill("900");
    await candidate.getByRole("button", { name: "Add candidate" }).click();

    await expect(page.getByRole("cell", { name: "$35,400.00" })).toBeVisible();
    // $35,400 over 96,000 miles, and $400 past the budget on the want above.
    await expect(page.getByRole("cell", { name: "$0.37" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "+$400.00" })).toBeVisible();

    await page.getByRole("table").getByLabel("Status for 2018 F-250").selectOption("purchased");
    await expect(page.getByText("2018 F-250 is in the fleet.")).toBeVisible();

    // The plan became the fact: the machine exists, and nothing was typed twice.
    await page.goto("/admin/equipment");
    await expect(page.getByRole("link", { name: "2018 F-250" })).toBeVisible();
  });
});
