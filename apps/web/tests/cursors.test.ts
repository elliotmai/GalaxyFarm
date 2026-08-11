import { describe, expect, it } from "vitest";

import { loadCursors, saveCursors } from "../lib/local/cursors.js";

/**
 * Cursors across restarts (spec §4.2).
 *
 * Without them a device re-pulls the whole farm every time the tab is closed.
 * Correct and wasteful on a laptop; on a phone with one bar in a barn it is
 * the difference between a sync that finishes and one that does not.
 */

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

const CURSORS = {
  animals: {
    entity: "animals",
    updatedAt: new Date("2026-11-15T08:00:00.000Z"),
    lastId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  },
};

describe("cursors", () => {
  it("round-trips through storage with real Dates", () => {
    const storage = fakeStorage();
    saveCursors(CURSORS, storage);

    const loaded = loadCursors(storage);

    expect(loaded["animals"]?.updatedAt).toBeInstanceOf(Date);
    expect(loaded["animals"]?.updatedAt.getTime()).toBe(CURSORS.animals.updatedAt.getTime());
    expect(loaded["animals"]?.lastId).toBe(CURSORS.animals.lastId);
  });

  it("starts from scratch when there is nothing stored", () => {
    expect(loadCursors(fakeStorage())).toEqual({});
  });

  it("starts from scratch rather than crashing on corrupt storage", () => {
    // The cost of a bad value is one full pull. The cost of throwing here is
    // an app that will not open.
    expect(loadCursors(fakeStorage({ "galaxy-farm:cursors": "{not json" }))).toEqual({});
  });

  it("drops a cursor whose timestamp cannot be read", () => {
    // An Invalid Date compares false against everything, so the entity would
    // pull nothing forever and nothing would say why. Dropping it costs one
    // re-pull, which is recoverable.
    const storage = fakeStorage({
      "galaxy-farm:cursors": JSON.stringify({
        animals: { updatedAt: "whenever", lastId: "x" },
        zones: { updatedAt: "2026-11-15T08:00:00.000Z", lastId: "y" },
      }),
    });

    const loaded = loadCursors(storage);

    expect(loaded["animals"]).toBeUndefined();
    expect(loaded["zones"]).toBeDefined();
  });

  it("takes the entity name from the key rather than the body", () => {
    const storage = fakeStorage({
      "galaxy-farm:cursors": JSON.stringify({
        animals: { entity: "zones", updatedAt: "2026-11-15T08:00:00.000Z", lastId: "x" },
      }),
    });

    expect(loadCursors(storage)["animals"]?.entity).toBe("animals");
  });

  it("survives a full quota without failing the sync that just succeeded", () => {
    const storage = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as Storage;

    expect(() => saveCursors(CURSORS, storage)).not.toThrow();
  });

  it("copes with no storage at all", () => {
    // Server render, or a browser with storage disabled.
    expect(loadCursors(undefined)).toEqual({});
    expect(() => saveCursors(CURSORS, undefined)).not.toThrow();
  });
});
