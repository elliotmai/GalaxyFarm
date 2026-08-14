import { describe, expect, it } from "vitest";

import {
  GROUPED_SPEC_ROUTES,
  appApiRoutes,
  appPageRoutes,
  isGroupedUnder,
  parseSpecRoutes,
} from "../../tools/routes.js";
import { listFiles, readText } from "../../tools/workspace.js";

/**
 * Spec §7 and the router cannot drift apart silently.
 *
 * Drift in either direction is a real bug: a route in the spec that nobody
 * built is a missing feature nobody noticed, and a route in the app that the
 * spec never mentioned is an undocumented surface with undefined permissions.
 */

const specRoutes = parseSpecRoutes();
const pageRoutes = appPageRoutes();

describe("spec §7 — route map conformance", () => {
  it("parses a plausible route map out of the spec", () => {
    expect(specRoutes.length).toBeGreaterThan(30);
    expect(specRoutes.map((r) => r.route)).toContain("/admin/cattle");
    expect(specRoutes.every((r) => r.route.startsWith("/"))).toBe(true);
  });

  it("every route in the spec exists in the app", () => {
    const missing = specRoutes
      .filter((spec) => {
        if (spec.wildcard) {
          return !pageRoutes.some((route) => isGroupedUnder(route, spec.route));
        }
        return !pageRoutes.includes(spec.route);
      })
      .map((spec) =>
        spec.wildcard
          ? `${spec.route}/* — spec §7 documents a scaffold here, but no page exists under it`
          : `${spec.route} — in spec §7, missing from ${"apps/web/app"}`,
      );

    expect(missing).toEqual([]);
  });

  it("every route in the app is documented in the spec", () => {
    const documented = new Set(specRoutes.map((r) => r.route));
    const groups = GROUPED_SPEC_ROUTES.map((g) => g.route);

    const undocumented = pageRoutes
      .filter((route) => !documented.has(route))
      .filter((route) => !groups.some((group) => isGroupedUnder(route, group)))
      .map(
        (route) =>
          `${route} — exists in the app but is absent from spec §7. ` +
          `Add it to the spec, or add its parent to GROUPED_SPEC_ROUTES with a justification.`,
      );

    expect(undocumented).toEqual([]);
  });

  it("keeps the grouped-route escape hatch small and justified", () => {
    // This list is the one deliberate loosening of the check above. If it grows
    // without bound the conformance test stops meaning anything.
    expect(GROUPED_SPEC_ROUTES.length).toBeLessThanOrEqual(5);
    for (const group of GROUPED_SPEC_ROUTES) {
      expect(group.because, `${group.route} needs a justification`).toMatch(/spec §\d/);
      expect(specRoutes.some((r) => r.route === group.route)).toBe(true);
    }
  });

  it("each grouped scaffold actually has children", () => {
    for (const group of GROUPED_SPEC_ROUTES) {
      const children = pageRoutes.filter((r) => isGroupedUnder(r, group.route));
      expect(
        children.length,
        `${group.route} is documented as a scaffold but has no sub-pages`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("route implementation hygiene", () => {
  it("every page default-exports a component", () => {
    const offenders = listFiles("apps/web/app", ["page.tsx"])
      .filter((f) => f.endsWith("/page.tsx"))
      .filter((f) => !/export\s+default\s+function|export\s+default\s+\w+/.test(readText(f)))
      .map((f) => `${f} has no default export — Next.js will fail the build`);

    expect(offenders).toEqual([]);
  });

  it("every surface has a layout that pins its theme", () => {
    // Spec §8: theme is a property of the surface, not a user preference.
    const layouts = listFiles("apps/web/app", ["layout.tsx"]).filter(
      (f) => f !== "apps/web/app/layout.tsx",
    );
    expect(layouts.length).toBeGreaterThanOrEqual(5);

    for (const layout of layouts) {
      const source = readText(layout);
      expect(source, `${layout} must declare its surface`).toMatch(/data-surface=/);
      expect(source, `${layout} must pin a theme`).toMatch(
        /data-theme="(flying-day|flying-night|flying-auto)"/,
      );
    }
  });

  /**
   * Which surfaces may follow the device (spec §8 v0.9).
   *
   * Daylight is the farm's look — the mark is a brand iron and the world it
   * comes from is paperwork. Night is not a second look, it is a working mode:
   * the barn screen at four in the morning during calving, and the phone the
   * same person is holding. So the surfaces where chores happen ask the device
   * and the surfaces where the farm is *presented* do not.
   *
   * Pinned in a list rather than inferred, because the interesting failure is
   * a surface quietly changing sides — a customer opening an invoice on a dark
   * phone and getting the barn theme is not a bug that announces itself.
   */
  const FOLLOWS_THE_DEVICE = new Set([
    "apps/web/app/(admin)/layout.tsx",
    "apps/web/app/(kiosk)/layout.tsx",
    "apps/web/app/(sitter)/layout.tsx",
  ]);

  const PINNED_TO_DAYLIGHT = new Set([
    "apps/web/app/(account)/layout.tsx",
    "apps/web/app/(public)/layout.tsx",
  ]);

  it("lets the working surfaces follow the device, and only those", () => {
    for (const file of FOLLOWS_THE_DEVICE) {
      expect(readText(file), `${file} should run flying-auto per spec §8 v0.9`).toContain(
        'data-theme="flying-auto"',
      );
    }

    for (const file of PINNED_TO_DAYLIGHT) {
      expect(readText(file), `${file} is customer-facing and stays in daylight`).toContain(
        'data-theme="flying-day"',
      );
    }
  });

  it("matches the browser chrome to whichever way a surface goes", () => {
    // A surface that goes dark under a light title bar has a bar of the wrong
    // colour across the top of every screen. The root layout is light, so a
    // following surface has to say otherwise for itself.
    for (const file of FOLLOWS_THE_DEVICE) {
      const source = readText(file);
      expect(source, `${file} must set its own themeColor`).toContain("themeColor");
      expect(source, `${file}'s dark chrome should be the night canvas`).toMatch(
        /prefers-color-scheme: dark\D+#0F1419/i,
      );
    }

    for (const file of PINNED_TO_DAYLIGHT) {
      expect(readText(file), `${file} takes the root's daylight chrome`).not.toContain(
        "themeColor",
      );
    }
  });

  it("accounts for every surface", () => {
    // Neither list may quietly stop covering the app: a surface added to
    // neither is one nobody has decided about.
    const layouts = listFiles("apps/web/app", ["layout.tsx"]).filter(
      (f) => f !== "apps/web/app/layout.tsx",
    );

    for (const layout of layouts) {
      expect(
        FOLLOWS_THE_DEVICE.has(layout) || PINNED_TO_DAYLIGHT.has(layout),
        `${layout} is a surface nobody has decided the theme rule for`,
      ).toBe(true);
    }
  });

  it("unimplemented API handlers answer 501, not 404", () => {
    // A 404 from an unbuilt endpoint is indistinguishable from a routing bug.
    const handlers = appApiRoutes();
    expect(handlers).toContain("/api/sync/push");
    expect(handlers).toContain("/api/sync/pull");

    for (const file of listFiles("apps/web/app", ["route.ts"])) {
      const source = readText(file);
      if (!source.includes("Not implemented")) continue;
      expect(source, `${file} should return 501`).toContain("501");
    }
  });
});
