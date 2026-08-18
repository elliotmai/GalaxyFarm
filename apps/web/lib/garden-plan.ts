import type { GeoPoint, Property, Ulid, Zone } from "@galaxy-farm/core";
import {
  METRES_PER_DEGREE_LATITUDE,
  boundsOf,
  metresPerDegreeLongitude,
  type SpatialChip,
  type SpatialGrid,
  type SpatialShape,
} from "@galaxy-farm/ui";
import {
  rotationWarning,
  type Bed,
  type Crop,
  type Planting,
  type PlantingStatus,
  type RotationWarning,
  type Variety,
} from "@galaxy-farm/module-garden";

import { familyHistory, familyOf, varietyLabel } from "@/lib/garden";

/**
 * The garden, flattened into the shapes the spatial editor draws (spec §2).
 *
 * `map-shapes.ts` is the property's half of this job; this is the garden's.
 * The editor may only depend on the kernel (§4.1), so it knows nothing about
 * beds, varieties or crop families — a caller hands it labelled rings and
 * labelled chips, and everything below is that caller's side of the seam.
 *
 * ## Feet on a plan, coordinates on the wire
 *
 * A `Bed` keeps `x`, `y`, `lengthFt` and `widthFt` — plan coordinates in feet,
 * which is how a garden is actually measured and how #36 modelled it. The
 * editor speaks lat/lng and only lat/lng, deliberately: that is what lets the
 * same component draw a pasture over a photograph. So the two are converted
 * here and nowhere else, in both directions, and the round trip is what the
 * tests pin down.
 *
 * The plan is pinned to its **garden zone** — its origin is the zone's
 * north-west corner. That is what makes the property map and this designer two
 * views of one `Zone` tree rather than parallel worlds: move the garden on the
 * map and every bed in it moves with it, because a bed's stored position was
 * never absolute in the first place. Where the zone has not been traced, the
 * property's own coordinate stands in — a plan needs somewhere to hang, not a
 * survey.
 */

/** Feet, in the metres the editor's geometry speaks. */
export const METRES_PER_FOOT = 0.3048;

/**
 * The grid a garden snaps to: one foot.
 *
 * Beds are built to a tape measure and the tape is in feet here, so a snap of
 * anything else produces the 2.98 m the palette's `snapByDefault` comment is
 * about — right to within a rounding error and wrong on the lumber list.
 */
export const GARDEN_GRID_FEET = 1;

/** What is drawn as being in the bed: what is in the ground right now. */
const LIVE_STATUSES: readonly PlantingStatus[] = ["growing", "harvesting"];

/** The rotation guard's three steps, as `gardenPalette` numbers them. */
export const ROTATION_CLEAR = 1;
export const ROTATION_INSIDE_WINDOW = 2;
export const ROTATION_LAST_SEASON = 3;

/**
 * Where the plan hangs.
 *
 * The garden zone's north-west corner, so `x` runs east and `y` runs south —
 * screen space, which is what `Bed.x`/`Bed.y` already are. Falls back to the
 * property's coordinate, and then to nothing: without one point of real ground
 * there is no plan to draw, and inventing one would put the beds in the Gulf of
 * Guinea rather than saying so.
 */
export function gardenOrigin(
  zone: Pick<Zone, "boundary"> | undefined,
  property: Pick<Property, "latitude" | "longitude"> | undefined,
): GeoPoint | undefined {
  const bounds = boundsOf([...(zone?.boundary ?? [])]);
  if (bounds !== undefined) return { lat: bounds.north, lng: bounds.west };

  if (property?.latitude !== undefined && property.longitude !== undefined) {
    return { lat: property.latitude, lng: property.longitude };
  }

  return undefined;
}

export function gardenGrid(origin: GeoPoint): SpatialGrid {
  return { metres: GARDEN_GRID_FEET * METRES_PER_FOOT, anchor: origin };
}

/** A point on the plan — feet east and feet south of the origin — as ground. */
function groundAt(origin: GeoPoint, eastFt: number, southFt: number): GeoPoint {
  const perLng = metresPerDegreeLongitude(origin.lat);

  return {
    lat: origin.lat - (southFt * METRES_PER_FOOT) / METRES_PER_DEGREE_LATITUDE,
    lng: perLng === 0 ? origin.lng : origin.lng + (eastFt * METRES_PER_FOOT) / perLng,
  };
}

/** Rounded to the nearest hundredth of a foot — under two millimetres. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The ring a bed occupies, or nothing for a bed that has not been drawn.
 *
 * All four numbers or none: a bed with a position and no size is a point, and
 * a bed with a size and no position has no place on the plan to put it. Absent
 * is an ordinary state the editor already handles — it draws nothing, and the
 * plantings in that bed fall into the tray under the canvas rather than
 * vanishing.
 */
export function bedBoundary(
  bed: Pick<Bed, "x" | "y" | "lengthFt" | "widthFt">,
  origin: GeoPoint,
): GeoPoint[] | undefined {
  const { x, y, lengthFt, widthFt } = bed;
  if (x === undefined || y === undefined || lengthFt === undefined || widthFt === undefined) {
    return undefined;
  }

  // Clockwise from the north-west corner, which is the corner `x`/`y` name.
  return [
    groundAt(origin, x, y),
    groundAt(origin, x + lengthFt, y),
    groundAt(origin, x + lengthFt, y + widthFt),
    groundAt(origin, x, y + widthFt),
  ];
}

export interface BedGeometry {
  readonly x: number;
  readonly y: number;
  readonly lengthFt: number;
  readonly widthFt: number;
}

/**
 * A drawn ring, read back as the four numbers a `Bed` stores.
 *
 * The **bounding box** of what was drawn, not the ring itself. A bed in this
 * model is a rectangle — §5.5 gives it a length and a width and nothing else —
 * so three clicks are enough to say which rectangle, and a fourth corner
 * dragged off true is read as somebody adjusting the extent rather than as a
 * request to store a quadrilateral the record cannot hold.
 *
 * Nothing comes back for a ring with no extent: `bedSchema` requires positive
 * dimensions, and a bed with no width is not a bed that got drawn badly, it is
 * a line.
 */
export function bedGeometry(ring: readonly GeoPoint[], origin: GeoPoint): BedGeometry | undefined {
  const bounds = boundsOf(ring);
  if (bounds === undefined) return undefined;

  const perLng = metresPerDegreeLongitude(origin.lat);
  if (perLng === 0) return undefined;

  const eastFt = (lng: number) => ((lng - origin.lng) * perLng) / METRES_PER_FOOT;
  const southFt = (lat: number) =>
    ((origin.lat - lat) * METRES_PER_DEGREE_LATITUDE) / METRES_PER_FOOT;

  const geometry = {
    x: round(eastFt(bounds.west)),
    y: round(southFt(bounds.north)),
    lengthFt: round(eastFt(bounds.east) - eastFt(bounds.west)),
    widthFt: round(southFt(bounds.south) - southFt(bounds.north)),
  };

  return geometry.lengthFt > 0 && geometry.widthFt > 0 ? geometry : undefined;
}

/**
 * Where a bed stands on the rotation scale for the family about to go in it.
 *
 * The guard itself is `rotationWarning` in the garden domain and is not
 * reimplemented here — this only reads its answer onto the palette's three
 * steps. Middle step for anything inside the window that is not last season,
 * because "two years ago" and "three years ago" call for the same decision.
 */
export function rotationRank(warning: RotationWarning | undefined): number {
  if (warning === undefined) return ROTATION_CLEAR;
  return warning.yearsSince < 1 ? ROTATION_LAST_SEASON : ROTATION_INSIDE_WINDOW;
}

/**
 * Colours that identify a botanical family rather than grading it.
 *
 * Chosen to be told apart, not to mean anything — nothing here says a
 * nightshade is worse than a brassica. They are only ever drawn beside
 * `accentLabel`, which carries the family's name, so the colour is the fast
 * path and never the only one (§5.1). Picked by a stable hash so the same
 * family is the same colour on every screen and after every reload, without a
 * colour column on `Crop` for somebody to keep in sync.
 */
const FAMILY_ACCENTS: readonly string[] = [
  "#1B3A5C",
  "#2E7D32",
  "#8E44AD",
  "#00838F",
  "#C9A24B",
  "#AD1457",
  "#4E342E",
  "#37474F",
];

export function familyAccent(family: string | undefined): string | undefined {
  if (family === undefined || family.trim() === "") return undefined;

  const key = family.trim().toLowerCase();
  let hash = 0;
  for (const character of key)
    hash = (hash + (character.codePointAt(0) ?? 0)) % FAMILY_ACCENTS.length;

  return FAMILY_ACCENTS[hash];
}

/**
 * Beds as rings, coloured by the rotation guard.
 *
 * `family` is what somebody is about to plant, and it is what turns the whole
 * plan into an answer: with it, every bed reads clear, amber or red for *that*
 * family before a bed has been chosen, which is §5.5's warning arriving early
 * enough to change the choice. Without it the beds carry no rank at all and the
 * palette draws them in its plain outline — that is the honest drawing, because
 * "is this bed clear" is not a question a bed can answer on its own.
 *
 * A bed with nothing growing in it is `resting` — the flag the property map
 * uses for a rested pasture, which this palette calls Fallow. Ground in use and
 * ground standing empty is the distinction somebody opens a garden plan to see.
 */
export function bedShapes(
  beds: readonly Bed[],
  plantings: readonly Planting[],
  varieties: readonly Variety[],
  crops: readonly Crop[],
  origin: GeoPoint,
  at: Date,
  family?: string,
): SpatialShape[] {
  // Once for the whole plan rather than once per bed: the history is the same
  // list every time, and `rotationWarning` filters it by bed itself.
  const history = familyHistory(plantings, varieties, crops);

  return [...beds]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((bed) => {
      const boundary = bedBoundary(bed, origin);
      const growing = plantings.filter(
        (planting) => planting.bedId === bed.id && LIVE_STATUSES.includes(planting.status),
      );

      const size =
        bed.lengthFt === undefined || bed.widthFt === undefined
          ? undefined
          : `${bed.lengthFt}′ × ${bed.widthFt}′`;

      return {
        id: bed.id,
        label: bed.name,
        ...(boundary === undefined ? {} : { boundary }),
        ...(size === undefined ? {} : { sublabel: size }),
        ...(family === undefined
          ? {}
          : { rank: rotationRank(rotationWarning(bed.id, family, history, at)) }),
        resting: bed.active && growing.length === 0,
        inactive: !bed.active,
        ...(bed.soilNotes === undefined ? {} : { instructions: bed.soilNotes }),
      };
    });
}

/**
 * Plantings as chips, each in the bed it is growing in.
 *
 * Only what is in the ground. A planned row has not been sown and a row started
 * indoors is in a seed tray on a windowsill, so neither is standing in a bed;
 * finished and failed rows are history the rotation guard still reads but not
 * things on the plan. This is the same cut `animalChips` makes when it leaves
 * out the sold and the dead.
 *
 * The accent is the botanical family, which is the fact the whole screen turns
 * on: two beds of nightshades read as the same colour whatever the two
 * varieties are called.
 */
export function plantingChips(
  plantings: readonly Planting[],
  varieties: readonly Variety[],
  crops: readonly Crop[],
): SpatialChip[] {
  return plantings
    .filter((planting) => LIVE_STATUSES.includes(planting.status))
    .map((planting) => {
      const variety = varieties.find((entry) => entry.id === planting.varietyId);
      const family = familyOf(planting.varietyId, varieties, crops);
      const accent = familyAccent(family);

      return {
        id: planting.id,
        label: varietyLabel(variety, crops),
        shapeId: planting.bedId,
        ...(family === undefined ? {} : { sublabel: family, accentLabel: family }),
        ...(accent === undefined ? {} : { accent }),
        ...(planting.notes === undefined ? {} : { instructions: planting.notes }),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * The rotation answer for one bed and one family, for the screen to show.
 *
 * A thin pass-through so the designer builds its history exactly the way the
 * plantings form does — one path to the guard, not two that drift.
 */
export function bedRotationWarning(
  bedId: Ulid,
  family: string | undefined,
  plantings: readonly Planting[],
  varieties: readonly Variety[],
  crops: readonly Crop[],
  at: Date,
  ignoreId?: Ulid,
): RotationWarning | undefined {
  if (family === undefined) return undefined;
  return rotationWarning(bedId, family, familyHistory(plantings, varieties, crops, ignoreId), at);
}
