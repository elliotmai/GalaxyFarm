import { z } from "zod";

import {
  DEFAULT_CALF_CHILL_F,
  DEFAULT_FROST_F,
  DEFAULT_HARD_FREEZE_F,
  DEFAULT_PRESSURE_FALL_HPA,
} from "./thresholds.js";

/**
 * What the farm has decided the weather means (spec §6).
 *
 * §6 asks for "configurable thresholds, per-trigger opt-out, and lead time",
 * and the reason all three are needed is the same reason: an alert that fires
 * when nothing needs doing is worse than no alert, because it is the one that
 * teaches somebody to swipe the next one away. The full moon is the clearest
 * case — it is in the spec, people weigh it, and it will be the first thing
 * somebody wants switched off.
 *
 * The signal names live here rather than in the cattle module because the
 * settings are property-wide and the poller that reads them is not cattle
 * code. `@galaxy-farm/module-cattle` re-exports them so a caller holding a
 * watch card does not have to know that.
 */

export const WATCH_SIGNALS = ["cold_snap", "pressure_fall", "full_moon"] as const;
export type WatchSignal = (typeof WATCH_SIGNALS)[number];

export interface WatchTrigger {
  readonly enabled: boolean;
  /**
   * How far ahead of the event to say something, in hours.
   *
   * Zero means "when it happens", which is right for a full moon and wrong for
   * a cold snap — somebody who finds out at 20 °F that it is 20 °F has already
   * lost the evening they needed to bed a pen down.
   */
  readonly leadHours: number;
}

export interface WatchSettings {
  /** Below this, a wet newborn chills. §6's default is 20 °F. */
  readonly calfChillF: number;
  /** §6: "≥ 4 hPa / ~0.12 inHg within 24 h". */
  readonly pressureFallHpa: number;
  /** How near a full moon still counts. §6 says ± 1 day. */
  readonly fullMoonDays: number;
  /** The fortnight either side of the due date, per §6. */
  readonly calvingWindowDays: number;
  /** §12 decision 2: a flat 283 days, editable here. */
  readonly gestationDays: number;
  readonly frostF: number;
  readonly hardFreezeF: number;
  readonly triggers: Readonly<Record<WatchSignal, WatchTrigger>>;
}

/**
 * The spec's numbers, which is what a property gets until somebody changes one.
 *
 * Lead times differ by what the person can actually do about it. A cold snap
 * gets a full day because bedding a pen and moving a close-up cow takes an
 * evening. A pressure fall gets twelve hours because that is about as far
 * ahead as the fall is legible in a forecast. A full moon gets none — it is on
 * the calendar and nobody needs warning about it.
 */
export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  calfChillF: DEFAULT_CALF_CHILL_F,
  pressureFallHpa: DEFAULT_PRESSURE_FALL_HPA,
  fullMoonDays: 1,
  calvingWindowDays: 14,
  gestationDays: 283,
  frostF: DEFAULT_FROST_F,
  hardFreezeF: DEFAULT_HARD_FREEZE_F,
  triggers: {
    cold_snap: { enabled: true, leadHours: 24 },
    pressure_fall: { enabled: true, leadHours: 12 },
    full_moon: { enabled: true, leadHours: 0 },
  },
};

const triggerSchema = z.object({
  enabled: z.boolean(),
  leadHours: z.number().int().min(0).max(168),
});

export const watchSettingsSchema = z.object({
  calfChillF: z.number().min(-40).max(80),
  pressureFallHpa: z.number().min(0.5).max(50),
  fullMoonDays: z.number().int().min(0).max(7),
  calvingWindowDays: z.number().int().min(1).max(45),
  gestationDays: z.number().int().min(240).max(320),
  frostF: z.number().min(-40).max(80),
  hardFreezeF: z.number().min(-40).max(80),
  triggers: z.object({
    cold_snap: triggerSchema,
    pressure_fall: triggerSchema,
    full_moon: triggerSchema,
  }),
});

/**
 * Fill the gaps from the defaults.
 *
 * Stored settings are `jsonb`, so a property saved before a setting existed
 * simply does not have it. Merging rather than replacing means adding a
 * threshold in a later version does not silently reset the two somebody had
 * already tuned — which is what a whole-object read would do.
 */
export function resolveWatchSettings(stored: unknown): WatchSettings {
  if (stored === null || typeof stored !== "object") return DEFAULT_WATCH_SETTINGS;

  const partial = stored as Partial<WatchSettings>;
  const triggers = { ...DEFAULT_WATCH_SETTINGS.triggers };

  for (const signal of WATCH_SIGNALS) {
    const override = partial.triggers?.[signal];
    if (override !== undefined) {
      triggers[signal] = {
        enabled: override.enabled ?? DEFAULT_WATCH_SETTINGS.triggers[signal].enabled,
        leadHours: override.leadHours ?? DEFAULT_WATCH_SETTINGS.triggers[signal].leadHours,
      };
    }
  }

  return { ...DEFAULT_WATCH_SETTINGS, ...partial, triggers };
}

/** Whether this signal is worth computing at all for this property. */
export function isTriggerEnabled(settings: WatchSettings, signal: WatchSignal): boolean {
  return settings.triggers[signal].enabled;
}

/**
 * Is it time to say something about an event at `at`?
 *
 * The lead time is a window opening, not a delay: a trigger with 24 hours of
 * lead fires from a day out and keeps firing until the event passes. Treating
 * it as a single moment would mean a poll that ran at the wrong hour missed it
 * entirely, and the poll runs on a schedule nobody controls to the minute.
 */
export function isWithinLead(
  settings: WatchSettings,
  signal: WatchSignal,
  at: Date,
  now: Date,
): boolean {
  if (!isTriggerEnabled(settings, signal)) return false;

  const leadMs = settings.triggers[signal].leadHours * 3_600_000;
  const opens = at.getTime() - leadMs;
  // Half-open at the far end, like every other range in the kernel. An event
  // exactly now is still in front of you.
  return now.getTime() >= opens && now.getTime() <= at.getTime();
}
