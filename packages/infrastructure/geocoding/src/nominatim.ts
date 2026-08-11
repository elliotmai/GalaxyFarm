import type { GeocodeRequest, Geocoder } from "@galaxy-farm/core";

/**
 * Nominatim / OpenStreetMap (spec §5.1, fallback).
 *
 * Here because the Census geocoder is US-only and is a government service that
 * goes down. Second rather than first because OSM's coverage of rural Texas
 * road addressing is thinner than TIGER's — it will often match the road but
 * not the number.
 *
 * Nominatim's usage policy requires an identifying User-Agent and permits at
 * most one request a second. Both are honoured here: the header is set below,
 * and this is only ever reached when somebody presses a button in Settings,
 * which is a handful of requests a year rather than a poll.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export interface NominatimOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  /** Overridable so a fork identifies as itself rather than as this farm. */
  readonly userAgent?: string;
}

export const DEFAULT_USER_AGENT = "GalaxyFarm/0.1 (farm management; contact via repository)";

interface NominatimMatch {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  address?: {
    house_number?: string;
    postcode?: string;
    county?: string;
    state?: string;
  };
}

export function nominatimUrl(request: GeocodeRequest, endpoint = ENDPOINT): string {
  const url = new URL(endpoint);
  url.searchParams.set("q", request.address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  return url.toString();
}

export function nominatimGeocoder(options: NominatimOptions = {}): Geocoder {
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    name: "nominatim",

    async geocode(request) {
      if (request.address.trim() === "") return undefined;

      const response = await doFetch(nominatimUrl(request, options.endpoint), {
        headers: { "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`Nominatim returned ${response.status}`);
      }

      const body = (await response.json()) as NominatimMatch[];
      const first = body[0];
      if (first === undefined) return undefined;

      // Nominatim reports coordinates as strings, and an unparseable one has
      // to be a miss rather than a NaN that flows all the way to a forecast
      // request and comes back as somewhere off the coast of Africa.
      const latitude = Number(first.lat);
      const longitude = Number(first.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

      return {
        latitude,
        longitude,
        matchedAddress: first.display_name ?? "",
        ...(first.address?.postcode === undefined ? {} : { postalCode: first.address.postcode }),
        ...(first.address?.county === undefined ? {} : { county: first.address.county }),
        ...(first.address?.state === undefined ? {} : { state: first.address.state }),
        // A house number means it found the building. Without one it has
        // matched the road, the hamlet, or the county — useful, and not the
        // same thing.
        precision: first.address?.house_number === undefined ? "approximate" : "exact",
      };
    },
  };
}
