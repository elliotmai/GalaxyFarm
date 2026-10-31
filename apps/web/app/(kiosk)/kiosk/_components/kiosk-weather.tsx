"use client";

import { useEffect, useState } from "react";

import { useForecast } from "@/lib/use-forecast";
import { weatherNow } from "@/lib/weather-now";

/**
 * The clock and the weather, in the corner of every barn board.
 *
 * The two things anybody walking past a screen in a barn wants before
 * anything on it: what time it is, and what it is doing outside — and, when
 * something is coming, when. Always there, on every board, so nobody has to
 * go to a particular one to find out whether to fetch a coat.
 *
 * The time ticks on its own; the forecast is asked again every quarter of an
 * hour, which is as often as the server's own copy changes. With no forecast
 * — offline, or no coordinates yet — the clock still shows, and the weather
 * line says so quietly rather than leaving a gap that looks broken.
 */

const REFRESH_MS = 15 * 60 * 1000;

export function KioskWeather() {
  const snapshot = useForecast({ refreshMs: REFRESH_MS });
  // Set after mount rather than during render: the server's clock is not the
  // barn's, and a time rendered on both disagrees by the trip between them.
  const [now, setNow] = useState<Date | undefined>(undefined);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const weather =
    now === undefined
      ? undefined
      : weatherNow(snapshot.forecast, snapshot.settings, snapshot.alerts, now);

  return (
    <section
      aria-label="Time and weather"
      className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-right"
    >
      <p className="text-2xl font-semibold tabular-nums leading-tight text-ink">
        {now === undefined
          ? " "
          : now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </p>
      {weather === undefined ? null : weather.temperatureF === undefined ? (
        snapshot.asked ? (
          <p className="text-density text-muted">No weather right now</p>
        ) : null
      ) : (
        <p className="text-density text-ink">
          <span className="font-semibold tabular-nums">{weather.temperatureF}°</span>
          {weather.sky === undefined ? null : <span> · {weather.sky}</span>}
        </p>
      )}
      {weather === undefined || weather.coming.length === 0 ? null : (
        <p className="text-density font-semibold text-ink">{weather.coming.join(" · ")}</p>
      )}
    </section>
  );
}
