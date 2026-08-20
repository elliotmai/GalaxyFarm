import { describe, expect, it } from "vitest";

import { fullMoonNear, type DailyWeather, type HourlyWeather, type Ulid } from "@galaxy-farm/core";

import type { BreedingRecord } from "../src/domain/breeding-record.js";
import { calvingWatch, calvingWatchSignals, describeWatch } from "../src/domain/calving-watch.js";

/**
 * The calving watch (spec §6, pulled into Phase 1 by §12 decision 5).
 *
 * §6's own example is the shape being tested: "Front arriving Thursday night +
 * full moon Friday — Dolly is at day 279."
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const IN_WINDOW = new Date("2026-11-20T18:00:00Z");

const breeding = (over: Partial<BreedingRecord> = {}): BreedingRecord => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  damId: id(2),
  method: "AI",
  sireExternalId: id(3),
  date: new Date("2026-02-14T00:00:00Z"),
  ...over,
});

const day = (date: string, lowF: number): DailyWeather => ({
  date: new Date(date),
  lowF,
  highF: lowF + 20,
});

const hour = (at: string, pressureHpa: number): HourlyWeather => ({
  at: new Date(at),
  temperatureF: 40,
  pressureHpa,
});

const calm = { daily: [day("2026-11-21", 45)], hourly: [hour("2026-11-20T18:00:00Z", 1018)] };

const front = {
  daily: [day("2026-11-21", 18)],
  hourly: [hour("2026-11-20T18:00:00Z", 1020), hour("2026-11-21T12:00:00Z", 1012)],
};

describe("calvingWatchSignals", () => {
  it("names a cold snap with the temperature, not just a flag", () => {
    const signals = calvingWatchSignals(front, IN_WINDOW);
    const chill = signals.find((signal) => signal.signal === "cold_snap");

    expect(chill?.detail).toBe("Low of 18°F — a wet calf will chill fast");
  });

  it("names the size of the pressure fall", () => {
    const signals = calvingWatchSignals(front, IN_WINDOW);
    const fall = signals.find((signal) => signal.signal === "pressure_fall");

    expect(fall?.detail).toMatch(/Pressure falling 8\.0 hPa/);
  });

  it("stays quiet on a settled forecast", () => {
    const moonless = new Date("2026-11-16T12:00:00Z");
    expect(calvingWatchSignals(calm, moonless)).toEqual([]);
  });

  it("mentions a full moon when there is one", () => {
    const full = fullMoonNear(new Date("2026-11-24T00:00:00Z"));
    const signals = calvingWatchSignals(calm, full);

    expect(signals.map((signal) => signal.signal)).toEqual(["full_moon"]);
  });

  it("respects a raised chill threshold", () => {
    const mild = { daily: [day("2026-11-21", 25)], hourly: [] };
    expect(
      calvingWatchSignals(mild, new Date("2026-11-16T12:00:00Z"), { calfChillF: 30 }),
    ).toHaveLength(1);
  });
});

describe("calvingWatch", () => {
  it("raises a card for a cow inside her window", () => {
    const cards = calvingWatch([breeding()], [], front, IN_WINDOW);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.dayOfGestation).toBe(279);
    expect(cards[0]?.dueOn).toEqual(new Date("2026-11-24T00:00:00Z"));
  });

  it("raises nothing in August", () => {
    expect(calvingWatch([breeding()], [], front, AT)).toEqual([]);
  });

  it("drops a cow who has already calved", () => {
    // The failure this is about: nothing ended the watch. A cow calved on the
    // Tuesday kept her card — and her nightly weather alert — for the rest of
    // the fortnight, which is how a watch card becomes one people scroll past.
    const her = breeding();
    const calved = [{ damId: her.damId, breedingRecordId: her.id, date: new Date("2026-11-22") }];

    expect(calvingWatch([her], calved, front, IN_WINDOW)).toEqual([]);
  });

  it("drops a cow confirmed open", () => {
    const open = breeding({
      pregCheck: { date: new Date("2026-04-01"), result: "open", method: "ultrasound" },
    });

    expect(calvingWatch([open], [], front, IN_WINDOW)).toEqual([]);
  });

  it("is urgent for a front, and not for a full moon alone", () => {
    // A card that goes urgent once a month on the calendar and nothing else
    // would train people to ignore it.
    expect(calvingWatch([breeding()], [], front, IN_WINDOW)[0]?.urgent).toBe(true);

    const full = fullMoonNear(new Date("2026-11-24T00:00:00Z"));
    expect(calvingWatch([breeding()], [], calm, full)[0]?.urgent).toBe(false);
  });

  it("puts the cow closest to calving at the top", () => {
    const later = breeding({ id: id(4), damId: id(5), date: new Date("2026-02-24T00:00:00Z") });
    const cards = calvingWatch([later, breeding()], [], front, IN_WINDOW);

    expect(cards.map((card) => card.damId)).toEqual([id(2), id(5)]);
  });

  it("computes the shared signals once for the whole herd", () => {
    // Five cows share one forecast. Recomputing per cow is five chances for
    // the same night to be described differently.
    const other = breeding({ id: id(6), damId: id(7) });
    const cards = calvingWatch([breeding(), other], [], front, IN_WINDOW);

    expect(cards[0]?.signals).toBe(cards[1]?.signals);
  });
});

describe("describeWatch", () => {
  it("reads like §6's own example", () => {
    const [card] = calvingWatch([breeding()], [], front, IN_WINDOW);
    const sentence = describeWatch(card as never, "Andromeda");

    expect(sentence).toMatch(/Andromeda is at day 279/);
    expect(sentence).toMatch(/chill fast/);
  });

  it("still says where she is when the forecast is quiet", () => {
    const moonless = new Date("2026-11-16T12:00:00Z");
    const [card] = calvingWatch([breeding()], [], calm, moonless);

    expect(describeWatch(card as never, "Andromeda")).toMatch(/^Andromeda is at day \d+, due/);
  });
});
