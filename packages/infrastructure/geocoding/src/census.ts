import type { GeocodeRequest, GeocodeResult, Geocoder } from "@galaxy-farm/core";

/**
 * The US Census geocoder (spec §5.1, primary).
 *
 * Free, keyless, and the best available on American rural addresses — it is
 * built on the TIGER road network, which is the dataset that actually knows
 * what "County Road 4651" is. Commercial geocoders are trained on deliverable
 * mail addresses and are noticeably worse the further you get from a town.
 *
 * No API key means no licensing seam of the kind Open-Meteo has, which is why
 * this is primary rather than Google. It is a government service, so it does
 * go down; `firstMatch` in the index falls through to Nominatim when it does.
 */

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

export interface CensusOptions {
  /** Injected so tests do not reach the network and the proxy is honoured. */
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
}

interface CensusResponse {
  result?: {
    addressMatches?: {
      matchedAddress?: string;
      /** **x is longitude, y is latitude.** See the note in `toResult`. */
      coordinates?: { x?: number; y?: number };
      addressComponents?: { zip?: string; state?: string };
      tigerLine?: { tigerLineId?: string; side?: string };
      geographies?: { Counties?: { NAME?: string }[] };
    }[];
  };
}

export function censusUrl(request: GeocodeRequest, endpoint = ENDPOINT): string {
  const url = new URL(endpoint);
  url.searchParams.set("address", request.address);
  // "Current" on both, so the answer moves with the annual TIGER release
  // rather than being pinned to whatever was newest when this was written.
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  return url.toString();
}

function toResult(match: NonNullable<CensusResponse["result"]>["addressMatches"]) {
  const first = match?.[0];
  if (first === undefined) return undefined;

  // **x is longitude and y is latitude**, which is the opposite order to how
  // every other API here reports a coordinate and to how anybody says it out
  // loud. Getting it backwards puts this farm in the Indian Ocean, and the
  // symptom is a forecast that is merely wrong rather than an error.
  const longitude = first.coordinates?.x;
  const latitude = first.coordinates?.y;
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;

  const result: GeocodeResult = {
    latitude,
    longitude,
    matchedAddress: first.matchedAddress ?? "",
    ...(first.addressComponents?.zip === undefined
      ? {}
      : { postalCode: first.addressComponents.zip }),
    ...(first.addressComponents?.state === undefined
      ? {}
      : { state: first.addressComponents.state }),
    ...(first.geographies?.Counties?.[0]?.NAME === undefined
      ? {}
      : { county: first.geographies.Counties[0].NAME }),
    // A TIGER match is a position interpolated along a road segment, not a
    // rooftop. Saying so matters: a long rural segment can put the pin a few
    // hundred yards off, which is fine for a forecast and not fine for a pen
    // boundary on the map.
    precision: first.tigerLine === undefined ? "approximate" : "interpolated",
  };

  return result;
}

export function censusGeocoder(options: CensusOptions = {}): Geocoder {
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    name: "us-census",

    async geocode(request) {
      if (request.address.trim() === "") return undefined;

      const response = await doFetch(censusUrl(request, options.endpoint));
      if (!response.ok) {
        throw new Error(`Census geocoder returned ${response.status}`);
      }

      const body = (await response.json()) as CensusResponse;
      // An empty match list is a successful "no such address", not a failure.
      // Throwing here would make a typo look like an outage.
      return toResult(body.result?.addressMatches);
    },
  };
}
