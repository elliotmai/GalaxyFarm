/**
 * The weather port (spec §6).
 *
 * Two adapters sit behind it: Open-Meteo for forecasts, including the surface
 * pressure the calving watch reads, and the National Weather Service for
 * official watches and warnings. The port exists so neither is reachable from
 * the domain, and so the §6 licensing seam is a swap rather than a rewrite —
 * Open-Meteo's free tier is non-commercial, and the boarding business will
 * need either their commercial plan or a full move to NWS.
 *
 * Fahrenheit and hectopascals, stated in the field names. A unit that lives
 * only in a comment is a unit that gets converted twice.
 */

export interface HourlyWeather {
  readonly at: Date;
  readonly temperatureF: number;
  /** Surface pressure. The calving watch is looking for a fall in this. */
  readonly pressureHpa?: number | undefined;
  readonly windMph?: number | undefined;
  readonly precipitationChance?: number | undefined;
}

export interface DailyWeather {
  readonly date: Date;
  readonly lowF: number;
  readonly highF: number;
  readonly precipitationChance?: number | undefined;
}

export interface WeatherAlert {
  readonly id: string;
  /** "Hard Freeze Warning", "Winter Storm Watch" — the issuer's own wording. */
  readonly event: string;
  readonly headline?: string | undefined;
  readonly severity: "extreme" | "severe" | "moderate" | "minor" | "unknown";
  readonly from: Date;
  readonly to?: Date | undefined;
  readonly description?: string | undefined;
}

export interface Forecast {
  readonly latitude: number;
  readonly longitude: number;
  /** When this was fetched, so a cached forecast can say how stale it is. */
  readonly retrievedAt: Date;
  readonly hourly: readonly HourlyWeather[];
  readonly daily: readonly DailyWeather[];
}

export interface ForecastRequest {
  readonly latitude: number;
  readonly longitude: number;
  /** Days ahead. Both providers cap this; the adapter clamps rather than fails. */
  readonly days?: number;
  /** IANA zone, so "the overnight low" means the farm's night, not UTC's. */
  readonly timezone?: string;
}

export interface WeatherProvider {
  readonly name: string;
  forecast(request: ForecastRequest): Promise<Forecast>;
  /** Official watches and warnings. Not every provider has them. */
  alerts?(request: ForecastRequest): Promise<WeatherAlert[]>;
}
