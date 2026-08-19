import { describe, expect, it } from "vitest";

import { DEFAULT_WATCH_SETTINGS, type DailyWeather, type Ulid } from "@galaxy-farm/core";
import type { Crop, PlannedPlanting, Variety } from "@galaxy-farm/module-garden";

import {
  frostAlerts,
  frostKey,
  gardenDigests,
  plantingWindowAlerts,
  windowKey,
} from "../lib/garden-watch.js";

/**
 * The two things the garden asks for attention about (spec §5.5, §6).
 *
 * Both failure modes are quiet. A window that never fires is a season somebody
 * misses; a window that fires for every variety in the seed box is a sender
 * somebody filters, which costs them the frost warning too. So the tests below
 * are as interested in what does *not* raise an alert as in what does.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12));

const PROPERTY = id(0);
const PLAN = id(1);
const TOMATO = id(10);
const OKRA = id(11);
const CHEROKEE = id(20);
const CLEMSON = id(21);

const crops: Crop[] = [
  {
    id: TOMATO,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    name: "Tomato",
    family: "Solanaceae",
  },
  {
    id: OKRA,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    name: "Okra",
    family: "Malvaceae",
  },
];

const varieties: Variety[] = [
  {
    id: CHEROKEE,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    cropId: TOMATO,
    name: "Cherokee Purple",
  },
  {
    id: CLEMSON,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    cropId: OKRA,
    name: "Clemson Spineless",
  },
];

const plan = (overrides: Partial<PlannedPlanting> & Pick<PlannedPlanting, "id">): PlannedPlanting =>
  ({
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    seasonPlanId: PLAN,
    varietyId: CHEROKEE,
    method: "indoor_start",
    windowFrom: on(2026, 2, 1),
    windowTo: on(2026, 2, 21),
    planStatus: "open",
    ...overrides,
  }) as PlannedPlanting;

const day = (date: Date, lowF: number): DailyWeather => ({ date, lowF, highF: lowF + 25 });

describe("planting windows", () => {
  it("speaks the method as an instruction rather than as a field value", () => {
    // "indoor_start" is a database value. "Start Cherokee Purple · Tomato
    // indoors this week" is a thing somebody can go and do.
    const alerts = plantingWindowAlerts([plan({ id: id(30) })], varieties, crops, on(2026, 2, 3));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subject).toBe("Start Cherokee Purple · Tomato indoors this week");
  });

  it("says when a window that has not opened yet will", () => {
    const alerts = plantingWindowAlerts(
      [plan({ id: id(31), method: "direct_sow", varietyId: CLEMSON })],
      varieties,
      crops,
      on(2026, 1, 28),
    );

    expect(alerts[0]?.subject).toContain("Direct-sow Clemson Spineless · Okra");
    expect(alerts[0]?.subject).toContain("Sunday, Feb 1");
    expect(alerts[0]?.detail).toContain("The window opens");
  });

  it("warns that the last of a window is going", () => {
    const alerts = plantingWindowAlerts([plan({ id: id(32) })], varieties, crops, on(2026, 2, 18));

    expect(alerts[0]?.detail).toContain("last of it");
  });

  it("says whether the plan already names a bed", () => {
    const withBed = plantingWindowAlerts(
      [plan({ id: id(33), bedId: id(40) })],
      varieties,
      crops,
      on(2026, 2, 3),
    );
    const without = plantingWindowAlerts([plan({ id: id(34) })], varieties, crops, on(2026, 2, 3));

    expect(withBed[0]?.detail).toContain("already says which bed");
    expect(without[0]?.detail).toContain("No bed picked yet");
  });

  it("fires for what is in the plan and for nothing else", () => {
    // §5.5's central constraint. A seed box with forty varieties in it raises
    // nothing here; only the rows somebody wrote into a season plan do.
    const alerts = plantingWindowAlerts([], varieties, crops, on(2026, 2, 3));

    expect(alerts).toEqual([]);
  });

  it("says nothing about a plan that has already been realised or abandoned", () => {
    const closed = [
      plan({ id: id(35), planStatus: "realised", realisedAs: id(50) }),
      plan({ id: id(36), planStatus: "abandoned", abandonedReason: "No room" }),
    ];

    expect(plantingWindowAlerts(closed, varieties, crops, on(2026, 2, 3))).toEqual([]);
  });

  it("says nothing about a window that has already closed", () => {
    expect(plantingWindowAlerts([plan({ id: id(37) })], varieties, crops, on(2026, 3, 15))).toEqual(
      [],
    );
  });

  it("stays quiet until the lead time reaches the window", () => {
    const early = plantingWindowAlerts([plan({ id: id(38) })], varieties, crops, on(2026, 1, 1));
    const inside = plantingWindowAlerts(
      [plan({ id: id(38) })],
      varieties,
      crops,
      on(2026, 1, 1),
      45,
    );

    expect(early).toEqual([]);
    expect(inside).toHaveLength(1);
  });

  it("still names the window when the variety has been deleted", () => {
    // Better an alert that says "Unknown variety" than one that never fires
    // because a lookup came back empty.
    const alerts = plantingWindowAlerts(
      [plan({ id: id(39), varietyId: id(97) })],
      varieties,
      crops,
      on(2026, 2, 3),
    );

    expect(alerts[0]?.subject).toContain("Unknown variety");
  });

  it("keys an alert to the plan, so a second poll updates one row", () => {
    const first = plantingWindowAlerts([plan({ id: id(41) })], varieties, crops, on(2026, 2, 3));
    const second = plantingWindowAlerts([plan({ id: id(41) })], varieties, crops, on(2026, 2, 9));

    expect(first[0]?.key).toBe(windowKey(id(41)));
    expect(second[0]?.key).toBe(first[0]?.key);
  });
});

describe("frost warnings", () => {
  const settings = DEFAULT_WATCH_SETTINGS;

  it("fires on a night below the threshold inside the growing season", () => {
    // 8b runs 15 March to 20 November, so an April night at 33 °F is exactly
    // the case the warning exists for.
    const alerts = frostAlerts([day(on(2026, 4, 3), 33)], "8b", settings);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subject).toContain("33 °F");
    expect(alerts[0]?.detail).toContain("Cover the tender beds");
  });

  it("says nothing about a January night, when frost is the weather behaving", () => {
    expect(frostAlerts([day(on(2026, 1, 12), 28)], "8b", settings)).toEqual([]);
  });

  it("calls a hard freeze what it is, rather than another frost warning", () => {
    const alerts = frostAlerts([day(on(2026, 4, 3), 26)], "8b", settings);

    expect(alerts[0]?.subject).toContain("Hard freeze");
    expect(alerts[0]?.detail).toContain("will not save anything tender");
  });

  it("leaves a night above the threshold alone", () => {
    expect(frostAlerts([day(on(2026, 4, 3), 41)], "8b", settings)).toEqual([]);
  });

  it("honours a threshold the property has moved", () => {
    // §6 makes every threshold configurable, and a farm in a frost pocket will
    // want to hear about 40 °F.
    const alerts = frostAlerts([day(on(2026, 4, 3), 39)], "8b", { frostF: 40, hardFreezeF: 28 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.detail).toContain("below the 40 °F frost threshold");
  });

  it("reads the season from the property's own zone", () => {
    // The same night is inside 8b's season and outside 7a's, which is the
    // whole reason the zone is a setting rather than a constant.
    const march = [day(on(2026, 3, 20), 33)];

    expect(frostAlerts(march, "8b", settings)).toHaveLength(1);
    expect(frostAlerts(march, "7a", settings)).toEqual([]);
  });

  it("lets every night through when the zone is unset or unknown", () => {
    // The safe direction to fail. A farm that has not set its zone gets more
    // warnings than it needs rather than none on the night it had tomatoes out.
    expect(frostAlerts([day(on(2026, 1, 12), 30)], undefined, settings)).toHaveLength(1);
    expect(frostAlerts([day(on(2026, 1, 12), 30)], "12z", settings)).toHaveLength(1);
  });

  it("keys an alert to the night, so two polls in a day write one row", () => {
    const alerts = frostAlerts([day(on(2026, 4, 3), 33)], "8b", settings);

    expect(alerts[0]?.key).toBe(frostKey(on(2026, 4, 3)));
  });

  it("raises one alert per cold night in the forecast", () => {
    const alerts = frostAlerts(
      [day(on(2026, 4, 3), 33), day(on(2026, 4, 4), 31), day(on(2026, 4, 5), 50)],
      "8b",
      settings,
    );

    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((alert) => alert.key)).size).toBe(2);
  });
});

describe("the digests", () => {
  it("sends nothing at all when there is nothing new", () => {
    expect(gardenDigests([])).toEqual([]);
  });

  it("uses the alert's own subject when it is the only one", () => {
    const alerts = frostAlerts([day(on(2026, 4, 3), 33)], "8b", DEFAULT_WATCH_SETTINGS);

    expect(gardenDigests(alerts)[0]?.subject).toBe(alerts[0]?.subject);
  });

  it("folds several of one trigger into one message rather than several", () => {
    // Three messages in the same minute is how somebody learns to filter the
    // sender — and the sender is also the one carrying the frost warning.
    const digests = gardenDigests(
      frostAlerts([day(on(2026, 4, 3), 33), day(on(2026, 4, 4), 30)], "8b", DEFAULT_WATCH_SETTINGS),
    );

    expect(digests).toHaveLength(1);
    expect(digests[0]?.subject).toBe("Garden: 2 things this week");
    expect(digests[0]?.body).toContain("Frost");
  });

  it("keeps two triggers apart, because their opt-outs are separate (§6)", () => {
    // The reason this is not one message: switching frost warnings off must
    // not take the season plan's windows with it, and a merged message could
    // only be sent under one of the two preferences.
    const digests = gardenDigests([
      ...plantingWindowAlerts([plan({ id: id(70) })], varieties, crops, on(2026, 2, 3)),
      ...frostAlerts([day(on(2026, 4, 3), 33)], "8b", DEFAULT_WATCH_SETTINGS),
    ]);

    expect(digests.map((digest) => digest.trigger).sort()).toEqual([
      "frost_warning",
      "planting_window_opening",
    ]);
    expect(digests.find((d) => d.trigger === "planting_window_opening")?.body).toContain(
      "Start Cherokee Purple",
    );
    expect(digests.find((d) => d.trigger === "frost_warning")?.body).toContain("Frost");
  });
});
