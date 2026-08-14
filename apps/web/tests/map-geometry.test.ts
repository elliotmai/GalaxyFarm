import { describe, expect, it } from "vitest";

import type { GeoPoint, Zone } from "@galaxy-farm/core";

import { mapsApiKey, mapsScriptUrl } from "../lib/google-maps";
import {
  boundsOf,
  dividerPaint,
  drawnPoints,
  isTraceable,
  openingView,
  traceHint,
  zonePaint,
} from "../lib/map-geometry";

/**
 * Where the map opens and what it paints (spec §8).
 *
 * None of this needs Google or a canvas, which is the reason it is a separate
 * file from the screen. It is also the layer a latitude/longitude swap would
 * hide in: two numbers of the same type in the same order, wrong by nine
 * hundred miles, and the map still renders something.
 */

const at = (lat: number, lng: number): GeoPoint => ({ lat, lng });

/** Roughly the shape of the home place — a few hundred feet across. */
const pasture = [at(33.05, -97.47), at(33.052, -97.47), at(33.052, -97.468), at(33.05, -97.468)];

const zone = (over: Partial<Zone> = {}): Zone =>
  ({
    baselineSafetyLevel: 1,
    resting: false,
    active: true,
    ...over,
  }) as Zone;

describe("where the map opens", () => {
  it("has nowhere to go with no pin and nothing drawn", () => {
    // The alternative is 0, 0 — which is in the Atlantic, and looks exactly
    // like a map that failed to find the farm.
    expect(openingView([], {})).toBeUndefined();
  });

  it("falls back to the pin on the house before anything is drawn", () => {
    const view = openingView([], { latitude: 33.05, longitude: -97.47 });

    expect(view?.centre).toEqual({ lat: 33.05, lng: -97.47 });
    expect(view?.bounds).toBeUndefined();
  });

  it("prefers what has been drawn, since the pens are why anybody opened it", () => {
    // The pin is on the house, deliberately away from the pens.
    const view = openingView([zone({ boundary: pasture })], {
      latitude: 33.04,
      longitude: -97.46,
    });

    expect(view?.centre.lat).toBeCloseTo(33.051, 5);
    expect(view?.centre.lng).toBeCloseTo(-97.469, 5);
    expect(view?.bounds).toEqual({
      south: 33.05,
      west: -97.47,
      north: 33.052,
      east: -97.468,
    });
  });

  it("does not offer bounds for a single point, which would zoom to the maximum", () => {
    const view = openingView([zone({ boundary: [at(33.05, -97.47)] })], {});

    expect(view?.centre).toEqual({ lat: 33.05, lng: -97.47 });
    expect(view?.bounds).toBeUndefined();
  });

  it("counts fence lines as drawn ground too", () => {
    const fenced = zone({
      dividers: [
        {
          id: "cross",
          name: "Pasture cross-fence",
          line: [at(33.06, -97.48), at(33.061, -97.48)],
          up: true,
          waterSourceIds: [],
        },
      ],
    });

    expect(drawnPoints([fenced])).toHaveLength(2);
    expect(openingView([fenced], {})?.centre.lat).toBeCloseTo(33.0605, 5);
  });

  it("keeps north above south and east right of west", () => {
    // The swap this is here for: latitude and longitude are both numbers, and
    // reversing them puts a Texas farm in the Indian Ocean without any error.
    const bounds = boundsOf(pasture);

    expect(bounds?.north).toBeGreaterThan(bounds?.south as number);
    expect(bounds?.east).toBeGreaterThan(bounds?.west as number);
    expect(bounds?.north).toBeLessThan(90);
    expect(bounds?.west).toBeLessThan(0);
  });

  it("has no bounds for nothing", () => {
    expect(boundsOf([])).toBeUndefined();
  });
});

describe("how a pen is painted", () => {
  it("carries the safety level in the border, which is the readable part", () => {
    const calm = zonePaint(zone({ baselineSafetyLevel: 1 }));
    const dangerous = zonePaint(zone({ baselineSafetyLevel: 5 }));

    expect(calm.strokeColor).not.toBe(dangerous.strokeColor);
  });

  it("keeps the fill faint, because the photograph underneath is the point", () => {
    // A pen filled solid is a pen whose ground nobody can see.
    expect(zonePaint(zone({ baselineSafetyLevel: 5 })).fillOpacity).toBeLessThan(0.25);
  });

  it("dims ground that is resting, the same as every other screen does", () => {
    const inUse = zonePaint(zone({ resting: false }));
    const resting = zonePaint(zone({ resting: true }));

    expect(resting.strokeOpacity).toBeLessThan(inUse.strokeOpacity);
  });

  it("dims a zone that is not in service at all", () => {
    expect(zonePaint(zone({ active: false })).strokeOpacity).toBeLessThan(
      zonePaint(zone()).strokeOpacity,
    );
  });
});

describe("how temporary fencing is drawn", () => {
  it("draws standing fence solid and stowed fence dashed", () => {
    // The convention from the hand-drawn map, which somebody already reads
    // without being told. Backwards would be worse than not drawing it: the
    // question this map answers is whether the cattle can reach the far end.
    expect(dividerPaint({ up: true }).dashed).toBe(false);
    expect(dividerPaint({ up: false }).dashed).toBe(true);
  });

  it("makes the standing one heavier, since it is the one that is really there", () => {
    expect(dividerPaint({ up: true }).strokeWeight).toBeGreaterThan(
      dividerPaint({ up: false }).strokeWeight,
    );
  });
});

describe("tracing a boundary", () => {
  it("needs three corners before it encloses any ground", () => {
    expect(isTraceable([])).toBe(false);
    expect(isTraceable(pasture.slice(0, 2))).toBe(false);
    expect(isTraceable(pasture.slice(0, 3))).toBe(true);
  });

  it("says how many more are needed rather than just refusing", () => {
    expect(traceHint([])).toContain("Three corners is the fewest");
    expect(traceHint(pasture.slice(0, 1))).toContain("2 more");
    expect(traceHint(pasture)).toContain("4 corners");
  });
});

describe("the key", () => {
  it("is absent when unset or blank", () => {
    expect(mapsApiKey({})).toBeUndefined();
    expect(mapsApiKey({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "   " })).toBeUndefined();
    expect(mapsApiKey({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: " abc " })).toBe("abc");
  });

  it("asks for a pinned version rather than whatever weekly happens to be", () => {
    // A Google release must not change how the map behaves between two
    // mornings without anybody deploying anything.
    const url = mapsScriptUrl("abc");

    expect(url).toContain("key=abc");
    expect(url).toMatch(/[?&]v=3\.\d+/);
  });
});
