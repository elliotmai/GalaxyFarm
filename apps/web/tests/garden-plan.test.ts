import { describe, expect, it } from "vitest";

import type { GeoPoint, Property, Ulid, Zone } from "@galaxy-farm/core";
import { METRES_PER_DEGREE_LATITUDE, metresPerDegreeLongitude } from "@galaxy-farm/ui";
import type { Bed, Crop, Planting, Variety } from "@galaxy-farm/module-garden";

import {
  METRES_PER_FOOT,
  ROTATION_CLEAR,
  ROTATION_INSIDE_WINDOW,
  ROTATION_LAST_SEASON,
  bedBoundary,
  bedGeometry,
  bedShapes,
  familyAccent,
  gardenGrid,
  gardenOrigin,
  plantingChips,
  type BedGeometry,
} from "@/lib/garden-plan";

/**
 * The garden, flattened for the spatial editor (issue #33).
 *
 * The one thing here that no screen would show going wrong is the **round
 * trip**. A `Bed` keeps feet on a plan and the editor speaks lat/lng, so every
 * drawn corner crosses that seam twice — once to be drawn, once to be stored —
 * and a lat/lng swap or a metres-for-feet slip would still produce a rectangle
 * on screen. It would just be the wrong rectangle, on ground nobody measured,
 * and the beds list would quietly disagree with the drawing.
 *
 * The rest is the same three questions `map-shapes.test.ts` asks of the
 * property: what colour a shape carries, which ground is drawn as in use, and
 * which chips land where.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const GARDEN = "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid;

/** The north-west corner of the garden, which is where every plan hangs. */
const ORIGIN: GeoPoint = { lat: 32.7357, lng: -97.4089 };

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;
const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };

function bed(over: Partial<Bed> & Pick<Bed, "id" | "name">): Bed {
  return { ...base, zoneId: GARDEN, type: "raised_bed", active: true, ...over } as Bed;
}

function planting(
  over: Partial<Planting> & Pick<Planting, "id" | "bedId" | "varietyId">,
): Planting {
  return { ...base, method: "transplant", status: "growing", ...over } as Planting;
}

const NIGHTSHADE: Crop = { ...base, id: id(80), name: "Tomato", family: "Solanaceae" } as Crop;
const BRASSICA: Crop = { ...base, id: id(81), name: "Kale", family: "Brassicaceae" } as Crop;

const CHEROKEE: Variety = {
  ...base,
  id: id(90),
  cropId: NIGHTSHADE.id,
  name: "Cherokee Purple",
} as Variety;
const RED_RUSSIAN: Variety = {
  ...base,
  id: id(91),
  cropId: BRASSICA.id,
  name: "Red Russian",
} as Variety;

const CROPS = [NIGHTSHADE, BRASSICA];
const VARIETIES = [CHEROKEE, RED_RUSSIAN];

/** How far apart two coordinates are on the ground, north-south and east-west. */
function metresBetween(from: GeoPoint, to: GeoPoint) {
  return {
    east: (to.lng - from.lng) * metresPerDegreeLongitude(from.lat),
    south: (from.lat - to.lat) * METRES_PER_DEGREE_LATITUDE,
  };
}

describe("bed geometry", () => {
  it("round-trips a bed through the plan and back unchanged", () => {
    // The seam the whole designer rests on. Drawn, stored, drawn again — and
    // the numbers on the record are the numbers somebody measured.
    const long = bed({ id: id(1), name: "The long bed", x: 10, y: 4, lengthFt: 12, widthFt: 3 });

    const ring = bedBoundary(long, ORIGIN);
    expect(ring).toBeDefined();

    const back = bedGeometry(ring as GeoPoint[], ORIGIN);
    expect(back?.x).toBeCloseTo(10, 2);
    expect(back?.y).toBeCloseTo(4, 2);
    expect(back?.lengthFt).toBeCloseTo(12, 2);
    expect(back?.widthFt).toBeCloseTo(3, 2);
  });

  it("puts the feet where the feet were, not where a swapped axis would", () => {
    // A lat/lng swap draws a rectangle too. This is the assertion that says
    // which rectangle: twelve feet is twelve feet east, three feet is three
    // feet south, and both are measured on the ground rather than in degrees —
    // a degree of longitude is 16% shorter than a degree of latitude here.
    const ring = bedBoundary(
      bed({ id: id(2), name: "Bed", x: 0, y: 0, lengthFt: 12, widthFt: 3 }),
      ORIGIN,
    ) as GeoPoint[];

    const northWest = ring[0] as GeoPoint;
    const northEast = ring[1] as GeoPoint;
    const southWest = ring[3] as GeoPoint;

    expect(metresBetween(northWest, northEast).east).toBeCloseTo(12 * METRES_PER_FOOT, 4);
    expect(metresBetween(northWest, northEast).south).toBeCloseTo(0, 6);
    expect(metresBetween(northWest, southWest).south).toBeCloseTo(3 * METRES_PER_FOOT, 4);
  });

  it("reads a drawn ring as the rectangle around it, whatever was clicked", () => {
    // §5.5 gives a bed a length and a width and nothing else, so three clicks
    // are enough to say which rectangle — and a fourth corner off true is an
    // adjustment of the extent rather than a quadrilateral the record cannot
    // hold.
    const corners = [
      { lat: ORIGIN.lat - 0.00002, lng: ORIGIN.lng + 0.00001 },
      { lat: ORIGIN.lat - 0.00005, lng: ORIGIN.lng + 0.00004 },
      { lat: ORIGIN.lat - 0.00003, lng: ORIGIN.lng + 0.00002 },
    ];

    const geometry = bedGeometry(corners, ORIGIN);
    expect(geometry).toBeDefined();

    // And what it read back draws the same extent again.
    const redrawn = bedGeometry(bedBoundary(geometry as BedGeometry, ORIGIN) as GeoPoint[], ORIGIN);
    expect(redrawn).toEqual(geometry);
  });

  it("refuses a ring that encloses no ground", () => {
    // `bedSchema` wants positive dimensions, and a bed with no width is not a
    // badly drawn bed — it is a line.
    const flat = [
      { lat: ORIGIN.lat, lng: ORIGIN.lng },
      { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.00004 },
      { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.00002 },
    ];

    expect(bedGeometry(flat, ORIGIN)).toBeUndefined();
    expect(bedGeometry([], ORIGIN)).toBeUndefined();
  });

  it("draws nothing for a bed nobody has placed", () => {
    // All four numbers or none: a position with no size is a point, and a size
    // with no position has nowhere on the plan to go.
    expect(bedBoundary(bed({ id: id(3), name: "New bed" }), ORIGIN)).toBeUndefined();
    expect(
      bedBoundary(bed({ id: id(4), name: "Measured", lengthFt: 8, widthFt: 4 }), ORIGIN),
    ).toBeUndefined();
  });

  it("snaps to the foot, because that is what the tape says", () => {
    expect(gardenGrid(ORIGIN)).toEqual({ metres: METRES_PER_FOOT, anchor: ORIGIN });
  });
});

describe("where the plan hangs", () => {
  it("takes the garden zone's north-west corner when it has been traced", () => {
    const zone = {
      boundary: [
        { lat: 32.74, lng: -97.41 },
        { lat: 32.74, lng: -97.4 },
        { lat: 32.73, lng: -97.4 },
      ],
    } as Pick<Zone, "boundary">;

    expect(gardenOrigin(zone, undefined)).toEqual({ lat: 32.74, lng: -97.41 });
  });

  it("falls back to the property, and then says there is nowhere", () => {
    const property = { latitude: 32.7357, longitude: -97.4089 } as Pick<
      Property,
      "latitude" | "longitude"
    >;

    expect(gardenOrigin(undefined, property)).toEqual({ lat: 32.7357, lng: -97.4089 });
    expect(gardenOrigin(undefined, {} as Pick<Property, "latitude" | "longitude">)).toBeUndefined();
  });
});

describe("beds as shapes", () => {
  const north = bed({ id: id(10), name: "North bed", x: 0, y: 0, lengthFt: 8, widthFt: 4 });
  const south = bed({ id: id(11), name: "South bed", x: 0, y: 6, lengthFt: 8, widthFt: 4 });
  const retired = bed({
    id: id(12),
    name: "Old bed",
    active: false,
    x: 0,
    y: 12,
    lengthFt: 4,
    widthFt: 4,
  });

  /** Tomatoes came out of the north bed last autumn. */
  const lastSeason = planting({
    id: id(20),
    bedId: north.id,
    varietyId: CHEROKEE.id,
    status: "finished",
    plantedOn: new Date("2025-04-01T12:00:00Z"),
  });

  it("says nothing about rotation until somebody says what is going in", () => {
    // "Is this bed clear" is not a question a bed can answer on its own, so an
    // uncoloured plan is the honest drawing rather than a missing feature.
    const [drawn] = bedShapes([north], [lastSeason], VARIETIES, CROPS, ORIGIN, NOW);
    expect(drawn?.rank).toBeUndefined();
  });

  it("colours every bed for the family about to be planted", () => {
    const shapes = bedShapes(
      [north, south],
      [lastSeason],
      VARIETIES,
      CROPS,
      ORIGIN,
      NOW,
      "Solanaceae",
    );

    // Fourteen months since the tomatoes: inside the three-year window, and
    // not last season.
    expect(shapes.find((shape) => shape.id === north.id)?.rank).toBe(ROTATION_INSIDE_WINDOW);
    expect(shapes.find((shape) => shape.id === south.id)?.rank).toBe(ROTATION_CLEAR);
  });

  it("reads last season's family as the reddest step", () => {
    const recent = { ...lastSeason, plantedOn: new Date("2026-03-01T12:00:00Z") };
    const [drawn] = bedShapes([north], [recent], VARIETIES, CROPS, ORIGIN, NOW, "Solanaceae");

    expect(drawn?.rank).toBe(ROTATION_LAST_SEASON);
  });

  it("goes clear again once the rotation has run its course", () => {
    const old = { ...lastSeason, plantedOn: new Date("2022-04-01T12:00:00Z") };
    const [drawn] = bedShapes([north], [old], VARIETIES, CROPS, ORIGIN, NOW, "Solanaceae");

    expect(drawn?.rank).toBe(ROTATION_CLEAR);
  });

  it("draws a bed with nothing in it as fallow, and a retired one as retired", () => {
    const growing = planting({ id: id(21), bedId: south.id, varietyId: RED_RUSSIAN.id });
    const shapes = bedShapes([north, south, retired], [growing], VARIETIES, CROPS, ORIGIN, NOW);

    expect(shapes.find((shape) => shape.id === north.id)?.resting).toBe(true);
    expect(shapes.find((shape) => shape.id === south.id)?.resting).toBe(false);
    expect(shapes.find((shape) => shape.id === retired.id)?.inactive).toBe(true);
  });

  it("carries the size and the soil notes across", () => {
    const noted = { ...north, soilNotes: "Heavy clay, amended twice." };
    const [drawn] = bedShapes([noted], [], VARIETIES, CROPS, ORIGIN, NOW);

    expect(drawn?.sublabel).toBe("8′ × 4′");
    // An attributed line rather than a bare string, since #19 made the editor
    // take instructions as lines that each name their source. A bed's note
    // comes from the bed, so it is a list of one that still says so.
    expect(drawn?.instructions).toEqual([
      { from: "North bed", text: "Heavy clay, amended twice." },
    ]);
    expect(drawn?.boundary).toHaveLength(4);
  });
});

describe("plantings as chips", () => {
  const north = bed({ id: id(30), name: "North bed", x: 0, y: 0, lengthFt: 8, widthFt: 4 });

  it("draws what is in the ground and leaves out what is not", () => {
    // The same cut `animalChips` makes for the sold and the dead: a planned row
    // has not been sown and a row started indoors is on a windowsill.
    const chips = plantingChips(
      [
        planting({ id: id(40), bedId: north.id, varietyId: CHEROKEE.id, status: "growing" }),
        planting({ id: id(41), bedId: north.id, varietyId: RED_RUSSIAN.id, status: "planned" }),
        planting({ id: id(42), bedId: north.id, varietyId: RED_RUSSIAN.id, status: "finished" }),
      ],
      VARIETIES,
      CROPS,
    );

    expect(chips.map((chip) => chip.id)).toEqual([id(40)]);
    expect(chips[0]?.label).toBe("Cherokee Purple · Tomato");
    expect(chips[0]?.shapeId).toBe(north.id);
  });

  it("gives one family one colour, and always names it", () => {
    // The colour is the fast path and never the only one (§5.1): the accent
    // travels with `accentLabel`, which the palette reads out as "family".
    const another = { ...CHEROKEE, id: id(92), name: "Roma" } as Variety;
    const chips = plantingChips(
      [
        planting({ id: id(50), bedId: north.id, varietyId: CHEROKEE.id }),
        planting({ id: id(51), bedId: north.id, varietyId: another.id }),
        planting({ id: id(52), bedId: north.id, varietyId: RED_RUSSIAN.id }),
      ],
      [...VARIETIES, another],
      CROPS,
    );

    const byLabel = new Map(chips.map((chip) => [chip.label, chip]));
    expect(byLabel.get("Cherokee Purple · Tomato")?.accent).toBe(
      byLabel.get("Roma · Tomato")?.accent,
    );
    expect(byLabel.get("Cherokee Purple · Tomato")?.accentLabel).toBe("Solanaceae");
    expect(byLabel.get("Red Russian · Kale")?.accentLabel).toBe("Brassicaceae");
  });

  it("has no colour for a planting whose crop is gone", () => {
    const orphan = planting({ id: id(60), bedId: north.id, varietyId: id(99) });
    const [chip] = plantingChips([orphan], VARIETIES, CROPS);

    expect(chip?.accent).toBeUndefined();
    expect(chip?.accentLabel).toBeUndefined();
    expect(familyAccent(undefined)).toBeUndefined();
    expect(familyAccent("  ")).toBeUndefined();
  });
});
