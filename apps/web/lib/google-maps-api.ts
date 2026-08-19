/**
 * The slice of the Maps JavaScript API this app touches (spec §8).
 *
 * Declared here rather than taken from `@types/google.maps`: the whole surface
 * used is a map and two setters, and a package of ten thousand lines of
 * ambient declarations to describe them is a dependency that earns nothing.
 * Narrowing it also documents what an offline renderer would have to provide
 * to stand in for Google — which is the point of §8's two-background design.
 *
 * It used to be larger. Polygons, polylines, click listeners and a dash
 * pattern all lived here while the map screen drew the pens itself through
 * Google. The spatial editor draws them now, in SVG over lat/lng, so Google's
 * only remaining job on this screen is to put photographs of the ground behind
 * it — and the type shrank to say exactly that.
 *
 * Everything here is what Google actually ships; nothing is invented. If a
 * call is added, its type goes here first.
 */

/** A coordinate in the shape Google takes. */
export interface LatLngLiteral {
  readonly lat: number;
  readonly lng: number;
}

export interface MapsMap {
  setCenter(centre: LatLngLiteral): void;
  setZoom(zoom: number): void;
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
  readonly keyboardShortcuts?: boolean;
  readonly clickableIcons?: boolean;
}

export interface MapsNamespace {
  Map: new (host: HTMLElement, options: MapOptions) => MapsMap;
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
