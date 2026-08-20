import { describe, expect, it } from "vitest";

import { projectEvents, type Animal, type PurchaseCandidate, type Ulid } from "@galaxy-farm/core";

import { cattleCalendarEntries } from "../src/domain/calendar.js";
import type { BreedingRecord } from "../src/domain/breeding-record.js";
import type { CalvingWatchCard } from "../src/domain/calving-watch.js";
import type { HealthRecord } from "../src/domain/health-record.js";
import type { MedInventory } from "../src/domain/med-inventory.js";
import { CO_SYNCH_CIDR_7_DAY, type SyncProtocol } from "../src/domain/sync-protocol.js";

/**
 * Cattle's half of the unified calendar (spec §6).
 *
 * The two properties worth defending hardest are the ones §4.5 and issue #20
 * name. Re-projecting the same records twice produces the same rows with the
 * same ids — otherwise "I've seen that" is unrememberable and every recompute
 * renumbers the screen. And correcting a source record moves its rows: fix a
 * breeding date and the calving window, the preg check, and every step of the
 * protocol that bred her move with it, because there is no stored copy of any
 * of them to be left behind.
 *
 * The dates are the farm's real ones — Andromeda, bred 14 February 2026.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const BRED_ON = new Date("2026-02-14T00:00:00Z");

const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const andromeda: Pick<Animal, "id" | "name" | "tagNumber"> = { id: id(2), name: "Andromeda" };

const breeding = (over: Partial<BreedingRecord> = {}): BreedingRecord => ({
  ...base,
  id: id(1),
  damId: id(2),
  method: "AI",
  sireExternalId: id(3),
  date: BRED_ON,
  ...over,
});

const protocol = (over: Partial<SyncProtocol> = {}): SyncProtocol => ({
  ...base,
  id: id(4),
  name: "7-day CO-Synch + CIDR",
  steps: CO_SYNCH_CIDR_7_DAY,
  active: true,
  ...over,
});

const health = (over: Partial<HealthRecord> = {}): HealthRecord => ({
  ...base,
  id: id(5),
  animalId: id(2),
  type: "treatment",
  date: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const med = (over: Partial<MedInventory> = {}): MedInventory => ({
  ...base,
  id: id(6),
  product: "Bovi-Shield Gold",
  category: "vaccine",
  onHand: { amount: 3, unit: "each" },
  ...over,
});

const candidate = (over: Partial<PurchaseCandidate> = {}): PurchaseCandidate => ({
  ...base,
  id: id(7),
  domain: "cattle",
  title: "Chi-Maine heifer",
  status: "watching",
  askingPrice: { cents: 350_000 },
  additionalCosts: [],
  firstSeen: AT,
  photoKeys: [],
  pros: [],
  cons: [],
  planStatus: "open",
  ...over,
});

describe("re-projection is idempotent", () => {
  it("gives the same ids the second time, over every kind at once", () => {
    const input = {
      animals: [andromeda],
      breedings: [breeding({ syncProtocolId: id(4) })],
      protocols: [protocol()],
      health: [health({ withdrawalDays: 21, boosterDueOn: new Date("2026-09-01T00:00:00Z") })],
      meds: [med({ expiresOn: new Date("2026-12-01T00:00:00Z") })],
      candidates: [candidate({ expiresAt: new Date("2026-09-19T00:00:00Z") })],
    };

    const first = cattleCalendarEntries(input).map((entry) => entry.id);
    const second = cattleCalendarEntries(input).map((entry) => entry.id);

    expect(second).toEqual(first);
    // Nothing derives an id from a counter or a clock, so no id may repeat
    // either — a collision is two rows that would overwrite one another in any
    // map keyed by id, which is every map the UI builds.
    expect(new Set(first).size).toBe(first.length);
  });

  it("keeps ids stable when the record it derives from is corrected", () => {
    const wrong = breeding({ date: new Date("2026-02-04T00:00:00Z"), syncProtocolId: id(4) });
    const fixed = breeding({ syncProtocolId: id(4) });

    const before = cattleCalendarEntries({ breedings: [wrong], protocols: [protocol()] });
    const after = cattleCalendarEntries({ breedings: [fixed], protocols: [protocol()] });

    // Same rows, moved — not a fresh set of rows beside the stale ones.
    expect(after.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
  });
});

describe("correcting the source moves the row", () => {
  it("moves the calving window and the preg check with the breeding date", () => {
    const before = cattleCalendarEntries({ breedings: [breeding()] });
    const after = cattleCalendarEntries({
      breedings: [breeding({ date: new Date("2026-02-24T00:00:00Z") })],
    });

    const windowOf = (entries: typeof before) =>
      entries.find((entry) => entry.kind === "calving_window");
    const checkOf = (entries: typeof before) =>
      entries.find((entry) => entry.kind === "preg_check_due");

    // Ten days later in, ten days later out — for both rows.
    expect((windowOf(after) as { at: Date }).at.getTime()).toBe(
      (windowOf(before) as { at: Date }).at.getTime() + 10 * 86_400_000,
    );
    expect((checkOf(after) as { at: Date }).at.getTime()).toBe(
      (checkOf(before) as { at: Date }).at.getTime() + 10 * 86_400_000,
    );
  });

  it("moves every step of the sync protocol when the start date is fixed (#20)", () => {
    const before = cattleCalendarEntries({
      breedings: [breeding({ syncProtocolId: id(4) })],
      protocols: [protocol()],
    }).filter((entry) => entry.kind === "breeding_protocol_step");

    const after = cattleCalendarEntries({
      breedings: [breeding({ syncProtocolId: id(4), date: new Date("2026-02-15T00:00:00Z") })],
      protocols: [protocol()],
    }).filter((entry) => entry.kind === "breeding_protocol_step");

    expect(before).toHaveLength(CO_SYNCH_CIDR_7_DAY.length);
    expect(after).toHaveLength(before.length);

    // Every step, not just the one that moved the record. A protocol that
    // shifted its breeding day and left the CIDR on the old date would have
    // somebody pulling a device three days after the cow was bred.
    for (const [index, entry] of after.entries()) {
      const was = before[index] as { at: Date };
      expect(entry.at.getTime() - was.at.getTime()).toBe(86_400_000);
    }
  });

  it("anchors the protocol so the breed step lands on the day she was bred", () => {
    const steps = cattleCalendarEntries({
      breedings: [breeding({ syncProtocolId: id(4) })],
      protocols: [protocol()],
    }).filter((entry) => entry.kind === "breeding_protocol_step");

    // §5.2 has the timed-AI step pre-fill the breeding date, so the breeding
    // record *is* day 10 of the CO-Synch protocol — everything else is worked
    // back from it rather than from a start date typed a second time.
    const breed = steps.find((entry) => entry.title.includes("Timed AI"));
    expect(breed?.at).toEqual(new Date("2026-02-14T00:00:00Z"));

    const cidrIn = steps.find((entry) => entry.title.includes("CIDR in"));
    expect(cidrIn?.at).toEqual(new Date("2026-02-03T16:00:00Z"));
  });
});

describe("what earns a row", () => {
  it("drops the window and the check for a cow confirmed open", () => {
    const entries = cattleCalendarEntries({
      breedings: [
        breeding({
          pregCheck: { date: new Date("2026-04-01T00:00:00Z"), result: "open", method: "blood" },
        }),
      ],
    });

    expect(entries.map((entry) => entry.kind)).toEqual([]);
  });

  it("dates the window from the service that still stands", () => {
    // She came back open and was bred again three weeks later. One due date,
    // not two — projecting the February service as well would put a fortnight
    // of watch dates on the calendar for a pregnancy that never happened.
    const first = breeding({ id: id(1), date: new Date("2026-02-14T00:00:00Z") });
    const again = breeding({ id: id(11), date: new Date("2026-04-06T00:00:00Z") });

    const windows = cattleCalendarEntries({ breedings: [first, again] }).filter(
      (entry) => entry.kind === "calving_window",
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]?.source?.id).toBe(id(11));
  });

  it("drops the window and the check once she has calved", () => {
    const bred = breeding({ id: id(1), date: new Date("2026-02-14T00:00:00Z") });
    const calved = [
      { damId: bred.damId, breedingRecordId: bred.id, date: new Date("2026-11-22T00:00:00Z") },
    ];

    const entries = cattleCalendarEntries({ breedings: [bred], calvings: calved });

    expect(entries.map((entry) => entry.kind)).toEqual([]);
  });

  it("projects a withdrawal end and names the product", () => {
    const entries = cattleCalendarEntries({
      animals: [andromeda],
      health: [health({ product: "Draxxin", withdrawalDays: 18 })],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("withdrawal_end");
    expect(entries[0]?.title).toBe("Andromeda — clear of Draxxin");
    expect(entries[0]?.at).toEqual(new Date("2026-08-19T00:00:00Z"));
  });

  it("leaves a treatment with no withdrawal off the calendar entirely", () => {
    // "No withdrawal" is not "cleared today" — §5.2 keeps the two apart, and a
    // row saying an animal cleared would be the app inventing a clearance.
    expect(cattleCalendarEntries({ health: [health()] })).toEqual([]);
  });

  it("skips a candidate already bought or passed on", () => {
    const live = candidate({ expiresAt: new Date("2026-09-19T00:00:00Z") });
    const gone = candidate({ id: id(8), status: "gone", expiresAt: live.expiresAt });

    const entries = cattleCalendarEntries({ candidates: [live, gone] });
    expect(entries.map((entry) => entry.source?.id)).toEqual([id(7)]);
  });

  it("ignores a candidate from another domain", () => {
    const baler = candidate({ domain: "equipment", expiresAt: AT });
    expect(cattleCalendarEntries({ candidates: [baler] })).toEqual([]);
  });

  it("raises a calving watch only when the forecast says something", () => {
    const quiet: CalvingWatchCard = {
      damId: id(2),
      breedingRecordId: id(1),
      dueOn: new Date("2026-11-24T00:00:00Z"),
      dayOfGestation: 279,
      signals: [],
      urgent: false,
    };
    const front: CalvingWatchCard = {
      ...quiet,
      signals: [
        { signal: "cold_snap", at: new Date("2026-11-19T18:00:00Z"), detail: "Low of 18°F" },
      ],
      urgent: true,
    };

    expect(cattleCalendarEntries({ watch: [quiet] })).toEqual([]);
    expect(cattleCalendarEntries({ animals: [andromeda], watch: [front] })[0]?.title).toBe(
      "Andromeda — calving watch, day 279",
    );
  });

  it("gives every row a source, so no row is a dead end", () => {
    const entries = cattleCalendarEntries({
      breedings: [breeding({ syncProtocolId: id(4) })],
      protocols: [protocol()],
      health: [health({ withdrawalDays: 3 })],
      meds: [med({ expiresOn: AT })],
      candidates: [candidate({ expiresAt: AT })],
    });

    expect(entries.every((entry) => entry.source !== undefined)).toBe(true);
  });
});

describe("the rows merge into the kernel's calendar", () => {
  it("filters to cattle and windows a calving window that opened earlier", () => {
    const entries = cattleCalendarEntries({ animals: [andromeda], breedings: [breeding()] });

    // The window opens 10 November and closes on the 25th; December asks for
    // nothing from it, and the fortnight it spans is what November's view is
    // meant to catch.
    const november = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-11-15T00:00:00Z"), to: new Date("2026-11-16T00:00:00Z") },
      ["cattle"],
    );
    expect(november.map((entry) => entry.kind)).toEqual(["calving_window"]);

    const december = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-12-15T00:00:00Z"), to: new Date("2026-12-16T00:00:00Z") },
    );
    expect(december).toEqual([]);
  });

  it("is dropped wholesale when the filter names another module", () => {
    const entries = cattleCalendarEntries({ breedings: [breeding()] });
    expect(projectEvents({ manual: [], projected: entries }, undefined, ["feed"])).toEqual([]);
  });
});
