import { eq } from "drizzle-orm";

import {
  hasCoordinates,
  resolveWatchSettings,
  type Forecast,
  type Property,
  type Ulid,
  type WatchSettings,
  type WeatherAlert,
} from "@galaxy-farm/core";
import { allTables } from "@galaxy-farm/infra-db";
import { combinedWeather, nwsProvider, openMeteoProvider } from "@galaxy-farm/infra-weather";

import { database } from "@/lib/credential-store";

/**
 * The forecast, server-side (spec §6).
 *
 * On the server rather than in the browser for three reasons, in order of how
 * much they matter: the adapters need the property's coordinates and the
 * property lives in the database; a per-device fetch would hit Open-Meteo once
 * per phone rather than once per farm, which is a real consideration on a free
 * non-commercial tier; and the outbound proxy is configured here.
 *
 * The cache is deliberately crude — one entry, fifteen minutes. A forecast
 * that is a quarter of an hour old is the same forecast, and the alternative
 * is a request to a third party every time somebody opens the dashboard.
 */

const CACHE_MS = 15 * 60 * 1000;

interface CacheEntry {
  readonly at: number;
  readonly value: WeatherSnapshot;
}

export interface WeatherSnapshot {
  readonly forecast?: Forecast;
  readonly alerts: readonly WeatherAlert[];
  readonly settings: WatchSettings;
  /** Why there is no forecast, when there is none. Shown to the person. */
  readonly unavailable?: string;
  readonly retrievedAt?: Date;
}

const cache = new Map<string, CacheEntry>();

/** Tests and a settings change both want the next read to be fresh. */
export function clearWeatherCache(): void {
  // An in-process Map of forecasts. Nothing here is persisted and none of it
  // is anybody's record; the worst case of clearing it is one extra request.
  // crud-guard: allow-unconfirmed — in-memory forecast cache, nothing persisted
  cache.clear();
}

function provider() {
  return combinedWeather(openMeteoProvider(), nwsProvider());
}

export async function propertyFor(propertyId: Ulid): Promise<Property | undefined> {
  const rows = await database()
    .select()
    .from(allTables.properties)
    .where(eq(allTables.properties.id, propertyId))
    .limit(1);

  // Through `unknown`: the drizzle row types nullable columns as `T | null`
  // where the entity says `T | undefined`. Every read below goes through
  // `hasCoordinates` or `resolveWatchSettings`, both of which treat null and
  // undefined alike, so the difference is real but not one this file acts on.
  return rows[0] as unknown as Property | undefined;
}

/**
 * Forecast, alerts and thresholds for one property.
 *
 * Never throws. §6's last acceptance criterion is that the watch card still
 * shows the day count when the forecast API is unreachable, and the day count
 * comes from the breeding record rather than from the weather — so the right
 * shape here is a snapshot with an empty forecast and a sentence saying why,
 * not an exception that takes the card down with it.
 */
export async function weatherSnapshot(propertyId: Ulid): Promise<WeatherSnapshot> {
  const cached = cache.get(propertyId);
  if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached.value;

  const property = await propertyFor(propertyId);
  const settings = resolveWatchSettings(property?.watchSettings);

  if (property === undefined || !hasCoordinates(property)) {
    // Not an error: a property that has not had its coordinates entered yet is
    // an ordinary state on day one, and saying so is more use than a stack
    // trace in a log nobody reads.
    return {
      alerts: [],
      settings,
      unavailable: "This property has no coordinates yet — set them in Settings to get a forecast.",
    };
  }

  const request = {
    latitude: property.latitude,
    longitude: property.longitude,
    timezone: property.timezone,
    days: 10,
  };

  try {
    const service = provider();
    // Alerts are already fail-soft inside `combinedWeather`; the forecast is
    // the one that can throw, and it is the one worth catching here.
    const [forecast, alerts] = await Promise.all([
      service.forecast(request),
      service.alerts(request),
    ]);

    const snapshot: WeatherSnapshot = {
      forecast,
      alerts,
      settings,
      retrievedAt: forecast.retrievedAt,
    };
    cache.set(propertyId, { at: Date.now(), value: snapshot });
    return snapshot;
  } catch (error) {
    console.error("Forecast unavailable", error);
    return {
      alerts: [],
      settings,
      unavailable: "The forecast is unreachable right now. The day counts below are still current.",
    };
  }
}
