/**
 * What the sky is doing, in words (spec §6).
 *
 * The forecast says it as a WMO weather code — the international table every
 * model publishes in — and a board on a barn wall wants "Light rain", not 61.
 * Short on purpose: it sits beside the temperature and the time, read from
 * across an aisle.
 */

const LABELS: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0], "Clear"],
  [[1], "Mostly clear"],
  [[2], "Partly cloudy"],
  [[3], "Cloudy"],
  [[45, 48], "Fog"],
  [[51, 53, 55], "Drizzle"],
  [[56, 57], "Freezing drizzle"],
  [[61], "Light rain"],
  [[63], "Rain"],
  [[65], "Heavy rain"],
  [[66, 67], "Freezing rain"],
  [[71], "Light snow"],
  [[73], "Snow"],
  [[75], "Heavy snow"],
  [[77], "Snow grains"],
  [[80], "Showers"],
  [[81], "Rain showers"],
  [[82], "Heavy showers"],
  [[85, 86], "Snow showers"],
  [[95], "Thunderstorm"],
  [[96, 99], "Storm with hail"],
];

/** "Partly cloudy", or undefined for a code nobody publishes. */
export function weatherCodeLabel(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  return LABELS.find(([codes]) => codes.includes(code))?.[1];
}
