import { describe, expect, it } from "vitest";

import type { OutboxEntry, Ulid } from "@galaxy-farm/core";

import {
  farmDay,
  kitchenEggConfig,
  parseKitchenEggResponse,
  settledIds,
  toKitchenRecord,
  touchesEggs,
  type PendingEggRecord,
} from "../lib/kitchen-eggs.js";

/**
 * Eggs to the kitchen — what is sent (spec §4.3 "Connected apps").
 *
 * The arithmetic is KitchenHub's; what has to be right here is that each
 * record is described as it now is, on the farm's own calendar, with a version
 * that only moves forward.
 */

const TOKEN = "khapp_" + "x".repeat(43);
const updatedAt = new Date("2026-11-25T19:00:00.000Z");

const log = (overrides: Partial<PendingEggRecord> = {}): PendingEggRecord => ({
  entity: "eggLogs",
  id: "01KLOG",
  updatedAt,
  deletedAt: null,
  on: new Date("2026-11-25T18:00:00.000Z"),
  quantity: 6,
  kind: null,
  ...overrides,
});

describe("kitchenEggConfig", () => {
  const env = {
    KITCHENHUB_URL: "https://kitchen.example.com/",
    KITCHENHUB_TOKEN: TOKEN,
    KITCHENHUB_PROPERTY_ID: "01PROPERTY",
  };

  it("is all three settings or nothing", () => {
    expect(kitchenEggConfig(env)).toEqual({
      endpoint: "https://kitchen.example.com/api/farm/eggs",
      token: TOKEN,
      propertyId: "01PROPERTY",
    });
    expect(kitchenEggConfig({ ...env, KITCHENHUB_TOKEN: "" })).toBeUndefined();
    expect(kitchenEggConfig({ ...env, KITCHENHUB_PROPERTY_ID: undefined })).toBeUndefined();
    expect(kitchenEggConfig({})).toBeUndefined();
  });

  it("refuses to send a token anywhere but https", () => {
    expect(kitchenEggConfig({ ...env, KITCHENHUB_URL: "http://kitchen.example.com" })).toBe(
      undefined,
    );
    expect(kitchenEggConfig({ ...env, KITCHENHUB_URL: "not a url" })).toBeUndefined();
  });
});

describe("touchesEggs", () => {
  const entry = (entity: string) =>
    ({ patch: { entity, recordId: "01X" as Ulid, changes: [] } }) as unknown as OutboxEntry;

  it("is true only for egg logs and dispositions", () => {
    expect(touchesEggs([entry("animals"), entry("eggLogs")])).toBe(true);
    expect(touchesEggs([entry("eggDispositions")])).toBe(true);
    expect(touchesEggs([entry("animals"), entry("flocks")])).toBe(false);
    expect(touchesEggs([])).toBe(false);
  });
});

describe("toKitchenRecord", () => {
  it("sends a log as it is, dated on the farm's calendar", () => {
    expect(toKitchenRecord(log(), "America/Chicago")).toEqual({
      id: "01KLOG",
      type: "log",
      version: "2026-11-25T19:00:00.000Z",
      date: "2026-11-25",
      quantity: 6,
      deleted: false,
    });
  });

  it("marks a tombstoned record deleted, so the kitchen takes its eggs back out", () => {
    expect(toKitchenRecord(log({ deletedAt: updatedAt }), "UTC").deleted).toBe(true);
  });

  it("sends a disposition with its kind", () => {
    const given = log({ entity: "eggDispositions", id: "01KDIS", kind: "given", quantity: 4 });
    expect(toKitchenRecord(given, "UTC")).toMatchObject({
      type: "disposition",
      kind: "given",
      quantity: 4,
      deleted: false,
    });
  });

  it("sends something it cannot describe as contributing nothing", () => {
    const odd = log({ entity: "eggDispositions", kind: "eaten" });
    expect(toKitchenRecord(odd, "UTC")).toMatchObject({ kind: "kept", deleted: true });
    expect(toKitchenRecord(log({ quantity: 2.5 }), "UTC")).toMatchObject({
      quantity: 0,
      deleted: true,
    });
  });
});

describe("farmDay", () => {
  it("reads the day in the farm's zone, and falls back to UTC", () => {
    const evening = new Date("2026-11-26T03:00:00Z");
    expect(farmDay(evening, "America/Chicago")).toBe("2026-11-25");
    expect(farmDay(evening, "Not/AZone")).toBe("2026-11-26");
  });
});

describe("the answer", () => {
  it("settles every id the kitchen dealt with", () => {
    const answer = parseKitchenEggResponse({
      ok: true,
      item: { id: "galaxyfarm-eggs", quantity: 6 },
      applied: ["a"],
      unchanged: ["b"],
      ignored: [{ id: "c", reason: "old" }],
      rejected: [{ id: null, reason: "no id" }],
    });
    expect([...settledIds(answer)].sort()).toEqual(["a", "b", "c"]);
  });

  it("refuses an answer that is not the endpoint's", () => {
    expect(() => parseKitchenEggResponse({ ok: true })).toThrow();
  });
});
