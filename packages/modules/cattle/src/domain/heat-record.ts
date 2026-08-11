import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  ulidSchema,
  type BaseRecord,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Heat observations, and the 21-day return (spec §5.2).
 *
 * The prediction is the whole point: a cow bred three weeks ago who shows heat
 * again did not settle, and the window to notice that is about a day wide.
 */

export const HEAT_INTENSITIES = ["standing", "strong", "moderate", "weak", "suspected"] as const;
export type HeatIntensity = (typeof HEAT_INTENSITIES)[number];

/** The bovine oestrous cycle. Eighteen to twenty-four days; twenty-one is the middle. */
export const OESTRUS_CYCLE_DAYS = 21;
export const OESTRUS_CYCLE_SPREAD_DAYS = 3;

export interface HeatRecord extends BaseRecord {
  readonly animalId: Ulid;
  readonly observedAt: Date;
  readonly intensity: HeatIntensity;
  /** Who or what saw it — a person, or a heat-detection patch. */
  readonly observedBy?: string | undefined;
  readonly notes?: string | undefined;
}

export const heatRecordSchema = baseRecordSchema.extend({
  animalId: ulidSchema,
  observedAt: z.coerce.date(),
  intensity: z.enum(HEAT_INTENSITIES),
  observedBy: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<HeatRecord>;

/** One cow's heats, most recent first. */
export function heatsFor(records: readonly HeatRecord[], animalId: Ulid): HeatRecord[] {
  return records
    .filter((record) => record.animalId === animalId)
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
}

/**
 * When to be watching next.
 *
 * A window rather than a date, because eighteen to twenty-four days is the
 * real range and a single date makes people stop looking on day twenty-two.
 * Built from the most recent observation only: heats before it are already
 * accounted for by it.
 */
export function nextExpectedHeat(
  records: readonly HeatRecord[],
  animalId: Ulid,
): { readonly from: Date; readonly expected: Date; readonly to: Date } | undefined {
  const [latest] = heatsFor(records, animalId);
  if (latest === undefined) return undefined;

  const expected = addDays(latest.observedAt, OESTRUS_CYCLE_DAYS);
  return {
    from: addDays(expected, -OESTRUS_CYCLE_SPREAD_DAYS),
    expected,
    to: addDays(expected, OESTRUS_CYCLE_SPREAD_DAYS),
  };
}

/**
 * A heat seen after a breeding, inside the return window — she likely did not
 * settle.
 *
 * Reported rather than acted on. This is a signal to check her, not a
 * conclusion: cows do show heat while pregnant, uncommonly, and an app that
 * quietly marked a breeding failed would lose a real pregnancy.
 */
export function suspectedReturnToHeat(
  records: readonly HeatRecord[],
  animalId: Ulid,
  bredOn: Date,
): HeatRecord | undefined {
  const from = addDays(bredOn, OESTRUS_CYCLE_DAYS - OESTRUS_CYCLE_SPREAD_DAYS);
  const to = addDays(bredOn, OESTRUS_CYCLE_DAYS + OESTRUS_CYCLE_SPREAD_DAYS);

  return heatsFor(records, animalId).find(
    (record) => record.observedAt >= from && record.observedAt <= to,
  );
}
