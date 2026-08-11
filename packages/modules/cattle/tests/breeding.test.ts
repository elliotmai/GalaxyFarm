import { describe, expect, it } from "vitest";

import { animalSchema, type Ulid } from "@galaxy-farm/core";

import {
  DEFAULT_GESTATION_DAYS,
  breedingRecordSchema,
  breedingsFor,
  calvingWindow,
  daysBred,
  isInCalvingWindow,
  pregCheckDue,
  projectedDueDate,
  serviceFor,
  type BreedingRecord,
} from "../src/domain/breeding-record.js";
import {
  calfFromCalving,
  calvingInterval,
  calvingRecordSchema,
  calfSequencesIn,
  calfTag,
  nextCalfSequence,
  producedLiveCalf,
  suggestedCalfTag,
  yearLetter,
  type CalvingRecord,
} from "../src/domain/calving-record.js";

/**
 * Breeding and calving (spec §5.2).
 *
 * The dates in here are the farm's real ones. Andromeda was bred by AI on
 * 14 February 2026 to ZNT Montego Bay; at the spec's flat 283-day gestation
 * (§12 decision 2) that is 24 November 2026, and the watch opens on the 10th.
 * If these tests ever disagree with `docs/property-layout.md`, one of the two
 * is wrong and it matters which.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const BRED_ON = new Date("2026-02-14T00:00:00Z");

const breeding = (over: Partial<BreedingRecord> = {}): BreedingRecord => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  damId: id(2),
  method: "AI",
  sireExternalId: id(3),
  date: BRED_ON,
  ...over,
});

describe("projectedDueDate", () => {
  it("puts Andromeda on 24 November 2026", () => {
    // The date the whole of Phase 1 is racing. 14 Feb + 283 days.
    expect(projectedDueDate(breeding())).toEqual(new Date("2026-11-24T00:00:00Z"));
  });

  it("uses the flat 283 days §12 decision 2 settled on", () => {
    expect(DEFAULT_GESTATION_DAYS).toBe(283);
  });

  it("lets one record override the default without moving anyone else's", () => {
    expect(projectedDueDate(breeding({ gestationDays: 280 }))).toEqual(
      new Date("2026-11-21T00:00:00Z"),
    );
  });

  it("follows the property setting when the record says nothing", () => {
    expect(projectedDueDate(breeding(), 285)).toEqual(new Date("2026-11-26T00:00:00Z"));
  });
});

describe("calvingWindow", () => {
  it("opens on 10 November, a fortnight before she is due", () => {
    // docs/property-layout.md states this date. Two places, one answer.
    expect(calvingWindow(breeding()).from).toEqual(new Date("2026-11-10T00:00:00Z"));
  });

  it("closes a fortnight after, half-open at the far end", () => {
    // Half-open so a cow calving on 8 December is still inside her window that
    // morning rather than having dropped out of it at midnight.
    expect(calvingWindow(breeding()).to).toEqual(new Date("2026-12-09T00:00:00Z"));
  });
});

describe("isInCalvingWindow", () => {
  it("is false in August and true on the day it opens", () => {
    expect(isInCalvingWindow(breeding(), AT)).toBe(false);
    expect(isInCalvingWindow(breeding(), new Date("2026-11-10T06:00:00Z"))).toBe(true);
  });

  it("stops watching a cow confirmed open", () => {
    // A cow that came back open is not about to calve. Leaving her on the
    // dashboard for a month teaches people to ignore the card.
    const open = breeding({
      pregCheck: { date: new Date("2026-04-01"), result: "open", method: "ultrasound" },
    });

    expect(isInCalvingWindow(open, new Date("2026-11-15"))).toBe(false);
  });

  it("keeps watching a cow confirmed bred", () => {
    const bred = breeding({
      pregCheck: { date: new Date("2026-04-01"), result: "bred", method: "ultrasound" },
    });

    expect(isInCalvingWindow(bred, new Date("2026-11-15"))).toBe(true);
  });
});

describe("daysBred", () => {
  it("says how far along she is, which is how the watch alert reads", () => {
    // §6's example: "Dolly is at day 279".
    expect(daysBred(breeding(), new Date("2026-11-20T00:00:00Z"))).toBe(279);
  });
});

describe("pregCheckDue", () => {
  it("waits for the earliest date the method is reliable", () => {
    // 35 days for ultrasound. Checking early reads open on a bred cow, and
    // that is the expensive direction — she gets sold or re-bred.
    expect(pregCheckDue(breeding())).toEqual(new Date("2026-03-21T00:00:00Z"));
    expect(pregCheckDue(breeding(), "palpation")).toEqual(new Date("2026-03-31T00:00:00Z"));
  });

  it("stops asking once she has been checked", () => {
    const checked = breeding({
      pregCheck: { date: new Date("2026-03-25"), result: "bred", method: "ultrasound" },
    });

    expect(pregCheckDue(checked)).toBeUndefined();
  });

  it("keeps asking after an inconclusive check", () => {
    const recheck = breeding({
      pregCheck: { date: new Date("2026-03-25"), result: "recheck", method: "ultrasound" },
    });

    expect(pregCheckDue(recheck)).toBeDefined();
  });
});

describe("breedingRecordSchema", () => {
  it("accepts the real record", () => {
    expect(breedingRecordSchema.safeParse(breeding()).success).toBe(true);
  });

  it("refuses a natural service with no bull", () => {
    const result = breedingRecordSchema.safeParse({
      ...breeding(),
      method: "natural",
      sireExternalId: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("refuses an AI breeding naming neither a straw nor a sire", () => {
    // Without one of the two the calf cannot be pedigreed, which is the whole
    // reason the breeding was recorded.
    const result = breedingRecordSchema.safeParse({
      ...breeding(),
      sireExternalId: undefined,
      semenInventoryId: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an AI breeding identified by the straw alone", () => {
    const result = breedingRecordSchema.safeParse({
      ...breeding(),
      sireExternalId: undefined,
      semenInventoryId: id(9),
    });
    expect(result.success).toBe(true);
  });

  it("refuses a pregnancy check dated before the breeding", () => {
    const result = breedingRecordSchema.safeParse({
      ...breeding(),
      pregCheck: { date: new Date("2026-01-01"), result: "bred", method: "blood" },
    });
    expect(result.success).toBe(false);
  });
});

describe("serviceFor", () => {
  const february = breeding({ id: id(10), date: BRED_ON });
  const may = breeding({ id: id(11), date: new Date("2026-05-20") });

  it("credits the service that preceded the birth", () => {
    // Picked by "most recent before the birth", not by whichever projection
    // lands closest: a cow calving three weeks early still calved to the
    // service that bred her.
    const found = serviceFor([february, may], id(2), new Date("2026-11-03"));
    expect(found?.id).toBe(id(11));
  });

  it("ignores a service recorded after the calf was on the ground", () => {
    const found = serviceFor([february, may], id(2), new Date("2026-03-01"));
    expect(found?.id).toBe(id(10));
  });

  it("says nothing rather than guessing when no service predates the birth", () => {
    expect(serviceFor([february], id(2), new Date("2026-01-01"))).toBeUndefined();
  });
});

describe("breedingsFor", () => {
  it("returns one dam's breedings, newest first", () => {
    const mine = breeding({ id: id(12), date: new Date("2026-05-20") });
    const hers = breeding({ id: id(13), damId: id(99) });

    expect(breedingsFor([hers, breeding(), mine], id(2)).map((r) => r.id)).toEqual([id(12), id(1)]);
  });
});

// ---------------------------------------------------------------- calving

const calving = (over: Partial<CalvingRecord> = {}): CalvingRecord => ({
  id: id(20),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  damId: id(2),
  breedingRecordId: id(1),
  date: new Date("2026-11-22T04:00:00Z"),
  calvingEase: 1,
  vigour: "vigorous",
  calfSex: "female",
  birthWeightLb: 78,
  assisted: false,
  ...over,
});

describe("calvingRecordSchema", () => {
  it("accepts an unassisted calving", () => {
    expect(calvingRecordSchema.safeParse(calving()).success).toBe(true);
  });

  it("refuses an assisted calving recorded as ease 1", () => {
    // Ease 1 means unassisted by definition; the two disagreeing is a mis-tap
    // that would skew any calving-ease summary built on either field.
    const result = calvingRecordSchema.safeParse({ ...calving(), assisted: true });
    expect(result.success).toBe(false);
  });

  it("refuses a birth weight that is obviously a mature weight", () => {
    expect(calvingRecordSchema.safeParse({ ...calving(), birthWeightLb: 780 }).success).toBe(false);
  });
});

describe("calfFromCalving", () => {
  const context = { propertyId: id(0), ownership: "own" as const, tagNumber: "601P" };

  it("creates the calf with the dam's calving date as its birthday", () => {
    const draft = calfFromCalving(calving(), { externalId: id(3) }, context);

    expect(draft?.animal.dob).toEqual(new Date("2026-11-22T04:00:00Z"));
    expect(draft?.animal.dobIsEstimate).toBe(false);
    expect(draft?.animal.species).toBe("cattle");
  });

  it("wires the pedigree to the dam and the service sire", () => {
    // The point of the whole flow: nobody types a sire the app already knows.
    const draft = calfFromCalving(calving(), { externalId: id(3) }, context);

    expect(draft?.pedigree.damId).toBe(id(2));
    expect(draft?.pedigree.sireExternalId).toBe(id(3));
  });

  it("starts the calf at safety level 1, not the dam's", () => {
    // §5.1 elevates the *dam* after calving, not the calf. Inheriting her
    // level would flag a newborn as something a helper must not approach.
    expect(calfFromCalving(calving(), {}, context)?.animal.safetyLevel).toBe(1);
  });

  it("tags the calf but does not name it", () => {
    // Forcing a name at birth produces a herd of "Calf 3"s nobody renames. A
    // tag is different — it is what actually goes in the ear.
    const draft = calfFromCalving(calving(), {}, context);
    expect(draft?.animal.name).toBeUndefined();
    expect(draft?.animal.tagNumber).toBe("601P");
  });

  it("produces a calf the animal schema will actually accept", () => {
    // The test that was missing. Every assertion above reads a field off the
    // draft, so none of them noticed that the draft had neither a name nor a
    // tag and `animalSchema` requires one — the calf was unsaveable, and the
    // first real calving would have been what discovered it.
    const draft = calfFromCalving(calving(), { externalId: id(3) }, context);
    const now = new Date("2026-11-22T05:00:00Z");

    const parsed = animalSchema.safeParse({
      ...draft?.animal,
      id: id(50),
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.success).toBe(true);
  });

  it("creates nothing for a stillbirth", () => {
    // The calving is still recorded — it matters to the dam's history — but
    // there is no animal.
    expect(calfFromCalving(calving({ vigour: "stillborn" }), {}, context)).toBeUndefined();
  });

  it("refuses to create the calf twice", () => {
    // Running the flow again after a dropped connection must not produce twins.
    expect(calfFromCalving(calving({ calfAnimalId: id(30) }), {}, context)).toBeUndefined();
  });

  it("carries the owner through for a client calf", () => {
    const draft = calfFromCalving(
      calving(),
      {},
      {
        propertyId: id(0),
        ownership: "client",
        ownerId: id(40),
        tagNumber: "601P",
      },
    );

    expect(draft?.animal.ownership).toBe("client");
    expect(draft?.animal.ownerId).toBe(id(40));
  });

  it("carries the birth weight so it can be logged as a weight record", () => {
    expect(calfFromCalving(calving(), {}, context)?.birthWeightLb).toBe(78);
  });
});

describe("producedLiveCalf", () => {
  it.each([
    ["vigorous", true],
    ["slow", true],
    ["weak", true],
    ["stillborn", false],
  ] as const)("%s → %s", (vigour, expected) => {
    expect(producedLiveCalf({ vigour })).toBe(expected);
  });
});

describe("calvingInterval", () => {
  it("measures the gap between her last two calvings", () => {
    const first = calving({ id: id(21), date: new Date("2025-11-20") });
    const second = calving({ id: id(22), date: new Date("2026-11-22") });

    expect(calvingInterval([first, second], id(2))).toBe(367);
  });

  it("says nothing for a first-calf heifer", () => {
    expect(calvingInterval([calving()], id(2))).toBeUndefined();
  });
});

describe("yearLetter", () => {
  it("puts 2026 at P, which is the year this farm is calving", () => {
    // The anchor for the whole system. Off by one here and every tag on the
    // farm is wrong by a year.
    expect(yearLetter(2026)).toBe("P");
  });

  it("skips I, O, Q and V", () => {
    // Unreadable on a tag at arm's length in a chute: I and O read as 1 and 0,
    // Q is a smudged O, V is a bent U.
    const cycle = Array.from({ length: 22 }, (_, offset) => yearLetter(2013 + offset)).join("");

    expect(cycle).toBe("ABCDEFGHJKLMNPRSTUWXYZ");
    for (const skipped of ["I", "O", "Q", "V"]) {
      expect(cycle).not.toContain(skipped);
    }
  });

  it("runs the years either side of 2026 in order", () => {
    expect(yearLetter(2025)).toBe("N");
    expect(yearLetter(2027)).toBe("R");
  });

  it("wraps after twenty-two years rather than running off the end", () => {
    expect(yearLetter(2035)).toBe(yearLetter(2013));
    expect(yearLetter(2012)).toBe("Z");
  });
});

describe("calfTag", () => {
  it("builds the farm's format: year digit, calf number, year letter", () => {
    expect(calfTag(2026, 1)).toBe("601P");
    expect(calfTag(2026, 12)).toBe("612P");
  });

  it("pads a single-digit calf number", () => {
    // 61P and 601P are different tags, and a farm reading a column of them
    // wants the digits to line up.
    expect(calfTag(2026, 7)).toBe("607P");
  });

  it("does not truncate past ninety-nine calves", () => {
    // This farm will not have a hundred calves for years, but silently
    // wrapping to 600P would put two animals in the same tag.
    expect(calfTag(2026, 100)).toBe("6100P");
  });
});

describe("calfSequencesIn", () => {
  it("reads back the numbers already issued this year", () => {
    expect(calfSequencesIn(["601P", "603P", "602P"], 2026)).toEqual([1, 3, 2]);
  });

  it("ignores tags from other years", () => {
    // 501N is last year's. Counting it would skip a number this year.
    expect(calfSequencesIn(["601P", "501N", "705R"], 2026)).toEqual([1]);
  });

  it("ignores a tag in somebody else's format", () => {
    // A bought-in animal wears whatever it arrived in.
    expect(calfSequencesIn(["601P", "Andromeda", "14", undefined], 2026)).toEqual([1]);
  });

  it("accepts a lower-case tag, because somebody will type one", () => {
    expect(calfSequencesIn(["601p"], 2026)).toEqual([1]);
  });
});

describe("nextCalfSequence", () => {
  it("starts at one on an empty year", () => {
    expect(nextCalfSequence([], 2026)).toBe(1);
  });

  it("takes the highest already used and adds one", () => {
    expect(nextCalfSequence(["601P", "602P", "603P"], 2026)).toBe(4);
  });

  it("does not reuse a number when a calf has been removed", () => {
    // Highest-plus-one rather than count-plus-one. Two animals wearing 603P
    // is a problem that surfaces at weaning, when nobody can tell which
    // weight belongs to which calf.
    expect(nextCalfSequence(["601P", "603P"], 2026)).toBe(4);
  });
});

describe("suggestedCalfTag", () => {
  const bornOn = new Date("2026-11-22T04:00:00Z");

  it("suggests 601P for the first calf of 2026", () => {
    expect(suggestedCalfTag([], bornOn)).toBe("601P");
  });

  it("counts only the calves already tagged this year", () => {
    expect(suggestedCalfTag(["601P", "602P", "501N", "Andromeda"], bornOn)).toBe("603P");
  });

  it("does not count a stillbirth, because a stillbirth never gets a tag", () => {
    // Structural rather than a special case, and worth pinning: `calfFromCalving`
    // returns undefined for a stillborn calf, so no Animal is created, so no
    // tag is ever issued — and the number it would have taken is still free
    // for the next live calf. A stillbirth that consumed 602P would leave a
    // gap in the year's tags that nobody could account for later.
    const stillborn = calfFromCalving(
      calving({ vigour: "stillborn" }),
      {},
      {
        propertyId: id(0),
        ownership: "own" as const,
        tagNumber: "602P",
      },
    );
    expect(stillborn).toBeUndefined();

    // One live calf on the ground and one stillbirth recorded: the next calf
    // is 602P, not 603P.
    expect(suggestedCalfTag(["601P"], bornOn)).toBe("602P");
  });
});
