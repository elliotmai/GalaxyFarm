import {
  addCalendarDays,
  dayKey,
  endOfDay,
  occurrencesInWindow,
  startOfDay,
  TIME_OF_DAY_LABELS,
  type ChoreTemplate,
} from "@galaxy-farm/core";
import {
  ADJUSTMENT_DIRECTION,
  headCountOn,
  layRate,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";
import type { Tone } from "@galaxy-farm/ui";

import { facts } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { REASON_LABEL } from "@/app/(admin)/admin/chickens/flock/_components/reasons";
import { describeRecurrence } from "@/lib/chores";

/**
 * What is coming for one flock, what it is laying, and everything that has
 * happened to it, as plain rows (spec §5.4; the cow page's V2 anatomy).
 *
 * Nothing here is stored. The headcount log, the egg logs and the flock's own
 * notes are read as they are, so a basket logged at the coop is on the page
 * the moment it is saved and a corrected entry corrects the history.
 */

export interface FlockRow {
  readonly key: string;
  readonly date: Date;
  readonly title: string;
  readonly line: string;
  /** Wraps rather than truncating — a note cut mid-word loses the point. */
  readonly notes?: string | undefined;
  /** Which way a headcount entry moved the count, for the sign's colour. */
  readonly direction?: 1 | -1 | undefined;
  readonly chip?: { readonly tone: Tone; readonly label: string } | undefined;
}

export interface FlockInputs {
  readonly flock: Flock;
  readonly adjustments: readonly FlockAdjustment[];
  readonly eggLogs: readonly EggLog[];
  readonly chores: readonly ChoreTemplate[];
  readonly now: Date;
}

export function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "+6" or "−4", with the sign the domain gives the reason. */
export function signed(entry: Pick<FlockAdjustment, "reason" | "quantity">): string {
  return ADJUSTMENT_DIRECTION[entry.reason] > 0 ? `+${entry.quantity}` : `−${entry.quantity}`;
}

/** A dated line at the top of the notes: the shape the Log's note writes. */
const DATED = /^(\d{4})-(\d{2})-(\d{2}): (.+)$/;

/**
 * The flock's notes, split into the dated lines and whatever else is there.
 *
 * A note from this page is a dated line added to the top of `notes`, which
 * is how the Log writes an animal's note — so the field stays one readable
 * block in the flock editor and each line is still a dated event here.
 * Lines without a date are left for the details, where they always were.
 */
export function splitNotes(notes: string | undefined): {
  dated: { date: Date; text: string; index: number }[];
  rest: string;
} {
  const dated: { date: Date; text: string; index: number }[] = [];
  const rest: string[] = [];
  (notes ?? "").split("\n").forEach((line, index) => {
    const match = DATED.exec(line.trim());
    if (match === null) {
      if (line.trim() !== "") rest.push(line);
      return;
    }
    const [, year, month, day, text] = match;
    // Midday, as every date-only value here is stored.
    dated.push({ date: new Date(`${year}-${month}-${day}T12:00:00`), text: text ?? "", index });
  });
  return { dated, rest: rest.join("\n") };
}

/** `notes` with one more dated line on top, or undefined when it would not fit. */
export function withNote(
  notes: string | undefined,
  text: string,
  day: string,
  limit = 2000,
): string | undefined {
  const entry = `${day}: ${text.replace(/\s*\n\s*/g, " ").trim()}`;
  const next = notes === undefined || notes.trim() === "" ? entry : `${entry}\n${notes}`;
  return next.length > limit ? undefined : next;
}

/** How many days the coming-up list looks ahead. */
const AHEAD_DAYS = 14;

/**
 * The chores at this flock's coop, by when each next falls due.
 *
 * A flock has no due dates of its own — no withdrawal, no calving — so what
 * is ahead of it is the work somebody has put on the coop: the waterer, the
 * bedding, the monthly clean. Read from the chore templates, so a chore edited
 * on the chores screen moves here too.
 */
export function comingUp(input: FlockInputs): FlockRow[] {
  const { flock, now } = input;
  if (flock.zoneId === undefined || !flock.active) return [];

  const rows: FlockRow[] = [];
  for (const chore of input.chores) {
    if (!chore.active || chore.zoneId !== flock.zoneId) continue;
    const next = occurrencesInWindow(chore, startOfDay(now), AHEAD_DAYS)[0];
    if (next === undefined) continue;
    const today = dayKey(next) === dayKey(now);
    rows.push({
      key: `chore:${chore.id}`,
      date: next,
      title: chore.title,
      line: facts(
        today ? "Today" : formatDate(next),
        chore.timeOfDay === undefined ? undefined : TIME_OF_DAY_LABELS[chore.timeOfDay],
        describeRecurrence(chore),
      ),
      chip: today ? { tone: "action", label: "Today" } : undefined,
    });
  }
  return rows.sort((left, right) => left.date.getTime() - right.date.getTime());
}

/** Everything on file about the flock, newest first. */
export function history(input: FlockInputs): FlockRow[] {
  const { flock } = input;
  const rows: FlockRow[] = [];

  for (const entry of input.adjustments) {
    if (entry.flockId !== flock.id) continue;
    rows.push({
      key: `adjustment:${entry.id}`,
      date: entry.occurredOn,
      title: `${signed(entry)} ${REASON_LABEL[entry.reason]}`,
      line: facts(formatDate(entry.occurredOn), "headcount"),
      notes: entry.notes,
      direction: ADJUSTMENT_DIRECTION[entry.reason],
      chip: entry.reason === "predator" ? { tone: "danger", label: "Predator" } : undefined,
    });
  }

  for (const log of input.eggLogs) {
    if (log.flockId !== flock.id) continue;
    rows.push({
      key: `eggs:${log.id}`,
      date: log.collectedOn,
      title: `${log.total} egg${log.total === 1 ? "" : "s"} collected`,
      line: facts(
        formatDate(log.collectedOn),
        log.breakdown.length === 0 ? undefined : "with a breakdown",
      ),
      notes: log.notes,
    });
  }

  for (const note of splitNotes(flock.notes).dated) {
    rows.push({
      key: `note:${note.index}`,
      date: note.date,
      title: "Note",
      line: formatDate(note.date),
      notes: note.text,
    });
  }

  // Where the count started, so the history adds up to the number at the top.
  rows.push({
    key: "opened",
    date: flock.createdAt,
    title: `Started with ${flock.openingCount} bird${flock.openingCount === 1 ? "" : "s"}`,
    line: formatDate(flock.createdAt),
  });

  // Same day: the newer record first, which is the later id.
  return rows.sort(
    (left, right) =>
      right.date.getTime() - left.date.getTime() || right.key.localeCompare(left.key),
  );
}

/** How many days the egg figure covers, today included. */
export const TREND_DAYS = 7;

export interface EggTrend {
  /** Oldest first, one per day, zero where nothing was logged. */
  readonly days: readonly { readonly key: string; readonly date: Date; readonly total: number }[];
  readonly total: number;
  readonly today: number;
  /** Eggs per bird a day over the window, when there are birds to divide by. */
  readonly rate: number | undefined;
  readonly headCount: number;
}

/**
 * The last week of eggs from this flock, by day.
 *
 * Whole days ending tonight: a collection is stored at midday, so a window
 * ending at this instant would leave this morning's basket out of it.
 */
export function eggTrend(input: Omit<FlockInputs, "chores">): EggTrend {
  const to = endOfDay(input.now);
  const from = startOfDay(addCalendarDays(to, -(TREND_DAYS - 1)));
  const mine = input.eggLogs.filter(
    (log) => log.flockId === input.flock.id && log.collectedOn >= from && log.collectedOn <= to,
  );

  const byDay = new Map<string, number>();
  for (const log of mine) {
    const key = dayKey(log.collectedOn);
    byDay.set(key, (byDay.get(key) ?? 0) + log.total);
  }

  const days = Array.from({ length: TREND_DAYS }, (_, offset) => {
    const date = addCalendarDays(from, offset);
    const key = dayKey(date);
    return { key, date, total: byDay.get(key) ?? 0 };
  });

  const headCount = headCountOn(input.flock, input.adjustments, to);
  return {
    days,
    total: days.reduce((sum, day) => sum + day.total, 0),
    today: days[days.length - 1]?.total ?? 0,
    rate: layRate(mine, headCount, { from, to }),
    headCount,
  };
}
