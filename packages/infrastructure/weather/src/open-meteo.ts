import type {
  DailyWeather,
  Forecast,
  ForecastRequest,
  HourlyWeather,
  WeatherProvider,
} from "@galaxy-farm/core";

/**
 * Open-Meteo (spec §6, primary).
 *
 * Free, no API key, and — the reason it is primary rather than NWS — it
 * publishes hourly **surface pressure**, which is the signal the calving watch
 * reads. NWS gives official warnings but not a pressure series you can trend.
 *
 * Licensing seam, stated in §6 and worth repeating where somebody will see it:
 * the free tier is non-commercial. When the boarding business launches, this
 * needs either their paid plan or a move to NWS. Both sit behind the port, so
 * that is a swap of this file.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Both providers cap the horizon; clamping beats a 400 nobody expected. */
export const MAX_FORECAST_DAYS = 16;

export interface OpenMeteoOptions {
  /** Injected so tests do not reach the network and so the proxy is honoured. */
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
}

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    surface_pressure?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    precipitation_probability?: (number | null)[];
  };
  daily?: {
    time?: string[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

export function openMeteoUrl(request: ForecastRequest, endpoint = ENDPOINT): string {
  const url = new URL(endpoint);
  url.searchParams.set("latitude", String(request.latitude));
  url.searchParams.set("longitude", String(request.longitude));
  url.searchParams.set(
    "hourly",
    "temperature_2m,surface_pressure,wind_speed_10m,precipitation_probability",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_min,temperature_2m_max,precipitation_probability_max",
  );
  // Fahrenheit and mph at the source rather than converted here: a unit
  // conversion in two places is a unit conversion that disagrees with itself.
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("timezone", request.timezone ?? "auto");
  url.searchParams.set(
    "forecast_days",
    String(Math.min(Math.max(request.days ?? 7, 1), MAX_FORECAST_DAYS)),
  );
  return url.toString();
}

/**
 * Parse the response.
 *
 * Exported and pure so the shape can be tested without a network, and so a
 * cached response from the service worker goes through exactly the same code
 * as a live one.
 *
 * Missing readings become absent rather than zero. Open-Meteo returns null for
 * a variable it has no value for, and a pressure of 0 hPa would read as the
 * steepest fall ever recorded.
 */
export function parseOpenMeteo(
  body: unknown,
  request: ForecastRequest,
  retrievedAt: Date,
): Forecast {
  const response = body as OpenMeteoResponse;

  const hourly: HourlyWeather[] = (response.hourly?.time ?? []).flatMap((time, index) => {
    const temperature = response.hourly?.temperature_2m?.[index];
    if (temperature === null || temperature === undefined) return [];
    const pressure = response.hourly?.surface_pressure?.[index];
    const wind = response.hourly?.wind_speed_10m?.[index];
    const precipitation = response.hourly?.precipitation_probability?.[index];

    return [
      {
        at: new Date(time),
        temperatureF: temperature,
        ...(pressure === null || pressure === undefined ? {} : { pressureHpa: pressure }),
        ...(wind === null || wind === undefined ? {} : { windMph: wind }),
        ...(precipitation === null || precipitation === undefined
          ? {}
          : { precipitationChance: precipitation }),
      },
    ];
  });

  const daily: DailyWeather[] = (response.daily?.time ?? []).flatMap((time, index) => {
    const low = response.daily?.temperature_2m_min?.[index];
    const high = response.daily?.temperature_2m_max?.[index];
    if (low === null || low === undefined || high === null || high === undefined) return [];
    const precipitation = response.daily?.precipitation_probability_max?.[index];

    return [
      {
        date: new Date(time),
        lowF: low,
        highF: high,
        ...(precipitation === null || precipitation === undefined
          ? {}
          : { precipitationChance: precipitation }),
      },
    ];
  });

  return {
    latitude: request.latitude,
    longitude: request.longitude,
    retrievedAt,
    hourly,
    daily,
  };
}

export function openMeteoProvider(options: OpenMeteoOptions = {}): WeatherProvider {
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    name: "open-meteo",
    async forecast(request) {
      const response = await doFetch(openMeteoUrl(request, options.endpoint));
      if (!response.ok) {
        throw new Error(`Open-Meteo returned ${response.status} ${response.statusText}`);
      }
      return parseOpenMeteo(await response.json(), request, new Date());
    },
  };
}
