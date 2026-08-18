import { describe, expect, it } from "vitest";

import type { GeoPoint } from "@galaxy-farm/core";

import {
  boundsOf,
  centroid,
  clampZoom,
  containsPoint,
  cornersOf,
  DEFAULT_ZOOM,
  fitViewport,
  fromWorld,
  gridLines,
  lineData,
  MAX_LATITUDE,
  MAX_ZOOM,
  METRES_PER_DEGREE_LATITUDE,
  metresPerDegreeLongitude,
  MIN_ZOOM,
  panBy,
  pathData,
  project,
  snapToGrid,
  toWorld,
  unproject,
  worldSize,
  zoomTo,
  type Viewport,
} from "../src/spatial-editor/geometry.js";

/**
 * The arithmetic the whole editor rests on (spec §8).
 *
 * Two things are tested harder than the rest, because they are the two that
 * fail silently. The **round trip** is the one that writes to records: every
 * corner a user clicks is a screen point unprojected back into a coordinate,
 * and a projection that is out by a metre stores a fence a metre from where it
 * was traced with nothing on screen to show for it. The **lat/lng order** is
 * the other: two numbers of the same type in the same order, swapped, and the
 * map still draws a perfectly convincing polygon — in Antarctica.
 */

/** The farm: Fort Worth, near enough. */
const FARM: GeoPoint = { lat: 32.7357, lng: -97.4089 };

const view = (over: Partial<Viewport> = {}): Viewport => ({
  centre: FARM,
  zoom: 18,
  width: 800,
  height: 600,
  ...over,
});

/**
 * Great-circle distance, written out rather than imported.
 *
 * The grid tests below have to check that a metre is a metre on the ground,
 * and measuring that with the same helpers the grid is built from would prove
 * only that the code agrees with itself.
 */
function metresBetween(from: GeoPoint, to: GeoPoint): number {
  const radius = 6_371_008.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * radius * Math.asin(Math.sqrt(a));
}

describe("projection", () => {
  it("returns the same coordinate it was given, at every zoom a farm is drawn at", () => {
    const points: GeoPoint[] = [
      FARM,
      { lat: 32.74, lng: -97.4 },
      { lat: -33.86, lng: 151.2 },
      { lat: 0, lng: 0 },
      { lat: 60.17, lng: 24.94 },
    ];

    for (const zoom of [4, 12, 16, 18, 21]) {
      for (const point of points) {
        const there = project(point, view({ zoom, centre: point }));
        const back = unproject(there, view({ zoom, centre: point }));

        // Sub-millimetre. Looser than the arithmetic deserves and tight enough
        // that a swapped axis or a dropped scale factor cannot hide in it.
        expect(back.lat).toBeCloseTo(point.lat, 9);
        expect(back.lng).toBeCloseTo(point.lng, 9);
      }
    }
  });

  it("puts north up and east right, which is the swap that draws a convincing wrong map", () => {
    const here = project(FARM, view());
    const north = project({ lat: FARM.lat + 0.001, lng: FARM.lng }, view());
    const east = project({ lat: FARM.lat, lng: FARM.lng + 0.001 }, view());

    expect(north.y).toBeLessThan(here.y);
    expect(east.x).toBeGreaterThan(here.x);
    // And nothing has leaked across: moving north must not move sideways.
    expect(north.x).toBeCloseTo(here.x, 6);
    expect(east.y).toBeCloseTo(here.y, 6);
  });

  it("centres the viewport's centre in the panel", () => {
    const at = project(FARM, view());

    expect(at.x).toBeCloseTo(400, 6);
    expect(at.y).toBeCloseTo(300, 6);
  });

  it("doubles the pixels per degree for each zoom level", () => {
    const near = project({ lat: FARM.lat, lng: FARM.lng + 0.001 }, view({ zoom: 17 })).x - 400;
    const far = project({ lat: FARM.lat, lng: FARM.lng + 0.001 }, view({ zoom: 18 })).x - 400;

    expect(far / near).toBeCloseTo(2, 6);
    expect(worldSize(18)).toBe(worldSize(17) * 2);
  });

  it("clamps at the latitude Mercator gives up on rather than returning infinity", () => {
    const pole = toWorld({ lat: 90, lng: 0 });

    expect(Number.isFinite(pole.y)).toBe(true);
    expect(fromWorld(pole).lat).toBeCloseTo(MAX_LATITUDE, 5);
  });
});

describe("fitting a view to what is drawn", () => {
  const ring: GeoPoint[] = [
    { lat: 32.736, lng: -97.41 },
    { lat: 32.738, lng: -97.406 },
    { lat: 32.734, lng: -97.405 },
  ];

  it("puts every corner inside the panel, clear of the padding", () => {
    const bounds = boundsOf(ring);
    expect(bounds).toBeDefined();

    const fitted = fitViewport(bounds as NonNullable<typeof bounds>, {
      width: 800,
      height: 600,
    });

    for (const point of ring) {
      const at = project(point, fitted);
      expect(at.x).toBeGreaterThanOrEqual(24);
      expect(at.x).toBeLessThanOrEqual(800 - 24);
      expect(at.y).toBeGreaterThanOrEqual(24);
      expect(at.y).toBeLessThanOrEqual(600 - 24);
    }
  });

  it("opens on the farm at a sensible zoom when there is only one point to fit", () => {
    // A property with its pin dropped and nothing traced. There is no extent
    // to fit, and asking for the zoom that makes a zero-width thing fill a
    // panel is a division by zero.
    const fitted = fitViewport(
      { south: FARM.lat, west: FARM.lng, north: FARM.lat, east: FARM.lng },
      { width: 800, height: 600 },
    );

    expect(fitted.zoom).toBe(DEFAULT_ZOOM);
    expect(fitted.centre.lat).toBeCloseTo(FARM.lat, 9);
    expect(fitted.centre.lng).toBeCloseTo(FARM.lng, 9);
  });

  it("fits a boundary with no width to the height it does have", () => {
    const fitted = fitViewport(
      { south: 32.73, west: -97.41, north: 32.74, east: -97.41 },
      { width: 800, height: 600 },
    );

    expect(fitted.zoom).toBeLessThan(MAX_ZOOM);
    expect(fitted.zoom).toBeGreaterThan(MIN_ZOOM);
  });

  it("never asks for a zoom nobody has tiles for", () => {
    expect(clampZoom(40)).toBe(MAX_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
  });

  it("returns nothing to fit for an empty set of points", () => {
    expect(boundsOf([])).toBeUndefined();
  });

  it("walks a rectangle's corners clockwise from the north-west", () => {
    expect(cornersOf({ south: 1, west: 2, north: 3, east: 4 })).toEqual([
      { lat: 3, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 1, lng: 4 },
      { lat: 1, lng: 2 },
    ]);
  });
});

describe("panning and zooming", () => {
  it("drags the ground with the pointer", () => {
    const moved = panBy(view(), 100, 0);

    // The map moved right, so the ground now under the middle is to the west.
    expect(moved.centre.lng).toBeLessThan(FARM.lng);
    expect(project(FARM, moved).x).toBeCloseTo(500, 6);
  });

  it("keeps the ground under the pointer still while zooming", () => {
    const start = view();
    const anchor = { x: 620, y: 180 };
    const under = unproject(anchor, start);

    const zoomed = zoomTo(start, 20, anchor);
    const after = project(under, zoomed);

    expect(zoomed.zoom).toBe(20);
    expect(after.x).toBeCloseTo(anchor.x, 4);
    expect(after.y).toBeCloseTo(anchor.y, 4);
  });

  it("zooms about the middle when nothing is anchoring it", () => {
    const zoomed = zoomTo(view(), 19);

    expect(zoomed.zoom).toBe(19);
    expect(zoomed.centre).toEqual(FARM);
  });
});

describe("rings", () => {
  /** An L, so the mean of the corners falls outside the ground it encloses. */
  const bent: GeoPoint[] = [
    { lat: 32.73, lng: -97.41 },
    { lat: 32.74, lng: -97.41 },
    { lat: 32.74, lng: -97.408 },
    { lat: 32.732, lng: -97.408 },
    { lat: 32.732, lng: -97.4 },
    { lat: 32.73, lng: -97.4 },
  ];

  it("weights the middle by area, not by how often somebody clicked", () => {
    // A pasture traced with six clicks along one fence and one at the far
    // corner has its *mean* sitting on the crowded side, and the chips would
    // pile up over the fence rather than over the ground.
    const crowded: GeoPoint[] = [
      { lat: 32.73, lng: -97.41 },
      { lat: 32.7301, lng: -97.4099 },
      { lat: 32.7302, lng: -97.4098 },
      { lat: 32.7303, lng: -97.4097 },
      { lat: 32.74, lng: -97.4 },
      { lat: 32.73, lng: -97.4 },
    ];

    const mean = {
      lat: crowded.reduce((sum, point) => sum + point.lat, 0) / crowded.length,
      lng: crowded.reduce((sum, point) => sum + point.lng, 0) / crowded.length,
    };
    const middle = centroid(crowded);

    expect(middle).toBeDefined();
    expect(containsPoint(crowded, middle as GeoPoint)).toBe(true);
    expect(middle?.lng).not.toBeCloseTo(mean.lng, 5);
  });

  it("falls back to the mean for a ring with no area rather than dividing by zero", () => {
    const flat: GeoPoint[] = [
      { lat: 32.73, lng: -97.41 },
      { lat: 32.74, lng: -97.41 },
      { lat: 32.75, lng: -97.41 },
    ];

    const middle = centroid(flat);
    expect(middle?.lat).toBeCloseTo(32.74, 9);
    expect(middle?.lng).toBeCloseTo(-97.41, 9);
    expect(centroid([FARM])).toEqual(FARM);
    expect(centroid([])).toBeUndefined();
  });

  it("knows what is inside a bent boundary and what is only inside its extent", () => {
    // Inside the L's own outline.
    expect(containsPoint(bent, { lat: 32.735, lng: -97.409 })).toBe(true);
    // Inside the bounding box, outside the ground — the notch of the L.
    expect(containsPoint(bent, { lat: 32.738, lng: -97.402 })).toBe(false);
    // Nowhere near.
    expect(containsPoint(bent, { lat: 32.9, lng: -97.4 })).toBe(false);
  });

  it("says a half-traced boundary contains nothing", () => {
    // Two clicks in, there is a path and it is not yet a pen. Answering "yes"
    // here would let a chip be dropped into ground that does not exist.
    expect(
      containsPoint(
        [
          { lat: 32.73, lng: -97.41 },
          { lat: 32.74, lng: -97.41 },
        ],
        FARM,
      ),
    ).toBe(false);
  });

  it("closes a boundary and leaves a fence line open", () => {
    expect(pathData(bent, view()).endsWith(" Z")).toBe(true);
    expect(lineData(bent, view()).endsWith(" Z")).toBe(false);
    expect(pathData([], view())).toBe("");
  });
});

describe("the grid", () => {
  const grid = { metres: 1, anchor: FARM };

  it("leaves the anchor exactly where it is", () => {
    expect(snapToGrid(FARM, grid)).toEqual(FARM);
  });

  it("snaps to the nearest intersection", () => {
    const nudged = {
      lat: FARM.lat + 2.4 / METRES_PER_DEGREE_LATITUDE,
      lng: FARM.lng + 0.4 / metresPerDegreeLongitude(FARM.lat),
    };
    const snapped = snapToGrid(nudged, grid);

    expect(metresBetween(FARM, { lat: snapped.lat, lng: FARM.lng })).toBeCloseTo(2, 2);
    expect(metresBetween(FARM, { lat: FARM.lat, lng: snapped.lng })).toBeCloseTo(0, 2);
  });

  it("is square on the ground, which is not square in degrees", () => {
    // The bug this is here for: Mercator stretches by 1/cos(latitude), so a
    // grid snapped in projected units comes out 19% coarser one way than the
    // other at this farm's latitude, and the beds are built oblong.
    const east = snapToGrid(
      { lat: FARM.lat, lng: FARM.lng + 5.2 / metresPerDegreeLongitude(FARM.lat) },
      { metres: 5, anchor: FARM },
    );
    const north = snapToGrid(
      { lat: FARM.lat + 5.2 / METRES_PER_DEGREE_LATITUDE, lng: FARM.lng },
      { metres: 5, anchor: FARM },
    );

    expect(metresBetween(FARM, east)).toBeCloseTo(5, 1);
    expect(metresBetween(FARM, north)).toBeCloseTo(5, 1);

    // Same distance, different number of degrees — that is the whole point.
    const degreesEast = Math.abs(east.lng - FARM.lng);
    const degreesNorth = Math.abs(north.lat - FARM.lat);
    expect(degreesEast / degreesNorth).toBeCloseTo(1 / Math.cos((FARM.lat * Math.PI) / 180), 2);
  });

  it("does nothing when there is no grid to speak of", () => {
    expect(snapToGrid(FARM, { metres: 0, anchor: FARM })).toEqual(FARM);
    expect(gridLines(view(), { metres: 0, anchor: FARM })).toEqual({
      vertical: [],
      horizontal: [],
    });
  });

  it("draws lines through the panel, anchored where it was told", () => {
    const lines = gridLines(view({ zoom: 21 }), { metres: 5, anchor: FARM });

    expect(lines.vertical.length).toBeGreaterThan(0);
    expect(lines.horizontal.length).toBeGreaterThan(0);
    // The anchor is on the grid, so a line passes through the middle.
    expect(lines.vertical.some((x) => Math.abs(x - 400) < 0.001)).toBe(true);
    expect(lines.horizontal.some((y) => Math.abs(y - 300) < 0.001)).toBe(true);
  });

  it("draws nothing rather than a solid block when the grid is finer than the pixels", () => {
    // Half a metre while the panel shows a county is tens of thousands of
    // lines that render as grey and lock the tab up drawing them.
    expect(gridLines(view({ zoom: 10 }), { metres: 0.5, anchor: FARM })).toEqual({
      vertical: [],
      horizontal: [],
    });
  });
});
