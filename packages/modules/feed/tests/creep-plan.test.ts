import { describe, expect, it } from "vitest";

import { feedingPlanSchema, type Ulid } from "@galaxy-farm/core";

import { CREEP_START_DAYS, creepPlanSuggestion } from "../src/domain/creep-plan.js";
import type { FeedType } from "../src/domain/feed-type.js";

/**
 * The feed half of the calving flow (spec §5.2, §5.3, issue #13).
 *
 * The thing being tested as much as the arithmetic: this file mentions calves
 * and never mentions cattle. §4.1 forbids feed importing the cattle module, so
 * what arrives is a birth date and an animal id off a `CalvingRecorded` event.
 * If that constraint were ever quietly broken, the fix would be to type the
 * argument as a `CalvingRecord` — and the boundary test would fail the build.
 */

const id = (n: number): Ulid => `01HQ${String(n).padStart(22, "0")}` as Ulid;
const now = new Date("2026-11-24T06:00:00Z");

const feed = (over: Partial<FeedType> = {}): FeedType => ({
  id: id(1),
  propertyId: id(0),
  createdAt: now,
  updatedAt: now,
  name: "Creep pellets",
  category: "creep",
  unit: "bag",
  reorderLeadDays: 5,
  active: true,
  ...over,
});

const birth = { animalId: id(9), bornOn: now, liveCalf: true };

describe("creepPlanSuggestion", () => {
  it("starts creep about two months out, not at birth", () => {
    // Earlier and the calf is on milk and will not eat enough for the feed to
    // be anything but wasted.
    const suggestion = creepPlanSuggestion(birth, [feed()]);

    expect(suggestion?.startOn).toEqual(new Date("2027-01-23T06:00:00Z"));
    expect(CREEP_START_DAYS).toBe(60);
  });

  it("targets the calf itself, not its pen", () => {
    const suggestion = creepPlanSuggestion(birth, [feed()]);

    expect(suggestion?.plan.target).toBe("animal");
    expect(suggestion?.plan.targetId).toBe(id(9));
  });

  it("offers the plan switched off", () => {
    // §5.3's run-out projection sums active plans. An active creep plan from
    // day one would count sixty days of feed against a calf entirely on its
    // dam, and the reorder date would come out early every calving season.
    expect(creepPlanSuggestion(birth, [feed()])?.plan.active).toBe(false);
  });

  it("produces a plan the schema will accept", () => {
    const suggestion = creepPlanSuggestion(birth, [feed()]);

    const parsed = feedingPlanSchema.safeParse({
      ...suggestion?.plan,
      id: id(20),
      propertyId: id(0),
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.success).toBe(true);
  });

  it("suggests nothing for a stillbirth", () => {
    expect(creepPlanSuggestion({ ...birth, liveCalf: false }, [feed()])).toBeUndefined();
  });

  it("suggests nothing when no animal was created", () => {
    expect(creepPlanSuggestion({ bornOn: now, liveCalf: true }, [feed()])).toBeUndefined();
  });

  it("suggests nothing when there is no creep feed in the catalogue", () => {
    // Offering an empty prompt anyway trains people to dismiss it, and then
    // the one that mattered gets dismissed too.
    expect(creepPlanSuggestion(birth, [feed({ category: "hay" })])).toBeUndefined();
  });

  it("ignores a creep feed that has been retired", () => {
    expect(creepPlanSuggestion(birth, [feed({ active: false })])).toBeUndefined();
  });

  it("takes an overridden start so the farm can settle on its own number", () => {
    const suggestion = creepPlanSuggestion(birth, [feed()], { startDays: 45 });

    expect(suggestion?.startOn).toEqual(new Date("2027-01-08T06:00:00Z"));
  });
});
