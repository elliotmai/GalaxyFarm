import { describe, expect, it } from "vitest";

import { projectEvents, type Ulid } from "@galaxy-farm/core";

import { feedCalendarEntries } from "../src/domain/calendar.js";
import type { FeedType } from "../src/domain/feed-type.js";
import type { FeedConsumption, FeedPurchase } from "../src/domain/inventory.js";

/**
 * Feed's half of the unified calendar (spec §6, §5.3).
 *
 * The point of the reorder row is that it is a different day from the run-out.
 * A calendar that carried only the run-out would be announcing the empty barn
 * on the morning it happens, which is a week after the order needed placing.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const hay = (over: Partial<FeedType> = {}): FeedType => ({
  ...base,
  id: id(1),
  name: "Coastal round bales",
  category: "hay",
  unit: "round_bale",
  reorderLeadDays: 7,
  active: true,
  ...over,
});

const purchase = (over: Partial<FeedPurchase> = {}): FeedPurchase => ({
  ...base,
  id: id(2),
  feedTypeId: id(1),
  quantity: 20,
  unitCost: { cents: 9000 },
  purchasedOn: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const counted = (over: Partial<FeedConsumption> = {}): FeedConsumption => ({
  ...base,
  id: id(3),
  feedTypeId: id(1),
  quantity: 0,
  kind: "correction",
  usedOn: new Date("2026-08-11T12:00:00Z"),
  ...over,
});

const oneADay = new Map<Ulid, number>([[id(1), 1]]);

describe("feedCalendarEntries", () => {
  it("projects the run-out and the reorder point a lead time apart", () => {
    const entries = feedCalendarEntries(
      {
        feedTypes: [hay()],
        purchases: [purchase()],
        consumption: [counted()],
        demandByFeedType: oneADay,
      },
      AT,
    );

    const runOut = entries.find((entry) => entry.kind === "feed_run_out");
    const order = entries.find((entry) => entry.kind === "feed_reorder");

    expect(runOut?.at).toEqual(new Date("2026-08-31T12:00:00Z"));
    expect(order?.at).toEqual(new Date("2026-08-24T12:00:00Z"));
  });

  it("gives the two rows different ids, so neither overwrites the other", () => {
    // They share a kind's worth of subject matter and the same feed type, which
    // is exactly the collision `projectedId` would produce if both were
    // `feed_run_out`.
    const entries = feedCalendarEntries(
      {
        feedTypes: [hay()],
        purchases: [purchase()],
        consumption: [counted()],
        demandByFeedType: oneADay,
      },
      AT,
    );

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.every((entry) => entry.module === "feed")).toBe(true);
  });

  it("is idempotent, and moves both rows when a correction is entered", () => {
    const input = {
      feedTypes: [hay()],
      purchases: [purchase()],
      consumption: [counted()],
      demandByFeedType: oneADay,
    };

    expect(feedCalendarEntries(input, AT).map((entry) => entry.id)).toEqual(
      feedCalendarEntries(input, AT).map((entry) => entry.id),
    );

    // Somebody counts the barn and finds ten bales, not twenty. Both dates
    // pull in by ten days; the ids do not change, because the feed type is
    // still the feed type.
    const recounted = feedCalendarEntries(
      { ...input, consumption: [counted({ quantity: 10 })] },
      AT,
    );

    expect(recounted.map((entry) => entry.id)).toEqual(
      feedCalendarEntries(input, AT).map((entry) => entry.id),
    );
    expect(recounted.find((entry) => entry.kind === "feed_run_out")?.at).toEqual(
      new Date("2026-08-21T12:00:00Z"),
    );
  });

  it("says nothing about a feed nothing is eating", () => {
    // `runOutDate` returns undefined rather than a date of "never", and a
    // calendar has nowhere to put "never".
    const entries = feedCalendarEntries(
      {
        feedTypes: [hay()],
        purchases: [purchase()],
        consumption: [],
        demandByFeedType: new Map(),
      },
      AT,
    );

    expect(entries).toEqual([]);
  });

  it("leaves a retired feed type alone", () => {
    const entries = feedCalendarEntries(
      {
        feedTypes: [hay({ active: false })],
        purchases: [purchase()],
        consumption: [counted()],
        demandByFeedType: oneADay,
      },
      AT,
    );

    expect(entries).toEqual([]);
  });

  it("merges into the kernel's calendar under the feed filter", () => {
    const entries = feedCalendarEntries(
      {
        feedTypes: [hay()],
        purchases: [purchase()],
        consumption: [counted()],
        demandByFeedType: oneADay,
      },
      AT,
    );

    const week = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-08-24T00:00:00Z"), to: new Date("2026-08-31T00:00:00Z") },
      ["feed"],
    );

    expect(week.map((entry) => entry.kind)).toEqual(["feed_reorder"]);
  });
});
