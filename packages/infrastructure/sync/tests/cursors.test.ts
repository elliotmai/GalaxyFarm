import { describe, expect, it } from "vitest";

import { advance, cursorFor, isTombstone, since, type CursorSet } from "../src/cursors.js";

const t = (iso: string) => new Date(iso);

const record = (id: string, iso: string) => ({ id, updatedAt: t(iso) });

describe("cursors", () => {
  it("starts empty and pulls everything", () => {
    const records = [record("a", "2026-05-01T10:00:00Z")];

    expect(cursorFor({}, "Animal")).toBeUndefined();
    expect(since(undefined, records)).toEqual(records);
  });

  it("advances past a page", () => {
    const cursors = advance({}, "Animal", [
      record("a", "2026-05-01T10:00:00Z"),
      record("b", "2026-05-01T11:00:00Z"),
    ]);

    expect(cursors["Animal"]?.updatedAt).toEqual(t("2026-05-01T11:00:00Z"));
    expect(cursors["Animal"]?.lastId).toBe("b");
  });

  it("keeps one cursor per entity, so a busy entity cannot starve a quiet one", () => {
    let cursors: CursorSet = advance({}, "Animal", [record("a", "2026-05-01T10:00:00Z")]);
    cursors = advance(cursors, "EggLog", [record("e", "2026-05-02T10:00:00Z")]);

    expect(Object.keys(cursors).sort()).toEqual(["Animal", "EggLog"]);
    expect(cursors["Animal"]?.lastId).toBe("a");
  });

  it("never moves backwards on an out-of-order response", () => {
    // A late page must not rewind the cursor, or the same records are pulled
    // forever.
    const ahead = advance({}, "Animal", [record("z", "2026-05-05T10:00:00Z")]);
    const stale = advance(ahead, "Animal", [record("a", "2026-05-01T10:00:00Z")]);

    expect(stale["Animal"]?.updatedAt).toEqual(t("2026-05-05T10:00:00Z"));
  });

  it("ignores an empty page", () => {
    const cursors = advance({}, "Animal", []);

    expect(cursors).toEqual({});
  });

  it("breaks a same-millisecond tie by id, so nothing is skipped or repeated", () => {
    const sameMs = "2026-05-01T10:00:00Z";
    const cursors = advance({}, "Animal", [
      record("a", sameMs),
      record("c", sameMs),
      record("b", sameMs),
    ]);

    expect(cursors["Animal"]?.lastId).toBe("c");
  });

  it("returns only records strictly newer than the cursor", () => {
    const cursors = advance({}, "Animal", [record("b", "2026-05-01T10:00:00Z")]);
    const cursor = cursorFor(cursors, "Animal");

    const page = [
      record("a", "2026-05-01T10:00:00Z"), // same ms, lower id — already seen
      record("c", "2026-05-01T10:00:00Z"), // same ms, higher id — new
      record("d", "2026-05-01T11:00:00Z"), // later — new
      record("e", "2026-04-01T10:00:00Z"), // older — already seen
    ];

    expect(since(cursor, page).map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("does not re-deliver the exact record the cursor points at", () => {
    const cursors = advance({}, "Animal", [record("b", "2026-05-01T10:00:00Z")]);

    expect(since(cursorFor(cursors, "Animal"), [record("b", "2026-05-01T10:00:00Z")])).toEqual([]);
  });
});

describe("tombstones — a deletion travels as a record, never as an absence", () => {
  it("recognises a tombstone", () => {
    // If a delete were expressed by the record simply not appearing, a device
    // that missed the pull would keep its copy and push it back from the dead.
    expect(isTombstone({ deletedAt: new Date("2026-05-01T10:00:00Z") })).toBe(true);
  });

  it("does not mistake a live record for one", () => {
    expect(isTombstone({ name: "Dolly" })).toBe(false);
    expect(isTombstone({ deletedAt: undefined })).toBe(false);
    expect(isTombstone({ deletedAt: null })).toBe(false);
  });
});
