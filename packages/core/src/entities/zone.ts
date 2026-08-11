import { z } from "zod";

import { safetyLevelSchema, type SafetyLevel } from "../value-objects/safety-level.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The universal "place" (spec §5.1) — a pen, a pasture, a coop, a stall, a
 * garden area. One entity rather than five, because the Pen Board, the
 * housesitter guide, and the garden designer all need to talk about "where
 * something is" in the same terms.
 */

export const ZONE_TYPES = [
  "pen",
  "pasture",
  "coop",
  "barn",
  "stall",
  "garden_area",
  /** Tub, chute, alley — holds cattle under handling, nothing lives there. */
  "working_facility",
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

/** A polygon vertex in real-world coordinates, never screen space (§8). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface Zone extends BaseRecord {
  readonly name: string;
  readonly type: ZoneType;
  readonly indoor: boolean;
  readonly capacity?: number | undefined;
  /** Real lat/lng so the same pens render over Google or cached NAIP (§8). */
  readonly boundary?: readonly GeoPoint[] | undefined;
  /** Hazards of the place itself, before any animal is in it (§5.1). */
  readonly baselineSafetyLevel: SafetyLevel;
  /**
   * The water this zone drinks from. Many-to-many on purpose: tanks are shared
   * between zones here, and a zone can have more than one source.
   */
  readonly waterSourceIds: readonly Ulid[];
  /** Rich text. Group-level care instructions live here. */
  readonly customInstructions?: string | undefined;
  /** Resting pastures render dimmed and challenge animal moves (§5.1). */
  readonly resting: boolean;
  readonly active: boolean;
}

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const zoneSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A zone needs a name").max(80),
  type: z.enum(ZONE_TYPES),
  indoor: z.boolean(),
  capacity: z.number().int().positive().optional(),
  boundary: z.array(geoPointSchema).min(3, "A boundary needs at least three points").optional(),
  baselineSafetyLevel: safetyLevelSchema,
  waterSourceIds: z.array(ulidSchema),
  customInstructions: z.string().max(5000).optional(),
  resting: z.boolean(),
  active: z.boolean(),
}) as unknown as z.ZodType<Zone>;

/**
 * Freeze-day chores are derived per *water source*, not per zone — see
 * `freezeCheckTargets` in `water-source.ts`. Deriving them here would produce
 * one chore per zone and send someone to a shared trough twice.
 */

export function isOverCapacity(zone: Pick<Zone, "capacity">, occupantCount: number): boolean {
  return zone.capacity !== undefined && occupantCount > zone.capacity;
}
