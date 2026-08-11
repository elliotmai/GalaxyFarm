import type { DailyWeather, Forecast, WeatherAlert, WeatherProvider } from "@galaxy-farm/core";

/**
 * The National Weather Service (spec §6, alerts).
 *
 * Official, free, and public domain — no licensing seam at all, which is why
 * §6 keeps it as the commercial fallback. What it is here for day to day is
 * watches and warnings: a Hard Freeze Warning issued by the office in Fort
 * Worth carries weight that a threshold crossing computed from a forecast does
 * not.
 *
 * Its forecast is a twelve-hour period series rather than an hourly one and it
 * publishes no pressure, so the calving watch reads Open-Meteo and this
 * supplies the warnings alongside.
 */

const ENDPOINT = "https://api.weather.gov";

/**
 * NWS asks for a User-Agent identifying the caller, and will refuse without
 * one. Overridable so a deployment can put a real contact address in it.
 */
export const DEFAULT_USER_AGENT = "(galaxy-farm, weather@galaxyfarm.invalid)";

export interface NwsOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  readonly userAgent?: string;
}

interface NwsPointResponse {
  properties?: { forecast?: string; forecastHourly?: string; forecastZone?: string };
}

interface NwsPeriod {
  startTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null };
}

interface NwsForecastResponse {
  properties?: { periods?: NwsPeriod[] };
}

interface NwsAlertsResponse {
  features?: Array<{
    id?: string;
    properties?: {
      event?: string;
      headline?: string;
      severity?: string;
      onset?: string;
      effective?: string;
      ends?: string;
      expires?: string;
      description?: string;
    };
  }>;
}

const SEVERITIES = ["extreme", "severe", "moderate", "minor"] as const;

function severityOf(raw: string | undefined): WeatherAlert["severity"] {
  const lowered = raw?.toLowerCase();
  return SEVERITIES.find((severity) => severity === lowered) ?? "unknown";
}

/**
 * Fold NWS's day/night periods into daily lows and highs.
 *
 * A period is a high if it is daytime and a low if it is not. Days with only
 * one of the pair are dropped rather than being given a fabricated partner — a
 * made-up low in front of somebody deciding whether to break ice is worse than
 * a blank row.
 *
 * Bucketed by the *local* calendar date NWS wrote, taken from the timestamp
 * string rather than from the parsed instant. A 6pm period in US Central is
 * already the next day in UTC, so keying on the UTC date puts tonight's low
 * and today's high in different buckets and drops both for want of a partner.
 */
export function periodsToDaily(periods: readonly NwsPeriod[]): DailyWeather[] {
  const byDay = new Map<
    string,
    { date: Date; low?: number; high?: number; precipitation?: number }
  >();

  for (const period of periods) {
    if (period.startTime === undefined || period.temperature === undefined) continue;
    const key = period.startTime.slice(0, 10);
    // Midnight UTC of that local date, which is also how Open-Meteo's bare
    // `"2026-11-20"` parses — one shape of daily date across both adapters.
    const entry = byDay.get(key) ?? { date: new Date(`${key}T00:00:00Z`) };

    if (period.isDaytime === true) entry.high = period.temperature;
    else entry.low = period.temperature;

    const chance = period.probabilityOfPrecipitation?.value;
    if (chance !== null && chance !== undefined) {
      entry.precipitation = Math.max(entry.precipitation ?? 0, chance);
    }
    byDay.set(key, entry);
  }

  return [...byDay.values()]
    .filter(
      (entry): entry is { date: Date; low: number; high: number; precipitation?: number } =>
        entry.low !== undefined && entry.high !== undefined,
    )
    .map((entry) => ({
      date: entry.date,
      lowF: entry.low,
      highF: entry.high,
      ...(entry.precipitation === undefined ? {} : { precipitationChance: entry.precipitation }),
    }))
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

export function parseNwsAlerts(body: unknown): WeatherAlert[] {
  const response = body as NwsAlertsResponse;

  return (response.features ?? []).flatMap((feature) => {
    const properties = feature.properties;
    const start = properties?.onset ?? properties?.effective;
    if (properties?.event === undefined || start === undefined) return [];

    const end = properties.ends ?? properties.expires;
    return [
      {
        id: feature.id ?? `${properties.event}:${start}`,
        event: properties.event,
        headline: properties.headline,
        severity: severityOf(properties.severity),
        from: new Date(start),
        ...(end === undefined ? {} : { to: new Date(end) }),
        description: properties.description,
      },
    ];
  });
}

export function nwsProvider(options: NwsOptions = {}): WeatherProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ENDPOINT;
  const headers = {
    "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
    Accept: "application/geo+json",
  };

  const get = async (url: string): Promise<unknown> => {
    const response = await doFetch(url, { headers });
    if (!response.ok) {
      throw new Error(`NWS returned ${response.status} ${response.statusText} for ${url}`);
    }
    return response.json();
  };

  return {
    name: "nws",

    async forecast(request) {
      // NWS is grid-based: a lat/lng resolves to a grid point first, and the
      // forecast URL comes back in that response rather than being constructed.
      const point = (await get(
        `${endpoint}/points/${request.latitude},${request.longitude}`,
      )) as NwsPointResponse;

      const forecastUrl = point.properties?.forecast;
      if (forecastUrl === undefined) {
        throw new Error("NWS gave no forecast URL for that point — is it outside the US?");
      }

      const body = (await get(forecastUrl)) as NwsForecastResponse;
      const daily = periodsToDaily(body.properties?.periods ?? []);

      return {
        latitude: request.latitude,
        longitude: request.longitude,
        retrievedAt: new Date(),
        // No hourly pressure series is published, and inventing an empty one is
        // honest: the calving watch will find no pressure signal here.
        hourly: [],
        daily: request.days === undefined ? daily : daily.slice(0, request.days),
      } satisfies Forecast;
    },

    async alerts(request) {
      const body = await get(
        `${endpoint}/alerts/active?point=${request.latitude},${request.longitude}`,
      );
      return parseNwsAlerts(body);
    },
  };
}
