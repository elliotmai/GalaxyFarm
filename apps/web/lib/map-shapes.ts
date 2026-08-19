import {
  describeZoneExtent,
  displayName,
  effectiveSafetyLevel,
  isGroupingType,
  isOnFarm,
  isOnProperty,
  occupantsOf,
  type Animal,
  type SafetyLevel,
  type Ulid,
  type Zone,
  type ZoneAssignment,
  type ZoneType,
} from "@galaxy-farm/core";
import type { SpatialChip, SpatialShape } from "@galaxy-farm/ui";

/**
 * The farm, flattened into the shapes the spatial editor draws (spec §2).
 *
 * The editor may only depend on the kernel (§4.1), so it knows nothing about
 * zones, animals, or assignments — a caller hands it labelled rings and
 * labelled chips. This is that caller's half, kept out of the screen because
 * it is where the decisions are: which zone a cow is drawn in when she is in
 * two, whose safety level a pen's border carries, and which ground can be
 * dropped on at all. All three are answerable without a browser, which is why
 * they are here rather than in a component.
 */

/**
 * Ground that holds nothing living.
 *
 * An area groups pens — North contains the traps, it is not one — and a
 * working facility is a tub and an alley cattle pass through under handling.
 * Neither is somewhere an animal *is*, so neither accepts a dropped chip; a
 * drag that ended on one would write a placement nobody meant and take the cow
 * off the pen she is actually in.
 */
const HOLDS_NOTHING: readonly ZoneType[] = ["area", "working_facility"];

/**
 * Zones as rings, in the order they are drawn.
 *
 * Areas and barns first, so the pens inside them draw over the top. That is
 * both how it should look and what decides a drop: the editor takes the last
 * shape containing the point, and a pen inside a pasture is the more specific
 * answer to "where did that land".
 *
 * The border carries the **effective** safety level — `max(baseline, highest
 * occupant)` — not the zone's own. That is the derivation §5.1 exists for: the
 * bull moved into a green pen turns it red here at the moment he arrives,
 * because nothing cached the old answer.
 */
export function zoneShapes(
  zones: readonly Zone[],
  animals: readonly Animal[],
  assignments: readonly ZoneAssignment[],
  at: Date,
): SpatialShape[] {
  const levels = new Map<Ulid, SafetyLevel>(
    animals.filter(isOnFarm).map((animal) => [animal.id, animal.safetyLevel]),
  );

  return zones
    .filter(isOnProperty)
    .slice()
    .sort((left, right) => Number(isGroupingType(right.type)) - Number(isGroupingType(left.type)))
    .map((zone) => {
      const occupants = occupantsOf(assignments, zone.id, at)
        .map((id) => levels.get(id))
        .filter((level): level is SafetyLevel => level !== undefined);

      const extent = describeZoneExtent(zone);

      return {
        id: zone.id,
        label: zone.name,
        // Only when it says something the name does not: "part of it only,
        // shut out of the creek" is the difference between walking to a gate
        // and walking the whole field.
        ...(extent === zone.name ? {} : { sublabel: extent }),
        ...(zone.boundary === undefined ? {} : { boundary: zone.boundary }),
        rank: effectiveSafetyLevel(zone.baselineSafetyLevel, occupants),
        resting: zone.resting,
        inactive: !zone.active,
        ...(zone.customInstructions === undefined ? {} : { instructions: zone.customInstructions }),
        lines: (zone.dividers ?? []).map((divider) => ({
          id: divider.id,
          label: divider.name,
          points: divider.line,
          // Drawn the way it was drawn on the hand-sketched map, which is the
          // convention somebody already reads without being told: a dashed
          // line is fencing that is not standing right now.
          dashed: !divider.up,
        })),
        acceptsChips: !HOLDS_NOTHING.includes(zone.type),
      };
    });
}

/**
 * Animals as chips, each in the zone it is drawn standing in.
 *
 * An animal stands in at most two places at once (§5.1) — one outside, one
 * inside — and this map is a map of ground, so the outside one wins. That is
 * not only the truer answer for a drawing of the property; it is what makes
 * dragging work. Moving a cow onto a pasture closes her *outside* assignment
 * and opens a new one, so if the chip followed her stall she would be dragged
 * across the map and snap straight back into the barn.
 *
 * Sold, dead and departed animals are left out entirely. They need no pen, and
 * a pen board carrying them is one nobody walks out with.
 */
export function animalChips(
  zones: readonly Zone[],
  animals: readonly Animal[],
  assignments: readonly ZoneAssignment[],
  at: Date,
): SpatialChip[] {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));

  return animals
    .filter(isOnFarm)
    .map((animal) => {
      const open = assignments.filter(
        (assignment) =>
          assignment.animalId === animal.id &&
          assignment.periodFrom <= at &&
          (assignment.periodTo === undefined || at < assignment.periodTo),
      );

      const outside = open.find((assignment) => zoneById.get(assignment.zoneId)?.indoor === false);
      const where = outside ?? open[0];

      // Her own words, not the merged set. Resolving own plus zone plus group
      // is the Pen Board's job (#19) and needs the resolver this screen does
      // not call yet; what is here is what is on her record.
      const instructions = [animal.safetyNotes, animal.customInstructions]
        .filter((part): part is string => part !== undefined && part.trim() !== "")
        .join("\n\n");

      return {
        id: animal.id,
        label: displayName(animal),
        ...(where === undefined ? {} : { shapeId: where.zoneId }),
        rank: animal.safetyLevel,
        ...(instructions === "" ? {} : { instructions }),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}
