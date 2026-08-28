import { describe, expect, it, vi } from "vitest";

import {
  choreDaySheet,
  type Animal,
  type ChoreEntry,
  type FeedingPlan,
  type FeedingPlanLine,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { toggleChore } from "../lib/chores.js";
import { feedingChoreText, feedingChoresFor } from "../lib/feeding-chores.js";
import type { Mutations } from "../lib/local/mutations.js";

/**
 * Feeding chores, end to end (spec §2, §5.1).
 *
 * The kernel decides which trips a day has; this is the app's half — the
 * sentence somebody reads, and what happens when they tick it. The assertion
 * that matters is the last one: ticking a derived chore has to write a real
 * row carrying `sourceKey`, or the occurrence comes straight back on the next
 * render and the tick reads as having done nothing.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NORTH = "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid;
const COMET = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const HAY = "01ARZ3NDEKTSV4RRFFQ69G5FF1" as Ulid;
const PELLETS = "01ARZ3NDEKTSV4RRFFQ69G5FF2" as Ulid;

const DATE = new Date("2026-09-02T09:00:00");
const NOW = new Date("2026-09-02T09:00:00");

const ZONES = [{ id: NORTH, name: "North Trap" }] as unknown as Zone[];
const ANIMALS = [{ id: COMET, name: "Comet", species: "horse" }] as unknown as Animal[];
const FEEDS = [
  { id: HAY, name: "Coastal hay" },
  { id: PELLETS, name: "Senior pellets" },
] as unknown as FeedType[];

const TEXT = feedingChoreText({
  zones: ZONES,
  animals: ANIMALS,
  feeds: FEEDS,
  propertyId: PROPERTY,
});

let counter = 0;
function plan(fields: Partial<FeedingPlan> & { lines: readonly FeedingPlanLine[] }): FeedingPlan {
  counter += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5FQ${counter}` as Ulid,
    propertyId: PROPERTY,
    createdAt: DATE,
    updatedAt: DATE,
    name: `Plan ${counter}`,
    target: "zone",
    targetId: NORTH,
    alsoFeeds: [],
    portion: "per_head",
    active: true,
    ...fields,
  } as FeedingPlan;
}

const line = (fields: Partial<FeedingPlanLine> = {}): FeedingPlanLine => ({
  feedTypeId: HAY,
  amount: { amount: 40, unit: "lb" },
  frequency: "once_daily",
  timeOfDay: "morning",
  ...fields,
});

describe("wording a trip", () => {
  it("names the pen and everything that goes to it", () => {
    const [entry] = feedingChoresFor(
      [
        plan({
          lines: [line(), line({ feedTypeId: PELLETS, amount: { amount: 3, unit: "scoop" } })],
        }),
      ],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.title).toBe("Morning feed · North Trap");
    expect(entry?.detail).toBe("40 lb Coastal hay · 3 scoop Senior pellets");
  });

  it("names an animal of any species, not just cattle", () => {
    // The whole point of asking "for all different animals": a zone plan feeds
    // whatever stands in the zone, and an animal plan feeds that animal.
    const [entry] = feedingChoresFor(
      [plan({ target: "animal", targetId: COMET, lines: [line()] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.title).toBe("Morning feed · Comet");
  });

  it("says so when an amount is shared rather than per head", () => {
    // One tub in the pen, not one each. Reading it per-head is what puts four
    // tubs out and empties the shed in a quarter of the time.
    const [entry] = feedingChoresFor(
      [plan({ portion: "shared", lines: [line({ amount: { amount: 1, unit: "block" } })] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.detail).toBe("1 block Coastal hay, shared");
  });

  it("spells out a frequency that is not simply once", () => {
    const [entry] = feedingChoresFor(
      [plan({ lines: [line({ frequency: "twice_daily" })] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.detail).toBe("40 lb Coastal hay (twice a day)");
  });

  it("calls a group plan what it is", () => {
    const [entry] = feedingChoresFor(
      [plan({ target: "group", targetId: PROPERTY, lines: [line()] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.title).toBe("Morning feed · everybody");
  });

  it("says something rather than crashing on a feed nobody named", () => {
    const gone = "01ARZ3NDEKTSV4RRFFQ69G5FF9" as Ulid;
    const [entry] = feedingChoresFor(
      [plan({ lines: [line({ feedTypeId: gone })] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(entry?.detail).toBe("40 lb feed");
  });
});

describe("ticking one", () => {
  function recorder() {
    const created: Record<string, unknown>[] = [];
    const api = {
      create: vi.fn(async (input: Record<string, unknown>) => {
        created.push(input);
        return { ok: true as const, value: input as unknown as Task };
      }),
      update: vi.fn(async () => ({ ok: true as const, value: {} as Task })),
      remove: vi.fn(),
      restoreRecord: vi.fn(),
    } as unknown as Mutations<Task>;
    return { api, created };
  }

  const occurrence = (): ChoreEntry =>
    feedingChoresFor([plan({ lines: [line()] })], TEXT, DATE, NOW)[0] as ChoreEntry;

  it("writes a real row, already complete", () => {
    // One patch rather than two: an empty row followed by an update leaves a
    // window in which a crash records a chore that exists and was never done.
    const { api, created } = recorder();
    const entry = occurrence();

    return toggleChore(api, { entry, date: DATE, at: NOW, actorId: ACTOR }).then((result) => {
      expect(result.ok).toBe(true);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        sourceKey: entry.id,
        title: "Morning feed · North Trap",
        detail: "40 lb Coastal hay",
        zoneId: NORTH,
        completedAt: NOW,
        completedBy: ACTOR,
      });
    });
  });

  it("keeps the chore ticked on the next render", async () => {
    // The regression this exists for. Without `sourceKey` the sheet shows the
    // stored row *and* the occurrence, and the tick reads as having bounced.
    const { api, created } = recorder();
    const derived = feedingChoresFor([plan({ lines: [line()] })], TEXT, DATE, NOW);

    await toggleChore(api, {
      entry: derived[0] as ChoreEntry,
      date: DATE,
      at: NOW,
      actorId: ACTOR,
    });

    const stored = {
      ...(created[0] as object),
      id: "01ARZ3NDEKTSV4RRFFQ69G5FT1" as Ulid,
      propertyId: PROPERTY,
      createdAt: NOW,
      updatedAt: NOW,
    } as Task;

    const sheet = choreDaySheet({ tasks: [stored], templates: [], derived }, DATE, NOW);
    const feeding = sheet.filter((entry) => entry.title.startsWith("Morning feed"));

    expect(feeding).toHaveLength(1);
    expect(feeding[0]?.completedAt).toEqual(NOW);
  });

  it("refuses a template occurrence whose template it was not given", () => {
    // Unchanged behaviour, asserted so the new branch cannot swallow it: a
    // template occurrence with no template is a bug, not a feeding chore.
    const { api } = recorder();
    const orphan = {
      ...occurrence(),
      templateId: "01ARZ3NDEKTSV4RRFFQ69G5FC1" as Ulid,
    };

    return toggleChore(api, { entry: orphan, date: DATE, at: NOW, actorId: ACTOR }).then(
      (result) => {
        expect(result.ok).toBe(false);
      },
    );
  });
});

describe("what the sheet does not do", () => {
  it("adds no feeding chore when every plan is switched off", () => {
    const derived = feedingChoresFor([plan({ active: false, lines: [line()] })], TEXT, DATE, NOW);

    expect(choreDaySheet({ tasks: [], templates: [], derived }, DATE, NOW)).toEqual([]);
  });

  it("sends one trip to a pen fed by two plans", () => {
    const derived = feedingChoresFor(
      [plan({ lines: [line()] }), plan({ lines: [line({ feedTypeId: PELLETS })] })],
      TEXT,
      DATE,
      NOW,
    );

    expect(derived).toHaveLength(1);
    expect(derived[0]?.detail).toBe("40 lb Coastal hay · 40 lb Senior pellets");
  });
});
