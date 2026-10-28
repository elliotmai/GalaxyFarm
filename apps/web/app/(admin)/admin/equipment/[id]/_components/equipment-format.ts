import type { MaintenanceDue } from "@galaxy-farm/module-equipment";

/**
 * The small formatting rules one machine's page is written in.
 *
 * Shared by the screen, its ledgers and its forms, so a reading says "1,234.5"
 * in the list, the panel and the delete confirmation alike.
 */

export function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Hours read to a tenth; miles do not. */
export function num(value: number | undefined, decimals = 0): string {
  return value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A date input's value is a day; the record wants an instant inside it. */
export function atNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

export function errorMessage(error: {
  kind: string;
  issues?: readonly { message: string }[];
}): string {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

/** What a rule is waiting on, in the words the rule was written in. */
export function describeDue(entry: MaintenanceDue): string {
  return entry.reason === "months"
    ? `due ${formatDate(entry.dueAt)}`
    : entry.reason === "hours"
      ? `at ${num(entry.dueAtHours, 1)} hrs`
      : `at ${num(entry.dueAtMiles)} mi`;
}

/** "1,204.5 hrs · 31,200 mi", or undefined when neither was written down. */
export function meterAt(hours: number | undefined, miles: number | undefined): string | undefined {
  const parts = [
    hours === undefined ? undefined : `${num(hours, 1)} hrs`,
    miles === undefined ? undefined : `${num(miles)} mi`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** Joins the parts of a row's muted line, skipping the ones that are not there. */
export function line(...parts: readonly (string | undefined | false)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}
