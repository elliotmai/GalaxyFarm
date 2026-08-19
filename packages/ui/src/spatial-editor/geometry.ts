import type { GeoPoint } from "@galaxy-farm/core";

/**
 * The arithmetic underneath the spatial editor (spec §8).
 *
 * Kept apart from the component for the same reason `map-geometry.ts` was kept
 * apart from the map screen: none of it needs a browser, a canvas, or Google,
 * so all of it can be tested directly. This is also the layer where a lat/lng
 * swap would hide — two numbers of the same type in the same order, wrong by
 * nine hundred miles, and the editor still draws something.
 *
 * ## Why Web Mercator, specifically
 *
 * The projection is not a free choice. §8 puts pens over the Google satellite
 * layer online, and Google's imagery is Web Mercator with 256-pixel tiles, so
 * an overlay drawn in any other projection lands next to the fence rather than
 * on it. Using Google's own formula means the SVG and the tiles under it agree
 * by construction rather than by adjustment — and the *same* formula, with the
 * tiles replaced by an owned NAIP image, is what makes the offline background
 * interchangeable rather than a second implementation.
 *
 * Shapes are stored as lat/lng and projected on the way to the screen, every
 * frame, in this direction only. Nothing here ever writes a screen coordinate
 * back into a record.
 */

/** Google's tile size, and therefore the unit the zoom scale is built on. */
export const TILE_SIZE = 256;

/**
 * Where Mercator gives up.
 *
 * The projection stretches to infinity at the poles, so every implementation
 * of it clips at the latitude that makes the world square — this one. Nothing
 * on a farm in Texas is near it; the clamp exists so a bad coordinate produces
 * a point at the edge of the world rather than `Infinity`, which would take
 * the whole drawing with it.
 */
export const MAX_LATITUDE = 85.05112878;

/** Zoomed to a farm rather than a county — a pen is traceable at 18. */
export const DEFAULT_ZOOM = 18;

/** Below 2 the whole world is smaller than the panel; above 22 Google has no tiles. */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 22;

/** A point in the panel, in CSS pixels from its top-left corner. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** A rectangle of the world. The shape `fitViewport` takes and `boundsOf` returns. */
export interface GeoBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * What is on screen: where the panel is centred, how far in, and how big it is.
 *
 * One object rather than three props because every function here needs all
 * four numbers together, and because it is the single thing a background layer
 * has to be told in order to line up — the Google map is handed this and sets
 * its own centre and zoom from it.
 */
export interface Viewport {
  readonly centre: GeoPoint;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

/** Pixels across the whole world at this zoom. */
export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/**
 * The world as a unit square: (0,0) at the north-west corner, (1,1) at the
 * south-east. Zoom-independent, which is what lets `fitViewport` work out a
 * zoom from an extent rather than searching for one.
 */
export function toWorld(point: GeoPoint): ScreenPoint {
  const lat = (clampLatitude(point.lat) * Math.PI) / 180;
  return {
    x: (point.lng + 180) / 360,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2,
  };
}

/** The inverse of `toWorld`. */
export function fromWorld(at: ScreenPoint): GeoPoint {
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * at.y))) * 180) / Math.PI,
    lng: at.x * 360 - 180,
  };
}

/** A coordinate, as a point in the panel. */
export function project(point: GeoPoint, view: Viewport): ScreenPoint {
  const scale = worldSize(view.zoom);
  const here = toWorld(point);
  const centre = toWorld(view.centre);

  return {
    x: (here.x - centre.x) * scale + view.width / 2,
    y: (here.y - centre.y) * scale + view.height / 2,
  };
}

/**
 * A point in the panel, as a coordinate.
 *
 * The half of the pair that writes to records — every vertex a user drags or
 * clicks comes back through here — so the round trip is asserted in the tests
 * rather than assumed.
 */
export function unproject(at: ScreenPoint, view: Viewport): GeoPoint {
  const scale = worldSize(view.zoom);
  const centre = toWorld(view.centre);

  return fromWorld({
    x: (at.x - view.width / 2) / scale + centre.x,
    y: (at.y - view.height / 2) / scale + centre.y,
  });
}

/** An SVG path for a ring. Closed, because a boundary encloses ground. */
export function pathData(points: readonly GeoPoint[], view: Viewport): string {
  if (points.length === 0) return "";

  const drawn = points
    .map((point, index) => {
      const at = project(point, view);
      return `${index === 0 ? "M" : "L"}${at.x.toFixed(2)} ${at.y.toFixed(2)}`;
    })
    .join(" ");

  return `${drawn} Z`;
}

/** An SVG path for a line that does not close — a cross-fence, a path, a run. */
export function lineData(points: readonly GeoPoint[], view: Viewport): string {
  return points
    .map((point, index) => {
      const at = project(point, view);
      return `${index === 0 ? "M" : "L"}${at.x.toFixed(2)} ${at.y.toFixed(2)}`;
    })
    .join(" ");
}

export function boundsOf(points: readonly GeoPoint[]): GeoBounds | undefined {
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

/** The four corners of a rectangle, as a ring — for drawing an image's extent. */
export function cornersOf(bounds: GeoBounds): GeoPoint[] {
  return [
    { lat: bounds.north, lng: bounds.west },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.south, lng: bounds.west },
  ];
}

/**
 * Where to open so everything drawn is on screen at once.
 *
 * Padding is in pixels and is subtracted from both dimensions before the zoom
 * is worked out, so a shape that reaches the edge of its extent still has room
 * for the handles drawn on its corners.
 *
 * A single point has no extent and cannot be fitted to anything — asking for a
 * zoom that makes a zero-width thing fill a panel is a division by zero, and
 * the honest answer is the default farm zoom centred on it.
 */
export function fitViewport(
  bounds: GeoBounds,
  size: { readonly width: number; readonly height: number },
  padding = 24,
): Viewport {
  const northWest = toWorld({ lat: bounds.north, lng: bounds.west });
  const southEast = toWorld({ lat: bounds.south, lng: bounds.east });

  const spanX = Math.abs(southEast.x - northWest.x);
  const spanY = Math.abs(southEast.y - northWest.y);

  const usableWidth = Math.max(1, size.width - padding * 2);
  const usableHeight = Math.max(1, size.height - padding * 2);

  const centre = fromWorld({
    x: (northWest.x + southEast.x) / 2,
    y: (northWest.y + southEast.y) / 2,
  });

  if (spanX === 0 && spanY === 0) {
    return { centre, zoom: DEFAULT_ZOOM, width: size.width, height: size.height };
  }

  const zoomX = spanX === 0 ? MAX_ZOOM : Math.log2(usableWidth / (spanX * TILE_SIZE));
  const zoomY = spanY === 0 ? MAX_ZOOM : Math.log2(usableHeight / (spanY * TILE_SIZE));

  return {
    centre,
    zoom: clampZoom(Math.min(zoomX, zoomY)),
    width: size.width,
    height: size.height,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Drag the world under the panel. Positive `dx` moves the map right. */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  const scale = worldSize(view.zoom);
  const centre = toWorld(view.centre);

  return {
    ...view,
    centre: fromWorld({ x: centre.x - dx / scale, y: centre.y - dy / scale }),
  };
}

/**
 * Zoom, keeping one point of the panel over the same ground.
 *
 * Without the anchor, zooming with the wheel walks the map away from whatever
 * the pointer was over, which on a farm at zoom 18 means losing the pen you
 * were looking at in two clicks.
 */
export function zoomTo(view: Viewport, zoom: number, anchor?: ScreenPoint): Viewport {
  const next = clampZoom(zoom);
  if (anchor === undefined) return { ...view, zoom: next };

  const under = unproject(anchor, view);
  const moved: Viewport = { ...view, zoom: next };
  const after = project(under, moved);

  return panBy(moved, anchor.x - after.x, anchor.y - after.y);
}

/**
 * The middle of a ring, area-weighted — where a label or a cluster of chips
 * belongs.
 *
 * The mean of the vertices is not good enough: a pasture traced with six
 * clicks along one fence and one at the far corner has its mean sitting on the
 * crowded side, and the chips would pile up over the fence line rather than
 * over the ground. A degenerate ring — three points in a row, or two the same
 * — has no area to weight by, so the mean is the fallback rather than a
 * division by zero.
 */
export function centroid(points: readonly GeoPoint[]): GeoPoint | undefined {
  if (points.length === 0) return undefined;
  if (points.length < 3) {
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
  }

  let twiceArea = 0;
  let lat = 0;
  let lng = 0;

  for (let index = 0; index < points.length; index += 1) {
    const here = points[index] as GeoPoint;
    const next = points[(index + 1) % points.length] as GeoPoint;
    const cross = here.lng * next.lat - next.lng * here.lat;

    twiceArea += cross;
    lng += (here.lng + next.lng) * cross;
    lat += (here.lat + next.lat) * cross;
  }

  if (twiceArea === 0) {
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
  }

  return { lat: lat / (3 * twiceArea), lng: lng / (3 * twiceArea) };
}

/**
 * Is this coordinate inside this ring?
 *
 * Ray casting, in degrees rather than projected pixels. At farm scale the two
 * disagree by less than the width of the line drawn for the fence, and doing
 * it in degrees means the answer does not change with the zoom — a chip
 * dropped on a pen must land in that pen whether the panel was showing the
 * whole place or one corner of it.
 */
export function containsPoint(ring: readonly GeoPoint[], point: GeoPoint): boolean {
  if (ring.length < 3) return false;

  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const here = ring[index] as GeoPoint;
    const there = ring[previous] as GeoPoint;

    const straddles = here.lat > point.lat !== there.lat > point.lat;
    if (!straddles) continue;

    const crossing =
      ((there.lng - here.lng) * (point.lat - here.lat)) / (there.lat - here.lat) + here.lng;
    if (point.lng < crossing) inside = !inside;
  }

  return inside;
}

/** Metres of ground per degree of latitude. Constant enough at any farm's size. */
export const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Metres per degree of longitude, which shrinks towards the poles. */
export function metresPerDegreeLongitude(latitude: number): number {
  return METRES_PER_DEGREE_LATITUDE * Math.cos((clampLatitude(latitude) * Math.PI) / 180);
}

/**
 * A grid to snap to, in metres of ground.
 *
 * Metres rather than pixels because the grid is a property of the place, not
 * of the zoom: a garden bed laid out on a half-metre grid is on that grid
 * whether it is being looked at closely or from across the property. Pixels
 * would mean the same bed snapped to different ground at different zooms,
 * which is the bug that makes a snapping editor untrustworthy.
 *
 * The anchor is required, not defaulted. A grid with no origin is a grid whose
 * lines move when the view does, and "the corner everything lines up with" is
 * a decision the caller has already made — the property's coordinates, or the
 * first corner of the first bed.
 */
export interface SpatialGrid {
  readonly metres: number;
  readonly anchor: GeoPoint;
}

/**
 * The nearest grid intersection to a point.
 *
 * Worked in ground metres from the anchor and converted back, rather than in
 * projected pixels: Mercator stretches by 1/cos(latitude), so a grid snapped
 * in projected units would be 18% coarser north-to-south than east-to-west at
 * this farm's latitude, and the beds would come out oblong.
 */
export function snapToGrid(point: GeoPoint, grid: SpatialGrid): GeoPoint {
  if (grid.metres <= 0) return point;

  const perLng = metresPerDegreeLongitude(grid.anchor.lat);
  if (perLng === 0) return point;

  const eastMetres = (point.lng - grid.anchor.lng) * perLng;
  const northMetres = (point.lat - grid.anchor.lat) * METRES_PER_DEGREE_LATITUDE;

  const east = Math.round(eastMetres / grid.metres) * grid.metres;
  const north = Math.round(northMetres / grid.metres) * grid.metres;

  return {
    lat: grid.anchor.lat + north / METRES_PER_DEGREE_LATITUDE,
    lng: grid.anchor.lng + east / perLng,
  };
}

/**
 * Where the grid lines fall in the panel.
 *
 * Constant longitude is a vertical line in Mercator and constant latitude a
 * horizontal one, so this is two lists of numbers rather than a list of paths.
 *
 * Capped, because a grid drawn at half a metre while the panel is showing a
 * county is tens of thousands of lines that render as a solid block and lock
 * the tab up drawing it. Past the cap it returns nothing: a grid too fine to
 * see is better absent than smeared.
 */
export function gridLines(
  view: Viewport,
  grid: SpatialGrid,
  limit = 200,
): { readonly vertical: number[]; readonly horizontal: number[] } {
  const none = { vertical: [], horizontal: [] };
  if (grid.metres <= 0) return none;

  const perLng = metresPerDegreeLongitude(grid.anchor.lat);
  if (perLng === 0) return none;

  const northWest = unproject({ x: 0, y: 0 }, view);
  const southEast = unproject({ x: view.width, y: view.height }, view);

  const lngStep = grid.metres / perLng;
  const latStep = grid.metres / METRES_PER_DEGREE_LATITUDE;

  const first = (value: number, origin: number, step: number) =>
    Math.ceil((value - origin) / step) * step + origin;

  const columns = Math.floor((southEast.lng - northWest.lng) / lngStep) + 1;
  const rows = Math.floor((northWest.lat - southEast.lat) / latStep) + 1;
  if (columns > limit || rows > limit) return none;

  const vertical: number[] = [];
  for (
    let lng = first(northWest.lng, grid.anchor.lng, lngStep);
    lng <= southEast.lng;
    lng += lngStep
  ) {
    vertical.push(project({ lat: view.centre.lat, lng }, view).x);
  }

  const horizontal: number[] = [];
  for (
    let lat = first(southEast.lat, grid.anchor.lat, latStep);
    lat <= northWest.lat;
    lat += latStep
  ) {
    horizontal.push(project({ lat, lng: view.centre.lng }, view).y);
  }

  return { vertical, horizontal };
}

/**
 * Where the panel is looking, without its size.
 *
 * The size belongs to the panel and is measured, not chosen, so a caller that
 * wants to control the view — to open on the pens, or to follow a search
 * result — supplies these two and the editor supplies the rest. Handing a
 * caller a width to keep in sync with a `<div>` it does not measure is how the
 * shapes end up half a panel away from the ground under them.
 */
export interface SpatialView {
  readonly centre: GeoPoint;
  readonly zoom: number;
}
