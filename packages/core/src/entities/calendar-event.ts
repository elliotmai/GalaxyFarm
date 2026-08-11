import { z } from "zod";

import { contains, overlaps, type DateRange } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The unified calendar (spec §5.1, §6).
 *
 * Almost every dated thing on this farm is already recorded somewhere else: a
 * calving window is a breeding record plus 283 days, a withdrawal end is a
 * treatment plus its withdrawal days, a run-out is arithmetic on the feed
 * inventory. §2's "derive, don't duplicate" makes the calendar a read model —
 * nothing here is entered twice, and correcting the breeding date moves the
 * calving window rather than leaving a stale copy behind.
 *
 * What *is* stored is the manual event, because "farrier coming Tuesday" is
 * derived from nothing. That half is an ordinary entity with a full CRUD
 * surface; the projected half is on §4.5's derived-read-model exception list.
 */

/**
 * Which module a row came from, for §6's "filter by module".
 *
 * Note that core does not import the modules — it never learns what a breeding
 * record is. Modules hand it entries; this is only the label they travel under.
 */
export const CALENDAR_MODULES = [
  "cattle",
  "feed",
  "poultry",
  "garden",
  "equipment",
  "supplies",
  "business",
  "chores",
  "weather",
  "general",
] as const;
export type CalendarModule = (typeof CALENDAR_MODULES)[number];

/** Every projected kind §6 names, plus the manual one. */
export const CALENDAR_EVENT_KINDS = [
  "breeding_protocol_step",
  "preg_check_due",
  "calving_window",
  "calving_watch",
  "withdrawal_end",
  "booster_due",
  "med_expiration",
  "feed_run_out",
  "maintenance_due",
  "rule_deadline",
  "drop_off",
  "pickup_estimate",
  "planting_window",
  "frost_warning",
  "tank_freeze",
  "candidate_sale_date",
  "chore",
  "manual",
] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const EVENT_KIND_MODULE: Readonly<Record<CalendarEventKind, CalendarModule>> = {
  breeding_protocol_step: "cattle",
  preg_check_due: "cattle",
  calving_window: "cattle",
  calving_watch: "cattle",
  withdrawal_end: "cattle",
  booster_due: "cattle",
  med_expiration: "cattle",
  candidate_sale_date: "cattle",
  feed_run_out: "feed",
  maintenance_due: "equipment",
  rule_deadline: "business",
  drop_off: "business",
  pickup_estimate: "business",
  planting_window: "garden",
  frost_warning: "weather",
  tank_freeze: "weather",
  chore: "chores",
  manual: "general",
};

/**
 * One row on the calendar, projected or manual.
 *
 * `source` is what makes a projected row useful rather than merely informative:
 * tapping "Andromeda — calving window opens" has to land on the breeding
 * record, and a row that cannot say where it came from is a dead end (§2).
 */
export interface CalendarEntry {
  /** Stable across recomputation, so React keys and "dismissed" flags hold. */
  readonly id: string;
  readonly kind: CalendarEventKind;
  readonly module: CalendarModule;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly at: Date;
  /** Set for windows — a calving window is a fortnight, not an instant. */
  readonly endAt?: Date | undefined;
  readonly allDay: boolean;
  /** Absent on manual events; present on everything projected. */
  readonly source?: { readonly entity: string; readonly id: Ulid } | undefined;
}

/** The manual half — a real record, with the full CRUD surface (§4.5). */
export interface CalendarEvent extends BaseRecord {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly at: Date;
  readonly endAt?: Date | undefined;
  readonly allDay: boolean;
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
}

export const calendarEventSchema = baseRecordSchema
  .extend({
    title: z.string().min(1, "An event needs a title").max(160),
    detail: z.string().max(5000).optional(),
    at: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    allDay: z.boolean(),
    zoneId: ulidSchema.optional(),
    animalId: ulidSchema.optional(),
  })
  .refine((event) => event.endAt === undefined || event.endAt >= event.at, {
    message: "An event cannot end before it starts",
    path: ["endAt"],
  }) as unknown as z.ZodType<CalendarEvent>;

/** Lift a stored manual event onto the calendar. */
export function entryFromEvent(event: CalendarEvent): CalendarEntry {
  return {
    id: event.id,
    kind: "manual",
    module: "general",
    title: event.title,
    detail: event.detail,
    at: event.at,
    endAt: event.endAt,
    allDay: event.allDay,
  };
}

/**
 * A projected row's id.
 *
 * Derived from what produced it rather than generated, so recomputing the
 * calendar twice a second does not produce a different id each time — which is
 * what would make "I've seen that alert" impossible to remember.
 */
export function projectedId(kind: CalendarEventKind, entity: string, id: Ulid): string {
  return `${kind}:${entity}:${id}`;
}

export interface ProjectionInput {
  readonly manual: readonly CalendarEvent[];
  /** Contributed by the modules; core computes none of them itself. */
  readonly projected: readonly CalendarEntry[];
}

/**
 * Merge the two halves into one ordered calendar.
 *
 * Windowing happens here rather than in each module so "does this event fall in
 * March" is answered one way: a row with an `endAt` counts if any part of it
 * overlaps, because a calving window that opened in February and closes in
 * March very much belongs on March's calendar.
 */
export function projectEvents(
  input: ProjectionInput,
  window?: DateRange,
  modules?: readonly CalendarModule[],
): CalendarEntry[] {
  const wanted = modules === undefined ? undefined : new Set(modules);

  const inWindow = (entry: CalendarEntry): boolean => {
    if (window === undefined) return true;

    // An instant is a point, not an open-ended range. Handing `{from: at}` to
    // `overlaps` says "from then onwards", which puts November's farrier
    // appointment on every month after it; collapsing it to `{from: at, to:
    // at}` is worse, because a half-open comparison excludes a zero-length
    // range from every window including its own.
    if (entry.endAt === undefined || entry.endAt <= entry.at) return contains(window, entry.at);
    return overlaps({ from: entry.at, to: entry.endAt }, window);
  };

  return [...input.manual.map(entryFromEvent), ...input.projected]
    .filter((entry) => wanted === undefined || wanted.has(entry.module))
    .filter(inWindow)
    .sort(
      (left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id),
    );
}

/** Group an ordered calendar into agenda days, keyed `YYYY-MM-DD` in local time. */
export function groupByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const days = new Map<string, CalendarEntry[]>();

  for (const entry of entries) {
    const key = [
      entry.at.getFullYear(),
      String(entry.at.getMonth() + 1).padStart(2, "0"),
      String(entry.at.getDate()).padStart(2, "0"),
    ].join("-");
    const bucket = days.get(key);
    if (bucket === undefined) days.set(key, [entry]);
    else bucket.push(entry);
  }

  return days;
}
