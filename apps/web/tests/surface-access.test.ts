import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@galaxy-farm/core";

import { SURFACES, homeSurfaceFor, mayReachSurface, surfaceOf } from "../lib/surface-access.js";

/**
 * Which roles reach which surface (spec §4.3).
 *
 * The gate this table implements is coarse on purpose — it decides which app
 * loads, not what may be done inside it. Both halves matter, and confusing
 * them is how a permission model ends up in a router.
 */

describe("mayReachSurface", () => {
  it("keeps a housesitter out of the admin app", () => {
    expect(mayReachSurface("housesitter", "admin")).toBe(false);
    expect(mayReachSurface("housesitter", "sitter")).toBe(true);
  });

  it("keeps a customer out of everything but their own portal", () => {
    for (const surface of SURFACES) {
      expect(mayReachSurface("customer", surface), surface).toBe(surface === "account");
    }
  });

  it("keeps a kiosk device off the admin app", () => {
    // A barn screen is unattended. Whoever walks past it must not find the
    // cull list and the invoices behind it.
    expect(mayReachSurface("kiosk", "kiosk")).toBe(true);
    expect(mayReachSurface("kiosk", "admin")).toBe(false);
    expect(mayReachSurface("kiosk", "account")).toBe(false);
  });

  it("lets the owner see every surface", () => {
    // Being unable to look at the customer portal makes "what does it look
    // like from their side" unanswerable, and that gets asked constantly.
    for (const surface of SURFACES) {
      expect(mayReachSurface("owner", surface), surface).toBe(true);
    }
  });

  it("gives a member the operational surfaces and not the customer portal", () => {
    expect(mayReachSurface("member", "admin")).toBe(true);
    expect(mayReachSurface("member", "kiosk")).toBe(true);
    expect(mayReachSurface("member", "sitter")).toBe(true);
    expect(mayReachSurface("member", "account")).toBe(false);
  });
});

describe("surfaceOf", () => {
  it("recognises a surface root and everything under it", () => {
    expect(surfaceOf("/admin")).toBe("admin");
    expect(surfaceOf("/admin/cattle/breeding")).toBe("admin");
    expect(surfaceOf("/kiosk/pen-board")).toBe("kiosk");
  });

  it("does not match a path that merely starts with the same letters", () => {
    // `/administration` is not `/admin`, and a prefix check that thought so
    // would gate a route nobody meant to gate — or fail to gate one.
    expect(surfaceOf("/administration")).toBeUndefined();
    expect(surfaceOf("/accounts-payable")).toBeUndefined();
  });

  it("leaves public routes alone", () => {
    for (const path of ["/", "/login", "/book", "/api/sync/push"]) {
      expect(surfaceOf(path), path).toBeUndefined();
    }
  });
});

describe("homeSurfaceFor", () => {
  it("gives every role somewhere to land", () => {
    // A role with no home would be redirected to undefined, which in a URL is
    // a 404 loop.
    for (const role of ROLES) {
      const home = homeSurfaceFor(role as Role);
      expect(home, role).toMatch(/^\/\w/);
      expect(mayReachSurface(role as Role, surfaceOf(home)!), role).toBe(true);
    }
  });
});
