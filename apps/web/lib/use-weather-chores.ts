"use client";

import {
  type ChoreEntry,
  type ChoreWeather,
  type Ulid,
  type WaterSource,
  type Zone,
} from "@galaxy-farm/core";
import type { Planting } from "@galaxy-farm/module-garden";

import { useRecords } from "@/lib/local/use-records";
import { useForecast } from "@/lib/use-forecast";
import { choreWeatherOn, weatherChores, weatherJobs, type WeatherJobs } from "@/lib/weather-jobs";

/**
 * The weather's part of a day sheet, for every screen that draws one.
 *
 * Today, the kiosk's chores board and the Chores screen all read their list
 * through this, so the barn and the phone agree on whether tonight wants the
 * covers — the same way they already agree on feeding by deriving it from the
 * same plans.
 *
 * Until the forecast has answered, weather templates are held back rather
 * than shown and then withdrawn: a chore that appears a moment late is fine,
 * one that vanishes from under a finger is not. If it answers with nothing —
 * offline, no coordinates — they are kept, because a day nobody could check
 * is not a day known to be mild.
 */
export interface WeatherChores {
  /** The weather's own chores — covers, ice, the garden — for `derived`. */
  readonly derived: readonly ChoreEntry[];
  /** For `choreDaySheet`'s `weather`. */
  readonly weather: ReadonlySet<ChoreWeather> | undefined;
  readonly jobs: WeatherJobs;
}

const NOT_YET: ReadonlySet<ChoreWeather> = new Set();

export function useWeatherChores(propertyId: Ulid, date: Date, now: Date): WeatherChores {
  const query = { propertyId };
  const { records: water } = useRecords<WaterSource>("waterSources", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: plantings } = useRecords<Planting>("plantings", query);
  const snapshot = useForecast();

  const jobs = weatherJobs({
    forecast: snapshot.forecast,
    settings: snapshot.settings,
    water,
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      waterSourceIds: zone.waterSourceIds,
      active: zone.active,
    })),
    plantings,
    now: date,
  });

  return {
    derived: weatherChores(jobs, date, now),
    weather: snapshot.asked ? choreWeatherOn(snapshot.forecast, snapshot.settings, date) : NOT_YET,
    jobs,
  };
}
