import { z } from "zod";

import { moneySchema, divideMoney, money, sumMoney, type Money } from "../value-objects/money.js";
import { quantitySchema, type Quantity, type Unit } from "../value-objects/quantity.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";
import type { ZoneType } from "./zone.js";

/**
 * Land upkeep, per zone (spec §5.1, "Pasture care", added v0.7).
 *
 * The reason this is a log and not a set of fields on Zone: the question worth
 * answering is "what has this pasture cost and when was it last done", and
 * that is a history. Fall overseeding is an annual event, and last year's rate
 * is what you compare this year's against.
 */

export const PASTURE_CARE_ACTIONS = [
  "seed",
  "overseed",
  "fertilize",
  "spray",
  "mow",
  "drag",
  "soil_test",
] as const;
export type PastureCareAction = (typeof PASTURE_CARE_ACTIONS)[number];

/**
 * The units a per-acre rate is written in — a subset of the kernel's `UNITS`,
 * the same shape `FEED_UNITS` takes and for the same reason. Offering all
 * fourteen would put millilitres and round bales in a seeding-rate dropdown.
 */
export const PASTURE_RATE_UNITS = ["lb", "ton", "bag", "each"] as const;
export type PastureRateUnit = (typeof PASTURE_RATE_UNITS)[number];

export interface PastureCareLog extends BaseRecord {
  readonly zoneId: Ulid;
  readonly action: PastureCareAction;
  readonly performedOn: Date;
  /** Winter rye, 13-13-13, 2,4-D — whatever went on the ground. */
  readonly product?: string | undefined;
  /**
   * Application rate, per acre. Separate from the acreage below so the rate
   * survives treating half a pasture — the rate is what gets repeated next
   * year, the total is not.
   */
  readonly ratePerAcre?: Quantity | undefined;
  /** Acres actually treated, which is not always the whole zone. */
  readonly acres?: number | undefined;
  readonly cost?: Money | undefined;
  /** The supplies-module stock this drew from (§5.11), where it came from stock. */
  readonly supplyItemId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export const pastureCareLogSchema = baseRecordSchema.extend({
  zoneId: ulidSchema,
  action: z.enum(PASTURE_CARE_ACTIONS),
  performedOn: z.coerce.date(),
  product: z.string().max(160).optional(),
  ratePerAcre: quantitySchema
    .refine(
      (rate) => (PASTURE_RATE_UNITS as readonly Unit[]).includes(rate.unit),
      "That is not a unit a seeding or spreading rate is written in",
    )
    .optional(),
  acres: z.number().positive("Acres treated must be more than zero").optional(),
  cost: moneySchema.optional(),
  supplyItemId: ulidSchema.optional(),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<PastureCareLog>;

/**
 * What an application cost per acre.
 *
 * Undefined rather than zero when either input is missing: a mow with no cost
 * recorded costs an unknown amount per acre, not nothing, and a report that
 * quietly averages in zeros understates every total it appears in.
 */
export function costPerAcre(log: Pick<PastureCareLog, "cost" | "acres">): Money | undefined {
  if (log.cost === undefined || log.acres === undefined || log.acres <= 0) return undefined;
  return divideMoney(log.cost, log.acres);
}

/** Everything done to one zone, most recent first. */
export function careHistoryFor(logs: readonly PastureCareLog[], zoneId: Ulid): PastureCareLog[] {
  return logs
    .filter((log) => log.zoneId === zoneId)
    .sort((left, right) => right.performedOn.getTime() - left.performedOn.getTime());
}

/**
 * When a zone last had a given action done to it.
 *
 * Feeds the seasonal reminders: "overseed every fall" is only answerable
 * against the date it was last overseeded.
 */
export function lastPerformed(
  logs: readonly PastureCareLog[],
  zoneId: Ulid,
  action: PastureCareAction,
): Date | undefined {
  return careHistoryFor(logs, zoneId).find((log) => log.action === action)?.performedOn;
}

/**
 * What one pasture has cost.
 *
 * Two numbers, not one. A total that quietly skips the entries with no cost
 * recorded looks like the answer to "what has this pasture cost" and is not
 * — it is a floor. Saying how many entries it could not price is the
 * difference between a figure and a figure with a hole in it, and the screen
 * can then label it rather than presenting it straight.
 */
export interface CareSpend {
  /** The costs that were recorded. Zero when none were. */
  readonly total: Money;
  readonly entries: number;
  /** Entries with no cost against them, which the total does not include. */
  readonly withoutCost: number;
}

export function careSpendFor(logs: readonly PastureCareLog[], zoneId: Ulid): CareSpend {
  const history = careHistoryFor(logs, zoneId);
  const costs = history.map((log) => log.cost).filter((cost): cost is Money => cost !== undefined);

  return {
    total: costs.length === 0 ? money(0) : sumMoney(costs),
    entries: history.length,
    withoutCost: history.length - costs.length,
  };
}

/**
 * Work that comes around with the season (§5.1).
 *
 * "Overseed rye every fall" is not a date, it is a window, and the only thing
 * that answers whether it still needs doing is when it was last done. Both
 * halves live here so the reminder, the chore, and the screen agree.
 */
export interface SeasonalJob {
  readonly action: PastureCareAction;
  readonly label: string;
  /** Months the window is open, inclusive, 1–12. May wrap the new year. */
  readonly fromMonth: number;
  readonly toMonth: number;
}

/**
 * The two the spec names, at Wise County's timings (§5.1, `property-layout.md`).
 *
 * The default only — `seasonalCareDue` takes the list as a parameter, so a
 * farm on different ground, or a second property, carries its own calendar
 * without this file knowing about it.
 */
export const SEASONAL_CARE: readonly SeasonalJob[] = [
  { action: "overseed", label: "Overseed winter rye", fromMonth: 9, toMonth: 11 },
  { action: "fertilize", label: "Spring fertiliser", fromMonth: 3, toMonth: 5 },
];

/** Minimum a zone must expose to be asked whether its season is due. */
export interface ZoneCareRef {
  readonly id: Ulid;
  readonly name: string;
  readonly type: ZoneType;
  readonly active: boolean;
}

export type SeasonalCareStatus =
  /** The window is open and it has not been done in this one. */
  | "due"
  /** The window is open and it has. */
  | "done"
  /** The window has not opened yet — `opensOn` says when. */
  | "scheduled";

export interface SeasonalCareItem {
  readonly zoneId: Ulid;
  readonly zoneName: string;
  readonly job: SeasonalJob;
  readonly status: SeasonalCareStatus;
  /** The window in play: the open one, or the next one to open. */
  readonly opensOn: Date;
  readonly closesOn: Date;
  /** Whenever it was last done, in this window or years ago. */
  readonly lastPerformed?: Date | undefined;
}

/**
 * The window in play for a job, relative to a day.
 *
 * The one that is open if one is, otherwise the next one to open — so a
 * December question about the fall overseed answers with next September rather
 * than with a window that closed a fortnight ago.
 *
 * Wrapping windows (November to February) are handled because the alternative
 * is worse than refusing them: an unwrapped comparison finds no month between
 * 11 and 2 and reports the work as never due, which reads exactly like nothing
 * needing doing.
 */
function windowFor(job: SeasonalJob, today: Date): { opens: Date; closes: Date } {
  const wraps = job.fromMonth > job.toMonth;
  const startOf = (year: number) => new Date(year, job.fromMonth - 1, 1);
  // Day 0 of the month after is the last day of the month itself.
  const endOf = (year: number) => new Date(year, job.toMonth, 0, 23, 59, 59, 999);

  const year = today.getFullYear();
  const started = wraps
    ? { opens: startOf(year - 1), closes: endOf(year) }
    : { opens: startOf(year), closes: endOf(year) };
  const following = wraps
    ? { opens: startOf(year), closes: endOf(year + 1) }
    : { opens: startOf(year + 1), closes: endOf(year + 1) };

  // Whichever has not closed yet: the current window while it is open, the
  // next one once it is over.
  return started.closes >= today ? started : following;
}

/**
 * Which pastures are due for their seasonal work, and which are already done.
 *
 * Pastures only, and active ones only. Nothing overseeds a chute, and a listed
 * chore for a zone that is not in use is a chore somebody has to decide to
 * ignore every time they read the list. Resting ground stays in: resting is
 * often *because* it was just seeded, and it is exactly the ground the fall
 * work is for.
 */
export function seasonalCareDue(
  zones: readonly ZoneCareRef[],
  logs: readonly PastureCareLog[],
  today: Date,
  jobs: readonly SeasonalJob[] = SEASONAL_CARE,
): SeasonalCareItem[] {
  const pastures = zones.filter((zone) => zone.active && zone.type === "pasture");

  return pastures.flatMap((zone) =>
    jobs.map((job) => {
      const { opens, closes } = windowFor(job, today);
      const done = lastPerformed(logs, zone.id, job.action);
      const open = opens <= today && today <= closes;

      const status: SeasonalCareStatus = !open
        ? "scheduled"
        : done !== undefined && done >= opens
          ? "done"
          : "due";

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        job,
        status,
        opensOn: opens,
        closesOn: closes,
        ...(done === undefined ? {} : { lastPerformed: done }),
      };
    }),
  );
}
