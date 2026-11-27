import { dayKey, endOfDay, type ChoreEntry, type Ulid, type Zone } from "@galaxy-farm/core";
import { headCountOn, type Flock, type FlockAdjustment } from "@galaxy-farm/module-poultry";

/**
 * The egg round, derived from the hens (spec §2, §5.4).
 *
 * "Collect eggs" is on the day's sheet for as long as there are laying birds
 * on the property: an active flock with a bird in it that day. Nobody writes a
 * template for it and nobody has to remember to retire one — sell the last
 * hen and the chore stops; buy pullets and it starts. Derive, don't duplicate.
 *
 * One chore for the whole property, not one per coop: the round is a single
 * walk with a basket, and the egg count it opens asks which coop when there is
 * more than one. The coops it covers ride in the detail.
 *
 * It holds open until the day is over, like a template with no part of the
 * day, so it is never "late" at breakfast. Ticking it writes a row keyed by
 * `eggChoreId(day)`, the way a feeding trip or a weather job is written down,
 * so it is matched to its day and never carried onto the next one.
 */

const EGG_CHORE_PREFIX = "eggs:";

/** The day's egg round, as its stable id. */
export function eggChoreId(date: Date): string {
  return `${EGG_CHORE_PREFIX}${dayKey(date)}`;
}

export function isEggChoreKey(key: string | undefined): boolean {
  return key?.startsWith(EGG_CHORE_PREFIX) ?? false;
}

export const EGG_CHORE_TITLE = "Collect eggs";

/** The flocks laying on a day: active, with at least one bird in them. */
export function layingFlocksOn(
  flocks: readonly Flock[],
  adjustments: readonly FlockAdjustment[],
  date: Date,
): { readonly flock: Flock; readonly birds: number }[] {
  const at = endOfDay(date);
  return flocks
    .filter((flock) => flock.active && flock.deletedAt === undefined)
    .map((flock) => ({ flock, birds: headCountOn(flock, adjustments, at) }))
    .filter(({ birds }) => birds > 0)
    .sort((left, right) => left.flock.name.localeCompare(right.flock.name));
}

/** The day's egg round, or nothing when no birds are laying. */
export function eggChoresFor(
  sources: {
    readonly flocks: readonly Flock[];
    readonly adjustments: readonly FlockAdjustment[];
    readonly zones?: readonly Zone[];
  },
  date: Date,
  now: Date,
): ChoreEntry[] {
  const laying = layingFlocksOn(sources.flocks, sources.adjustments, date);
  if (laying.length === 0) return [];

  const coopName = (zoneId: Ulid | undefined) =>
    zoneId === undefined ? undefined : sources.zones?.find((zone) => zone.id === zoneId)?.name;
  const detail = laying
    .map(({ flock, birds }) => {
      const coop = coopName(flock.zoneId);
      const where =
        coop === undefined || coop === flock.name ? flock.name : `${flock.name}, ${coop}`;
      return `${where} (${birds})`;
    })
    .join(" · ");

  // One coop means one place to go; several are named in the detail instead.
  const coops = new Set(laying.map(({ flock }) => flock.zoneId));
  const zoneId = coops.size === 1 ? laying[0]?.flock.zoneId : undefined;

  const dueAt = endOfDay(date);
  return [
    {
      id: eggChoreId(date),
      title: EGG_CHORE_TITLE,
      detail,
      dueAt,
      ...(zoneId === undefined ? {} : { zoneId }),
      carriedOver: false,
      overdue: dueAt < now,
    },
  ];
}
