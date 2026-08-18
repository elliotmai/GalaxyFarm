import { describe, expect, it } from "vitest";

import { projectEvents, type Ulid } from "@galaxy-farm/core";

import { gardenCalendarEntries } from "../src/domain/calendar.js";
import type { PlannedPlanting } from "../src/domain/season-plan.js";

/**
 * The garden's half of the unified calendar (spec §6, §5.5).
 *
 * §5.5 confines alerts to "what's *in the plan*, not the whole seed catalog",
 * and these rows follow the same rule. The other thing worth defending is the
 * shape: a planting window is a fortnight, so it carries an `endAt` and shows
 * on every view its span touches rather than only the one it opens in.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-01-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const planned = (over: Partial<PlannedPlanting> = {}): PlannedPlanting => ({
  ...base,
  id: id(1),
  seasonPlanId: id(2),
  varietyId: id(3),
  method: "direct_sow",
  windowFrom: new Date("2026-03-25T00:00:00Z"),
  windowTo: new Date("2026-04-08T00:00:00Z"),
  planStatus: "open",
  ...over,
});

const varieties = new Map<Ulid, string>([[id(3), "Blue Lake beans"]]);

describe("gardenCalendarEntries", () => {
  it("projects an open plan as a window, not an instant", () => {
    const entries = gardenCalendarEntries({ planned: [planned()], varietyNames: varieties });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("planting_window");
    expect(entries[0]?.title).toBe("Direct sow Blue Lake beans");
    expect(entries[0]?.at).toEqual(new Date("2026-03-25T00:00:00Z"));
    expect(entries[0]?.endAt).toEqual(new Date("2026-04-08T00:00:00Z"));
  });

  it("is idempotent and moves the row when the window is corrected", () => {
    const before = gardenCalendarEntries({ planned: [planned()] });
    expect(gardenCalendarEntries({ planned: [planned()] })).toEqual(before);

    const after = gardenCalendarEntries({
      planned: [planned({ windowFrom: new Date("2026-04-01T00:00:00Z") })],
    });

    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.at).toEqual(new Date("2026-04-01T00:00:00Z"));
  });

  it("drops a plan already in the ground or given up on", () => {
    const entries = gardenCalendarEntries({
      planned: [
        planned({ id: id(4), planStatus: "realised", realisedAs: id(9) }),
        planned({ id: id(5), planStatus: "abandoned", abandonedReason: "Seed never arrived" }),
      ],
    });

    expect(entries).toEqual([]);
  });

  it("still names the method when the variety is not to hand", () => {
    const entries = gardenCalendarEntries({ planned: [planned({ method: "indoor_start" })] });
    expect(entries[0]?.title).toBe("Start indoors — planting window");
  });

  it("shows in April for a window that opened in March", () => {
    // The reason the row carries an `endAt` at all: a fortnight that straddles
    // the month boundary belongs to both months, and `projectEvents` is
    // careful about exactly this.
    const entries = gardenCalendarEntries({ planned: [planned()] });
    const april = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-04-01T00:00:00Z"), to: new Date("2026-05-01T00:00:00Z") },
      ["garden"],
    );

    expect(april).toHaveLength(1);
  });
});
