import type { DailyWeather, Forecast, HourlyWeather } from "../ports/weather.js";
import {
  coversToFit,
  freezeCheckTargets,
  type FreezeCheckTarget,
  type WaterSource,
  type ZoneWaterRef,
} from "../entities/water-source.js";

/**
 * What the forecast means for this farm (spec §6).
 *
 * Three thresholds, all configurable, all defaulted to the spec's numbers:
 * frost for the garden at 36 °F, hard freeze for the tanks at 28 °F, and a
 * calf-chill cold snap at 20 °F. Pure functions over a forecast — the polling
 * and the adapters live in infrastructure, and none of it is reachable from
 * here.
 */

export const DEFAULT_FROST_F = 36;
export const DEFAULT_HARD_FREEZE_F = 28;
export const DEFAULT_SUSTAINED_FREEZE_F = 32;
export const DEFAULT_CALF_CHILL_F = 20;

/** §6: "≥ 4 hPa / ~0.12 inHg within 24 h". */
export const DEFAULT_PRESSURE_FALL_HPA = 4;

export interface FrostRisk {
  readonly date: Date;
  readonly lowF: number;
  /** True below the hard-freeze threshold, not merely below freezing. */
  readonly hardFreeze: boolean;
}

/**
 * Nights below the frost threshold.
 *
 * The growing-season filter is the caller's: §6 says frost warnings fire "during
 * the growing season", and what counts as the season depends on the property's
 * zone, which is a setting rather than a fact about the weather.
 */
export function frostRisk(
  daily: readonly DailyWeather[],
  options: { frostF?: number; hardFreezeF?: number } = {},
): FrostRisk[] {
  const frostF = options.frostF ?? DEFAULT_FROST_F;
  const hardFreezeF = options.hardFreezeF ?? DEFAULT_HARD_FREEZE_F;

  return daily
    .filter((day) => day.lowF <= frostF)
    .map((day) => ({ date: day.date, lowF: day.lowF, hardFreeze: day.lowF <= hardFreezeF }));
}

/**
 * Days cold enough to freeze a tank.
 *
 * Two ways in, per §6: a low crossing the hard-freeze threshold, or a
 * sustained spell below freezing. The second matters because a still day at
 * 30 °F freezes a trough that a night dipping to 27 and recovering by nine
 * does not.
 */
export function freezeDays(
  forecast: Pick<Forecast, "daily" | "hourly">,
  options: { hardFreezeF?: number; sustainedF?: number; sustainedHours?: number } = {},
): DailyWeather[] {
  const hardFreezeF = options.hardFreezeF ?? DEFAULT_HARD_FREEZE_F;
  const sustainedF = options.sustainedF ?? DEFAULT_SUSTAINED_FREEZE_F;
  const sustainedHours = options.sustainedHours ?? 8;

  const hoursBelow = new Map<string, number>();
  for (const hour of forecast.hourly) {
    if (hour.temperatureF >= sustainedF) continue;
    const key = dayKey(hour.at);
    hoursBelow.set(key, (hoursBelow.get(key) ?? 0) + 1);
  }

  return forecast.daily.filter(
    (day) => day.lowF <= hardFreezeF || (hoursBelow.get(dayKey(day.date)) ?? 0) >= sustainedHours,
  );
}

function dayKey(at: Date): string {
  return `${at.getUTCFullYear()}-${at.getUTCMonth()}-${at.getUTCDate()}`;
}

export interface FreezeChore {
  readonly date: Date;
  readonly target: FreezeCheckTarget;
  readonly lowF: number;
}

/**
 * One ice-breaking chore per tank per freeze day — never per zone.
 *
 * §5.1 and §6 are both explicit about this and the reason is on this property:
 * four tanks serve eight zones, one of them serving three. Derived per zone,
 * a freeze day would raise eight chores for four tanks and send someone to the
 * Pen 1/2 trough three times. A chore list that does that stops being trusted,
 * and an untrusted chore list is worse than none.
 */
export function freezeChores(
  forecast: Pick<Forecast, "daily" | "hourly">,
  waterSources: readonly WaterSource[],
  zones: readonly ZoneWaterRef[],
  options: { hardFreezeF?: number; sustainedF?: number; sustainedHours?: number } = {},
): FreezeChore[] {
  const targets = freezeCheckTargets(waterSources, zones);

  return freezeDays(forecast, options).flatMap((day) =>
    targets.map((target) => ({ date: day.date, target, lowF: day.lowF })),
  );
}

export interface CoverChore {
  /** The day to do it: the one before the cold arrives. */
  readonly date: Date;
  /** The freeze it is getting ahead of. */
  readonly freezeDate: Date;
  readonly target: FreezeCheckTarget;
  readonly lowF: number;
}

/**
 * Go and put the covers on, before it gets here (§6).
 *
 * The one piece of freeze work that has to happen *ahead* of the freeze rather
 * than on the morning of it, which is why it is derived separately from
 * `freezeChores` and dated a day earlier. §6 already sends the alert the
 * evening before; this is the list that alert should be carrying.
 *
 * One chore per tank for the *first* freeze in the forecast, not one per tank
 * per freeze day. A three-day cold spell does not need the same cover put on
 * three times, and once somebody records it as on the tank drops off this list
 * by itself.
 */
export function coverChores(
  forecast: Pick<Forecast, "daily" | "hourly">,
  waterSources: readonly WaterSource[],
  zones: readonly ZoneWaterRef[],
  options: { hardFreezeF?: number; sustainedF?: number; sustainedHours?: number } = {},
): CoverChore[] {
  const [first] = freezeDays(forecast, options).sort(
    (left, right) => left.date.getTime() - right.date.getTime(),
  );
  if (first === undefined) return [];

  return coversToFit(freezeCheckTargets(waterSources, zones)).map((target) => ({
    date: new Date(first.date.getTime() - 86_400_000),
    freezeDate: first.date,
    target,
    lowF: first.lowF,
  }));
}

/**
 * The steepest 24-hour pressure fall in the forecast, in hectopascals.
 *
 * Positive means falling. Compared over a rolling 24 hours rather than between
 * consecutive readings, because the signal §6 wants is the depth of the whole
 * fall, not how fast any one hour of it moved.
 */
export function steepestPressureFall(hourly: readonly HourlyWeather[]): number {
  const withPressure = hourly
    .filter(
      (hour): hour is HourlyWeather & { pressureHpa: number } => hour.pressureHpa !== undefined,
    )
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  let steepest = 0;
  for (let start = 0; start < withPressure.length; start += 1) {
    const from = withPressure[start] as HourlyWeather & { pressureHpa: number };
    for (let end = start + 1; end < withPressure.length; end += 1) {
      const to = withPressure[end] as HourlyWeather & { pressureHpa: number };
      if (to.at.getTime() - from.at.getTime() > 24 * 3_600_000) break;
      const fall = from.pressureHpa - to.pressureHpa;
      if (fall > steepest) steepest = fall;
    }
  }

  return steepest;
}

/** Is a front coming through hard enough to be worth mentioning? */
export function isRapidPressureFall(
  hourly: readonly HourlyWeather[],
  thresholdHpa: number = DEFAULT_PRESSURE_FALL_HPA,
): boolean {
  return steepestPressureFall(hourly) >= thresholdHpa;
}

/** Cold enough that a wet newborn is in trouble. */
export function isColdSnap(
  daily: readonly DailyWeather[],
  thresholdF: number = DEFAULT_CALF_CHILL_F,
): boolean {
  return daily.some((day) => day.lowF <= thresholdF);
}

/** Hectopascals to inches of mercury, for the "~0.12 inHg" §6 quotes. */
export function hpaToInHg(hpa: number): number {
  return hpa * 0.029_529_98;
}
