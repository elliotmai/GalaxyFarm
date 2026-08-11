import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { allTables } from "../src/schema/index.js";
import { SYNCED_ENTITIES, tableFor } from "../src/sync/entities.js";

/**
 * What must never reach a device.
 *
 * Sync copies rows to every device the property has. That is the whole design,
 * and it is also why the list of what does *not* sync deserves a test of its
 * own rather than a comment: a table added to the schema is synced by default,
 * and the day someone adds one holding a secret, nothing else in the suite
 * would notice.
 *
 * The concrete failure: a phone lost in a feed store with an IndexedDB copy of
 * every password hash on the property.
 */

/** Columns whose name alone says they must not leave the server. */
const SECRET = /(password|token|secret|credential)/i;

describe("nothing secret is synced", () => {
  it("keeps credential tables off the wire", () => {
    expect(SYNCED_ENTITIES).not.toContain("users");
    expect(SYNCED_ENTITIES).not.toContain("kioskDevices");
  });

  it("refuses to resolve a patch naming one", () => {
    // Not just absent from the pull list — unaddressable. A push naming
    // `users` must be rejected as an unknown entity, not applied.
    expect(tableFor("users")).toBeUndefined();
    expect(tableFor("kioskDevices")).toBeUndefined();
  });

  it("keeps the two bookkeeping tables off it too", () => {
    // A patch naming either would be a device writing its own audit trail.
    expect(SYNCED_ENTITIES).not.toContain("syncAudit");
    expect(SYNCED_ENTITIES).not.toContain("syncFieldMeta");
  });

  it("has no secret-shaped column anywhere in what does sync", () => {
    // The backstop. Adding a table with a `*_token` column and forgetting to
    // exclude it fails here rather than in a lost-phone incident.
    const offenders: string[] = [];

    for (const entity of SYNCED_ENTITIES) {
      const table = allTables[entity as keyof typeof allTables];
      for (const [name, column] of Object.entries(getTableColumns(table))) {
        if (SECRET.test(name) || SECRET.test((column as { name: string }).name)) {
          offenders.push(`${getTableName(table)}.${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does sync the things a device actually needs", () => {
    // The exclusions must not have quietly taken the app with them.
    for (const entity of ["animals", "zones", "tasks", "waterSources", "zoneAssignments"]) {
      expect(SYNCED_ENTITIES, entity).toContain(entity);
    }
  });
});
