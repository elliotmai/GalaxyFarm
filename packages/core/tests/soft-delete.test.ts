import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_DAYS,
  deletedOnly,
  isDeleted,
  isLive,
  isPurgeable,
  liveOnly,
  restore,
  softDelete,
  type BaseRecord,
} from "../src/entities/record.js";
import { encodeUlid } from "../src/types/ids.js";

const id = encodeUlid(1_000, () => 0.1);
const propertyId = encodeUlid(1_001, () => 0.2);
const userId = encodeUlid(1_002, () => 0.3);

const record = (): BaseRecord => ({
  id,
  propertyId,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("soft delete — spec §4.5 clause 4", () => {
  const deletedAt = new Date("2026-02-01T00:00:00Z");

  it("writes a tombstone rather than removing anything", () => {
    const deleted = softDelete(record(), deletedAt, userId, "sold at the barn");

    expect(deleted.deletedAt).toEqual(deletedAt);
    expect(deleted.deletedBy).toBe(userId);
    expect(deleted.deletedReason).toBe("sold at the barn");
    expect(isDeleted(deleted)).toBe(true);
    expect(isLive(deleted)).toBe(false);
  });

  it("bumps updatedAt so the sync engine notices the change", () => {
    // A tombstone that does not move updatedAt never reaches the other devices,
    // and the record resurrects on their next pull (§4.2).
    const deleted = softDelete(record(), deletedAt, userId);

    expect(deleted.updatedAt).toEqual(deletedAt);
  });

  it("does not mutate the original", () => {
    const original = record();
    softDelete(original, deletedAt, userId);

    expect(original.deletedAt).toBeUndefined();
  });

  it("makes the reason optional but keeps it when given", () => {
    expect(softDelete(record(), deletedAt, userId).deletedReason).toBeUndefined();
  });

  it("restores cleanly, leaving no tombstone fields behind", () => {
    const restoredAt = new Date("2026-02-05T00:00:00Z");
    const restored = restore(softDelete(record(), deletedAt, userId, "mistake"), restoredAt);

    expect(restored.deletedAt).toBeUndefined();
    expect(restored.deletedBy).toBeUndefined();
    expect(restored.deletedReason).toBeUndefined();
    expect(isLive(restored)).toBe(true);
    expect(restored.updatedAt).toEqual(restoredAt);
    expect("deletedAt" in restored).toBe(false);
  });

  it("separates live from deleted for the normal read path and Trash", () => {
    const live = record();
    const dead = softDelete(record(), deletedAt, userId);

    expect(liveOnly([live, dead])).toEqual([live]);
    expect(deletedOnly([live, dead])).toEqual([dead]);
  });

  describe("retention", () => {
    it("never purges a live record", () => {
      expect(isPurgeable(record(), new Date("2030-01-01T00:00:00Z"))).toBe(false);
    });

    it("holds a deleted record for the retention window", () => {
      const deleted = softDelete(record(), deletedAt, userId);
      const dayBefore = new Date(deletedAt.getTime() + (DEFAULT_RETENTION_DAYS - 1) * 86_400_000);

      expect(isPurgeable(deleted, dayBefore)).toBe(false);
    });

    it("becomes purgeable exactly at the window", () => {
      const deleted = softDelete(record(), deletedAt, userId);
      const atWindow = new Date(deletedAt.getTime() + DEFAULT_RETENTION_DAYS * 86_400_000);

      expect(isPurgeable(deleted, atWindow)).toBe(true);
    });

    it("honours a configured window", () => {
      const deleted = softDelete(record(), deletedAt, userId);
      const day8 = new Date(deletedAt.getTime() + 8 * 86_400_000);

      expect(isPurgeable(deleted, day8, 7)).toBe(true);
      expect(isPurgeable(deleted, day8, 90)).toBe(false);
    });
  });
});
