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
        /data-theme="(flying-day|flying-night)"/,
      );
    }
  });

  it("every surface renders in daylight", () => {
    // Spec §8 v0.9. The mark is a brand iron and the world it comes from is
    // paperwork, which is a daylight world — and the jobs agree: printing a
    // pedigree, showing a buyer a screen, reading a kiosk in a sunlit barn.
    // `flying-night` is entered deliberately for the barn after dark; no
    // surface is pinned to it, which is what this asserts.
    const surfaces = [
      "apps/web/app/(admin)/layout.tsx",
      "apps/web/app/(kiosk)/layout.tsx",
      "apps/web/app/(account)/layout.tsx",
      "apps/web/app/(sitter)/layout.tsx",
      "apps/web/app/(public)/layout.tsx",
    ];

    for (const file of surfaces) {
      expect(readText(file), `${file} should render flying-day per spec §8`).toContain(
        'data-theme="flying-day"',
      );
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
