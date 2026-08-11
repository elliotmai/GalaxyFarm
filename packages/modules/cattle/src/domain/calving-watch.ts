import {
  DEFAULT_CALF_CHILL_F,
  DEFAULT_PRESSURE_FALL_HPA,
  isColdSnap,
  isNearFullMoon,
  steepestPressureFall,
  WATCH_SIGNALS,
  type DailyWeather,
  type Forecast,
  type Ulid,
  type WatchSignal,
} from "@galaxy-farm/core";

import {
  daysBred,
  isInCalvingWindow,
  projectedDueDate,
  type BreedingRecord,
} from "./breeding-record.js";

/**
 * The calving watch (spec §6, pulled forward into Phase 1 by §12 decision 5).
 *
 * "Front arriving Thursday night + full moon Friday — Dolly is at day 279."
 * That sentence is the whole feature: a cow inside her window, plus whichever
 * of the three signals the forecast actually shows, phrased the way somebody
 * deciding whether to set a 2am alarm would say it.
 *
 * The signals are weighted honestly. A cold snap is a real risk to a wet
 * newborn and stands on its own. A barometric fall has some support and a lot
 * of stockman belief. A full moon has very little support and is here because
 * the spec asks for it and because people weigh it anyway — it is never the
 * only reason a card appears, only ever an addition to one.
 */

/**
 * Re-exported, not redeclared.
 *
 * The names live in the kernel beside the watch settings, because the poller
 * that reads those settings is not cattle code and §4.1 keeps it from
 * importing this module. A caller holding a watch card should not have to know
 * that, so the names are still reachable from here.
 */
export { WATCH_SIGNALS, type WatchSignal };

export interface WatchSignalDetail {
  readonly signal: WatchSignal;
  readonly at: Date;
  /** One line, already phrased for a person. */
  readonly detail: string;
}

export interface CalvingWatchCard {
  readonly damId: Ulid;
  readonly breedingRecordId: Ulid;
  readonly dueOn: Date;
  readonly dayOfGestation: number;
  readonly signals: readonly WatchSignalDetail[];
  /**
   * True when something in the forecast is worth acting on tonight.
   *
   * A full moon alone does not raise this. A card that goes urgent once a
   * month on the calendar and nothing else would train people to ignore it.
   */
  readonly urgent: boolean;
}

export interface CalvingWatchOptions {
  readonly defaultGestationDays?: number;
  readonly windowDays?: number;
  readonly calfChillF?: number;
  readonly pressureFallHpa?: number;
  readonly fullMoonDays?: number;
}

/** The coldest night in the forecast, which is the one worth naming. */
function coldestNight(daily: readonly DailyWeather[]): DailyWeather | undefined {
  return [...daily].sort((left, right) => left.lowF - right.lowF)[0];
}

/**
 * What the weather says, independent of any particular cow.
 *
 * Split out because the signals are property-wide: five cows in their windows
 * share one forecast, and computing it per cow would say the same thing five
 * times with five chances to disagree.
 */
export function calvingWatchSignals(
  forecast: Pick<Forecast, "daily" | "hourly">,
  now: Date,
  options: CalvingWatchOptions = {},
): WatchSignalDetail[] {
  const signals: WatchSignalDetail[] = [];

  const chillF = options.calfChillF ?? DEFAULT_CALF_CHILL_F;
  if (isColdSnap(forecast.daily, chillF)) {
    const night = coldestNight(forecast.daily);
    if (night !== undefined) {
      signals.push({
        signal: "cold_snap",
        at: night.date,
        detail: `Low of ${Math.round(night.lowF)}°F — a wet calf will chill fast`,
      });
    }
  }

  const fall = steepestPressureFall(forecast.hourly);
  if (fall >= (options.pressureFallHpa ?? DEFAULT_PRESSURE_FALL_HPA)) {
    const firstHour = [...forecast.hourly].sort(
      (left, right) => left.at.getTime() - right.at.getTime(),
    )[0];
    signals.push({
      signal: "pressure_fall",
      at: firstHour?.at ?? now,
      detail: `Pressure falling ${fall.toFixed(1)} hPa in 24 hours — a front is coming through`,
    });
  }

  const moonDays = options.fullMoonDays ?? 1;
  if (isNearFullMoon(now, moonDays)) {
    signals.push({ signal: "full_moon", at: now, detail: "Full moon" });
  }

  return signals;
}

/**
 * A watch card per cow currently inside her window.
 *
 * Ordered by due date, so the cow closest to calving is the one at the top.
 */
export function calvingWatch(
  breedings: readonly BreedingRecord[],
  forecast: Pick<Forecast, "daily" | "hourly">,
  now: Date,
  options: CalvingWatchOptions = {},
): CalvingWatchCard[] {
  const signals = calvingWatchSignals(forecast, now, options);
  // A full moon on its own is a note, not a reason to be up at 2am.
  const urgent = signals.some((signal) => signal.signal !== "full_moon");

  return breedings
    .filter((record) => isInCalvingWindow(record, now, options))
    .map((record) => ({
      damId: record.damId,
      breedingRecordId: record.id,
      dueOn: projectedDueDate(record, options.defaultGestationDays),
      dayOfGestation: daysBred(record, now),
      signals,
      urgent,
    }))
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime());
}

/**
 * The alert sentence, in §6's own shape.
 *
 * Built here rather than in the UI because the same words go to an email, a
 * push notification, and a dashboard card, and three copies of a sentence is
 * three chances for one of them to say something slightly different about a
 * cow at 2am.
 */
export function describeWatch(card: CalvingWatchCard, damName: string): string {
  const conditions = card.signals.map((signal) => signal.detail);
  const position = `${damName} is at day ${card.dayOfGestation}`;

  return conditions.length === 0
    ? `${position}, due ${card.dueOn.toDateString()}`
    : `${conditions.join(" + ")} — ${position}`;
}
