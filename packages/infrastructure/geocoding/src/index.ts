import type { GeocodeRequest, GeocodeResult, Geocoder } from "@galaxy-farm/core";

/**
 * Geocoding adapters (spec §5.1).
 *
 * A latitude is not something anybody knows about their own farm. It is
 * something worked out from the address they already typed, and every screen
 * that needs a coordinate — the forecast, the calving watch, the property map
 * — reads a derived value rather than a field somebody was asked to fill in.
 */

export * from "./census.js";
export * from "./nominatim.js";
export * from "./hardiness.js";

/**
 * Ask each in turn until one answers.
 *
 * A miss falls through as well as an error does, and that is deliberate: the
 * Census geocoder is US-only and built on TIGER, so an address it has never
 * heard of — a new subdivision, anything outside the country — is one OSM may
 * well know. What keeps that from being sloppy is that each adapter reports
 * its own `precision` honestly, and the screen shows it: a fall-through match
 * to the middle of a town arrives labelled as one.
 *
 * The distinction that survives to the caller is a different one. If every
 * service *errored*, they get the error rather than a silent "not found",
 * because "we could not reach the geocoder" and "that address is not real"
 * call for completely different things from the person at the screen.
 */
export function firstMatch(...geocoders: readonly Geocoder[]): Geocoder {
  return {
    name: geocoders.map((geocoder) => geocoder.name).join("+"),

    async geocode(request: GeocodeRequest): Promise<GeocodeResult | undefined> {
      let lastError: unknown;
      let reached = false;

      for (const geocoder of geocoders) {
        try {
          const result = await geocoder.geocode(request);
          reached = true;
          if (result !== undefined) return result;
        } catch (error) {
          lastError = error;
        }
      }

      if (!reached && lastError !== undefined) throw lastError;
      return undefined;
    },
  };
}
