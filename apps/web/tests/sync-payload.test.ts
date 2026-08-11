import { describe, expect, it } from "vitest";

import { reviveCursors, reviveDate, reviveOutboxEntries } from "../lib/sync-payload.js";

/**
 * Reading a sync payload off the wire (spec §4.2, §4.5 clause 2).
 *
 * The bug this file exists to prevent has no error attached to it. Every
 * timestamp arrives from JSON as a string; the merge compares them with
 * `getTime()`; a string produces `NaN`; every comparison with `NaN` is false;
 * and the incoming write silently loses. Nothing throws, nothing is logged,
 * and someone's note about a limping heifer is simply not there later.
 */

const CHANGE = {
  field: "notes",
  value: "Limping, left hind",
  at: "2026-11-15T08:00:00.000Z",
  deviceId: "phone",
};

const ENTRY = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
  operation: "update",
  patch: { entity: "animals", recordId: "01ARZ3NDEKTSV4RRFFQ69G5FA1", changes: [CHANGE] },
  queuedAt: "2026-11-15T08:00:00.000Z",
  deviceId: "phone",
  attempts: 0,
};

describe("reviveDate", () => {
  it("turns the wire format back into a Date", () => {
    expect(reviveDate("2026-11-15T08:00:00.000Z", "at")).toEqual(
      new Date("2026-11-15T08:00:00.000Z"),
    );
  });

  it("refuses anything that would quietly become NaN", () => {
    // `new Date("yesterday")` is not an error, it is an Invalid Date, and an
    // Invalid Date loses every comparison it takes part in.
    for (const bad of ["yesterday", "", "2026-13-45", null, 17, {}]) {
      expect(() => reviveDate(bad, "at"), String(bad)).toThrow(/not a date/);
    }
  });

  it("passes a Date through untouched", () => {
    const at = new Date("2026-11-15T08:00:00.000Z");
    expect(reviveDate(at, "at")).toBe(at);
  });
});

describe("reviveOutboxEntries", () => {
  it("revives a well-formed push", () => {
    const [entry] = reviveOutboxEntries({ entries: [ENTRY] });

    expect(entry?.patch.entity).toBe("animals");
    expect(entry?.queuedAt).toBeInstanceOf(Date);
    expect(entry?.patch.changes[0]?.at).toBeInstanceOf(Date);
    expect(entry?.patch.changes[0]?.value).toBe("Limping, left hind");
  });

  it("accepts an empty push", () => {
    expect(reviveOutboxEntries({ entries: [] })).toEqual([]);
  });

  it("leaves the field's value alone, whatever shape it is", () => {
    // The value is the field's business — the entity's own schema decides what
    // is valid there. What this boundary guarantees is that the *metadata* the
    // merge runs on is real.
    const entries = reviveOutboxEntries({
      entries: [
        {
          ...ENTRY,
          patch: {
            ...ENTRY.patch,
            changes: [{ ...CHANGE, field: "photoKeys", value: ["a", "b"] }],
          },
        },
      ],
    });

    expect(entries[0]?.patch.changes[0]?.value).toEqual(["a", "b"]);
  });

  it("keeps an explicitly cleared field, rather than dropping it", () => {
    // Clearing a value is a real edit. A reviver that discarded undefined
    // would turn "remove this note" into "leave the note alone".
    const entries = reviveOutboxEntries({
      entries: [{ ...ENTRY, patch: { ...ENTRY.patch, changes: [{ ...CHANGE, value: null }] } }],
    });

    expect(entries[0]?.patch.changes[0]).toHaveProperty("value", null);
  });

  it("rejects a body that is not shaped like a push", () => {
    for (const bad of [null, [], "entries", { entries: {} }, {}]) {
      expect(() => reviveOutboxEntries(bad), JSON.stringify(bad)).toThrow(/Malformed/);
    }
  });

  it("rejects an entry missing the metadata the merge needs", () => {
    const { queuedAt, ...withoutQueuedAt } = ENTRY;
    void queuedAt;

    expect(() => reviveOutboxEntries({ entries: [withoutQueuedAt] })).toThrow(/queuedAt/);
    expect(() =>
      reviveOutboxEntries({
        entries: [{ ...ENTRY, patch: { ...ENTRY.patch, changes: [{ ...CHANGE, at: "soon" }] } }],
      }),
    ).toThrow(/changes\[0\]\.at/);
  });

  it("names which entry and which field failed", () => {
    // A push of two hundred entries with "malformed payload" and no index is
    // a bug report nobody can act on.
    expect(() =>
      reviveOutboxEntries({
        entries: [ENTRY, { ...ENTRY, patch: { ...ENTRY.patch, changes: [{ ...CHANGE, at: 5 }] } }],
      }),
    ).toThrow(/changes\[0\]\.at/);
  });

  it("rejects an operation it does not recognise", () => {
    expect(() => reviveOutboxEntries({ entries: [{ ...ENTRY, operation: "drop" }] })).toThrow(
      /operation/,
    );
  });

  it("refuses a push large enough to hold the connection open all day", () => {
    const entries = Array.from({ length: 1_001 }, () => ENTRY);

    expect(() => reviveOutboxEntries({ entries })).toThrow(/too many/);
  });
});

describe("reviveCursors", () => {
  it("treats a missing cursor set as a first sync", () => {
    expect(reviveCursors(undefined)).toEqual({});
    expect(reviveCursors(null)).toEqual({});
  });

  it("revives each entity's cursor with a real Date", () => {
    const cursors = reviveCursors({
      animals: { updatedAt: "2026-11-15T08:00:00.000Z", lastId: "01ARZ3NDEKTSV4RRFFQ69G5FA1" },
    });

    expect(cursors["animals"]?.updatedAt).toBeInstanceOf(Date);
    expect(cursors["animals"]?.entity).toBe("animals");
  });

  it("takes the entity name from the key, not from the body", () => {
    // A cursor claiming to be for a different entity than the one it is filed
    // under would pull the wrong table's rows.
    const cursors = reviveCursors({
      animals: {
        entity: "users",
        updatedAt: "2026-11-15T08:00:00.000Z",
        lastId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      },
    });

    expect(cursors["animals"]?.entity).toBe("animals");
  });

  it("rejects a cursor with an unusable timestamp", () => {
    // A cursor that became NaN would return either everything or nothing, and
    // both look like a sync bug rather than a bad request.
    expect(() => reviveCursors({ animals: { updatedAt: "never", lastId: "x" } })).toThrow(
      /not a date/,
    );
  });
});
