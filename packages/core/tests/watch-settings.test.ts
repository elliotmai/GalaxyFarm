import { describe, expect, it } from "vitest";

import {
  DEFAULT_WATCH_SETTINGS,
  isTriggerEnabled,
  isWithinLead,
  resolveWatchSettings,
  WATCH_SIGNALS,
  watchSettingsSchema,
} from "../src/weather/watch-settings.js";

/**
 * §6's configurable thresholds, per-trigger opt-out and lead time.
 *
 * The property these tests are really protecting: a farm that has tuned two
 * numbers keeps them when a third is added. Storing settings as a whole object
 * and reading it back whole would reset everything the moment the shape grew,
 * and nobody would notice until an alert stopped firing.
 */

describe("DEFAULT_WATCH_SETTINGS", () => {
  it("carries the spec's own numbers", () => {
    expect(DEFAULT_WATCH_SETTINGS.calfChillF).toBe(20);
    expect(DEFAULT_WATCH_SETTINGS.pressureFallHpa).toBe(4);
    expect(DEFAULT_WATCH_SETTINGS.calvingWindowDays).toBe(14);
    expect(DEFAULT_WATCH_SETTINGS.gestationDays).toBe(283);
  });

  it("gives every signal a setting", () => {
    // A signal with no entry would read as undefined and every lookup on it
    // would throw at 2am rather than in a test.
    for (const signal of WATCH_SIGNALS) {
      expect(DEFAULT_WATCH_SETTINGS.triggers[signal]).toBeDefined();
    }
  });

  it("leads by how long the person needs, not by a round number", () => {
    // A cold snap gets an evening because bedding a pen takes one. A full moon
    // gets none because it is on the calendar and nobody needs warning.
    expect(DEFAULT_WATCH_SETTINGS.triggers.cold_snap.leadHours).toBe(24);
    expect(DEFAULT_WATCH_SETTINGS.triggers.full_moon.leadHours).toBe(0);
  });

  it("validates against its own schema", () => {
    expect(watchSettingsSchema.safeParse(DEFAULT_WATCH_SETTINGS).success).toBe(true);
  });
});

describe("resolveWatchSettings", () => {
  it("falls back whole when nothing is stored", () => {
    expect(resolveWatchSettings(undefined)).toEqual(DEFAULT_WATCH_SETTINGS);
    expect(resolveWatchSettings(null)).toEqual(DEFAULT_WATCH_SETTINGS);
  });

  it("keeps a tuned threshold and defaults the rest", () => {
    const resolved = resolveWatchSettings({ calfChillF: 28 });

    expect(resolved.calfChillF).toBe(28);
    expect(resolved.pressureFallHpa).toBe(DEFAULT_WATCH_SETTINGS.pressureFallHpa);
  });

  it("keeps one switched-off trigger without resetting the others", () => {
    // The case this whole function exists for: somebody turns the full moon
    // off, and a later version adds a threshold. A whole-object read would
    // turn the moon back on.
    const resolved = resolveWatchSettings({
      triggers: { full_moon: { enabled: false, leadHours: 0 } },
    } as never);

    expect(resolved.triggers.full_moon.enabled).toBe(false);
    expect(resolved.triggers.cold_snap.enabled).toBe(true);
    expect(resolved.triggers.pressure_fall.leadHours).toBe(12);
  });

  it("fills a partial trigger from the default rather than producing undefined", () => {
    const resolved = resolveWatchSettings({
      triggers: { cold_snap: { enabled: false } },
    } as never);

    expect(resolved.triggers.cold_snap.enabled).toBe(false);
    expect(resolved.triggers.cold_snap.leadHours).toBe(24);
  });

  it("ignores a stored value that is not an object", () => {
    expect(resolveWatchSettings("nonsense")).toEqual(DEFAULT_WATCH_SETTINGS);
    expect(resolveWatchSettings(7)).toEqual(DEFAULT_WATCH_SETTINGS);
  });
});

describe("isTriggerEnabled", () => {
  it("reports the opt-out", () => {
    const settings = resolveWatchSettings({
      triggers: { full_moon: { enabled: false, leadHours: 0 } },
    } as never);

    expect(isTriggerEnabled(settings, "full_moon")).toBe(false);
    expect(isTriggerEnabled(settings, "cold_snap")).toBe(true);
  });
});

describe("isWithinLead", () => {
  const settings = DEFAULT_WATCH_SETTINGS;
  const event = new Date("2026-11-20T22:00:00Z");

  it("opens a window rather than firing at one instant", () => {
    // The poll runs on a schedule nobody controls to the minute. Treating the
    // lead as a moment would mean a poll at the wrong hour missed it entirely.
    expect(isWithinLead(settings, "cold_snap", event, new Date("2026-11-20T02:00:00Z"))).toBe(true);
    expect(isWithinLead(settings, "cold_snap", event, new Date("2026-11-20T18:00:00Z"))).toBe(true);
  });

  it("says nothing before the window opens", () => {
    expect(isWithinLead(settings, "cold_snap", event, new Date("2026-11-19T12:00:00Z"))).toBe(
      false,
    );
  });

  it("stops once the event has passed", () => {
    expect(isWithinLead(settings, "cold_snap", event, new Date("2026-11-20T23:00:00Z"))).toBe(
      false,
    );
  });

  it("counts an event happening exactly now as still in front of you", () => {
    expect(isWithinLead(settings, "cold_snap", event, event)).toBe(true);
  });

  it("fires a zero-lead trigger only at the event", () => {
    expect(isWithinLead(settings, "full_moon", event, new Date("2026-11-20T20:00:00Z"))).toBe(
      false,
    );
    expect(isWithinLead(settings, "full_moon", event, event)).toBe(true);
  });

  it("never fires a trigger that is switched off", () => {
    const off = resolveWatchSettings({
      triggers: { cold_snap: { enabled: false, leadHours: 24 } },
    } as never);

    expect(isWithinLead(off, "cold_snap", event, new Date("2026-11-20T18:00:00Z"))).toBe(false);
  });
});

/**
 * The weaning window, as a setting (spec §6).
 *
 * Two ages rather than one, because weaning does not happen on a single
 * correct day: a calf may come off from the first and must be off by the
 * second. A lone figure could only ever be one of the two, and either choice
 * is wrong — the early one nags for a month about work that is not late, the
 * late one never warns until it already is.
 */
describe("the weaning window", () => {
  const valid = { ...DEFAULT_WATCH_SETTINGS };

  it("ships the range this farm works to", () => {
    expect(DEFAULT_WATCH_SETTINGS.weaningEarliestDays).toBe(120);
    expect(DEFAULT_WATCH_SETTINGS.weaningLatestDays).toBe(150);
  });

  it("refuses a deadline that falls before the earliest day", () => {
    // Neither figure is wrong on its own; the pair is. Every calf would be
    // overdue the moment it appeared, and none could ever be weaned in time.
    const backwards = watchSettingsSchema.safeParse({
      ...valid,
      weaningEarliestDays: 150,
      weaningLatestDays: 120,
    });

    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(["weaningLatestDays"]);
  });

  it("refuses the two being equal, which leaves no window at all", () => {
    expect(
      watchSettingsSchema.safeParse({
        ...valid,
        weaningEarliestDays: 140,
        weaningLatestDays: 140,
      }).success,
    ).toBe(false);
  });

  it("takes a wider window for an operation that runs one", () => {
    expect(
      watchSettingsSchema.safeParse({
        ...valid,
        weaningEarliestDays: 180,
        weaningLatestDays: 240,
      }).success,
    ).toBe(true);
  });

  it("will not take an age that is not a calf's", () => {
    // Below about two months nothing is ready to be off milk; past a year it
    // is not a calf.
    expect(watchSettingsSchema.safeParse({ ...valid, weaningEarliestDays: 10 }).success).toBe(
      false,
    );
    expect(watchSettingsSchema.safeParse({ ...valid, weaningLatestDays: 400 }).success).toBe(false);
  });

  it("fills the window in for a property saved before it existed", () => {
    // The merge is what stops a new setting silently resetting the two
    // somebody had already tuned.
    const older = resolveWatchSettings({ calfChillF: 25, gestationDays: 279 } as never);

    expect(older.weaningEarliestDays).toBe(120);
    expect(older.weaningLatestDays).toBe(150);
    expect(older.calfChillF).toBe(25);
    expect(older.gestationDays).toBe(279);
  });

  it("keeps a window somebody has set", () => {
    const tuned = resolveWatchSettings({
      weaningEarliestDays: 100,
      weaningLatestDays: 130,
    } as never);

    expect(tuned.weaningEarliestDays).toBe(100);
    expect(tuned.weaningLatestDays).toBe(130);
  });
});
