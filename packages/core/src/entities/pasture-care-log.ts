import { z } from "zod";

import { moneySchema, divideMoney, type Money } from "../value-objects/money.js";
import { quantitySchema, type Quantity } from "../value-objects/quantity.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

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
  ratePerAcre: quantitySchema.optional(),
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
