import type { Forecast, ForecastRequest, WeatherAlert, WeatherProvider } from "@galaxy-farm/core";

/**
 * Weather adapters (spec §6).
 *
 * Two providers, one port: Open-Meteo for the hourly forecast and its surface
 * pressure, the National Weather Service for official watches and warnings.
 */

export * from "./open-meteo.js";
export * from "./nws.js";

/**
 * Both at once, which is how §6 actually describes the service: forecasts from
 * the primary, alerts from the official source.
 *
 * A failure to reach the alert provider does not fail the forecast. The
 * forecast is what the freeze chores and the calving watch are computed from,
 * and losing all of it because weather.gov was slow would be the wrong trade
 * on the night it matters.
 */
export function combinedWeather(
  forecastProvider: WeatherProvider,
  alertProvider: WeatherProvider,
): WeatherProvider & { alerts(request: ForecastRequest): Promise<WeatherAlert[]> } {
  return {
    name: `${forecastProvider.name}+${alertProvider.name}`,

    forecast(request): Promise<Forecast> {
      return forecastProvider.forecast(request);
    },

    async alerts(request): Promise<WeatherAlert[]> {
      if (alertProvider.alerts === undefined) return [];
      try {
        return await alertProvider.alerts(request);
      } catch {
        // Deliberately swallowed. Callers treat an empty alert list as "none
        // published", which is the same thing a person would conclude from a
        // site that would not load.
        return [];
      }
    },
  };
}
