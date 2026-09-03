import {
  ancestorsOf,
  describeZoneExtent,
  displayName,
  effectiveSafetyLevel,
  isGroupingType,
  isOnFarm,
  isOnProperty,
  occupantsOf,
  resolveCareInstructions,
  resolveZoneInstructions,
  type Animal,
  type ResolvedInstruction,
  type Ulid,
  type Zone,
  type ZoneAssignment,
  type ZoneType,
} from "@galaxy-farm/core";
import {
  DEFAULT_HALTER_COLOR,
  DEFAULT_HALTER_NAME,
  HALTER_COLORS,
  type SpatialChip,
  type SpatialInstruction,
  type SpatialShape,
} from "@galaxy-farm/ui";
import { isPet, penAssignments } from "@galaxy-farm/module-pets";

/**
 * The farm, flattened into the shapes the spatial editor draws (spec §2).
 *
 * The editor may only depend on the kernel (§4.1), so it knows nothing about
 * zones, animals, or assignments — a caller hands it labelled rings and
 * labelled chips. This is that caller's half, kept out of the screen because
 * it is where the decisions are: which zone a cow is drawn in when she is in
 * two, whose safety level a pen's border carries, which ground can be dropped
 * on at all, and which instructions a helper is shown when they tap her. All
 * four are answerable without a browser, which is why they are here rather
 * than in a component.
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
 * An enrolled calf's halter, as much of it as a chip needs (spec §5.7).
 *
 * Structural rather than the business module's `ProgramEnrollment`, because
 * the only thing the map wants from an enrollment is which calf wears what.
 * Taking the three fields keeps this testable without building a customer, an
 * agreement and a feeding plan around every fixture.
 *
 * **Enrollments are not among the entities a device holds yet.** They arrive
 * with §5.7's own phase, along with the roster that writes them — the same
 * standing arrangement `lib/calendar.ts` describes for the business module's
 * projected rows. So the screen passes none today and every chip is plain;
 * the day `programEnrollments` joins `LOCAL_STORES`, one `useRecords` call
 * lights the swatches up, and what that swatch should say is settled and
 * tested here rather than being decided then.
 */
export interface HalterEnrollment {
  readonly animalId: Ulid;
  readonly halterColor: string;
  readonly active: boolean;
}

/** What a show string calls that colour, for the reader who cannot see it. */
function halterName(color: string): string {
  const known = HALTER_COLORS.find(
    (halter) => halter.color.toLowerCase() === color.toLowerCase(),
  )?.name;
  // Unnamed is the hex, which is at least true. A calf in a colour nobody
  // stocks is a real thing and it should not read as an unlabelled one.
  return known ?? color;
}

/** The kernel's resolved lines, in the editor's generic shape. */
function asInstructions(lines: readonly ResolvedInstruction[]): SpatialInstruction[] {
  return lines.map((line) => ({ from: line.sourceName, text: line.text }));
}

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
  const onFarm = animals.filter(isOnFarm);
  const animalById = new Map(onFarm.map((animal) => [animal.id, animal]));
  // A dog dragged into a pen must not be able to raise the pen's border to
  // his handling level, or write himself into what a helper reads there.
  const placements = penAssignments(assignments, animals);

  return zones
    .filter(isOnProperty)
    .slice()
    .sort((left, right) => Number(isGroupingType(right.type)) - Number(isGroupingType(left.type)))
    .map((zone) => {
      const occupants = occupantsOf(placements, zone.id, at)
        .map((id) => animalById.get(id))
        .filter((animal): animal is Animal => animal !== undefined);

      const extent = describeZoneExtent(zone);

      return {
        id: zone.id,
        label: zone.name,
        // Only when it says something the name does not: "part of it only,
        // shut out of the creek" is the difference between walking to a gate
        // and walking the whole field.
        ...(extent === zone.name ? {} : { sublabel: extent }),
        ...(zone.boundary === undefined ? {} : { boundary: zone.boundary }),
        rank: effectiveSafetyLevel(
          zone.baselineSafetyLevel,
          occupants.map((animal) => animal.safetyLevel),
        ),
        resting: zone.resting,
        inactive: !zone.active,
        // What somebody walking into this pen needs, rather than what is
        // typed on the pen: its own note, the area's or barn's above it, and
        // then each animal standing in it, every line saying which it is.
        instructions: asInstructions(
          resolveZoneInstructions(
            zone,
            occupants.map((animal) => ({ ...animal, name: displayName(animal) })),
            ancestorsOf(zones, zone.id),
          ),
        ),
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
 * **Where she is drawn and what she is read as are two questions.** She is
 * drawn on one pen; her instructions come from every pen she is in, because a
 * calf inside for the night and out in the trap by day is under both sets of
 * rules and a helper reading half of them is a helper who has been misled.
 *
 * Sold, dead and departed animals are left out entirely. They need no pen, and
 * a pen board carrying them is one nobody walks out with.
 *
 * **So are the dogs and the cats.** A pet has no pen (§5.8) — it goes in the
 * guide's own pet section, not under a pasture — so a chip for one is a chip
 * with nowhere to be, and the tray under the canvas is where a chip with
 * nowhere to be lands. That put the house dog in a list of stock a drag
 * away from the North Trap, which is the slip this is written for: the map
 * offers the move, and the record it writes is one nobody meant.
 */
export function animalChips(
  zones: readonly Zone[],
  animals: readonly Animal[],
  assignments: readonly ZoneAssignment[],
  at: Date,
  enrollments: readonly HalterEnrollment[] = [],
): SpatialChip[] {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const halters = new Map(
    enrollments
      .filter((enrollment) => enrollment.active)
      .map((enrollment) => [enrollment.animalId, enrollment.halterColor]),
  );

  return animals
    .filter((animal) => isOnFarm(animal) && !isPet(animal))
    .map((animal) => {
      const open = assignments.filter(
        (assignment) =>
          assignment.animalId === animal.id &&
          assignment.periodFrom <= at &&
          (assignment.periodTo === undefined || at < assignment.periodTo),
      );

      const outside = open.find((assignment) => zoneById.get(assignment.zoneId)?.indoor === false);
      const where = outside ?? open[0];

      /**
       * Every pen she is in, the one she is drawn on first.
       *
       * Order is what a helper reads down, and the ground she is standing on
       * is the one they are looking at. Deduplicated because two open
       * assignments to the same zone are a sync artefact, not two pens.
       */
      const held = [where, ...open.filter((assignment) => assignment !== where)]
        .filter((assignment) => assignment !== undefined)
        .map((assignment) => zoneById.get(assignment.zoneId))
        .filter((zone): zone is Zone => zone !== undefined)
        .filter((zone, index, all) => all.findIndex((other) => other.id === zone.id) === index);

      /**
       * The groups those pens sit in (§5.1 v1.5).
       *
       * A zone with no parent is its own group, and an instruction written on
       * North applies to every animal in every pen in North — which is exactly
       * the instruction nobody sees today, because it is filed one level above
       * anywhere they would think to look.
       */
      const groups = held
        .flatMap((zone) => ancestorsOf(zones, zone.id))
        .filter((zone, index, all) => all.findIndex((other) => other.id === zone.id) === index)
        .filter((group) => !held.some((zone) => zone.id === group.id));

      const halter = halters.get(animal.id);

      return {
        id: animal.id,
        label: displayName(animal),
        ...(where === undefined ? {} : { shapeId: where.zoneId }),
        rank: animal.safetyLevel,
        // Why she is that level, kept beside the level rather than folded in
        // with the care instructions. "Kicks when cornered" is not a chore.
        ...(animal.safetyNotes === undefined || animal.safetyNotes.trim() === ""
          ? {}
          : { rankNote: animal.safetyNotes.trim() }),
        // Her effective instructions (§5.1): her own, plus every pen she is
        // in, plus the groups above them — resolved by the kernel, which is
        // the same resolution the housesitter guide composes from, so the two
        // cannot drift into disagreeing about the same cow.
        instructions: asInstructions(
          resolveCareInstructions({
            animal: { ...animal, name: displayName(animal) },
            zones: held,
            groups,
          }),
        ),
        // A halter is an identity, not a grade: the calf in the red halter is
        // findable across a barn without reading a tag (§5.7). The name goes
        // with it, because navy and black are the same swatch in a dark barn.
        ...(halter === undefined
          ? {}
          : {
              accent: halter.trim() === "" ? DEFAULT_HALTER_COLOR : halter,
              accentLabel: halter.trim() === "" ? DEFAULT_HALTER_NAME : halterName(halter),
            }),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}
