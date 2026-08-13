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

/**
 * The cover, and whether it is on.
 *
 * One field with three states rather than two booleans, because "there is no
 * cover for this tank" and "the cover is off" are different answers that lead
 * to different work: the first can only be broken open in the morning, the
 * second is something to go and do tonight. A pair of booleans would also
 * admit a fourth state — no cover, cover on — that cannot happen.
 */
export const TANK_COVERS = [
  /** Nothing to put on. Ice here is broken, not prevented. */
  "none",
  /** There is one, and it is stowed. */
  "off",
  /** Fitted. */
  "on",
] as const;
export type TankCover = (typeof TANK_COVERS)[number];

export interface WaterSource extends BaseRecord {
  readonly name: string;
  readonly type: WaterSourceType;
  readonly hasHeater: boolean;
  /**
   * A cover is the mitigation actually in use here — no tank on this place has
   * a heater. It is a state rather than a fact about the tank for the same
   * reason `active` is: it comes off in the spring and goes back on before the
   * first hard freeze, and what §6 needs to know is which ones are off *now*.
   */
  readonly cover: TankCover;
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
  // Defaulted rather than required, because tanks were recorded before covers
  // were. A required enum would refuse the first edit to a tank already
  // sitting in a device's store — the record would have to be deleted and
  // retyped to gain a field it should simply inherit the honest answer to.
  cover: z.enum(TANK_COVERS).default("none"),
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
  /**
   * There is a cover for it and it is not on.
   *
   * Separate from `vulnerable` because it is a different job at a different
   * time: vulnerable is what gets walked to with a hammer in the morning,
   * this is what gets carried out before dark. A cover slows ice, it does not
   * stop it, so fitting one does not clear the morning check.
   */
  readonly needsCover: boolean;
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
      needsCover: source.cover === "off",
    }))
    .filter((target) => target.zones.length > 0);
}

/** The heaterless subset, which the alert names individually (§6). */
export function vulnerableToFreezing(targets: readonly FreezeCheckTarget[]): FreezeCheckTarget[] {
  return targets.filter((target) => target.vulnerable);
}

/**
 * The tanks with a cover to go and put on.
 *
 * The whole point of naming them separately is that this work has a deadline
 * the ice-breaking does not: a cover fitted the morning after the freeze
 * prevented nothing.
 */
export function coversToFit(targets: readonly FreezeCheckTarget[]): FreezeCheckTarget[] {
  return targets.filter((target) => target.needsCover);
}

/** "Put the cover on North Tank — serves Pen 1, 2nd Pen, Randy's Pasture." */
export function coverChoreTitle(target: FreezeCheckTarget): string {
  const served = target.zones.map((zone) => zone.name).join(", ");
  return `Put the cover on ${target.waterSource.name} — serves ${served}`;
}

/**
 * "Break ice at North Tank — serves Pen 1, 2nd Pen, Randy's Pasture."
 *
 * Three wordings, because the tank decides which tool gets carried: a heated
 * tank wants an eye on it, a covered one wants the cover lifted before
 * anything can be seen, and a bare one wants a hammer.
 */
export function freezeChoreTitle(target: FreezeCheckTarget): string {
  const served = target.zones.map((zone) => zone.name).join(", ");
  const action = !target.vulnerable
    ? "Check"
    : target.waterSource.cover === "on"
      ? "Lift the cover and check"
      : "Break ice and check";
  return `${action} ${target.waterSource.name} — serves ${served}`;
}
