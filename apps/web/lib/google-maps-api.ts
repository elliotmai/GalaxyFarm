import type { LatLngLiteral, MapBounds } from "./map-geometry";

/**
 * The slice of the Maps JavaScript API this app touches (spec §8).
 *
 * Declared here rather than taken from `@types/google.maps`, for the same
 * reason the Neo4j adapter is `fetch` and not a driver: the whole surface used
 * is a map, two shapes and a bounds object, and a package of ten thousand
 * lines of ambient declarations to describe five of them is a dependency that
 * earns nothing. Narrowing it also documents what a barn kiosk's offline
 * renderer would have to provide to stand in for Google — which is the point of
 * §8's two-backgrounds design.
 *
 * Everything here is what Google actually ships; nothing is invented. If a call
 * is added, its type goes here first.
 */

export interface MapsEvent {
  readonly latLng?: { lat(): number; lng(): number } | null;
}

export interface MapsPath {
  getLength(): number;
  getAt(index: number): { lat(): number; lng(): number };
}

export interface MapsPolygon {
  setMap(map: MapsMap | null): void;
  getPath(): MapsPath;
  addListener(event: string, handler: () => void): void;
}

export interface MapsPolyline {
  setMap(map: MapsMap | null): void;
}

export interface MapsMap {
  setCenter(centre: LatLngLiteral): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: MapBounds, padding?: number): void;
  addListener(event: string, handler: (event: MapsEvent) => void): void;
}

export interface PolygonOptions {
  readonly paths?: readonly LatLngLiteral[];
  readonly map?: MapsMap;
  readonly strokeColor?: string;
  readonly strokeOpacity?: number;
  readonly strokeWeight?: number;
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly editable?: boolean;
  readonly clickable?: boolean;
  readonly zIndex?: number;
}

export interface PolylineOptions {
  readonly path?: readonly LatLngLiteral[];
  readonly map?: MapsMap;
  readonly strokeColor?: string;
  readonly strokeOpacity?: number;
  readonly strokeWeight?: number;
  readonly icons?: readonly unknown[];
  readonly zIndex?: number;
}

export interface MapOptions {
  readonly center: LatLngLiteral;
  readonly zoom: number;
  readonly mapTypeId: string;
  readonly tilt?: number;
  readonly disableDefaultUI?: boolean;
  readonly zoomControl?: boolean;
  readonly mapTypeControl?: boolean;
  readonly fullscreenControl?: boolean;
  readonly streetViewControl?: boolean;
  readonly rotateControl?: boolean;
  readonly gestureHandling?: string;
}

export interface MapsNamespace {
  Map: new (host: HTMLElement, options: MapOptions) => MapsMap;
  Polygon: new (options: PolygonOptions) => MapsPolygon;
  Polyline: new (options: PolylineOptions) => MapsPolyline;
  SymbolPath: { CIRCLE: unknown };
}

/**
 * The namespace, once the script has run.
 *
 * The one cast in the whole feature. Everything past this point is typed, so a
 * misspelled option is a compile error rather than a silently ignored key —
 * which is how Google's API fails, since it reads the options it recognises
 * and says nothing about the rest.
 */
export function mapsNamespace(): MapsNamespace | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { google?: { maps?: MapsNamespace } }).google?.maps;
}

/**
 * A dashed line, in the only way the API draws one.
 *
 * Polylines have no dash option; a dash is a repeated symbol along the path.
 * Written once here so the fence-down convention cannot drift between the two
 * places that draw it.
 */
export function dashPattern(): readonly unknown[] {
  return [
    {
      icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
      offset: "0",
      repeat: "12px",
    },
  ];
}
