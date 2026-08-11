import { describe, expect, it } from "vitest";

import { isGroupedUnder, parseSpecRoutes, routeFromFile } from "../../tools/routes.js";

/**
 * Tests for the route-map parser. If this drifts, the conformance test starts
 * comparing the app against an empty or half-read list and passes for the wrong
 * reason.
 */

describe("routeFromFile", () => {
  it.each([
    ["apps/web/app/(admin)/admin/cattle/page.tsx", "/admin/cattle"],
    ["apps/web/app/(public)/page.tsx", "/"],
    ["apps/web/app/(admin)/admin/cattle/[id]/page.tsx", "/admin/cattle/[id]"],
    ["apps/web/app/(kiosk)/kiosk/pen-board/page.tsx", "/kiosk/pen-board"],
    ["apps/web/app/api/sync/push/route.ts", "/api/sync/push"],
  ])("%s → %s", (file, expected) => {
    expect(routeFromFile(file, file.endsWith("route.ts") ? "route" : "page")).toBe(expected);
  });

  it("strips route groups but keeps real segments", () => {
    expect(routeFromFile("apps/web/app/(account)/account/invoices/page.tsx", "page")).toBe(
      "/account/invoices",
    );
  });

  it("ignores private folders", () => {
    expect(routeFromFile("apps/web/app/(admin)/_components/x/page.tsx", "page")).toBe("/x");
  });
});

describe("parseSpecRoutes", () => {
  const markdown = [
    "## 7. Route map",
    "",
    "```",
    "/                               landing (public, later)",
    "/login",
    "/admin/business/*               scaffold: bookings · clients",
    "/admin/cattle/[id]              profile tabs: overview · pedigree",
    "                                continuation line that should be ignored",
    "```",
    "",
    "## 8. UI/UX notes",
  ].join("\n");

  it("extracts routes from the fenced block", () => {
    expect(parseSpecRoutes(markdown).map((r) => r.route)).toEqual([
      "/",
      "/login",
      "/admin/business",
      "/admin/cattle/[id]",
    ]);
  });

  it("marks wildcard scaffolds and strips the wildcard from the route", () => {
    const business = parseSpecRoutes(markdown).find((r) => r.route === "/admin/business");
    expect(business?.wildcard).toBe(true);
  });

  it("treats a bare route with no description as a route", () => {
    const login = parseSpecRoutes(markdown).find((r) => r.route === "/login");
    expect(login).toBeDefined();
    expect(login?.description).toBe("");
  });

  it("keeps the description for context in failure messages", () => {
    const root = parseSpecRoutes(markdown).find((r) => r.route === "/");
    expect(root?.description).toContain("landing");
  });

  it("ignores continuation lines that do not begin with a slash", () => {
    expect(parseSpecRoutes(markdown).some((r) => r.route.includes("continuation"))).toBe(false);
  });

  it("picks up sub-routes the spec documents inline on a parent's line", () => {
    const inline = [
      "## 7. Route map",
      "```",
      "/admin/equipment                fleet · /admin/equipment/[id] · /admin/equipment/roadmap",
      "```",
      "## 8. Next",
    ].join("\n");

    expect(parseSpecRoutes(inline).map((r) => r.route)).toEqual([
      "/admin/equipment",
      "/admin/equipment/[id]",
      "/admin/equipment/roadmap",
    ]);
  });

  it("labels inline sub-routes with the line that documented them", () => {
    const inline = [
      "## 7. Route map",
      "```",
      "/admin/horses                   placeholder shells · /admin/horses/roadmap (active)",
      "```",
      "## 8. Next",
    ].join("\n");

    const roadmap = parseSpecRoutes(inline).find((r) => r.route === "/admin/horses/roadmap");
    expect(roadmap?.description).toContain("/admin/horses");
  });

  it("does not invent routes from prose that merely contains a slash", () => {
    const prose = [
      "## 7. Route map",
      "```",
      "/admin                          dashboard: 10,000 loads / month, feed run-outs",
      "```",
      "## 8. Next",
    ].join("\n");

    expect(parseSpecRoutes(prose).map((r) => r.route)).toEqual(["/admin"]);
  });

  it("does not duplicate a sub-route that also has its own line", () => {
    const both = [
      "## 7. Route map",
      "```",
      "/admin/cattle                   herd list · /admin/cattle/breeding",
      "/admin/cattle/breeding          heat log, sync protocols",
      "```",
      "## 8. Next",
    ].join("\n");

    const routes = parseSpecRoutes(both).map((r) => r.route);
    expect(routes.filter((r) => r === "/admin/cattle/breeding")).toHaveLength(1);
  });

  it("throws a useful error when the section is missing", () => {
    expect(() => parseSpecRoutes("# Some other document")).toThrow(/section 7/i);
  });

  it("throws when the section exists but has no code block", () => {
    expect(() => parseSpecRoutes("## 7. Route map\n\nno fence here\n\n## 8. Next")).toThrow(
      /fenced/i,
    );
  });

  it("reads the real spec and finds the routes we expect", () => {
    const routes = parseSpecRoutes().map((r) => r.route);
    for (const expected of [
      "/",
      "/login",
      "/admin",
      "/admin/cattle",
      "/kiosk",
      "/account",
      "/sitter",
    ]) {
      expect(routes).toContain(expected);
    }
  });
});

describe("isGroupedUnder", () => {
  it("recognises descendants", () => {
    expect(isGroupedUnder("/kiosk/pen-board", "/kiosk")).toBe(true);
    expect(isGroupedUnder("/admin/business/invoices", "/admin/business")).toBe(true);
  });

  it("does not treat a route as its own descendant", () => {
    expect(isGroupedUnder("/kiosk", "/kiosk")).toBe(false);
  });

  it("does not match on a shared prefix that is not a path boundary", () => {
    expect(isGroupedUnder("/kiosks-other", "/kiosk")).toBe(false);
    expect(isGroupedUnder("/admin/businesses", "/admin/business")).toBe(false);
  });
});
