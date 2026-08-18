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
  /**
   * A named part of the place — North, South, the home forty (added v1.5).
   *
   * Pens and pastures group into these, and the group is a Zone rather than a
   * string on each pen for the reason every other shared thing here is a
   * record: a string is retyped, and "North", "north" and "Norht" become three
   * groups nobody meant. Renaming the area renames it everywhere, and it can
   * carry a boundary of its own so the map can draw where North actually is.
   *
   * Nothing lives in an area — it holds pens, it is not one — so it stays off
   * the Pen Board for the same reason `working_facility` does.
   */
  "area",
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

/**
 * What can hold what.
 *
 * Two containments, one mechanism. **Stalls are in barns** and **pens and
 * pastures are in areas**, and both are the same sentence — this zone sits
 * inside that one — so both are `parentZoneId` rather than a parent field for
 * barns and a separate group field for areas. It also means a barn is picked
 * by *name*: a stall is in the Red Barn, not in "a barn".
 *
 * The pairs are listed rather than left open because the wrong ones are
 * nonsense that would be hard to notice afterwards: an area inside an area
 * ("North contains South"), or a stall sitting loose in a field.
 */
const CONTAINS: Readonly<Record<ZoneType, readonly ZoneType[]>> = {
  // A named part of the property. Holds anything that sits on ground —
  // including a barn, which can perfectly well be in the North end.
  area: ["pasture", "pen", "barn", "coop", "garden_area", "working_facility"],
  // Inside the barn: the stalls, and whatever pens are made up in there.
  barn: ["stall", "pen", "working_facility"],
  pen: [],
  pasture: [],
  coop: [],
  stall: [],
  garden_area: [],
  working_facility: [],
  // Not this property. Nothing here holds anything here.
  off_site: [],
};

export function canContain(parent: ZoneType, child: ZoneType): boolean {
  return CONTAINS[parent].includes(child);
}

/** Types that hold other zones — what the group picker offers. */
export function isGroupingType(type: ZoneType): boolean {
  return CONTAINS[type].length > 0;
}

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
  /**
   * The area or barn this sits in, if any.
   *
   * Undefined is not missing data — it is a zone that is **its own group**,
   * which is the ordinary state for a pasture nobody has lumped in with
   * anything. See `canContain` for which pairings mean something.
   */
  readonly parentZoneId?: Ulid | undefined;
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
  parentZoneId: ulidSchema.optional(),
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

/** Everything sitting directly inside one zone. */
export function childrenOf(zones: readonly Zone[], parentId: Ulid): Zone[] {
  return zones
    .filter((zone) => zone.parentZoneId === parentId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Every zone inside this one, however deep.
 *
 * Walks with a seen-set rather than trusting the data to be a tree. Nothing in
 * `canContain` permits a loop, but this is what a bad import or a hand-edited
 * row would land on, and the cost of being wrong is a page that hangs rather
 * than a page that is wrong — the worse of the two.
 */
export function descendantsOf(zones: readonly Zone[], parentId: Ulid): Zone[] {
  const found: Zone[] = [];
  const seen = new Set<Ulid>([parentId]);
  const queue: Ulid[] = [parentId];

  while (queue.length > 0) {
    const next = queue.shift() as Ulid;
    for (const child of childrenOf(zones, next)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child.id);
    }
  }

  return found;
}

/**
 * The groups this zone sits in, nearest first.
 *
 * The other direction of `descendantsOf`, and the one anything *derived for an
 * animal* needs: a cow standing in Pen 1 is also standing in North, and an
 * instruction written on North is written about her. `parentZoneId` is the
 * grouping (§5.1 v1.5) — a zone with none is its own group — so walking up it
 * is what turns "the pen she is in" into "everything she is inside of".
 *
 * Guarded with a seen-set for the same reason the walk down is: nothing in
 * `canContain` permits a loop, but a bad import or a hand-edited row is what
 * this would land on, and a page that hangs is worse than a page that is
 * wrong.
 */
export function ancestorsOf(zones: readonly Zone[], zoneId: Ulid): Zone[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const found: Zone[] = [];
  const seen = new Set<Ulid>([zoneId]);

  let next = byId.get(zoneId)?.parentZoneId;
  while (next !== undefined && !seen.has(next)) {
    seen.add(next);
    const parent = byId.get(next);
    if (parent === undefined) break;
    found.push(parent);
    next = parent.parentZoneId;
  }

  return found;
}

/**
 * The groups a zone could be put in.
 *
 * Filtered three ways, and each one is a mistake somebody would otherwise
 * make: by type, so a stall is only ever offered barns; minus itself, because
 * a zone cannot be inside itself; and minus everything already inside it, or
 * putting the Red Barn into a stall it contains would strand both of them in a
 * loop no screen could draw.
 */
export function possibleGroupsFor(zones: readonly Zone[], zone: Pick<Zone, "id" | "type">): Zone[] {
  const inside = new Set(descendantsOf(zones, zone.id).map((child) => child.id));

  return zones
    .filter(
      (candidate) => candidate.active && candidate.id !== zone.id && !inside.has(candidate.id),
    )
    .filter((candidate) => canContain(candidate.type, zone.type))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export interface ZoneGrouping {
  /** The area or barn holding them. Undefined for the ones on their own. */
  readonly group?: Zone | undefined;
  readonly members: readonly Zone[];
}

/**
 * The zone list as somebody thinks of it: North, South, the barn, and the
 * handful that belong to nothing.
 *
 * A zone with no group is **its own group** rather than an error state, so the
 * ungrouped are not hidden or flagged — they are collected at the end, which
 * is where a list of them belongs once the named groups have been read.
 *
 * A group that holds nothing still appears. An empty North is a group somebody
 * made and has not filled yet, and dropping it off the screen is how they
 * conclude the app lost it.
 */
export function groupedZones(zones: readonly Zone[]): ZoneGrouping[] {
  const groups = zones
    .filter((zone) => isGroupingType(zone.type) || childrenOf(zones, zone.id).length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({ group, members: childrenOf(zones, group.id) }));

  const grouped = new Set(groups.map((entry) => entry.group.id));
  const alone = zones
    .filter((zone) => zone.parentZoneId === undefined && !grouped.has(zone.id))
    .sort((left, right) => left.name.localeCompare(right.name));

  return alone.length === 0 ? groups : [...groups, { members: alone }];
}
