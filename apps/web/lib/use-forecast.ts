"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_WATCH_SETTINGS,
  resolveWatchSettings,
  type Forecast,
  type WatchSettings,
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
    hourly: (value.hourly ?? []).map((hour) => ({ ...hour, at: new Date(hour.at) })),
    daily: (value.daily ?? []).map((day) => ({ ...day, date: new Date(day.date) })),
  };
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
      ...(typeof body["unavailable"] === "string" ? { unavailable: body["unavailable"] } : {}),
      asked: true,
    };
  } catch {
    return {
      settings: DEFAULT_WATCH_SETTINGS,
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

export function useForecast(): ForecastSnapshot {
  const [snapshot, setSnapshot] = useState<ForecastSnapshot>({
    settings: DEFAULT_WATCH_SETTINGS,
    asked: false,
  });

  useEffect(() => {
    let live = true;
    void sharedAnswer().then((answer) => {
      if (live) setSnapshot(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  return snapshot;
}
