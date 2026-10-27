import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_MS,
  MAX_BACKOFF_MS,
  QUIET_HEARTBEAT_MS,
  isQuietHour,
  nextSyncDelay,
} from "../lib/sync-schedule.js";

const at = (hour: number) => new Date(2026, 9, 27, hour, 15);

describe("isQuietHour", () => {
  it("is 9 p.m. up to 5 a.m.", () => {
    expect(isQuietHour(at(20))).toBe(false);
    expect(isQuietHour(at(21))).toBe(true);
    expect(isQuietHour(at(2))).toBe(true);
    expect(isQuietHour(at(4))).toBe(true);
    expect(isQuietHour(at(5))).toBe(false);
  });
});

describe("nextSyncDelay", () => {
  it("is a minute by day, on any surface", () => {
    expect(nextSyncDelay({ at: at(10), quietOvernight: true, refusals: 0 })).toBe(HEARTBEAT_MS);
    expect(nextSyncDelay({ at: at(10), quietOvernight: false, refusals: 0 })).toBe(HEARTBEAT_MS);
  });

  it("slows a kiosk overnight, and only a kiosk", () => {
    expect(nextSyncDelay({ at: at(2), quietOvernight: true, refusals: 0 })).toBe(
      QUIET_HEARTBEAT_MS,
    );
    expect(nextSyncDelay({ at: at(2), quietOvernight: false, refusals: 0 })).toBe(HEARTBEAT_MS);
  });

  it("doubles per refusal in a row, up to the cap", () => {
    const delay = (refusals: number) =>
      nextSyncDelay({ at: at(10), quietOvernight: false, refusals });

    expect(delay(1)).toBe(2 * HEARTBEAT_MS);
    expect(delay(2)).toBe(4 * HEARTBEAT_MS);
    expect(delay(4)).toBe(16 * HEARTBEAT_MS);
    expect(delay(5)).toBe(MAX_BACKOFF_MS);
    expect(delay(50)).toBe(MAX_BACKOFF_MS);
  });

  it("never backs off to less than the overnight wait", () => {
    expect(nextSyncDelay({ at: at(2), quietOvernight: true, refusals: 1 })).toBe(
      QUIET_HEARTBEAT_MS,
    );
  });
});
