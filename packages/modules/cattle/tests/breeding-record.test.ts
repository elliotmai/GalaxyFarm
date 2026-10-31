import { describe, expect, it } from "vitest";

import { daysCarried } from "../src/domain/breeding-record.js";

/** How far along she is — a count that stops when she calves (decision 46). */
describe("days carried", () => {
  const bred = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5B01",
    damId: "01ARZ3NDEKTSV4RRFFQ69G5C01",
    date: new Date("2026-01-01T12:00:00Z"),
  } as unknown as Parameters<typeof daysCarried>[0];

  it("counts up while she carries, and stops at the calving", () => {
    expect(daysCarried(bred, [], new Date("2026-03-02T12:00:00Z"))).toBe(60);
    const calving = {
      damId: bred.damId,
      breedingRecordId: bred.id,
      date: new Date("2026-10-09T12:00:00Z"),
    };
    // A month after she calved, she still reads the day she calved at.
    expect(daysCarried(bred, [calving], new Date("2026-11-09T12:00:00Z"))).toBe(281);
  });

  it("has nothing to count once a preg check finds her open", () => {
    const open = { ...bred, pregCheck: { result: "open" } } as typeof bred;
    expect(daysCarried(open, [], new Date("2026-03-02T12:00:00Z"))).toBeUndefined();
  });
});
