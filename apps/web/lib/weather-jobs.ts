import {
  addCalendarDays,
  coverChoreTitle,
  coversToFit,
  dayKey,
  freezeChoreTitle,
  freezeCheckTargets,
  freezeDays,
  frostRisk,
  timeOfDayDeadline,
  type ChoreEntry,
  type ChoreWeather,
  type FreezeCheckTarget,
  type Forecast,
  type WatchSettings,
  type WaterSource,
  type ZoneWaterRef,
} from "@galaxy-farm/core";
import type { Planting } from "@galaxy-farm/module-garden";

/**
 * The jobs the weather decides, worked out from the actual forecast (spec §6).
 *
 * A tank cover that is off is not, by itself, a job. It becomes one the day
 * before a freeze, and it stops being one once the freeze has arrived — a
 * cover fitted the morning after prevented nothing. The same goes for the
 * garden: tender beds want covering on a frost night, not every night they
 * are in the ground. So everything here reads the forecast first and the
 * records second, and says nothing about the weather it was not shown.
 *
 * Pure, so the rules can be pinned by a test rather than by rendering Today.
 */

/** Covers to put on today, ahead of the first freeze tonight. */
export interface CoversJob {
  readonly targets: readonly FreezeCheckTarget[];
  /** The morning the freeze lands — a night's low falls in its small hours. */
  readonly freezeOn: Date;
  readonly lowF: number;
}

/** Tanks to check this morning because it froze, or is freezing, today. */
export interface IceJob {
  readonly targets: readonly FreezeCheckTarget[];
  /** The bare ones — no heater, so somebody carries a hammer. */
  readonly bare: readonly FreezeCheckTarget[];
  readonly lowF: number;
}

/** Tender beds to cover tonight. */
export interface FrostJob {
  readonly plantings: number;
  readonly lowF: number;
  readonly hardFreeze: boolean;
}

export interface WeatherJobs {
  /** False when there was no forecast to read, so nothing below was decided by it. */
  readonly known: boolean;
  readonly covers: CoversJob | undefined;
  readonly ice: IceJob | undefined;
  readonly frost: FrostJob | undefined;
  /**
   * Covers that are off with no freeze close enough to act on, and when the
   * next one is if the forecast has one — "next freeze Fri" — so the quiet
   * line can say why it is quiet.
   */
  readonly coversOff: number;
  readonly nextFreezeOn: Date | undefined;
}

/** Planted out and alive: what a frost would actually reach. */
function inTheGround(planting: Planting): boolean {
  if (planting.status !== "growing" && planting.status !== "harvesting") return false;
  // An indoor start is under a roof until somebody records it going out.
  return planting.method !== "indoor_start" || planting.plantedOn !== undefined;
}

export function weatherJobs(input: {
  readonly forecast: Pick<Forecast, "daily" | "hourly"> | undefined;
  readonly settings: Pick<WatchSettings, "frostF" | "hardFreezeF">;
  readonly water: readonly WaterSource[];
  readonly zones: readonly ZoneWaterRef[];
  readonly plantings: readonly Planting[];
  readonly now: Date;
}): WeatherJobs {
  const { forecast, settings, now } = input;
  const targets = freezeCheckTargets(input.water, input.zones);
  const off = coversToFit(targets);

  if (forecast === undefined) {
    return {
      known: false,
      covers: undefined,
      ice: undefined,
      frost: undefined,
      coversOff: off.length,
      nextFreezeOn: undefined,
    };
  }

  const tomorrow = addCalendarDays(now, 1);
  const freezes = freezeDays(forecast, { hardFreezeF: settings.hardFreezeF }).sort(
    (left, right) => left.date.getTime() - right.date.getTime(),
  );
  const today = freezes.find((day) => isForecastDay(day.date, now));
  // The first freeze still ahead: tonight's lands on tomorrow's date.
  const ahead = freezes.find((day) => forecastKey(day.date) >= localKey(tomorrow));

  const covers =
    ahead !== undefined && isForecastDay(ahead.date, tomorrow) && off.length > 0
      ? { targets: off, freezeOn: ahead.date, lowF: ahead.lowF }
      : undefined;

  const ice =
    today === undefined || targets.length === 0
      ? undefined
      : {
          targets,
          bare: targets.filter((target) => target.vulnerable && target.waterSource.cover !== "on"),
          lowF: today.lowF,
        };

  const tonight = forecast.daily.find((day) => isForecastDay(day.date, tomorrow));
  const risk =
    tonight === undefined
      ? undefined
      : frostRisk([tonight], { frostF: settings.frostF, hardFreezeF: settings.hardFreezeF })[0];
  const planted = input.plantings.filter(inTheGround).length;
  const frost =
    risk === undefined || planted === 0
      ? undefined
      : { plantings: planted, lowF: risk.lowF, hardFreeze: risk.hardFreeze };

  return {
    known: true,
    covers,
    ice,
    frost,
    coversOff: covers === undefined ? off.length : 0,
    nextFreezeOn: covers === undefined ? ahead?.date : undefined,
  };
}

/**
 * Is this forecast day that calendar day here?
 *
 * A forecast's days arrive as bare dates — "2026-10-29" — which JavaScript
 * reads as UTC midnight, and UTC midnight is the previous evening anywhere
 * west of Greenwich. Compared with `isSameDay`, every day of the forecast
 * would land a day early on a Texas farm, and tonight's freeze would be read
 * as last night's. So the forecast's side is read in UTC, the clock's side in
 * local time, and both as plain calendar dates.
 */
export function isForecastDay(day: Date, local: Date): boolean {
  return forecastKey(day) === localKey(local);
}

function forecastKey(day: Date): string {
  return key(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
}

function localKey(at: Date): string {
  return key(at.getFullYear(), at.getMonth(), at.getDate());
}

function key(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/**
 * A high at or above this is a hot day: water checked twice, shade, no
 * working cattle in the afternoon. Not one of the watch settings yet, so a
 * constant, and a generous one — 95 °F is a Texas August afternoon, not a
 * warm spring one.
 */
export const HEAT_F = 95;

/** "Likely" rain, as the Today header already reads it. */
const RAIN_LIKELY = 50;

/**
 * The weather a day has, for chore templates that wait on it.
 *
 * Undefined when the forecast is missing or does not reach that day — a day
 * nobody could check, which `choreDaySheet` treats as "keep the chore" rather
 * than "drop it". An empty set is a day that was checked and had none of it.
 */
export function choreWeatherOn(
  forecast: Pick<Forecast, "daily" | "hourly"> | undefined,
  settings: Pick<WatchSettings, "frostF" | "hardFreezeF">,
  date: Date,
): ReadonlySet<ChoreWeather> | undefined {
  if (forecast === undefined) return undefined;
  const today = forecast.daily.find((day) => isForecastDay(day.date, date));
  if (today === undefined) return undefined;

  const tonight = forecast.daily.find((day) => isForecastDay(day.date, addCalendarDays(date, 1)));
  const freezes = freezeDays(forecast, { hardFreezeF: settings.hardFreezeF });
  const weather = new Set<ChoreWeather>();

  if (tonight !== undefined && freezes.includes(tonight)) {
    weather.add("freeze_tonight");
  }
  if (tonight !== undefined && tonight.lowF <= settings.frostF) weather.add("frost_tonight");
  if (freezes.includes(today)) weather.add("freezing_today");
  if ((today.precipitationChance ?? 0) >= RAIN_LIKELY) weather.add("rain_today");
  if (today.highF >= HEAT_F) weather.add("heat_today");

  return weather;
}

/** Every weather chore's id starts so, which is how its ticked row is told apart. */
export const WEATHER_CHORE_PREFIX = "weather:";

export function isWeatherChoreKey(key: string | undefined): boolean {
  return key?.startsWith(WEATHER_CHORE_PREFIX) ?? false;
}

/**
 * The weather's jobs as chores on the day sheet (spec §6).
 *
 * §6 asks for the freeze work to be injected as chores — one per tank, never
 * per zone — and the chore list is where it gets done: on the kiosk in the
 * barn, ticked with a gloved hand, with who did it written down. So covers go
 * on as an evening job the day before the freeze, the ice check is a morning
 * job on the freezing day, and the garden's row cover is an evening job on a
 * frost night. Each id is derived from what it is about and the day, so a
 * tick on one screen clears it on every other.
 */
export function weatherChores(jobs: WeatherJobs, date: Date, now: Date): ChoreEntry[] {
  const day = dayKey(date);
  const entry = (
    id: string,
    title: string,
    detail: string,
    part: "morning" | "evening",
  ): ChoreEntry => {
    const dueAt = timeOfDayDeadline(date, part);
    return {
      id: `${WEATHER_CHORE_PREFIX}${id}:${day}`,
      title,
      detail,
      dueAt,
      carriedOver: false,
      overdue: dueAt < now,
    };
  };

  const covers = (jobs.covers?.targets ?? []).map((target) =>
    entry(
      `cover:${target.waterSource.id}`,
      coverChoreTitle(target),
      `Hard freeze tonight, low ${Math.round(jobs.covers?.lowF ?? 0)}°`,
      "evening",
    ),
  );
  const ice = (jobs.ice?.targets ?? []).map((target) =>
    entry(
      `ice:${target.waterSource.id}`,
      freezeChoreTitle(target),
      `Freezing today, low ${Math.round(jobs.ice?.lowF ?? 0)}°`,
      "morning",
    ),
  );
  const frost =
    jobs.frost === undefined
      ? []
      : [
          entry(
            "frost",
            jobs.frost.hardFreeze
              ? "Pick what is ready in the garden before the hard freeze"
              : "Cover the tender garden beds",
            `${jobs.frost.hardFreeze ? "Hard freeze" : "Frost"} tonight, low ${Math.round(jobs.frost.lowF)}° · ${jobs.frost.plantings} planting${jobs.frost.plantings === 1 ? "" : "s"} in the ground`,
            "evening",
          ),
        ];

  return [...ice, ...covers, ...frost];
}
