import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SEARCHABLE_FIELDS } from "../src/repositories/index.js";
import { allTables } from "../src/schema/index.js";

/**
 * The registry, checked against the schema.
 *
 * "Search finds nothing" is a bug nobody reports — they assume the record is
 * not there and enter it a second time. These tests make the omission a build
 * failure instead.
 */
describe("SEARCHABLE_FIELDS", () => {
  const registered = Object.keys(SEARCHABLE_FIELDS);

  it("covers every table that is a repository", () => {
    // syncAudit is append-only and on the §4.5 exception list, so it is not a
    // Repository at all. Everything else must appear, even if the answer is
    // "nothing here is worth searching" — that is a decision, not a default.
    const expected = Object.keys(allTables).filter((name) => name !== "syncAudit");

    expect(registered.sort()).toEqual(expected.sort());
  });

  it("names only columns that exist, and only text ones", () => {
    // A typo'd field name would silently narrow search to whatever remains.
    for (const [table, fields] of Object.entries(SEARCHABLE_FIELDS)) {
      const columns = getTableColumns(allTables[table as keyof typeof allTables]);
      for (const field of fields as readonly string[]) {
        const column = (columns as Record<string, { dataType: string } | undefined>)[field];
        expect(column, `${table}.${field} is not a column`).toBeDefined();
        expect(column?.dataType, `${table}.${field} is not text`).toBe("string");
      }
    }
  });

  it("gives every entity a person would look up by name something to search", () => {
    // Assignments are reached through the animal or the zone. Everything else
    // has a name, title, or filename someone will type into a search box.
    const searchableByDesign = registered.filter((name) => name !== "zoneAssignments");

    for (const name of searchableByDesign) {
      const fields = SEARCHABLE_FIELDS[name as keyof typeof SEARCHABLE_FIELDS];
      expect(fields.length, `${name} has nothing searchable`).toBeGreaterThan(0);
    }
  });
});
