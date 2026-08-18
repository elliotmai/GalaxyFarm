import type { SpatialImagery } from "./types.js";
import { project, type Viewport } from "./geometry.js";

/**
 * An owned aerial photograph, placed on the ground it covers (spec §8).
 *
 * This is the half of the hybrid imagery design that is ours. Google's tiles
 * are never stored — their terms do not permit it, and that single sentence is
 * the entire reason this component exists — so the background that ships to a
 * barn kiosk with no signal is a USDA NAIP snapshot of the property: public
 * domain, roughly half-metre resolution, downloaded once, kept in R2 and
 * cached by the service worker. The pens drawn over it are the same lat/lng
 * rings drawn over Google online, which is what makes the two interchangeable
 * rather than two implementations of a map.
 *
 * ## Reproject before storing it
 *
 * The placement below is a rectangle: the image's north-west and south-east
 * corners are projected and the pixels are stretched linearly between them.
 * That is exact only if the image is itself in Web Mercator (EPSG:3857), which
 * is what the shapes and Google's tiles are in. NAIP ships in UTM, so whoever
 * sources the image reprojects it once on the way in — a `gdalwarp -t_srs
 * EPSG:3857` — and stores its bounds alongside it.
 *
 * Left in its native projection the error is a smooth stretch rather than a
 * wild one, and at a farm's size it stays under a pixel; it is still worth
 * doing properly once rather than explaining every time a fence looks a foot
 * off.
 */
export function GeoImage({
  imagery,
  view,
  opacity = 1,
}: {
  readonly imagery: SpatialImagery;
  readonly view: Viewport;
  readonly opacity?: number;
}) {
  const northWest = project({ lat: imagery.bounds.north, lng: imagery.bounds.west }, view);
  const southEast = project({ lat: imagery.bounds.south, lng: imagery.bounds.east }, view);

  const width = southEast.x - northWest.x;
  const height = southEast.y - northWest.y;

  // A zero-extent image is a georeference somebody typed wrongly. Drawing it
  // would be an invisible element the browser still decodes the file for.
  if (width <= 0 || height <= 0) return null;

  return (
    <image
      href={imagery.url}
      x={northWest.x}
      y={northWest.y}
      width={width}
      height={height}
      opacity={opacity}
      // The bounds say where the pixels go. Letting SVG letterbox them inside
      // that box would move the ground away from the coordinates that placed
      // it, which is the one thing this component exists to get right.
      preserveAspectRatio="none"
    />
  );
}
