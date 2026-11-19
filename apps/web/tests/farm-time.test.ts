import { describe, expect, it } from "vitest";

import { offWallClock, onWallClock, wallClock } from "../lib/farm-time.js";

/**
 * Server-drawn pages work out "today" on the device's wall clock, then hand
 * the browser real instants (`app/(sitter)/sitter/page.tsx`).
 */
describe("the wall clock", () => {
  // 8 p.m. on 17 November in Texas, which is already the 18th in UTC.
  const evening = new Date("2026-11-18T02:00:00.000Z");

  it("reads a Texas evening as that evening, not the next day", () => {
    const wall = wallClock(evening, "America/Chicago");
    expect([wall.getDate(), wall.getHours()]).toEqual([17, 20]);
  });

  it("brings every date in a record back to the instant it started as", () => {
    const record = { dueAt: evening, nested: { at: evening }, list: [evening], title: "Hay" };
    const there = onWallClock(record, "America/Chicago");
    expect(offWallClock(there, "America/Chicago")).toEqual(record);
  });
});
