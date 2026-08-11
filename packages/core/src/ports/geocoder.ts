/**
 * Turning an address into a place (spec §5.1, §6, §8).
 *
 * A latitude is not something anybody knows about their own farm. It is
 * something a computer works out from the address they already typed, and
 * every screen that needs a coordinate — the forecast, the calving watch, the
 * property map — should be reading a derived value rather than a field
 * somebody was asked to fill in. §2: derive, don't duplicate.
 *
 * Behind a port for the same reason the weather is: the US Census geocoder is
 * free, keyless and excellent on American street addresses, and it is also a
 * government service that goes down. Swapping it for Nominatim or for Google
 * has to be a swap of one file rather than a change to anything that calls it.
 */

export interface GeocodeRequest {
  /** As typed. "1220 County Road 4651, Rhome TX 76078". */
  readonly address: string;
}

export interface GeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  /**
   * The address as the geocoder understands it.
   *
   * Shown back before anything is saved, because a rural route matched to the
   * wrong side of a county line is a wrong forecast that looks entirely
   * plausible, and the normalised string is the only thing that gives it away.
   */
  readonly matchedAddress: string;
  readonly postalCode?: string | undefined;
  readonly county?: string | undefined;
  readonly state?: string | undefined;
  /**
   * How sure the geocoder is, `exact` down to `approximate`.
   *
   * A rooftop match and a match to the middle of a ZIP code are both
   * "success", and treating them the same is how a farm ends up with the
   * forecast for a town nine miles away.
   */
  readonly precision: "exact" | "interpolated" | "approximate";
}

export interface Geocoder {
  readonly name: string;
  /** Undefined when nothing matched. Throws only when the service is down. */
  geocode(request: GeocodeRequest): Promise<GeocodeResult | undefined>;
}
