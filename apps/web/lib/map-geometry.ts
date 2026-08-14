import { safetyScale } from "@galaxy-farm/ui";
import type { Divider, GeoPoint, SafetyLevel, Zone } from "@galaxy-farm/core";

/**
 * Where the map opens, and what the shapes on it look like (spec §8).
 *
 * Kept apart from the map component because none of it needs Google, a
 * browser, or a canvas — it is arithmetic on latitudes and a lookup on the
 * safety scale. That is what makes it testable, and this is the layer where a
 * lat/lng swap would hide: two numbers of the same type in the same order,
 * wrong by nine hundred miles, and the map still renders something.
 */

/** A corner of the world, in the shape Google takes. */
export interface LatLngLiteral {
  readonly lat: number;
  readonly lng: number;
}

export interface MapBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * Zoomed to a farm rather than a county.
 *
 * 18 shows a pen at a size somebody can trace a corner on; the whole place
 * still fits at this zoom on any screen wider than a phone.
 */
export const DEFAULT_ZOOM = 18;

export function boundsOf(points: readonly GeoPoint[]): MapBounds | undefined {
  if (points.length === 0) return undefined;

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);

  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };
}

/** Every point of every boundary and fence drawn so far. */
export function drawnPoints(zones: readonly Pick<Zone, "boundary" | "dividers">[]): GeoPoint[] {
  return zones.flatMap((zone) => [
    ...(zone.boundary ?? []),
    ...(zone.dividers ?? []).flatMap((divider) => [...divider.line]),
  ]);
}

/**
 * Where to open.
 *
 * What has already been drawn wins over the property's pin, because the pin is
 * on the house and the pens are the reason anybody opened this screen. The pin
 * is the fallback for the first visit, when nothing has been drawn at all.
 *
 * Undefined when there is neither — which is a real state on a farm whose
 * address has not been looked up yet, and the screen says so rather than
 * opening on the Atlantic, where `0, 0` is.
 */
export function openingView(
  zones: readonly Pick<Zone, "boundary" | "dividers">[],
  property: { latitude?: number | undefined; longitude?: number | undefined },
): { centre: LatLngLiteral; bounds?: MapBounds | undefined } | undefined {
  const bounds = boundsOf(drawnPoints(zones));

  if (bounds !== undefined) {
    return {
      centre: {
        lat: (bounds.south + bounds.north) / 2,
        lng: (bounds.west + bounds.east) / 2,
      },
      // A single point has no extent, and fitting to it zooms to the maximum.
      ...(bounds.south === bounds.north && bounds.west === bounds.east ? {} : { bounds }),
    };
  }

  if (property.latitude === undefined || property.longitude === undefined) return undefined;
  return { centre: { lat: property.latitude, lng: property.longitude } };
}

/** How a zone's outline is painted — the safety scale, as §8 asks for. */
export interface ZonePaint {
  readonly strokeColor: string;
  readonly strokeOpacity: number;
  readonly strokeWeight: number;
  readonly fillColor: string;
  readonly fillOpacity: number;
}

/**
 * A pen's colours.
 *
 * The border carries the baseline safety level, which is the one thing on this
 * screen somebody needs to read from across a barn. The colours come from
 * `safetyScale` rather than being chosen here: they are the same five the
 * badges use, and they have been contrast-checked once, in one place.
 *
 * The fill stays faint whatever the level. It sits over an aerial photograph
 * and the photograph is the point — a pen filled solid red is a pen whose
 * ground nobody can see.
 */
export function zonePaint(
  zone: Pick<Zone, "baselineSafetyLevel" | "resting" | "active">,
): ZonePaint {
  const colour = safetyScale[zone.baselineSafetyLevel as SafetyLevel].color;

  // Resting ground renders dimmed, the same as it does everywhere else (§5.1),
  // so a pasture being rested is not mistaken for one in use.
  const dimmed = zone.resting || !zone.active;

  return {
    strokeColor: colour,
    strokeOpacity: dimmed ? 0.45 : 0.95,
    strokeWeight: dimmed ? 2 : 3,
    fillColor: colour,
    fillOpacity: dimmed ? 0.05 : 0.15,
  };
}

/**
 * A temporary fence's line — solid when it is standing, dashed when it is not.
 *
 * Drawn the way it was drawn on the hand-sketched map, which is the convention
 * somebody already reads without being told: a dashed line is fencing that is
 * not there right now. Getting this backwards would be worse than not drawing
 * it, since the whole question the map answers is whether the cattle can get
 * to the far end.
 */
export interface DividerPaint {
  readonly strokeColor: string;
  readonly strokeOpacity: number;
  readonly strokeWeight: number;
  readonly dashed: boolean;
}

export function dividerPaint(divider: Pick<Divider, "up">): DividerPaint {
  return {
    strokeColor: "#FFFFFF",
    strokeOpacity: divider.up ? 1 : 0.7,
    strokeWeight: divider.up ? 3 : 2,
    dashed: !divider.up,
  };
}

/**
 * A boundary is a ring; a fence line is not.
 *
 * Three points is the fewest that enclose any ground, and the schema says so
 * too. Worth checking again here because the map is where a half-traced pen
 * exists: two clicks in, there is a path, and it is not yet a pen.
 */
export function isTraceable(path: readonly GeoPoint[]): boolean {
  return path.length >= 3;
}

/** What the trace button says, which is also the whole instruction. */
export function traceHint(path: readonly GeoPoint[]): string {
  if (path.length === 0) return "Click each corner of the pen. Three corners is the fewest.";
  if (path.length < 3) return `${path.length} down — at least ${3 - path.length} more.`;
  return `${path.length} corners. Save it, or keep clicking to add more.`;
}
