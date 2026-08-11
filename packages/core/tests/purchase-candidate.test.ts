import { describe, expect, it } from "vitest";

import {
  byTotalCost,
  compareToBudget,
  daysOnMarket,
  isActive,
  isExpiring,
  purchaseCandidateSchema,
  rankByTotalCost,
  totalAcquisitionCost,
  type PurchaseCandidate,
} from "../src/entities/purchase-candidate.js";
import { fromDollars, toDollars } from "../src/value-objects/money.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

let counter = 0;
const nextId = (): Ulid => encodeUlid(4_000 + counter++, () => 0.5);

const candidate = (overrides: Partial<PurchaseCandidate> = {}): PurchaseCandidate =>
  ({
    id: nextId(),
    propertyId: nextId(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    domain: "equipment",
    title: "2018 F-250, 96k miles",
    status: "watching",
    askingPrice: fromDollars(34_500),
    additionalCosts: [],
    firstSeen: new Date("2026-01-01T00:00:00Z"),
    photoKeys: [],
    pros: [],
    cons: [],
    planStatus: "open",
    ...overrides,
  }) as PurchaseCandidate;

describe("PurchaseCandidate — spec §5.1", () => {
  it("validates a realistic listing", () => {
    const valid = candidate({
      listingUrl: "https://example.com/listing/1",
      distanceMiles: 180,
      pros: ["service records"],
      cons: ["rust on the bed"],
    });

    expect(purchaseCandidateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a listing URL that is not a URL", () => {
    expect(
      purchaseCandidateSchema.safeParse(candidate({ listingUrl: "facebook marketplace" })).success,
    ).toBe(false);
  });

  it("requires a title", () => {
    expect(purchaseCandidateSchema.safeParse(candidate({ title: "" })).success).toBe(false);
  });

  it("requires every additional cost to be labelled", () => {
    // An unlabelled $900 in the total is worse than no total at all.
    const unlabelled = candidate({
      additionalCosts: [{ label: "", amount: fromDollars(900) }],
    });

    expect(purchaseCandidateSchema.safeParse(unlabelled).success).toBe(false);
  });
});

describe("total acquisition cost — the number that decides things", () => {
  it("is the asking price when nothing else applies", () => {
    expect(toDollars(totalAcquisitionCost(candidate()))).toBe(34_500);
  });

  it("adds every itemised cost", () => {
    // Hauling a truck 300 miles and replacing its tyres is real money, and the
    // sticker price is the one figure that never settles a purchase.
    const withCosts = candidate({
      additionalCosts: [
        { label: "hauling", amount: fromDollars(450) },
        { label: "inspection", amount: fromDollars(150) },
        { label: "tyres", amount: fromDollars(1_200) },
      ],
    });

    expect(toDollars(totalAcquisitionCost(withCosts))).toBe(36_300);
  });

  it("is derived, so editing a line item moves it", () => {
    const before = totalAcquisitionCost(candidate());
    const after = totalAcquisitionCost(
      candidate({ additionalCosts: [{ label: "hauling", amount: fromDollars(450) }] }),
    );

    expect(after.cents - before.cents).toBe(45_000);
  });

  it("handles a credit as a negative cost", () => {
    const withTradeIn = candidate({
      additionalCosts: [{ label: "trade-in", amount: fromDollars(-5_000) }],
    });

    expect(toDollars(totalAcquisitionCost(withTradeIn))).toBe(29_500);
  });
});

describe("budget comparison", () => {
  it("reports under budget", () => {
    const result = compareToBudget(candidate(), fromDollars(40_000));

    expect(result.overBudget).toBe(false);
    expect(toDollars(result.difference)).toBe(-5_500);
  });

  it("reports over budget once the real costs are counted", () => {
    // This is the case worth catching: under sticker, over once hauling and
    // repairs are in.
    const withCosts = candidate({
      additionalCosts: [{ label: "repairs", amount: fromDollars(2_000) }],
    });
    const result = compareToBudget(withCosts, fromDollars(35_000));

    expect(result.overBudget).toBe(true);
    expect(toDollars(result.difference)).toBe(1_500);
  });

  it("treats exactly on budget as not over", () => {
    expect(compareToBudget(candidate(), fromDollars(34_500)).overBudget).toBe(false);
  });
});

describe("status and timing", () => {
  it("counts days on market from the listing date, falling back to first seen", () => {
    const now = new Date("2026-02-01T00:00:00Z");

    expect(
      daysOnMarket({ listedDate: new Date("2026-01-01T00:00:00Z"), firstSeen: now }, now),
    ).toBe(31);
    expect(
      daysOnMarket({ listedDate: undefined, firstSeen: new Date("2026-01-20T00:00:00Z") }, now),
    ).toBe(12);
  });

  it("treats watching, contacted, inspected, and offer_made as still live", () => {
    for (const status of ["watching", "contacted", "inspected", "offer_made"] as const) {
      expect(isActive({ status })).toBe(true);
    }
  });

  it("treats purchased, passed, and gone as closed", () => {
    for (const status of ["purchased", "passed", "gone"] as const) {
      expect(isActive({ status })).toBe(false);
    }
  });

  describe("expiry — an auction lot is a deadline, not a browse", () => {
    const now = new Date("2026-02-01T00:00:00Z");

    it("flags a sale date inside the window", () => {
      expect(
        isExpiring({ expiresAt: new Date("2026-02-03T00:00:00Z"), status: "watching" }, now),
      ).toBe(true);
    });

    it("ignores one outside the window", () => {
      expect(
        isExpiring({ expiresAt: new Date("2026-02-20T00:00:00Z"), status: "watching" }, now),
      ).toBe(false);
    });

    it("ignores a date already past", () => {
      expect(
        isExpiring({ expiresAt: new Date("2026-01-20T00:00:00Z"), status: "watching" }, now),
      ).toBe(false);
    });

    it("stays quiet about candidates already decided", () => {
      expect(
        isExpiring({ expiresAt: new Date("2026-02-02T00:00:00Z"), status: "passed" }, now),
      ).toBe(false);
    });

    it("stays quiet when there is no date at all", () => {
      expect(isExpiring({ expiresAt: undefined, status: "watching" }, now)).toBe(false);
    });

    it("honours a custom window", () => {
      const twoWeeksOut = {
        expiresAt: new Date("2026-02-14T00:00:00Z"),
        status: "watching" as const,
      };

      expect(isExpiring(twoWeeksOut, now, 20)).toBe(true);
    });
  });
});

describe("ranking", () => {
  const cheap = candidate({ title: "cheap", askingPrice: fromDollars(20_000) });
  const dear = candidate({ title: "dear", askingPrice: fromDollars(30_000) });
  // Cheaper sticker, but a long haul and a rebuild put it on top.
  const deceptive = candidate({
    title: "deceptive",
    askingPrice: fromDollars(19_000),
    additionalCosts: [
      { label: "hauling", amount: fromDollars(2_000) },
      { label: "engine work", amount: fromDollars(12_000) },
    ],
  });

  it("orders by true cost, not sticker price", () => {
    expect(rankByTotalCost([deceptive, dear, cheap]).map((c) => c.title)).toEqual([
      "cheap",
      "dear",
      "deceptive",
    ]);
  });

  it("does not mutate the caller's list", () => {
    const input = [dear, cheap];
    rankByTotalCost(input);

    expect(input.map((c) => c.title)).toEqual(["dear", "cheap"]);
  });

  it("exposes the comparator for use elsewhere", () => {
    expect(byTotalCost(cheap, dear)).toBeLessThan(0);
    expect(byTotalCost(dear, cheap)).toBeGreaterThan(0);
    expect(byTotalCost(cheap, cheap)).toBe(0);
  });
});
