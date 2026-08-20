/**
 * Reading a `<input type="date">` (spec §4.2).
 *
 * The control hands over `2026-02-14` and nothing else — no time, no zone —
 * and `new Date("2026-02-14")` reads that as **midnight UTC**, because the
 * language says a bare date string is UTC. Every screen then renders it with
 * `toLocaleDateString`, which is local. West of Greenwich those two disagree
 * by a day: midnight UTC on the 14th is six in the evening on the 13th in
 * Iowa, so a cow bred on Valentine's Day was logged, projected and displayed
 * as bred on the 13th. Her due date, her calving window and her preg-check
 * reminder were all a day early with her.
 *
 * Midday local is the reading that survives. It is the same calendar day in
 * every timezone on earth, it stays that day across both daylight-saving
 * changes, and it is what the rest of the app already did — the calving,
 * health, weight and sales screens all wrote `T12:00:00` by hand. This is
 * that, in one place, so a screen cannot get it wrong by not knowing.
 */

/** Midday local on the day the field names. */
export function fromDateInput(value: string): Date | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Not `new Date(trimmed + "T12:00:00")` on its own: an unparseable field
  // would yield an Invalid Date, which every downstream projection happily
  // turns into NaN and renders as an empty cell rather than an error.
  const parsed = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The other direction: a stored day, as the field wants it. */
export function toDateInput(value: Date | undefined): string {
  if (value === undefined || Number.isNaN(value.getTime())) return "";

  // Built from the local parts rather than `toISOString().slice(0, 10)`, which
  // is UTC and would hand back the previous day for anything before the zone's
  // offset — the same bug in the opposite direction.
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, as the field wants it. What every date field on the farm opens at. */
export function todayInput(now: Date = new Date()): string {
  return toDateInput(now);
}
