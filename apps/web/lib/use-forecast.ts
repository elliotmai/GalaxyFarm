"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_WATCH_SETTINGS,
  resolveWatchSettings,
  type Forecast,
  type WatchSettings,
  type WeatherAlert,
} from "@galaxy-farm/core";

/**
 * The property's forecast and watch thresholds, from `/api/weather`.
 *
 * One request per page, however many parts of it ask: the calving watch, the
 * chore sheet and the header on Today all read the same forecast, and three
 * fetches of it would be three chances to disagree. The answer is shared for a
 * few minutes, which is well inside the server's own fifteen-minute cache.
 *
 * Never throws. Offline is the ordinary case in a barn, so a failed fetch is a
 * snapshot with no forecast and a sentence saying why — and everything that
 * reads it already knows what to do without one.
 */

export interface ForecastSnapshot {
  readonly forecast?: Forecast | undefined;
  readonly settings: WatchSettings;
  /** The weather service's watches and warnings — wind and storms the hours smooth over. */
  readonly alerts: readonly WeatherAlert[];
  /** Why there is no forecast, when there is none. */
  readonly unavailable?: string | undefined;
  /** The forecast has been asked for, whichever way it answered. */
  readonly asked: boolean;
}

const SHARE_MS = 5 * 60 * 1000;

let shared: { readonly at: number; readonly answer: Promise<ForecastSnapshot> } | undefined;

/** Dates arrive from JSON as strings. */
export function reviveForecast(raw: unknown): Forecast | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = raw as Forecast;

  return {
    ...value,
    retrievedAt: new Date(value.retrievedAt),
    ...(value.current === undefined || value.current === null
      ? {}
      : { current: { ...value.current, at: new Date(value.current.at) } }),
    hourly: (value.hourly ?? []).map((hour) => ({ ...hour, at: new Date(hour.at) })),
    daily: (value.daily ?? []).map((day) => ({ ...day, date: new Date(day.date) })),
  };
}

/** Alerts arrive with their dates as strings too; anything malformed is dropped. */
function reviveAlerts(raw: unknown): WeatherAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const alert = entry as WeatherAlert;
    const from = new Date(alert.from);
    if (typeof alert.event !== "string" || Number.isNaN(from.getTime())) return [];
    return [
      {
        ...alert,
        from,
        ...(alert.to === undefined || alert.to === null ? {} : { to: new Date(alert.to) }),
      },
    ];
  });
}

async function ask(): Promise<ForecastSnapshot> {
  try {
    const response = await fetch("/api/weather");
    if (!response.ok) throw new Error(String(response.status));

    const body = (await response.json()) as Record<string, unknown>;
    const forecast = reviveForecast(body["forecast"]);
    return {
      ...(forecast === undefined ? {} : { forecast }),
      settings: resolveWatchSettings(body["settings"]),
      alerts: reviveAlerts(body["alerts"]),
      ...(typeof body["unavailable"] === "string" ? { unavailable: body["unavailable"] } : {}),
      asked: true,
    };
  } catch {
    return {
      settings: DEFAULT_WATCH_SETTINGS,
      alerts: [],
      unavailable: "No forecast right now — day counts are still current.",
      asked: true,
    };
  }
}

function sharedAnswer(): Promise<ForecastSnapshot> {
  if (shared === undefined || Date.now() - shared.at > SHARE_MS) {
    shared = { at: Date.now(), answer: ask() };
  }
  return shared.answer;
}

/** Tests start each case from a fresh request. */
export function forgetSharedForecast(): void {
  shared = undefined;
}

/**
 * The forecast, asked once — or, with `refreshMs`, asked again on that beat.
 *
 * A phone page lives a few minutes and the first answer does it. A barn board
 * stays up all day, and "the weather now" read at seven is wrong by noon, so
 * the kiosk asks again every quarter of an hour. A failed refresh keeps the
 * last good answer rather than blanking the board.
 */
export function useForecast(options: { readonly refreshMs?: number } = {}): ForecastSnapshot {
  const { refreshMs } = options;
  const [snapshot, setSnapshot] = useState<ForecastSnapshot>({
    settings: DEFAULT_WATCH_SETTINGS,
    alerts: [],
    asked: false,
  });

  useEffect(() => {
    let live = true;
    void sharedAnswer().then((answer) => {
      if (live) setSnapshot(answer);
    });
    if (refreshMs === undefined) {
      return () => {
        live = false;
      };
    }

    const timer = setInterval(() => {
      shared = undefined;
      void sharedAnswer().then((answer) => {
        if (!live) return;
        setSnapshot((previous) =>
          answer.forecast === undefined && previous.forecast !== undefined ? previous : answer,
        );
      });
    }, refreshMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refreshMs]);

  return snapshot;
}
