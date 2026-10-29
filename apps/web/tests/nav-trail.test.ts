import { describe, expect, it } from "vitest";

import {
  arrive,
  backLabel,
  named,
  parentOf,
  type TrailStep,
} from "../app/(admin)/_components/nav-trail.js";

/**
 * The way back (spec §8). A step forward gets a Back; a tab change starts
 * fresh; moving along a strip replaces rather than adds; and arriving where
 * the trail's previous step was is going back.
 */

const walk = (...steps: [string, "forward" | "tab" | "sideways"][]): TrailStep[] =>
  steps.reduce<TrailStep[]>((trail, [href, move]) => arrive(trail, href, move), []);

const hrefs = (trail: readonly TrailStep[]) => trail.map((step) => step.href);

describe("the trail", () => {
  it("steps forward into a record and back out of it", () => {
    const into = walk(["/admin/animals", "tab"], ["/admin/cattle/andromeda", "forward"]);
    expect(hrefs(into)).toEqual(["/admin/animals", "/admin/cattle/andromeda"]);

    // Back — the link or the browser's — lands on the previous step and pops.
    expect(hrefs(arrive(into, "/admin/animals", "forward"))).toEqual(["/admin/animals"]);
  });

  it("starts fresh on a tab change, so there is no Back into the tab left", () => {
    const trail = walk(
      ["/admin/animals", "tab"],
      ["/admin/cattle/andromeda", "forward"],
      ["/admin/feed", "tab"],
    );
    expect(hrefs(trail)).toEqual(["/admin/feed"]);
  });

  it("moves sideways along a strip without growing the trail", () => {
    const trail = walk(
      ["/admin", "tab"],
      ["/admin/cattle", "forward"],
      ["/admin/cattle/health", "sideways"],
      ["/admin/cattle/weights", "sideways"],
    );
    // Back still goes to Today, not through every view flicked across.
    expect(hrefs(trail)).toEqual(["/admin", "/admin/cattle/weights"]);
  });

  it("keeps its place when only the query changes", () => {
    const trail = walk(["/admin/more", "tab"], ["/admin/settings", "forward"]);
    expect(hrefs(arrive(trail, "/admin/settings?tab=people", "forward"))).toEqual([
      "/admin/more",
      "/admin/settings?tab=people",
    ]);
  });

  it("names the page once its heading renders, and labels the Back with it", () => {
    const trail = named(
      walk(["/admin/cattle/andromeda", "tab"]),
      "/admin/cattle/andromeda",
      "Andromeda",
    );
    // A late heading from the next page never renames this one.
    expect(named(trail, "/admin/animals", "Animals")[0]?.title).toBe("Andromeda");
    expect(trail[0]?.title).toBe("Andromeda");
    expect(backLabel(trail[0]?.title, "Back")).toBe("Andromeda");
    expect(backLabel(undefined, "Back")).toBe("Back");
  });
});

describe("a page opened cold", () => {
  it("goes back to the list a record sits under", () => {
    expect(parentOf("/admin/cattle/andromeda")).toEqual({ href: "/admin/cattle", label: "Cattle" });
  });

  it("goes back to More from a page listed there", () => {
    expect(parentOf("/admin/breeding")?.href).toBe("/admin/more");
  });

  it("needs nothing on a tab's landing or a section the strip already shows", () => {
    expect(parentOf("/admin")).toBeUndefined();
    expect(parentOf("/admin/animals")).toBeUndefined();
    expect(parentOf("/admin/cattle")).toBeUndefined();
    expect(parentOf("/admin/cattle/health")).toBeUndefined();
    expect(parentOf("/admin/log")).toBeUndefined();
  });
});
