import { describe, expect, it } from "vitest";

import { choreDaySheet, type Ulid, type Zone } from "@galaxy-farm/core";
import type { Flock, FlockAdjustment } from "@galaxy-farm/module-poultry";

import { isEggCollectionChore } from "../lib/chores.js";
import { eggChoreId, eggChoresFor, isEggChoreKey } from "../lib/egg-chores.js";

/**
 * The egg round, derived from the hens (spec §2, §5.4).
 *
 * "Collect eggs" is on the day's sheet while there are laying birds on the
 * property, and gone the day there are none: no template to write, and none
 * to forget to retire.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const COOP = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;
const THURSDAY = new Date(2026, 0, 15);
const MORNING = new Date(2026, 0, 15, 7, 30);

const base = (n: number) => ({
  id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
});

const flock = (n: number, fields: Partial<Flock> = {}): Flock => ({
  ...base(n),
  name: "Barn hens",
  species: "chicken",
  openingCount: 12,
  active: true,
  ...fields,
});

const adjustment = (n: number, fields: Partial<FlockAdjustment>): FlockAdjustment =>
  ({ ...base(n), quantity: 1, reason: "sold", occurredOn: THURSDAY, ...fields }) as FlockAdjustment;

const coop = { ...base(90), id: COOP, name: "Main coop" } as Zone;

describe("the egg round", () => {
  it("is on the sheet while there are laying birds", () => {
    const [entry, ...rest] = eggChoresFor(
      { flocks: [flock(1, { zoneId: COOP })], adjustments: [], zones: [coop] },
      THURSDAY,
      MORNING,
    );

    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: eggChoreId(THURSDAY),
      title: "Collect eggs",
      detail: "Barn hens, Main coop (12)",
      zoneId: COOP,
      carriedOver: false,
      overdue: false,
    });
    // It is the egg round, so ticking it opens the egg count.
    expect(isEggCollectionChore(entry!)).toBe(true);
    expect(isEggChoreKey(entry!.id)).toBe(true);
  });

  it("is not there with no birds, a retired flock, or the last hen gone", () => {
    expect(eggChoresFor({ flocks: [], adjustments: [] }, THURSDAY, MORNING)).toEqual([]);
    expect(
      eggChoresFor({ flocks: [flock(1, { active: false })], adjustments: [] }, THURSDAY, MORNING),
    ).toEqual([]);

    const soldOut = adjustment(2, { flockId: base(1).id, quantity: 12, reason: "sold" });
    expect(eggChoresFor({ flocks: [flock(1)], adjustments: [soldOut] }, THURSDAY, MORNING)).toEqual(
      [],
    );
  });

  it("follows the headcount as of the day: pullets bought on Friday are not Thursday's", () => {
    const empty = flock(1, { openingCount: 0 });
    const pullets = adjustment(3, {
      flockId: empty.id,
      quantity: 6,
      reason: "added",
      occurredOn: new Date(2026, 0, 16, 10, 0),
    });

    expect(eggChoresFor({ flocks: [empty], adjustments: [pullets] }, THURSDAY, MORNING)).toEqual(
      [],
    );
    expect(
      eggChoresFor(
        { flocks: [empty], adjustments: [pullets] },
        new Date(2026, 0, 16),
        new Date(2026, 0, 16, 12, 0),
      ),
    ).toHaveLength(1);
  });

  it("is one round for the whole property, naming every coop", () => {
    const entries = eggChoresFor(
      {
        flocks: [flock(1, { name: "Barn hens" }), flock(2, { name: "Quail", species: "quail" })],
        adjustments: [],
      },
      THURSDAY,
      MORNING,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toBe("Barn hens (12) · Quail (12)");
    expect(entries[0]?.zoneId).toBeUndefined();
  });

  it("holds open all day, and is gone from the next day once ticked or missed", () => {
    const flocks = [flock(1)];
    const [today] = eggChoresFor({ flocks, adjustments: [] }, THURSDAY, MORNING);
    expect(today?.overdue).toBe(false);

    // Ticked: the row keeps the occurrence's key, so the day shows one line.
    const ticked = {
      ...base(40),
      title: today!.title,
      sourceKey: today!.id,
      dueAt: today!.dueAt,
      completedAt: new Date(2026, 0, 15, 8, 0),
    };
    const sheet = choreDaySheet(
      { tasks: [ticked], templates: [], derived: [today!] },
      THURSDAY,
      MORNING,
    );
    expect(sheet).toHaveLength(1);
    expect(sheet[0]?.taskId).toBe(ticked.id);

    // Friday has its own round and nothing owed from Thursday, done or not.
    const friday = new Date(2026, 0, 16);
    const fridayRound = eggChoresFor({ flocks, adjustments: [] }, friday, friday);
    const putBack = { ...ticked, completedAt: undefined };
    const next = choreDaySheet(
      { tasks: [putBack], templates: [], derived: fridayRound },
      friday,
      friday,
    );
    expect(next.map((entry) => entry.id)).toEqual([eggChoreId(friday)]);
  });
});
