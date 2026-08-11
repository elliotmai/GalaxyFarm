import { describe, expect, it } from "vitest";

import { abandon, isPlanOpen, realise, type PlannedRecord } from "../src/crud/planned-actual.js";
import { isErr, isOk } from "../src/types/result.js";
import { encodeUlid } from "../src/types/ids.js";
import type { BaseRecord } from "../src/entities/record.js";

const at = new Date("2026-03-01T00:00:00Z");
const planId = encodeUlid(1, () => 0.1);
const actualId = encodeUlid(2, () => 0.2);
const propertyId = encodeUlid(3, () => 0.3);

const plan = (overrides: Partial<PlannedRecord> = {}): PlannedRecord => ({
  id: planId,
  propertyId,
  createdAt: at,
  updatedAt: at,
  planStatus: "open",
  ...overrides,
});

const buildActual = (): BaseRecord => ({
  id: actualId,
  propertyId,
  createdAt: at,
  updatedAt: at,
});

describe("planned → actual", () => {
  it("converts an open plan and links the two records", () => {
    const result = realise(plan(), at, buildActual);

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.actual.id).toBe(actualId);
    expect(result.value.plan.planStatus).toBe("realised");
    expect(result.value.plan.realisedAs).toBe(actualId);
    expect(result.value.plan.realisedAt).toEqual(at);
  });

  it("keeps the plan rather than consuming it", () => {
    // What you intended is worth reading next season alongside what happened.
    const result = realise(plan(), at, buildActual);

    expect(isOk(result) && result.value.plan.id).toBe(planId);
  });

  it("carries data across via the builder, so nothing is typed twice", () => {
    const result = realise(plan(), at, (p) => ({ ...buildActual(), propertyId: p.propertyId }));

    expect(isOk(result) && result.value.actual.propertyId).toBe(propertyId);
  });

  it("refuses to realise the same plan twice", () => {
    const already = plan({ planStatus: "realised", realisedAs: actualId });
    const result = realise(already, at, buildActual);

    expect(isErr(result)).toBe(true);
    expect(!result.ok && result.error.kind).toBe("already-realised");
  });

  it("refuses to realise an abandoned plan", () => {
    const result = realise(plan({ planStatus: "abandoned" }), at, buildActual);

    expect(!result.ok && result.error.kind).toBe("abandoned");
  });

  it("does not call the builder when the conversion is rejected", () => {
    let called = false;
    realise(plan({ planStatus: "abandoned" }), at, () => {
      called = true;
      return buildActual();
    });

    expect(called).toBe(false);
  });
});

describe("abandoning a plan", () => {
  it("keeps the record and the reason", () => {
    // The record of what you turned down and why is worth as much next year as
    // the record of what you bought.
    const result = abandon(plan(), at, "rust through the bed");

    expect(isOk(result)).toBe(true);
    expect(isOk(result) && result.value.planStatus).toBe("abandoned");
    expect(isOk(result) && result.value.abandonedReason).toBe("rust through the bed");
  });

  it("insists on a reason", () => {
    expect(isErr(abandon(plan(), at, ""))).toBe(true);
    expect(isErr(abandon(plan(), at, "   "))).toBe(true);
  });

  it("trims the reason", () => {
    const result = abandon(plan(), at, "  too far to haul  ");

    expect(isOk(result) && result.value.abandonedReason).toBe("too far to haul");
  });

  it("refuses to abandon something already bought", () => {
    const result = abandon(plan({ planStatus: "realised", realisedAs: actualId }), at, "changed");

    expect(!result.ok && result.error.kind).toBe("already-realised");
  });

  it("reports whether a plan is still open", () => {
    expect(isPlanOpen(plan())).toBe(true);
    expect(isPlanOpen(plan({ planStatus: "realised" }))).toBe(false);
    expect(isPlanOpen(plan({ planStatus: "abandoned" }))).toBe(false);
  });
});
