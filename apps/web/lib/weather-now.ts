import {
  weatherCodeLabel,
  type Forecast,
  type WatchSettings,
  type WeatherAlert,
} from "@galaxy-farm/core";

import { choreWeatherDay } from "@/lib/weather-jobs";

/**
 * What a barn board says about the weather: "52° · Partly cloudy", and what
 * is on its way — "Rain from 5 PM · Hard freeze tonight".
 *
 * Pure, so the wording is pinned by a test. The board adds the clock.
 */

export interface WeatherNow {
  readonly temperatureF: number | undefined;
  /** "Partly cloudy", with the wind when it is worth mentioning. */
  readonly sky: string | undefined;
  /** What is coming before noon tomorrow, soonest first. Empty when nothing is. */
  readonly coming: readonly string[];
}

/** Gusts worth saying out loud on a board, well below the "high winds" line. */
const BREEZY_GUST_MPH = 25;

/** A forecast hour — the farm's clock read as UTC — as a time on this device. */
function farmClock(at: Date): Date {
  return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours());
}

function when(what: string, at: Date | undefined, now: Date): string {
  if (at === undefined) return `${what} by morning`;
  if (at <= now) return `${what} now`;
  return `${what} from ${at.toLocaleTimeString(undefined, { hour: "numeric" })}`;
}

export function weatherNow(
  forecast: Forecast | undefined,
  settings: Pick<WatchSettings, "frostF" | "hardFreezeF">,
  alerts: readonly WeatherAlert[],
  now: Date,
): WeatherNow {
  if (forecast === undefined) return { temperatureF: undefined, sky: undefined, coming: [] };

  // The provider's own "now" when it has one; otherwise the nearest hour.
  const nearest = [...forecast.hourly].sort(
    (left, right) =>
      Math.abs(farmClock(left.at).getTime() - now.getTime()) -
      Math.abs(farmClock(right.at).getTime() - now.getTime()),
  )[0];
  const reading = forecast.current ?? nearest;
  const gust = reading?.gustMph;
  const label = weatherCodeLabel(reading?.weatherCode);
  const windy =
    gust !== undefined && gust >= BREEZY_GUST_MPH ? `gusts ${Math.round(gust)} mph` : undefined;

  const day = choreWeatherDay(forecast, settings, now, alerts);
  const tonight = day.weather?.has("freeze_tonight")
    ? "Hard freeze tonight"
    : day.weather?.has("frost_tonight")
      ? "Frost tonight"
      : undefined;
  const coming = [
    day.weather?.has("rain_coming") === true
      ? when("Rain", day.arrives.rain_coming, now)
      : undefined,
    day.weather?.has("wind_coming") === true
      ? when("High winds", day.arrives.wind_coming, now)
      : undefined,
    tonight,
  ].filter((part): part is string => part !== undefined);

  return {
    temperatureF: reading === undefined ? undefined : Math.round(reading.temperatureF),
    sky: [label, windy].filter((part) => part !== undefined).join(", ") || undefined,
    coming,
  };
}
