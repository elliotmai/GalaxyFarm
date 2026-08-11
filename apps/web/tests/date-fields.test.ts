import { describe, expect, it } from "vitest";

import { allTables, dateFieldsOf } from "@galaxy-farm/infra-db";
import type { RecordTable } from "@galaxy-farm/infra-db";

import { isDateField } from "../lib/local/transport.js";

/**
 * Every timestamp column is recognised as one on the way back down (§4.2).
 *
 * A `Date` crosses the wire as a string in both directions, and each end has
 * to turn it back. The **push** side asks the schema, which cannot be wrong.
 * The **pull** side runs in the browser and cannot import drizzle, so it goes
 * by field name — and a name convention is only as good as the last column
 * somebody added.
 *
 * It was not good. `transport.ts` asserted that "every timestamp column in
 * Postgres is `*_at` or `*Date`", and the schema has `date`, `dob`,
 * `performed_on`, `period_from` and `period_to`. On the push side that threw
 * `value.toISOString is not a function` and rejected the entry on every
 * retry — the outbox grew and nothing ever left the device. On the pull side
 * the same gap is quieter and worse: a timestamp stays a string, every
 * comparison against it is NaN, and a cow silently drops out of her own
 * calving window.
 *
 * So the convention is checked against the schema rather than trusted. Adding
 * a timestamp column named in a way `isDateField` does not match fails this
 * test, and the fix is either the column name or the predicate — but never
 * neither.
 */

describe("the client's date-field convention agrees with the schema", () => {
  const tables = Object.entries(allTables) as [string, RecordTable][];

  it.each(tables)("%s", (name, table) => {
    const missed = [...dateFieldsOf(table)].filter((field) => !isDateField(field));

    expect(
      missed,
      `${name} has timestamp columns the client would leave as strings: ${missed.join(", ")}`,
    ).toEqual([]);
  });

  it("finds the timestamps it is supposed to be checking", () => {
    // A guard on the guard: if `dateFieldsOf` ever returned nothing, every
    // case above would pass while checking nothing at all.
    expect(dateFieldsOf(allTables.animals).size).toBeGreaterThan(0);
    expect(dateFieldsOf(allTables.animals)).toContain("dob");
  });
});
