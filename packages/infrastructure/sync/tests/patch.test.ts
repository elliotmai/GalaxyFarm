import { describe, expect, it } from "vitest";

import { applyPatch, diff, isEqual, type Patch } from "../src/patch.js";

const meta = { at: new Date("2026-05-01T10:00:00Z"), deviceId: "barn-kiosk" };

describe("diff", () => {
  it("reports only the fields that actually changed", () => {
    const changes = diff({ name: "Dolly", count: 1 }, { name: "Dolly", count: 2 }, meta);

    expect(changes.map((c) => c.field)).toEqual(["count"]);
  });

  it("produces nothing when a form is opened and saved unchanged", () => {
    // An empty patch should not exist at all — otherwise every idle save
    // becomes an outbox entry and a spurious conflict candidate.
    expect(diff({ name: "Dolly" }, { name: "Dolly" }, meta)).toEqual([]);
  });

  it("never emits identity or provenance fields", () => {
    const changes = diff(
      { id: "A", propertyId: "P", createdAt: new Date(0), name: "old" },
      { id: "B", propertyId: "Q", createdAt: new Date(1), name: "new" },
      meta,
    );

    expect(changes.map((c) => c.field)).toEqual(["name"]);
  });

  it("stamps each change with when and where it happened", () => {
    const [change] = diff({ count: 1 }, { count: 2 }, meta);

    expect(change?.at).toEqual(meta.at);
    expect(change?.deviceId).toBe("barn-kiosk");
  });

  it("treats a field going undefined as a change", () => {
    expect(diff({ notes: "watch her" }, { notes: undefined }, meta)).toHaveLength(1);
  });
});

describe("applyPatch", () => {
  const patch = (field: string, value: unknown): Patch => ({
    entity: "Animal",
    recordId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" as never,
    changes: [{ field, value, ...meta }],
  });

  it("applies a change", () => {
    expect(applyPatch({ name: "old" }, patch("name", "new"))).toEqual({ name: "new" });
  });

  it("leaves untouched fields alone", () => {
    expect(applyPatch({ name: "Dolly", count: 3 }, patch("count", 4))).toEqual({
      name: "Dolly",
      count: 4,
    });
  });

  it("refuses a patch that tries to rewrite identity", () => {
    const record = { id: "keep", name: "Dolly" };

    expect(applyPatch(record, patch("id", "hijacked"))).toEqual(record);
  });

  it("does not mutate the input", () => {
    const record = { name: "old" };
    applyPatch(record, patch("name", "new"));

    expect(record.name).toBe("old");
  });
});

describe("isEqual", () => {
  it.each([
    [1, 1],
    ["a", "a"],
    [null, null],
    [undefined, undefined],
    [true, true],
  ])("treats identical primitives as equal (%s)", (left, right) => {
    expect(isEqual(left, right)).toBe(true);
  });

  it("compares dates by value, not identity", () => {
    // Dates cross the wire as strings and come back as new objects; comparing
    // by reference would make every sync look like a change.
    expect(isEqual(new Date("2026-01-01"), new Date("2026-01-01"))).toBe(true);
    expect(isEqual(new Date("2026-01-01"), new Date("2026-01-02"))).toBe(false);
  });

  it("compares arrays element-wise", () => {
    expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isEqual(["a"], ["b"])).toBe(false);
  });

  it("compares plain objects structurally", () => {
    expect(isEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("does not confuse an array with an object", () => {
    expect(isEqual([], {})).toBe(false);
  });

  it("handles null against an object without throwing", () => {
    expect(isEqual(null, { a: 1 })).toBe(false);
    expect(isEqual({ a: 1 }, null)).toBe(false);
    expect(isEqual(undefined, {})).toBe(false);
  });
});
