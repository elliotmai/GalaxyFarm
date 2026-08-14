import { describe, expect, it } from "vitest";

import {
  NAV,
  SUB_SECTIONS,
  UTILITY,
  allNavRoutes,
  destinationFor,
  sectionFor,
} from "../app/(admin)/_components/nav-groups.js";
import { appPageRoutes } from "../../../tools/routes.js";
import { listFiles, readText } from "../../../tools/workspace.js";

/**
 * The nav restructure must not orphan a route (spec §7, §8 v0.9).
 *
 * Fifty-five sidebar links became five destinations, a utility rail and two
 * levels of in-page strip. Nothing was merged and no route moved, but a route
 * that fell out of the data while it was being reshaped would still be *there*
 * — reachable by typing the URL, invisible to anybody using the app. That is
 * exactly the kind of loss nobody notices until a feature is presumed missing.
 */

const adminRoutes = appPageRoutes().filter(
  (route) =>
    route.startsWith("/admin") &&
    // Dynamic segments are reached from their list, never from the nav.
    !route.includes("["),
);

describe("admin nav reachability", () => {
  it("still reaches every admin route", () => {
    const reachable = new Set(allNavRoutes());
    const orphaned = adminRoutes.filter((route) => !reachable.has(route));

    expect(orphaned, "these admin routes have no way in from the nav").toEqual([]);
  });

  it("points at nothing that does not exist", () => {
    const real = new Set(adminRoutes);
    const dangling = allNavRoutes().filter((href) => !real.has(href));

    expect(dangling, "the nav links to routes with no page").toEqual([]);
  });

  it("keeps the sidebar short, which was the point", () => {
    // Nine rows total. The wall it replaced was fifty-five across nine
    // collapsing groups; if this creeps back up, the restructure has been
    // undone one convenient addition at a time.
    expect(NAV.length).toBe(5);
    expect(NAV.length + UTILITY.length).toBeLessThanOrEqual(10);
  });

  it("puts every route under exactly one destination", () => {
    // A route claimed by two destinations lights two rail items, and the reader
    // has no way to tell which one is the truth.
    for (const route of adminRoutes) {
      const owners = NAV.filter((destination) =>
        destination.sections.some(
          (section) =>
            section.href === route ||
            (SUB_SECTIONS[section.href] ?? []).some((sub) => sub.href === route),
        ),
      );

      // Utility routes belong to no destination, which is deliberate.
      const isUtility = UTILITY.some(
        (item) =>
          item.href === route || (SUB_SECTIONS[item.href] ?? []).some((sub) => sub.href === route),
      );
      if (isUtility) continue;

      expect(owners.length, `${route} is claimed by ${owners.length} destinations`).toBe(1);
    }
  });

  it("resolves the strip for a route that used to be a sidebar row", () => {
    // The thirteen cattle views are the case the restructure exists for.
    expect(destinationFor("/admin/cattle/breeding")?.label).toBe("Animals");
    expect(sectionFor("/admin/cattle/breeding")?.label).toBe("Cattle");
    expect(SUB_SECTIONS["/admin/cattle"]?.map((s) => s.href)).toContain("/admin/cattle/breeding");
  });

  it("keeps an animal's detail page inside the herd", () => {
    // `owns` exists so opening a cow does not black out the nav.
    expect(destinationFor("/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FAV")?.label).toBe("Animals");
    expect(sectionFor("/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FAV")?.label).toBe("Cattle");
  });

  it("never puts a page under a heading the nav has never heard of", () => {
    // A screen's eyebrow is its trail, written by hand on each page. The
    // restructure renamed the groups underneath them, and five screens went on
    // announcing "People & places" — a group that no longer exists — while the
    // rail beside them highlighted something else entirely. A reader has no way
    // to tell which of the two is lying.
    const labels = new Set([
      ...NAV.map((destination) => destination.label),
      ...NAV.flatMap((destination) => destination.sections.map((section) => section.label)),
      ...Object.values(SUB_SECTIONS).flatMap((subs) => subs.map((sub) => sub.label)),
      ...UTILITY.map((item) => item.label),
    ]);

    const stray: string[] = [];
    for (const file of listFiles("apps/web/app", ["page.tsx", ".tsx"])) {
      for (const [, eyebrow] of readText(file).matchAll(/eyebrow="([^"]+)"/g)) {
        if (!labels.has(eyebrow!)) stray.push(`${file} — "${eyebrow}" is not a place in the nav`);
      }
    }

    expect(stray).toEqual([]);
  });

  it("does not let a prefix swallow a sibling", () => {
    // Every cattle route starts with /admin/cattle. Without the guard, the
    // herd tab would light up while somebody is on the breeding page.
    expect(sectionFor("/admin/cattle/breeding")?.href).toBe("/admin/cattle");
    const cattleViews = SUB_SECTIONS["/admin/cattle"] ?? [];
    const lit = cattleViews.filter((view) => view.href === "/admin/cattle/breeding");
    expect(lit).toHaveLength(1);
  });
});
