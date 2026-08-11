import { describe, expect, it } from "vitest";

import { EventBus, type Ulid } from "@galaxy-farm/core";

import { CALVING_RECORDED, calvingRecorded } from "../src/domain/events.js";

/**
 * What cattle tells the rest of the app (spec §4.1).
 *
 * The event is the only channel: cattle must not import feed and feed must not
 * import cattle, so the calving flow cannot call "offer a creep plan" — it
 * announces, and whoever cares subscribes.
 */

const id = (n: number): Ulid => `01HQ${String(n).padStart(22, "0")}` as Ulid;

const record = {
  id: id(1),
  propertyId: id(0),
  damId: id(2),
  date: new Date("2026-11-24T06:00:00Z"),
  calfAnimalId: id(3),
};

describe("calvingRecorded", () => {
  it("carries the ids a listener needs and not the whole record", () => {
    const event = calvingRecorded(record, {
      liveCalf: true,
      occurredAt: new Date("2026-11-24T14:00:00Z"),
    });

    expect(event.name).toBe(CALVING_RECORDED);
    expect(event.aggregateId).toBe(id(1));
    expect(event.propertyId).toBe(id(0));
    expect(event.payload.damId).toBe(id(2));
    expect(event.payload.calfAnimalId).toBe(id(3));
    expect(event.payload.liveCalf).toBe(true);
  });

  it("separates when the calf was born from when somebody recorded it", () => {
    // Those differ by however long it took to get to a phone, and a listener
    // scheduling a follow-up wants the recording time while one projecting a
    // creep date wants the birth.
    const event = calvingRecorded(record, {
      liveCalf: true,
      occurredAt: new Date("2026-11-25T20:00:00Z"),
    });

    expect(event.payload.bornOn).toEqual(new Date("2026-11-24T06:00:00Z"));
    expect(event.occurredAt).toEqual(new Date("2026-11-25T20:00:00Z"));
  });

  it("omits the calf id for a stillbirth", () => {
    // No animal was created, so there is none to feed. A listener that saw an
    // id here would build a creep plan for a calf that does not exist.
    const event = calvingRecorded(
      { ...record, calfAnimalId: undefined },
      { liveCalf: false, occurredAt: new Date("2026-11-24T14:00:00Z") },
    );

    expect(event.payload.calfAnimalId).toBeUndefined();
    expect(event.payload.liveCalf).toBe(false);
  });

  it("reaches a subscriber that never imported the cattle module", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(CALVING_RECORDED, (event) => {
      seen.push(event.name);
    });

    void bus.publish(calvingRecorded(record, { liveCalf: true, occurredAt: new Date() }));

    expect(seen).toEqual([CALVING_RECORDED]);
  });
});
