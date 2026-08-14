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
  /**
   * Somewhere that is not this property at all.
   *
   * A bull standing at a collection facility, a cow away to be bred, a calf at
   * a show for a week. They are still ours and still cost money, so they must
   * not be marked sold or retired to get them off the Pen Board — the only
   * honest answer to "where is he" is the name of the place he is at.
   *
   * The type exists so everything derived from a zone can tell the difference.
   * An off-site zone has no water to break ice on, no ground to rest, and
   * nothing to walk to, so it must never raise a chore or appear on the map.
   */
  "off_site",
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

/** A polygon vertex in real-world coordinates, never screen space (§8). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Temporary fencing that sections a zone in two.
 *
 * Here it is the Pasture: fencing goes up so the cattle can be shut out of the
 * large portion, and comes down again. So it is a *state*, like a tank's cover
 * — what matters is whether it is standing now, not that the place is capable
 * of being divided.
 *
 * Part of the zone rather than a record of its own, unlike `WaterSource`. A
 * tank became its own entity because tanks are shared between zones and a chore
 * per zone would send somebody to the same trough twice. A temporary fence is
 * the opposite: it has no existence apart from the one zone it cuts, and
 * nothing else ever refers to it. The cost of keeping it here is that the whole
 * list is one field to the sync's last-write-wins, so two people standing at
 * two different fences on the same pasture in the same minute would have one
 * overwrite the other — which is a trade worth making on a place this size.
 */
export interface Divider {
  /** Stable within the zone, so a toggle can name which fence it meant. */
  readonly id: string;
  readonly name: string;
  /** The run of the fence. A line, not a ring — it does not close. */
  readonly line: readonly GeoPoint[];
  /** Standing now. */
  readonly up: boolean;
  /**
   * The water the cattle can still reach while it is up.
   *
   * The reason this is recorded per fence rather than read off the zone: the
   * zone's tank is on one side of the line, and which side is a fact about
   * where this particular fence was run. Empty, while up, means the cattle are
   * shut in with nothing to drink — and there is nothing about that visible
   * from the gate.
   */
  readonly waterSourceIds: readonly Ulid[];
  /** What they are shut out of, in the words somebody would use at the gate. */
  readonly closes?: string | undefined;
  readonly notes?: string | undefined;
}

export interface Zone extends BaseRecord {
  readonly name: string;
  readonly type: ZoneType;
  readonly indoor: boolean;
  readonly capacity?: number | undefined;
  /** Real lat/lng so the same pens render over Google or cached NAIP (§8). */
  readonly boundary?: readonly GeoPoint[] | undefined;
  /** Temporary fencing across this zone. Usually none, and usually down. */
  readonly dividers?: readonly Divider[] | undefined;
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

export const dividerSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1, "A fence needs a name").max(80),
  // Two points is a straight run between two corners, which is what temporary
  // fencing usually is. Three or more follows a contour.
  line: z.array(geoPointSchema).min(2, "A fence line needs at least two points"),
  up: z.boolean(),
  waterSourceIds: z.array(ulidSchema),
  closes: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export const zoneSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A zone needs a name").max(80),
  type: z.enum(ZONE_TYPES),
  indoor: z.boolean(),
  capacity: z.number().int().positive().optional(),
  boundary: z.array(geoPointSchema).min(3, "A boundary needs at least three points").optional(),
  dividers: z.array(dividerSchema).max(8).optional(),
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

/**
 * Somewhere on this property, as opposed to away.
 *
 * The test every derived list wants. An animal at a collection facility is
 * still ours and still costs money, but there is no trough to break ice on and
 * no gate to walk to — so a chore, a headcount of who is on the place, or a
 * shape on the map must all leave it out, while a list of what we own must not.
 */
export function isOnProperty(zone: Pick<Zone, "type">): boolean {
  return zone.type !== "off_site";
}

/** The zone standing for "away", if one has been set up. */
export function offSiteZones(zones: readonly Zone[]): Zone[] {
  return zones.filter((zone) => zone.type === "off_site" && zone.active);
}

/** The fencing across this zone that is standing right now. */
export function standingDividers(zone: Pick<Zone, "dividers">): Divider[] {
  return (zone.dividers ?? []).filter((divider) => divider.up);
}

/**
 * Fencing that has shut animals in with nothing to drink.
 *
 * A zone's water is recorded on the zone, but a tank sits on one side of a
 * cross-fence, and putting the fence up can leave the cattle on the other side
 * of it. Nothing about that is visible from the gate — the pasture still has a
 * tank, the cattle still have grass, and they simply cannot get to it.
 *
 * Only counts sources that are actually out: West Pen's tank is stowed for half
 * the year, and a fence relying on it in January leaves the same empty field.
 */
export function dividersWithoutWater(
  zone: Pick<Zone, "dividers">,
  activeWaterSourceIds: ReadonlySet<Ulid>,
): Divider[] {
  return standingDividers(zone).filter(
    (divider) => !divider.waterSourceIds.some((id) => activeWaterSourceIds.has(id)),
  );
}

/**
 * Where the animals in this zone actually are, in the words used at the gate.
 *
 * "Pasture" while a cross-fence is standing means a strip of it, and somebody
 * who does not already know that walks the whole field looking for cattle stood
 * in one corner. This is what the Pen Board and the housesitter guide say
 * instead of the bare zone name.
 */
export function describeZoneExtent(zone: Pick<Zone, "name" | "dividers">): string {
  const standing = standingDividers(zone);
  if (standing.length === 0) return zone.name;

  const shut = standing
    .map((divider) => divider.closes ?? divider.name)
    .filter((part) => part !== "")
    .join(", ");

  return `${zone.name} — part of it only, shut out of ${shut}`;
}
