import { describe, expect, it } from "vitest";

import { encodeUlid, isUlid, ulidSchema, ulidTimestamp } from "../src/types/ids.js";

/** Deterministic "randomness" so the tests assert on exact output. */
const constantRandom = (value: number) => () => value;

describe("ULID", () => {
  it("produces 26 characters", () => {
    expect(encodeUlid(0, constantRandom(0))).toHaveLength(26);
    expect(encodeUlid(Date.UTC(2026, 7, 11), constantRandom(0.5))).toHaveLength(26);
  });

  it("round-trips the timestamp", () => {
    const at = Date.UTC(2026, 7, 11, 4, 30, 0);

    expect(ulidTimestamp(encodeUlid(at, constantRandom(0)))).toBe(at);
  });

  it("sorts lexicographically by creation time", () => {
    // This is the property the outbox depends on: ids that sort by time give
    // the sync engine a sensible drain order for free (spec §4.2).
    const earlier = encodeUlid(1_000_000, constantRandom(0));
    const later = encodeUlid(2_000_000, constantRandom(0));

    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("differs for the same timestamp with different randomness", () => {
    const at = 1_700_000_000_000;

    expect(encodeUlid(at, constantRandom(0))).not.toBe(encodeUlid(at, constantRandom(0.9)));
  });

  it("recognises its own output", () => {
    expect(isUlid(encodeUlid(Date.now(), constantRandom(0.25)))).toBe(true);
  });

  it.each(["", "too-short", "0123456789012345678901234", "!!!!!!!!!!!!!!!!!!!!!!!!!!"])(
    "rejects %s",
    (value) => {
      expect(isUlid(value)).toBe(false);
    },
  );

  it("rejects lowercase, which Crockford base32 does not use", () => {
    const valid = encodeUlid(1_000, constantRandom(0));

    expect(isUlid(valid.toLowerCase())).toBe(false);
  });

  it("rejects an impossible timestamp", () => {
    expect(() => encodeUlid(-1, constantRandom(0))).toThrow(RangeError);
    expect(() => encodeUlid(Number.NaN, constantRandom(0))).toThrow(RangeError);
    expect(() => encodeUlid(2 ** 49, constantRandom(0))).toThrow(/48 bits/);
  });

  it("validates through the schema", () => {
    const valid = encodeUlid(1_000, constantRandom(0));

    expect(ulidSchema.safeParse(valid).success).toBe(true);
    expect(ulidSchema.safeParse("nope").success).toBe(false);
  });
});
