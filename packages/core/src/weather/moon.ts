/**
 * Moon phase, computed rather than fetched (spec §6).
 *
 * §6 asks for phases that "render on the calendar indefinitely and offline",
 * which rules out an API and rules in arithmetic. The calving watch wants one
 * thing from it: is a full moon within a day of this date.
 *
 * This is the mean-phase calculation — a known new moon plus whole synodic
 * months. It ignores the perturbations that make a real lunation run between
 * about 29.27 and 29.83 days, so an individual full moon can land up to about
 * fourteen hours either side of what this says. That is well inside the ±1 day
 * window §6 asks for, and it is the reason this file does not pretend to more
 * precision than it has: nothing here should be used to time an eclipse.
 */

/** 2000 January 6, 18:14 UTC — the new moon the count runs from. */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

/** The mean synodic month, in days. */
export const SYNODIC_MONTH_DAYS = 29.530_588_853;

const MS_PER_DAY = 86_400_000;

export const MOON_PHASES = [
  "new",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full",
  "waning_gibbous",
  "last_quarter",
  "waning_crescent",
] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];

/**
 * Where in the lunation a date falls: 0 at new moon, 0.5 at full, wrapping at 1.
 */
export function lunationFraction(at: Date): number {
  const days = (at.getTime() - KNOWN_NEW_MOON) / MS_PER_DAY;
  const fraction = (days / SYNODIC_MONTH_DAYS) % 1;
  return fraction < 0 ? fraction + 1 : fraction;
}

/** Lit fraction of the disc, 0 at new and 1 at full. */
export function illumination(at: Date): number {
  return (1 - Math.cos(2 * Math.PI * lunationFraction(at))) / 2;
}

/**
 * The named phase.
 *
 * The four exact phases get a window of roughly a day either side rather than
 * an instant, because "first quarter" on a calendar means the day, not the
 * moment.
 */
export function moonPhase(at: Date): MoonPhase {
  const fraction = lunationFraction(at);
  const eighth = 1 / 8;
  const half = eighth / 2;

  if (fraction < half || fraction >= 1 - half) return "new";
  if (fraction < eighth * 2 - half) return "waxing_crescent";
  if (fraction < eighth * 2 + half) return "first_quarter";
  if (fraction < eighth * 4 - half) return "waxing_gibbous";
  if (fraction < eighth * 4 + half) return "full";
  if (fraction < eighth * 6 - half) return "waning_gibbous";
  if (fraction < eighth * 6 + half) return "last_quarter";
  return "waning_crescent";
}

/** The moment of the full moon in the lunation containing `at`. */
export function fullMoonNear(at: Date): Date {
  const fraction = lunationFraction(at);
  // Distance to the next full moon, signed: negative when it has just passed.
  const offset = fraction <= 0.5 ? 0.5 - fraction : 1.5 - fraction;
  const candidate = new Date(at.getTime() + offset * SYNODIC_MONTH_DAYS * MS_PER_DAY);

  // Having crossed the half-way point, the *nearest* full moon may be the one
  // behind rather than the one ahead.
  const previous = new Date(candidate.getTime() - SYNODIC_MONTH_DAYS * MS_PER_DAY);
  return Math.abs(previous.getTime() - at.getTime()) < Math.abs(candidate.getTime() - at.getTime())
    ? previous
    : candidate;
}

/**
 * Is a full moon within `days` of this date? (§6 default: ±1.)
 *
 * The old-hand belief that cows calve on a full moon has weak support in the
 * literature. It is in the spec anyway, and correctly so: it costs nothing to
 * mention alongside a genuine pressure drop, and the person deciding whether
 * to set an alarm at 2am is entitled to every signal they already weigh.
 */
export function isNearFullMoon(at: Date, days = 1): boolean {
  return Math.abs(fullMoonNear(at).getTime() - at.getTime()) <= days * MS_PER_DAY;
}
