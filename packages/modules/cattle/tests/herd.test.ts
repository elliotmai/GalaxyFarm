import { describe, expect, it } from "vitest";

import { fromDollars, type Ulid } from "@galaxy-farm/core";

import {
  cattleProfileSchema,
  describeComposition,
  isPapered,
  isPurebred,
  registrationIn,
  type CattleProfile,
  type ParentRef,
} from "../src/domain/cattle-profile.js";
import {
  ancestorsAtGeneration,
  buildPedigree,
  pedigreeDepth,
  repeatedAncestors,
  wouldCreateCycle,
  type PedigreeSource,
} from "../src/domain/pedigree.js";
import {
  drawStraw,
  isLowSemenInventory,
  returnStraw,
  semenInventorySchema,
  tankLocation,
  tankValue,
  type SemenInventory,
} from "../src/domain/semen-inventory.js";
import {
  heatsFor,
  nextExpectedHeat,
  suspectedReturnToHeat,
  type HeatRecord,
} from "../src/domain/heat-record.js";
import {
  CO_SYNCH_CIDR_7_DAY,
  breedingStep,
  projectProtocol,
  stepsOn,
  syncProtocolSchema,
} from "../src/domain/sync-protocol.js";
import {
  cutRevenue,
  cuttingYield,
  dressingPercentage,
  poundsKept,
  poundsSold,
  processingRecordSchema,
  type ProcessingRecord,
} from "../src/domain/processing-record.js";
import {
  acquisitionCost,
  netSaleProceeds,
  type AcquisitionRecord,
  type SaleRecord,
} from "../src/domain/transactions.js";
import { animalProfitAndLoss, herdRollup } from "../src/domain/profit-and-loss.js";
import {
  herdSizeProgress,
  matingToBreeding,
  plannedMatingSchema,
  type PlannedMating,
} from "../src/domain/herd-roadmap.js";
import {
  candidateAgeMonths,
  upcomingSales,
  type CattleCandidateDetail,
} from "../src/domain/cattle-candidate.js";

/**
 * The rest of §5.2 — papers, pedigree, the tank, protocols, the packer, and
 * what any of it cost.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

// ---------------------------------------------------------------- profile

const profile = (over: Partial<CattleProfile> = {}): CattleProfile => ({
  id: id(1),
  ...base,
  animalId: id(2),
  geneticTests: [],
  breedComposition: [
    { breed: "Maine-Anjou", percent: 50 },
    { breed: "Chianina", percent: 25 },
    { breed: "Shorthorn", percent: 25 },
  ],
  registrations: [{ association: "AMAA", regNumber: "M123456" }],
  ...over,
});

describe("cattleProfileSchema", () => {
  it("accepts the spec's own example composition", () => {
    expect(cattleProfileSchema.safeParse(profile()).success).toBe(true);
  });

  it("refuses a composition that does not add up", () => {
    // 50% Maine and nothing else means the other half was forgotten, not that
    // it is unknown — and it would misstate a percentage on a sale sheet.
    const result = cattleProfileSchema.safeParse({
      ...profile(),
      breedComposition: [{ breed: "Maine-Anjou", percent: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty composition, because plenty of cattle have none known", () => {
    expect(cattleProfileSchema.safeParse({ ...profile(), breedComposition: [] }).success).toBe(
      true,
    );
  });

  it("tolerates a three-way split that cannot be exact", () => {
    const result = cattleProfileSchema.safeParse({
      ...profile(),
      breedComposition: [
        { breed: "Maine-Anjou", percent: 33.3 },
        { breed: "Chianina", percent: 33.3 },
        { breed: "Shorthorn", percent: 33.4 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("refuses the same registration listed twice", () => {
    const result = cattleProfileSchema.safeParse({
      ...profile(),
      registrations: [
        { association: "AMAA", regNumber: "M123456" },
        { association: "AMAA", regNumber: "M123456" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts one animal papered in two associations", () => {
    // §5.2 says so explicitly — show cattle often are.
    const result = cattleProfileSchema.safeParse({
      ...profile(),
      registrations: [
        { association: "AMAA", regNumber: "M123456" },
        { association: "ACA", regNumber: "C77" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("describeComposition", () => {
  it("writes the fractions the way papers write them", () => {
    expect(describeComposition(profile().breedComposition)).toBe(
      "½ Maine-Anjou · ¼ Chianina · ¼ Shorthorn",
    );
  });

  it("falls back to a percentage for a share with no tidy fraction", () => {
    expect(
      describeComposition([
        { breed: "Angus", percent: 40 },
        { breed: "Hereford", percent: 60 },
      ]),
    ).toBe("60% Hereford · 40% Angus");
  });

  it("says so plainly when nothing is known", () => {
    expect(describeComposition([])).toBe("Unknown breeding");
  });
});

describe("profile helpers", () => {
  it("recognises a purebred", () => {
    expect(isPurebred([{ breed: "Shorthorn", percent: 100 }])).toBe(true);
    expect(isPurebred(profile().breedComposition)).toBe(false);
  });

  it("finds a registration by association", () => {
    expect(registrationIn(profile(), "AMAA")?.regNumber).toBe("M123456");
    expect(registrationIn(profile(), "ASA")).toBeUndefined();
  });

  it("knows whether an animal is papered at all", () => {
    expect(isPapered(profile())).toBe(true);
    expect(isPapered({ registrations: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------- pedigree

const ref = (kind: "animal" | "external", n: number): ParentRef => ({ kind, id: id(n) });

/** A four-generation paper pedigree, with one bull appearing on both sides. */
function source(): PedigreeSource {
  const parents = new Map<string, { sire?: ParentRef; dam?: ParentRef }>([
    ["animal:" + id(2), { sire: ref("external", 10), dam: ref("animal", 3) }],
    ["external:" + id(10), { sire: ref("external", 20), dam: ref("external", 21) }],
    ["animal:" + id(3), { sire: ref("external", 20), dam: ref("external", 22) }],
  ]);
  const names = new Map<string, string>([
    ["animal:" + id(2), "Andromeda"],
    ["external:" + id(10), "ZNT Montego Bay"],
    ["animal:" + id(3), "Cassiopeia"],
    ["external:" + id(20), "Shared Grandsire"],
    ["external:" + id(21), "Dam of Montego"],
    ["external:" + id(22), "Dam of Cassiopeia"],
  ]);

  return {
    parentsOf: (r) => parents.get(`${r.kind}:${r.id}`),
    describe: (r) => {
      const name = names.get(`${r.kind}:${r.id}`);
      return name === undefined ? undefined : { name };
    },
  };
}

describe("buildPedigree", () => {
  it("walks both sides, mixing on-farm and outside ancestors", () => {
    const tree = buildPedigree(ref("animal", 2), source());

    expect(tree?.name).toBe("Andromeda");
    expect(tree?.sire?.name).toBe("ZNT Montego Bay");
    expect(tree?.dam?.name).toBe("Cassiopeia");
    expect(tree?.sire?.sire?.name).toBe("Shared Grandsire");
  });

  it("stops at the requested depth", () => {
    const tree = buildPedigree(ref("animal", 2), source(), 1);

    expect(tree?.sire?.name).toBe("ZNT Montego Bay");
    expect(tree?.sire?.sire).toBeUndefined();
  });

  it("returns nothing for an animal the source cannot describe", () => {
    expect(buildPedigree(ref("animal", 99), source())).toBeUndefined();
  });

  it("survives a pedigree that loops back on itself", () => {
    // A mistyped registration number can make an animal its own ancestor.
    // Without a guard this is an infinite walk on a screen somebody opened by
    // accident.
    const looping: PedigreeSource = {
      parentsOf: () => ({ sire: ref("external", 50) }),
      describe: () => ({ name: "Ouroboros" }),
    };

    const tree = buildPedigree(ref("external", 50), looping, 10);
    expect(pedigreeDepth(tree)).toBeLessThanOrEqual(1);
  });
});

describe("ancestorsAtGeneration", () => {
  it("returns the grandparent row", () => {
    const names = ancestorsAtGeneration(buildPedigree(ref("animal", 2), source()), 2).map(
      (n) => n.name,
    );
    expect(names).toEqual([
      "Shared Grandsire",
      "Dam of Montego",
      "Shared Grandsire",
      "Dam of Cassiopeia",
    ]);
  });
});

describe("repeatedAncestors", () => {
  it("finds the bull standing on both sides", () => {
    // Line breeding, or a typo. Either way it is the first thing worth seeing.
    const repeats = repeatedAncestors(buildPedigree(ref("animal", 2), source()));
    expect(repeats.get(`external:${id(20)}`)).toBe(2);
  });

  it("does not count the subject as its own ancestor", () => {
    const repeats = repeatedAncestors(buildPedigree(ref("animal", 2), source()));
    expect(repeats.has(`animal:${id(2)}`)).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses an animal as its own parent", () => {
    expect(wouldCreateCycle(ref("animal", 2), ref("animal", 2), source())).toBe(true);
  });

  it("refuses a descendant as a parent", () => {
    // Making Andromeda the sire of her own grandsire.
    expect(wouldCreateCycle(ref("external", 20), ref("animal", 2), source())).toBe(true);
  });

  it("allows an unrelated animal", () => {
    expect(wouldCreateCycle(ref("animal", 2), ref("external", 21), source())).toBe(false);
  });
});

// ---------------------------------------------------------------- the tank

const straw = (over: Partial<SemenInventory> = {}): SemenInventory => ({
  id: id(60),
  ...base,
  sireName: "ZNT Montego Bay",
  strawsOnHand: 6,
  tank: "1",
  canister: "B",
  cane: "3",
  pricePerStraw: fromDollars(45),
  reorderThreshold: 2,
  ...over,
});

describe("drawStraw", () => {
  it("takes one out of the tank", () => {
    const result = drawStraw(straw(), AT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.item.strawsOnHand).toBe(5);
  });

  it("refuses rather than clamping at zero", () => {
    // §4.5 clause 2 names "straw count cannot go negative" by name. Silently
    // absorbing the discrepancy is how a dead bull's remaining straws become a
    // guess.
    const result = drawStraw(straw({ strawsOnHand: 0 }), AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/0 straws on hand/);
  });

  it("counts the last one in the singular", () => {
    const result = drawStraw(straw({ strawsOnHand: 1 }), AT, 2);
    if (!result.ok) expect(result.reason).toMatch(/1 straw on hand/);
  });

  it("refuses a draw of nothing", () => {
    expect(drawStraw(straw(), AT, 0).ok).toBe(false);
  });

  it("puts one back when a thaw goes unused", () => {
    expect(returnStraw(straw(), AT).strawsOnHand).toBe(7);
  });
});

describe("isLowSemenInventory", () => {
  it("fires at or below the threshold", () => {
    expect(isLowSemenInventory({ strawsOnHand: 2, reorderThreshold: 2 })).toBe(true);
    expect(isLowSemenInventory({ strawsOnHand: 3, reorderThreshold: 2 })).toBe(false);
  });

  it("stays quiet for stock with no threshold, even at zero", () => {
    // Somebody who used the last straw of a bull they are done with does not
    // need telling.
    expect(isLowSemenInventory({ strawsOnHand: 0 })).toBe(false);
  });
});

describe("tank bookkeeping", () => {
  it("reads the location off the tank map", () => {
    expect(tankLocation(straw())).toBe("Tank 1, canister B, cane 3");
    expect(tankLocation({})).toBeUndefined();
  });

  it("values the whole tank", () => {
    expect(tankValue([straw(), straw({ id: id(61), strawsOnHand: 2 })])).toEqual(fromDollars(360));
  });

  it("refuses a straw record with no sire named", () => {
    expect(semenInventorySchema.safeParse({ ...straw(), sireName: "" }).success).toBe(false);
  });

  it("refuses a negative count outright", () => {
    expect(semenInventorySchema.safeParse({ ...straw(), strawsOnHand: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- heats

const heat = (over: Partial<HeatRecord> = {}): HeatRecord => ({
  id: id(70),
  ...base,
  animalId: id(2),
  observedAt: new Date("2026-08-01T07:00:00Z"),
  intensity: "standing",
  ...over,
});

describe("nextExpectedHeat", () => {
  it("predicts a window rather than a day", () => {
    // Eighteen to twenty-four days is the real range; a single date makes
    // people stop looking on day twenty-two.
    const next = nextExpectedHeat([heat()], id(2));

    expect(next?.expected).toEqual(new Date("2026-08-22T07:00:00Z"));
    expect(next?.from).toEqual(new Date("2026-08-19T07:00:00Z"));
    expect(next?.to).toEqual(new Date("2026-08-25T07:00:00Z"));
  });

  it("uses only the most recent observation", () => {
    const older = heat({ id: id(71), observedAt: new Date("2026-07-11T07:00:00Z") });
    expect(nextExpectedHeat([older, heat()], id(2))?.expected).toEqual(
      new Date("2026-08-22T07:00:00Z"),
    );
  });

  it("says nothing for a cow never seen in heat", () => {
    expect(nextExpectedHeat([], id(2))).toBeUndefined();
  });

  it("returns one cow's heats newest first", () => {
    const older = heat({ id: id(72), observedAt: new Date("2026-07-11") });
    expect(heatsFor([older, heat()], id(2)).map((h) => h.id)).toEqual([id(70), id(72)]);
  });
});

describe("suspectedReturnToHeat", () => {
  it("flags a heat three weeks after a breeding", () => {
    const bredOn = new Date("2026-07-11T00:00:00Z");
    expect(suspectedReturnToHeat([heat()], id(2), bredOn)?.id).toBe(id(70));
  });

  it("ignores a heat well outside the return window", () => {
    const bredOn = new Date("2026-06-01T00:00:00Z");
    expect(suspectedReturnToHeat([heat()], id(2), bredOn)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- protocols

describe("projectProtocol", () => {
  const protocol = { id: id(80), steps: CO_SYNCH_CIDR_7_DAY };
  const started = new Date("2026-09-01T00:00:00Z");

  it("lays the day offsets over a real start date", () => {
    const steps = projectProtocol(protocol, id(2), started);

    expect(steps[0]?.at).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(breedingStep(steps)?.at).toEqual(new Date("2026-09-11T08:00:00Z"));
  });

  it("keeps two steps on the same day in the order the protocol wrote them", () => {
    // Both day-7 steps happen; the sheet says CIDR out first.
    const sameDay = stepsOn(projectProtocol(protocol, id(2), started), new Date("2026-09-08"));
    expect(sameDay.map((s) => s.step.action)).toEqual(["cidr_out", "prostaglandin"]);
  });

  it("picks out only the steps falling on one day", () => {
    const steps = projectProtocol(protocol, id(2), started);
    expect(stepsOn(steps, new Date("2026-09-10")).map((s) => s.step.action)).toEqual([
      "heat_watch",
    ]);
  });

  it("refuses a protocol with no steps", () => {
    const result = syncProtocolSchema.safeParse({
      id: id(81),
      ...base,
      name: "Empty",
      steps: [],
      active: true,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------- packer

const processing = (over: Partial<ProcessingRecord> = {}): ProcessingRecord => ({
  id: id(90),
  ...base,
  animalId: id(2),
  deliveredOn: new Date("2027-05-01"),
  liveScaleWeightLb: 1250,
  hangingWeightLb: 775,
  processingCost: fromDollars(650),
  cutLines: [
    { cut: "Ribeye", pounds: 40, disposition: "sold", pricePerLb: fromDollars(18) },
    { cut: "Ground", pounds: 220, disposition: "kept" },
  ],
  ...over,
});

describe("dressingPercentage", () => {
  it("is hanging over live", () => {
    expect(dressingPercentage(processing())).toBeCloseTo(62, 1);
  });

  it("says nothing when either weight is missing", () => {
    // A guess here is worse than a blank: the number gets compared between
    // animals.
    expect(
      dressingPercentage({ liveScaleWeightLb: 1250, hangingWeightLb: undefined }),
    ).toBeUndefined();
    expect(
      dressingPercentage({ liveScaleWeightLb: undefined, hangingWeightLb: 775 }),
    ).toBeUndefined();
  });

  it("is refused outright when the carcass outweighs the animal", () => {
    const result = processingRecordSchema.safeParse({
      ...processing(),
      hangingWeightLb: 1300,
    });
    expect(result.success).toBe(false);
  });
});

describe("cut lines", () => {
  it("splits kept from sold", () => {
    expect(poundsKept(processing())).toBe(220);
    expect(poundsSold(processing())).toBe(40);
  });

  it("counts only sold cuts as revenue", () => {
    // Freezer beef is not income. Counting it would inflate every P&L that has
    // a processed animal in it.
    expect(cutRevenue(processing())).toEqual(fromDollars(720));
  });

  it("reports the cutting yield against hanging weight", () => {
    expect(cuttingYield(processing())).toBeCloseTo((260 / 775) * 100, 6);
  });

  it("refuses a collection date before delivery", () => {
    const result = processingRecordSchema.safeParse({
      ...processing(),
      collectedOn: new Date("2027-04-01"),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------- P&L

const acquisition: AcquisitionRecord = {
  id: id(100),
  ...base,
  animalId: id(2),
  date: new Date("2025-04-01"),
  price: fromDollars(2400),
  type: "private",
};

const sale: SaleRecord = {
  id: id(101),
  ...base,
  animalId: id(3),
  date: new Date("2027-03-01"),
  price: fromDollars(3200),
  type: "sale_barn",
  commission: fromDollars(160),
};

describe("netSaleProceeds", () => {
  it("takes the barn's commission off the top", () => {
    expect(netSaleProceeds(sale)).toEqual(fromDollars(3040));
  });
});

describe("acquisitionCost", () => {
  it("says nothing for a home-raised calf rather than zero", () => {
    // A P&L that treats "raised here" as "free" understates every home-raised
    // animal against every purchased one.
    expect(acquisitionCost([acquisition], id(99))).toBeUndefined();
    expect(acquisitionCost([acquisition], id(2))).toEqual(fromDollars(2400));
  });
});

describe("animalProfitAndLoss", () => {
  const inputs = {
    animalId: id(2),
    acquisitions: [acquisition],
    sales: [],
    health: [
      {
        id: id(110),
        ...base,
        animalId: id(2),
        type: "treatment" as const,
        date: new Date("2026-08-01"),
        cost: fromDollars(85),
      },
    ],
    processing: [processing()],
  };

  it("adds the cost lines and the revenue lines", () => {
    const pl = animalProfitAndLoss({ ...inputs, allocatedFeed: fromDollars(900) });

    expect(pl.totalCost).toEqual(fromDollars(2400 + 900 + 85 + 650));
    expect(pl.totalRevenue).toEqual(fromDollars(720));
    expect(pl.net).toEqual(fromDollars(720 - 4035));
  });

  it("marks the figure incomplete when no feed has been allocated", () => {
    // A home-raised calf with no feed allocation yet shows a flattering
    // profit, and the screen has to be able to say so.
    expect(animalProfitAndLoss(inputs).complete).toBe(false);
  });

  it("marks it incomplete when a treatment was logged with no cost", () => {
    const noCost = {
      ...inputs,
      allocatedFeed: fromDollars(900),
      health: inputs.health.map((record) => ({ ...record, cost: undefined })),
    };
    expect(animalProfitAndLoss(noCost).complete).toBe(false);
  });

  it("is complete once every input has a figure", () => {
    expect(animalProfitAndLoss({ ...inputs, allocatedFeed: fromDollars(900) }).complete).toBe(true);
  });

  it("ignores another animal's records entirely", () => {
    const pl = animalProfitAndLoss({ ...inputs, animalId: id(88), allocatedFeed: fromDollars(0) });
    expect(pl.totalCost).toEqual(fromDollars(0));
  });
});

describe("herdRollup", () => {
  it("averages cost per head and counts the complete figures", () => {
    const rows = [
      animalProfitAndLoss({
        animalId: id(2),
        acquisitions: [acquisition],
        sales: [],
        health: [],
        processing: [],
        allocatedFeed: fromDollars(600),
      }),
      animalProfitAndLoss({
        animalId: id(3),
        acquisitions: [],
        sales: [sale],
        health: [],
        processing: [],
      }),
    ];

    const rollup = herdRollup(rows);

    expect(rollup.animals).toBe(2);
    expect(rollup.costPerHead).toEqual(fromDollars(1500));
    expect(rollup.completeAnimals).toBe(1);
  });

  it("does not divide by zero on an empty herd", () => {
    expect(herdRollup([]).costPerHead).toEqual(fromDollars(0));
  });
});

// ---------------------------------------------------------------- roadmap

const mating = (over: Partial<PlannedMating> = {}): PlannedMating => ({
  id: id(120),
  ...base,
  damId: id(2),
  method: "AI",
  semenInventoryId: id(60),
  targetSeason: "Spring 2027",
  rationale: "Calving ease on a first-calf heifer",
  planStatus: "open",
  ...over,
});

describe("matingToBreeding", () => {
  it("turns the plan into a breeding draft in one step", () => {
    const result = matingToBreeding(mating(), new Date("2027-03-14"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.damId).toBe(id(2));
      expect(result.draft.semenInventoryId).toBe(id(60));
      expect(result.draft.date).toEqual(new Date("2027-03-14"));
      expect(result.draft.notes).toBe("Calving ease on a first-calf heifer");
    }
  });

  it("refuses a plan that names only criteria until a cow is chosen", () => {
    // Criteria are enough to plan with and not enough to breed with — somebody
    // has to say which cow walked into the chute.
    const vague = mating({ damId: undefined, damCriteria: "whichever heifer settles" });
    const result = matingToBreeding(vague, AT);

    expect(result.ok).toBe(false);
  });

  it("accepts the cow supplied at the chute", () => {
    const vague = mating({ damId: undefined, damCriteria: "whichever heifer settles" });
    const result = matingToBreeding(vague, AT, { damId: id(7) });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.damId).toBe(id(7));
  });

  it("refuses to realise a plan twice", () => {
    expect(matingToBreeding(mating({ planStatus: "realised" }), AT).ok).toBe(false);
  });

  it("refuses a plan naming neither a dam nor criteria", () => {
    const result = plannedMatingSchema.safeParse({ ...mating(), damId: undefined });
    expect(result.success).toBe(false);
  });
});

describe("herdSizeProgress", () => {
  it("plots the target curve against what actually happened", () => {
    // §5.2's "1 → 20 over 5 years".
    const progress = herdSizeProgress(
      [
        { year: 2027, target: 4 },
        { year: 2026, target: 2 },
      ],
      new Map([[2026, 3]]),
    );

    expect(progress.map((row) => row.year)).toEqual([2026, 2027]);
    expect(progress[0]?.onTrack).toBe(true);
    expect(progress[1]?.actual).toBeUndefined();
  });
});

// ---------------------------------------------------------------- candidates

const detail = (over: Partial<CattleCandidateDetail> = {}): CattleCandidateDetail => ({
  candidateId: id(130),
  breedComposition: [{ breed: "Maine-Anjou", percent: 100 }],
  sex: "female",
  unpapered: false,
  regNumber: "M999",
  bred: false,
  saleType: "production_sale",
  saleDate: new Date("2026-08-20"),
  lotNumber: "14",
  ...over,
});

describe("candidateAgeMonths", () => {
  it("counts months from a date of birth", () => {
    expect(candidateAgeMonths({ dob: new Date("2025-02-11") }, AT)).toBe(18);
  });

  it("ages a stated age forward from the listing date", () => {
    // "18 months" on a March listing is 20 months in May. Comparing that
    // against a DOB-derived age without adjusting is comparing two dates.
    expect(candidateAgeMonths({ ageMonths: 18 }, AT, new Date("2026-06-11"))).toBe(20);
  });

  it("takes a stated age at face value with no listing date", () => {
    expect(candidateAgeMonths({ ageMonths: 18 }, AT)).toBe(18);
  });

  it("says nothing when neither is known", () => {
    expect(candidateAgeMonths({}, AT)).toBeUndefined();
  });
});

describe("upcomingSales", () => {
  const live = [{ id: id(130), status: "watching" as const }];

  it("raises a lot whose sale is inside the lead time", () => {
    // "Auction lots are a deadline, not a browse."
    expect(upcomingSales([detail()], live, AT, 14)).toHaveLength(1);
  });

  it("drops a candidate already passed on", () => {
    const passed = [{ id: id(130), status: "passed" as const }];
    expect(upcomingSales([detail()], passed, AT, 14)).toEqual([]);
  });

  it("ignores a sale that has already happened", () => {
    const gone = detail({ saleDate: new Date("2026-07-01") });
    expect(upcomingSales([gone], live, AT, 14)).toEqual([]);
  });
});
