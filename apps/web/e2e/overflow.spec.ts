import { expect, test, type Page } from "@playwright/test";

import { storageStatePath } from "./session.js";

/**
 * Nothing is wider than the phone (spec §8).
 *
 * A page that scrolls sideways on a phone is not a cosmetic problem: the whole
 * layout shifts under a thumb that meant to scroll down, every fixed element
 * detaches from the edge it was pinned to, and the row you were reading slides
 * out from under the column heading that named it.
 *
 * Asserted on the document rather than on any one component, because the
 * culprit is never where the symptom is: one `min-w` deep inside a table
 * widens the page, and the thing that looks broken is the header.
 */

const ROUTES = [
  "/admin",
  "/admin/map",
  "/admin/pastures",
  "/admin/calendar",
  "/admin/chores",
  "/admin/cattle",
  "/admin/cattle/breeding",
  "/admin/cattle/calving",
  "/admin/cattle/supplies",
  "/admin/cattle/health",
  "/admin/cattle/weights",
  "/admin/cattle/feed",
  "/admin/cattle/sales",
  "/admin/cattle/ancestors",
  "/admin/cattle/catalog",
  "/admin/cattle/roadmap",
  "/admin/cattle/candidates",
  "/admin/feed",
  "/admin/chickens/flock",
  "/admin/chickens/eggs",
  "/admin/supplies",
  "/admin/contacts",
  "/admin/pets",
  "/admin/housesitter",
  "/admin/reports",
  "/admin/settings",
  "/admin/equipment",
  "/admin/horses",
  "/admin/garden",
];

/**
 * What is sticking out, in the terms somebody would go and fix it in.
 *
 * Anything inside a horizontal scroller is skipped. The tab strip and the wide
 * tables are *meant* to run past their box — that is what `overflow-x: auto`
 * is for, and their children's right edges say so without the page being any
 * wider. Reporting them buries the one element that actually widened it.
 */
async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: { tag: string; className: string; right: number; text: string }[] = [];

    const inAScroller = (element: HTMLElement): boolean => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
      }
      return false;
    };

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right <= limit + 1) continue;
      if (inAScroller(element)) continue;
      // Only the outermost: every descendant of one wide row is one row.
      if (element.parentElement !== null) {
        const parent = element.parentElement.getBoundingClientRect();
        if (parent.right > limit + 1 && !inAScroller(element.parentElement)) continue;
      }
      offenders.push({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        right: Math.round(box.right),
        text: (element.textContent ?? "").trim().slice(0, 80),
      });
    }

    return { limit, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
}

test.describe("a phone-width page", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const route of ROUTES) {
    test(`does not scroll sideways: ${route}`, async ({ page }) => {
      await page.goto(route);
      // Not `networkidle`: the sync engine polls, so the network never goes
      // quiet and every route would fail as a timeout rather than a width.
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1200);

      const report = await overflowReport(page);
      // The elements, not `document.scrollWidth`: the surface clips its
      // overflow so a stray element no longer widens the page — which is the
      // point of the clip and would be the end of this test if it measured
      // the page instead of what is in it.
      expect(
        report.offenders,
        `${route} has something wider than the phone: ${JSON.stringify(report.offenders, null, 2)}`,
      ).toEqual([]);
      expect(report.scrollWidth).toBeLessThanOrEqual(report.limit + 1);
    });
  }
});
