import { describe, expect, it } from "vitest";

import { legFrom, saidAloud, tripFieldsFrom, type WanderTravel } from "../lib/wander-client.js";

/**
 * The boundary between Wander and the farm (spec §5.10, §4.5 clause 2).
 *
 * `Trip` was shaped to match Wander's fields, so the mapping is a rename — and
 * a rename is exactly the kind of code that looks obviously correct and
 * silently drops a flight when the other side renames a key. Everything here
 * is about what happens to a leg that is *not* the happy shape, because that
 * is the case nobody notices: a dropped leg leaves a board that still looks
 * right, just with one fewer flight on it.
 *
 * The rule the assertions encode: **never render a time we cannot place.** A
 * flight shown at the wrong hour is worse on a housesitter board than a flight
 * not shown at all — somebody plans an evening round around it.
 */

const goodLeg = {
  transport: "flight",
  number: "F9 4018",
  from: "Dallas/Ft. Worth (DFW)",
  to: "Orlando (MCO)",
  depart_at: "2026-09-15T09:21",
  depart_tz: "America/Chicago",
  arrive_at: "2026-09-15T12:09",
  arrive_tz: "America/New_York",
  traveler_names: ["Elliot", "Mai"],
};

describe("a leg crossing from Wander", () => {
  it("renames the fields it was shaped to match", () => {
    expect(legFrom(goodLeg)).toEqual({
      transport: "flight",
      number: "F9 4018",
      from: "Dallas/Ft. Worth (DFW)",
      to: "Orlando (MCO)",
      departAt: "2026-09-15T09:21",
      departTz: "America/Chicago",
      arriveAt: "2026-09-15T12:09",
      arriveTz: "America/New_York",
    });
  });

  it("drops a departure with no zone rather than guessing one", () => {
    // This is the whole point. Rendered without a zone the clock face lands in
    // whichever zone the kiosk is in — a flight time quietly shifted by
    // however far the trip went.
    expect(legFrom({ ...goodLeg, depart_tz: undefined })).toBeUndefined();
    expect(legFrom({ ...goodLeg, depart_tz: "CST" })).toBeUndefined();
  });

  it("drops a departure that is not a bare wall clock", () => {
    // An offset would mean two sources of truth for one moment, and nothing
    // decides which wins.
    expect(legFrom({ ...goodLeg, depart_at: "2026-09-15T09:21-05:00" })).toBeUndefined();
    expect(legFrom({ ...goodLeg, depart_at: "2026-09-15" })).toBeUndefined();
  });

  it("keeps a leg whose arrival is missing entirely", () => {
    // A one-way hop with no arrival time is still worth showing — the sitter
    // learns somebody left.
    const leg = legFrom({ ...goodLeg, arrive_at: undefined, arrive_tz: undefined });

    expect(leg?.departAt).toBe("2026-09-15T09:21");
    expect(leg?.arriveAt).toBeUndefined();
  });

  it("drops half an arrival rather than rendering it in the wrong zone", () => {
    const leg = legFrom({ ...goodLeg, arrive_tz: undefined });

    expect(leg).toBeDefined();
    expect(leg?.arriveAt).toBeUndefined();
    expect(leg?.arriveTz).toBeUndefined();
  });

  it("maps a transport this app has no word for onto other", () => {
    // Wander has subway, taxi and walk. None is a reason to lose the leg.
    expect(legFrom({ ...goodLeg, transport: "taxi" })?.transport).toBe("other");
    expect(legFrom({ ...goodLeg, transport: undefined })?.transport).toBe("other");
    expect(legFrom({ ...goodLeg, transport: "ferry" })?.transport).toBe("ferry");
  });

  it("survives a leg that is not an object at all", () => {
    expect(legFrom(null)).toBeUndefined();
    expect(legFrom("F9 4018")).toBeUndefined();
    expect(legFrom([])).toBeUndefined();
  });

  it("substitutes a placeholder rather than dropping a leg with no endpoint", () => {
    // `from`/`to` are free text in Wander and not validated there, so a blank
    // one is a typo rather than corruption — and the time is still useful.
    const leg = legFrom({ ...goodLeg, from: "", to: undefined });

    expect(leg?.from).toBe("—");
    expect(leg?.to).toBe("—");
  });

  it("truncates to what the schema accepts", () => {
    const leg = legFrom({ ...goodLeg, number: "X".repeat(50), from: "Y".repeat(200) });

    expect(leg?.number).toHaveLength(20);
    expect(leg?.from).toHaveLength(120);
  });
});

describe("who is away, said the way somebody says it", () => {
  it("joins names with and rather than commas", () => {
    expect(saidAloud(["Elliot"])).toBe("Elliot");
    expect(saidAloud(["Elliot", "Mai"])).toBe("Elliot and Mai");
    expect(saidAloud(["Elliot", "Mai", "Sam"])).toBe("Elliot, Mai and Sam");
  });

  it("has nothing to say about nobody", () => {
    expect(saidAloud([])).toBeUndefined();
  });
});

describe("the fields a pull writes", () => {
  const travel: WanderTravel = {
    name: "Orlando and Cincinnati",
    destination: "Florida",
    startDate: new Date(2026, 8, 15, 12),
    endDate: new Date(2026, 8, 20, 12),
    legs: [],
    travellers: ["Elliot", "Mai"],
    droppedLegs: 0,
  };

  it("marks the row as Wander's and remembers which trip it was", () => {
    const fields = tripFieldsFrom(travel, "wander-trip-1");

    expect(fields.source).toBe("wander");
    expect(fields.externalId).toBe("wander-trip-1");
  });

  it("fills who is away from the names on the legs", () => {
    expect(tripFieldsFrom(travel, "t1").whoIsAway).toBe("Elliot and Mai");
  });

  it("keeps wording the owner corrected, on a re-pull", () => {
    // The one field Wander cannot say the way a sitter reads it — its profile
    // names are "Elliot Mai", not "Elliot and Mai". Everything else is
    // Wander's and gets overwritten, which is what the admin form warns about.
    expect(tripFieldsFrom(travel, "t1", "Eli and Mai").whoIsAway).toBe("Eli and Mai");
  });

  it("does not treat a blanked field as a correction worth keeping", () => {
    expect(tripFieldsFrom(travel, "t1", "   ").whoIsAway).toBe("Elliot and Mai");
  });

  it("falls back to the trip name when Wander names nobody", () => {
    // `whoIsAway` is required by `tripSchema`, so an empty one fails the write
    // rather than showing a blank banner — the fallback is what keeps a trip
    // with no named travellers linkable at all.
    const anonymous = { ...travel, travellers: [] };

    expect(tripFieldsFrom(anonymous, "t1").whoIsAway).toBe("Orlando and Cincinnati");
  });
});
