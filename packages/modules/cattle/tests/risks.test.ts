import { describe, expect, it } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

import type { BreedingRecord } from "../src/domain/breeding-record.js";
import type { CalvingRecord } from "../src/domain/calving-record.js";
import type { HealthRecord } from "../src/domain/health-record.js";
import {
  assessRisks,
  averageRebreeds,
  assistedBirths,
  earlyCalfDeaths,
  frequentTreatment,
  highRebreeds,
  missingVaccinations,
  notCalvedRecently,
  prematureCalves,
  type RiskInput,
} from "../src/domain/risks.js";

/**
 * The risks page (§5.2).
 *
 * Half of these tests are about a risk *not* firing, and that is the point. A
 * page that flags every animal with a thin record is a page nobody opens
 * twice, so every check has to be able to tell "this cow has a problem" from
 * "nobody has written anything about this cow".
 */

const id = (n: number) => String(n).padStart(26, "0") as Ulid;
const NOW = new Date("2026-08-12T12:00:00Z");
const AT = new Date("2026-01-01T00:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const cow = (over: Partial<Animal> = {}): Animal => ({
  id: id(1),
  ...base,
  species: "cattle",
  name: "Andromeda",
  sex: "female",
  dob: new Date("2020-03-01T00:00:00Z"),
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 2,
  photoKeys: [],
  ...over,
});

const calving = (over: Partial<CalvingRecord> = {}): CalvingRecord => ({
  id: id(10),
  ...base,
  damId: id(1),
  date: new Date("2026-03-01T00:00:00Z"),
  calvingEase: 1,
  birthType: "natural",
  vigour: "vigorous",
  assisted: false,
  ...over,
});

const breeding = (over: Partial<BreedingRecord> = {}): BreedingRecord => ({
  id: id(20),
  ...base,
  damId: id(1),
  date: new Date("2025-06-01T00:00:00Z"),
  method: "AI",
  ...over,
});

const health = (over: Partial<HealthRecord> = {}): HealthRecord => ({
  id: id(30),
  ...base,
  animalId: id(1),
  type: "treatment",
  date: new Date("2026-06-01T00:00:00Z"),
  route: "subcutaneous",
  ...over,
});

const input = (over: Partial<RiskInput> = {}): RiskInput => ({
  animals: [cow()],
  profiles: [],
  breedings: [],
  calvings: [],
  health: [],
  now: NOW,
  ...over,
});

describe("cows that have not calved", () => {
  it("flags one whose last calf was over two years ago", () => {
    const risks = notCalvedRecently(
      input({ calvings: [calving({ date: new Date("2023-03-01T00:00:00Z") })] }),
    );

    expect(risks).toHaveLength(1);
    expect(risks[0]?.detail).toMatch(/has not calved/i);
  });

  it("leaves alone a cow who calved this spring", () => {
    expect(notCalvedRecently(input({ calvings: [calving()] }))).toEqual([]);
  });

  it("does not flag a heifer too young to have calved", () => {
    const heifer = cow({ dob: new Date("2025-03-01T00:00:00Z") });

    expect(notCalvedRecently(input({ animals: [heifer] }))).toEqual([]);
  });

  it("says nothing about a cow whose age nobody recorded", () => {
    // "Never calved and we do not know how old she is" is a records problem,
    // not a fertility problem, and reporting it as the latter is noise.
    const unknown = cow({ dob: undefined });

    expect(notCalvedRecently(input({ animals: [unknown] }))).toEqual([]);
  });

  it("leaves bulls and sold cows out of it", () => {
    const bull = cow({ id: id(2), sex: "male" });
    const sold = cow({ id: id(3), status: "sold" });

    expect(notCalvedRecently(input({ animals: [bull, sold] }))).toEqual([]);
  });
});

describe("rebreeds", () => {
  it("averages services against calves, not against years", () => {
    const average = averageRebreeds(
      [breeding(), breeding({ id: id(21) }), breeding({ id: id(22) })],
      [calving()],
      id(1),
    );

    expect(average).toBe(3);
  });

  it("says nothing about a heifer bred twice and not yet calved", () => {
    // No completed cycle to average over. She is a cow in calf, not a
    // rebreeder, and calling her one would be a guess about a pregnancy.
    expect(averageRebreeds([breeding(), breeding({ id: id(21) })], [], id(1))).toBeUndefined();
  });

  it("flags a cow over the line and not one on it", () => {
    const over = highRebreeds(
      input({
        breedings: [breeding(), breeding({ id: id(21) }), breeding({ id: id(22) })],
        calvings: [calving()],
      }),
    );
    const on = highRebreeds(input({ breedings: [breeding()], calvings: [calving()] }));

    expect(over).toHaveLength(1);
    expect(on).toEqual([]);
  });
});

describe("premature calves", () => {
  it("waits for a second one before calling it a pattern", () => {
    const once = prematureCalves(input({ calvings: [calving({ premature: true })] }));
    const twice = prematureCalves(
      input({
        calvings: [calving({ premature: true }), calving({ id: id(11), premature: true })],
      }),
    );

    expect(once).toEqual([]);
    expect(twice).toHaveLength(1);
  });
});

describe("calves lost early", () => {
  it("counts a stillbirth", () => {
    const risks = earlyCalfDeaths(input({ calvings: [calving({ vigour: "stillborn" })] }));

    expect(risks).toHaveLength(1);
  });

  it("counts a calf that died inside its first month", () => {
    const calf = cow({
      id: id(5),
      name: "calf",
      dob: new Date("2026-03-01T00:00:00Z"),
      diedOn: new Date("2026-03-10T00:00:00Z"),
      status: "deceased",
    });

    const risks = earlyCalfDeaths(
      input({ animals: [cow(), calf], calvings: [calving({ calfAnimalId: id(5) })] }),
    );

    expect(risks).toHaveLength(1);
  });

  it("does not hang a four-month-old calf's death on its dam", () => {
    // At four months it is about a fence, a snake, or luck. Blaming the cow
    // would be unfair to her and useless to whoever reads the page.
    const calf = cow({
      id: id(5),
      dob: new Date("2026-03-01T00:00:00Z"),
      diedOn: new Date("2026-07-01T00:00:00Z"),
      status: "deceased",
    });

    expect(
      earlyCalfDeaths(
        input({ animals: [cow(), calf], calvings: [calving({ calfAnimalId: id(5) })] }),
      ),
    ).toEqual([]);
  });

  it("says nothing about a living calf", () => {
    const calf = cow({ id: id(5), dob: new Date("2026-03-01T00:00:00Z") });

    expect(
      earlyCalfDeaths(
        input({ animals: [cow(), calf], calvings: [calving({ calfAnimalId: id(5) })] }),
      ),
    ).toEqual([]);
  });
});

describe("treatments", () => {
  it("flags an animal treated four times in a year", () => {
    const many = Array.from({ length: 4 }, (_, i) => health({ id: id(30 + i) }));

    expect(frequentTreatment(input({ health: many }))).toHaveLength(1);
  });

  it("does not count vaccinations", () => {
    // Otherwise the whole herd lands on this page every spring, which is the
    // fastest way to teach somebody to ignore it.
    const shots = Array.from({ length: 6 }, (_, i) =>
      health({ id: id(30 + i), type: "vaccination" }),
    );

    expect(frequentTreatment(input({ health: shots }))).toEqual([]);
  });

  it("only counts the last year", () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      health({ id: id(30 + i), date: new Date("2023-01-01T00:00:00Z") }),
    );

    expect(frequentTreatment(input({ health: old }))).toEqual([]);
  });
});

describe("births that needed help", () => {
  it("treats a C-section as more serious than a pull, however many pulls", () => {
    const section = assistedBirths(input({ calvings: [calving({ birthType: "c_section" })] }));
    const pulls = assistedBirths(
      input({
        calvings: [
          calving({ birthType: "pulled", assisted: true }),
          calving({ id: id(11), birthType: "pulled", assisted: true }),
        ],
      }),
    );

    expect(section[0]?.severity).toBe("serious");
    expect(pulls[0]?.severity).toBe("concern");
  });

  it("says nothing about a cow who calves on her own", () => {
    expect(assistedBirths(input({ calvings: [calving()] }))).toEqual([]);
  });
});

describe("boosters", () => {
  it("flags one that came due and was never given", () => {
    const risks = missingVaccinations(
      input({
        health: [
          health({
            type: "vaccination",
            date: new Date("2026-01-01T00:00:00Z"),
            boosterDueOn: new Date("2026-02-01T00:00:00Z"),
            product: "Bovi-Shield",
          }),
        ],
      }),
    );

    expect(risks).toHaveLength(1);
    expect(risks[0]?.detail).toMatch(/Bovi-Shield/);
  });

  it("clears once something was given after the due date", () => {
    const risks = missingVaccinations(
      input({
        health: [
          health({
            id: id(30),
            type: "vaccination",
            date: new Date("2026-01-01T00:00:00Z"),
            boosterDueOn: new Date("2026-02-01T00:00:00Z"),
          }),
          health({ id: id(31), type: "vaccination", date: new Date("2026-02-05T00:00:00Z") }),
        ],
      }),
    );

    expect(risks).toEqual([]);
  });

  it("says nothing about an animal with no vaccination history at all", () => {
    // Unrecorded is not overdue. The two need different work.
    expect(missingVaccinations(input())).toEqual([]);
  });

  it("does not flag one that is not due yet", () => {
    expect(
      missingVaccinations(
        input({
          health: [health({ type: "vaccination", boosterDueOn: new Date("2027-01-01T00:00:00Z") })],
        }),
      ),
    ).toEqual([]);
  });
});

describe("the page as a whole", () => {
  it("finds nothing wrong with a herd that has nothing wrong with it", () => {
    const report = assessRisks(input({ calvings: [calving()] }));

    expect(report.risks).toEqual([]);
    expect(report.counts.not_calved).toBe(0);
  });

  it("puts the serious ones first", () => {
    const report = assessRisks(
      input({
        calvings: [
          calving({ birthType: "c_section" }),
          calving({ id: id(11), date: new Date("2023-01-01T00:00:00Z") }),
        ],
      }),
    );

    expect(report.risks[0]?.severity).toBe("serious");
  });

  it("groups by animal, so one cow's troubles read together", () => {
    const report = assessRisks(
      input({
        calvings: [
          calving({ date: new Date("2023-01-01T00:00:00Z"), birthType: "pulled", assisted: true }),
        ],
      }),
    );

    expect(report.byAnimal.get(id(1))?.length).toBeGreaterThanOrEqual(2);
  });

  it("stays silent on a herd nobody has recorded anything about", () => {
    // The single most important case: a fresh install must not open on a wall
    // of warnings about animals whose records simply have not been filled in.
    const report = assessRisks(input({ animals: [cow({ dob: undefined })] }));

    expect(report.risks).toEqual([]);
  });
});
