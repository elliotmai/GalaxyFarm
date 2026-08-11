import { z } from "zod";

import type { Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * A trough, tank, or natural water — its own record, because tanks are shared.
 *
 * Modelling water as a boolean on `Zone` assumed one tank per zone. On this
 * place three of the four tanks serve two zones each and one serves three, so
 * the freeze chore in §6 would have fired once per *zone* — seven or eight
 * chores for four tanks, sending someone to the same trough twice. A chore list
 * that does that stops being trusted, and a chore list nobody trusts is worse
 * than none on the morning it matters.
 *
 * With the tank as the record, there is one chore per tank, and a heater is a
 * property of the tank rather than of every zone that drinks from it.
 */

export const WATER_SOURCE_TYPES = ["auto_refill", "static_tank", "pond", "creek"] as const;
export type WaterSourceType = (typeof WATER_SOURCE_TYPES)[number];

export interface WaterSource extends BaseRecord {
  readonly name: string;
  readonly type: WaterSourceType;
  readonly hasHeater: boolean;
  /**
   * False when a seasonal tank is not currently out.
   *
   * West Pen only has water when a tank is put there, so presence is a state
   * rather than a fact about the pen. An inactive source raises no chore.
   */
  readonly active: boolean;
  readonly notes?: string | undefined;
}

export const waterSourceSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A water source needs a name").max(80),
  type: z.enum(WATER_SOURCE_TYPES),
  hasHeater: z.boolean(),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<WaterSource>;

/** Minimum a zone must expose to be matched to its water. */
export interface ZoneWaterRef {
  readonly id: Ulid;
  readonly name: string;
  readonly active: boolean;
  readonly waterSourceIds: readonly Ulid[];
}

export interface FreezeCheckTarget {
  readonly waterSource: WaterSource;
  /** Every zone drinking from it — what the chore names. */
  readonly zones: readonly ZoneWaterRef[];
  /** No heater. §6 calls these out by name as the vulnerable ones. */
  readonly vulnerable: boolean;
}

/**
 * One entry per tank that needs checking on a freeze day (§6).
 *
 * Keyed on the water source, never on the zone — that is the whole point. A
 * source nothing drinks from raises no chore, and neither does one that is not
 * currently out.
 */
export function freezeCheckTargets(
  waterSources: readonly WaterSource[],
  zones: readonly ZoneWaterRef[],
): FreezeCheckTarget[] {
  const liveZones = zones.filter((zone) => zone.active);

  return waterSources
    .filter((source) => source.active)
    .map((source) => ({
      waterSource: source,
      zones: liveZones.filter((zone) => zone.waterSourceIds.includes(source.id)),
      vulnerable: !source.hasHeater,
    }))
    .filter((target) => target.zones.length > 0);
}

/** The heaterless subset, which the alert names individually (§6). */
export function vulnerableToFreezing(targets: readonly FreezeCheckTarget[]): FreezeCheckTarget[] {
  return targets.filter((target) => target.vulnerable);
}

/** "Break ice at North Tank — serves Pen 1, 2nd Pen, Randy's Pasture." */
export function freezeChoreTitle(target: FreezeCheckTarget): string {
  const served = target.zones.map((zone) => zone.name).join(", ");
  const action = target.vulnerable ? "Break ice and check" : "Check";
  return `${action} ${target.waterSource.name} — serves ${served}`;
}
