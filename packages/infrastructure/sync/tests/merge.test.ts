import { describe, expect, it } from "vitest";

import { changesToState, initialState, materialise, mergePatch, winner } from "../src/merge.js";
import type { Patch } from "../src/patch.js";

/**
 * Field-level last-write-wins (spec §4.2).
 *
 * The scenario throughout: the same cow edited from the house and from a barn
 * kiosk while the barn had no signal.
 */

const recordId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as never;
const t = (iso: string) => new Date(iso);

const patch = (changes: Patch["changes"]): Patch => ({
  entity: "Animal",
  recordId,
  changes,
});

const resolvedAt = t("2026-05-01T12:00:00Z");

describe("winner", () => {
  it("prefers the later write", () => {
    const early = { value: "a", at: t("2026-05-01T10:00:00Z"), deviceId: "house" };
    const late = { value: "b", at: t("2026-05-01T11:00:00Z"), deviceId: "barn" };

    expect(winner(early, late).value).toBe("b");
    expect(winner(late, early).value).toBe("b");
  });

  it("breaks an exact tie deterministically, not arbitrarily", () => {
    // Every device must reach the same answer without talking to the others,
    // so the tiebreak has to be a total order on something both can see.
    const at = t("2026-05-01T10:00:00Z");
    const house = { value: "h", at, deviceId: "house" };
    const barn = { value: "b", at, deviceId: "barn" };

    expect(winner(house, barn)).toEqual(winner(barn, house));
    expect(winner(house, barn).deviceId).toBe("house");
  });
});

describe("mergePatch", () => {
  it("keeps both edits when two devices change different fields", () => {
    // This is the whole reason the unit of sync is a field, not a record.
    const current = initialState(
      { name: "Dolly", notes: "quiet" },
      { at: t("2026-05-01T09:00:00Z"), deviceId: "house" },
    );

    const fromBarn = patch([
      {
        field: "notes",
        value: "protective with calf",
        at: t("2026-05-01T10:00:00Z"),
        deviceId: "barn",
      },
    ]);
    const fromHouse = patch([
      { field: "name", value: "Dolly II", at: t("2026-05-01T10:30:00Z"), deviceId: "house" },
    ]);

    const first = mergePatch(current, fromBarn, resolvedAt);
    const second = mergePatch(first.state, fromHouse, resolvedAt);

    expect(materialise(second.state)).toEqual({
      name: "Dolly II",
      notes: "protective with calf",
    });

    // Neither device's edit was discarded. The audit holds the values they
    // superseded, which is what makes any of this recoverable.
    expect(first.audit.map((a) => a.loser.value)).toEqual(["quiet"]);
    expect(second.audit.map((a) => a.loser.value)).toEqual(["Dolly"]);
  });

  it("resolves a same-field conflict and records the losing write", () => {
    // A rare conflict must be recoverable, not silent (§4.2).
    const current = changesToState([
      { field: "safetyLevel", value: 2, at: t("2026-05-01T10:00:00Z"), deviceId: "house" },
    ]);
    const incoming = patch([
      { field: "safetyLevel", value: 4, at: t("2026-05-01T11:00:00Z"), deviceId: "barn" },
    ]);

    const result = mergePatch(current, incoming, resolvedAt);

    expect(materialise(result.state)["safetyLevel"]).toBe(4);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]?.loser.value).toBe(2);
    expect(result.audit[0]?.winner.value).toBe(4);
    expect(result.audit[0]?.field).toBe("safetyLevel");
  });

  it("records the loser even when the incoming write is the one rejected", () => {
    // A late-arriving stale edit still deserves a trail — that is exactly the
    // write someone will come looking for.
    const current = changesToState([
      { field: "safetyLevel", value: 4, at: t("2026-05-01T11:00:00Z"), deviceId: "house" },
    ]);
    const stale = patch([
      { field: "safetyLevel", value: 1, at: t("2026-05-01T09:00:00Z"), deviceId: "barn" },
    ]);

    const result = mergePatch(current, stale, resolvedAt);

    expect(materialise(result.state)["safetyLevel"]).toBe(4);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]?.loser.value).toBe(1);
  });

  it("logs nothing when a field is written with the value it already had", () => {
    // Agreement is not a conflict, and logging it would bury the real ones.
    const current = changesToState([
      { field: "status", value: "active", at: t("2026-05-01T10:00:00Z"), deviceId: "house" },
    ]);
    const agreeing = patch([
      { field: "status", value: "active", at: t("2026-05-01T11:00:00Z"), deviceId: "barn" },
    ]);

    expect(mergePatch(current, agreeing, resolvedAt).audit).toEqual([]);
  });

  it("accepts a field it has never seen without calling it a conflict", () => {
    const result = mergePatch(
      {},
      patch([{ field: "notes", value: "new", at: t("2026-05-01T10:00:00Z"), deviceId: "barn" }]),
      resolvedAt,
    );

    expect(materialise(result.state)).toEqual({ notes: "new" });
    expect(result.audit).toEqual([]);
  });

  it("converges regardless of the order patches arrive in", () => {
    // Two devices that receive the same patches in opposite orders must end up
    // identical, or the farm ends up with two different truths.
    const base = changesToState([
      { field: "notes", value: "base", at: t("2026-05-01T08:00:00Z"), deviceId: "house" },
    ]);
    const a = patch([
      { field: "notes", value: "A", at: t("2026-05-01T10:00:00Z"), deviceId: "house" },
    ]);
    const b = patch([
      { field: "notes", value: "B", at: t("2026-05-01T11:00:00Z"), deviceId: "barn" },
    ]);

    const forwards = mergePatch(mergePatch(base, a, resolvedAt).state, b, resolvedAt);
    const backwards = mergePatch(mergePatch(base, b, resolvedAt).state, a, resolvedAt);

    expect(materialise(forwards.state)).toEqual(materialise(backwards.state));
  });

  it("survives clock skew without corrupting the record", () => {
    // A kiosk whose clock is an hour fast wins more often than it should, but
    // the result is still one coherent value on every device — not a mangle.
    const current = changesToState([
      { field: "notes", value: "correct", at: t("2026-05-01T10:00:00Z"), deviceId: "house" },
    ]);
    const skewed = patch([
      {
        field: "notes",
        value: "from a fast clock",
        at: t("2026-05-01T11:00:00Z"),
        deviceId: "barn",
      },
    ]);

    const result = mergePatch(current, skewed, resolvedAt);

    expect(materialise(result.state)["notes"]).toBe("from a fast clock");
    expect(result.audit[0]?.loser.value).toBe("correct");
  });

  it("does not mutate the state it was given", () => {
    const current = changesToState([
      { field: "notes", value: "original", at: t("2026-05-01T10:00:00Z"), deviceId: "house" },
    ]);
    mergePatch(
      current,
      patch([
        { field: "notes", value: "changed", at: t("2026-05-01T11:00:00Z"), deviceId: "barn" },
      ]),
      resolvedAt,
    );

    expect(materialise(current)["notes"]).toBe("original");
  });

  it("applies every change in a multi-field patch", () => {
    const result = mergePatch(
      {},
      patch([
        { field: "name", value: "Dolly", at: t("2026-05-01T10:00:00Z"), deviceId: "barn" },
        { field: "notes", value: "quiet", at: t("2026-05-01T10:00:00Z"), deviceId: "barn" },
      ]),
      resolvedAt,
    );

    expect(materialise(result.state)).toEqual({ name: "Dolly", notes: "quiet" });
  });
});
