import type { BreedShare } from "./cattle-profile.js";

/**
 * The AMAA upgrading chart (spec §5.2).
 *
 * Transcribed from the association's own chart. The thing worth understanding
 * before reading the table: **this is not arithmetic, and computing it would
 * give wrong answers.**
 *
 * A Fullblood bull on a 3/8 cow produces a calf that is 11/16 Maine by
 * halving — 68.75%, which is under 3/4. The chart says the calf registers as
 * **3/4**. The registry is deliberately more generous than the genetics in
 * places, because an upgrading programme exists to pull a herd up rather than
 * to describe it precisely. Anywhere the two disagree, the chart is what the
 * association will actually issue papers for, and the chart is what a breeder
 * plans around.
 *
 * So it is a lookup, printed row for row, and the arithmetic is left to
 * `expectedComposition`, which answers a different question.
 */

/**
 * The classes the chart deals in, weakest first.
 *
 * `commercial` is anything not registered with the AMAA — the association's
 * own definition, not a judgement about the animal. `outside_bull` is a
 * registered bull of another breed, which is a sire-only class: it appears in
 * the bull column and never in the female one.
 */
export const MAINE_CLASSES = [
  "commercial",
  "quarter",
  "three_eighths",
  "half",
  "five_eighths",
  "three_quarters",
  "purebred",
  "fullblood",
] as const;
export type MaineClass = (typeof MAINE_CLASSES)[number];

export type MaineSireClass = MaineClass | "outside_bull";

/** What each class is called on a paper, and the fraction it stands for. */
export const MAINE_CLASS_LABELS: Record<MaineSireClass, string> = {
  commercial: "Commercial",
  quarter: "1/4",
  three_eighths: "3/8",
  half: "1/2",
  five_eighths: "5/8",
  three_quarters: "3/4",
  purebred: "Purebred (7/8)",
  fullblood: "Fullblood (100%)",
  outside_bull: "Registered bull of another breed",
};

/** The share of Maine-Anjou each class stands for, as a percentage. */
const CLASS_PERCENT: Record<MaineClass, number> = {
  commercial: 0,
  quarter: 25,
  three_eighths: 37.5,
  half: 50,
  five_eighths: 62.5,
  three_quarters: 75,
  purebred: 87.5,
  fullblood: 100,
};

/**
 * A quarter Maine-Anjou, which is the floor for registering anything at all.
 *
 * Steers included — they are eligible on the same fraction, and may be
 * registered out of commercial sires, which no other class may.
 */
export const MAINE_MINIMUM_PERCENT = 25;

/**
 * The chart, row for row.
 *
 * Keyed `sire → dam → progeny`. Written out rather than generated because
 * every row is the association's decision and several of them do not follow
 * from any rule — `fullblood × three_eighths` gives 3/4 where halving gives
 * 11/16, and `five_eighths × three_quarters` gives 5/8 where halving gives
 * 11/16 the other way. A generator that produced those two would be a
 * coincidence, not a reading of the chart.
 */
const CHART: Partial<Record<MaineSireClass, Partial<Record<MaineClass, MaineClass>>>> = {
  fullblood: {
    fullblood: "fullblood",
    purebred: "purebred",
    three_quarters: "purebred",
    five_eighths: "three_quarters",
    half: "three_quarters",
    three_eighths: "three_quarters",
    quarter: "five_eighths",
    commercial: "half",
  },
  // The chart prints "Purebred × Fullblood = Purebred" and then folds the
  // purebred sire in with the fullblood one for every row below it.
  purebred: {
    fullblood: "purebred",
    purebred: "purebred",
    three_quarters: "purebred",
    five_eighths: "three_quarters",
    half: "three_quarters",
    three_eighths: "three_quarters",
    quarter: "five_eighths",
    commercial: "half",
  },
  three_quarters: {
    fullblood: "purebred",
    purebred: "purebred",
    three_quarters: "three_quarters",
    five_eighths: "five_eighths",
    half: "five_eighths",
    three_eighths: "half",
    quarter: "half",
    commercial: "three_eighths",
  },
  five_eighths: {
    fullblood: "three_quarters",
    purebred: "three_quarters",
    three_quarters: "five_eighths",
    five_eighths: "five_eighths",
    half: "half",
    three_eighths: "half",
    quarter: "three_eighths",
    commercial: "quarter",
  },
  half: {
    fullblood: "three_quarters",
    purebred: "three_quarters",
    three_quarters: "five_eighths",
    five_eighths: "half",
    half: "half",
    three_eighths: "three_eighths",
    quarter: "three_eighths",
    commercial: "quarter",
  },
  three_eighths: {
    fullblood: "three_quarters",
    purebred: "three_quarters",
    three_quarters: "half",
    five_eighths: "half",
    half: "three_eighths",
    three_eighths: "three_eighths",
    quarter: "quarter",
  },
  quarter: {
    fullblood: "five_eighths",
    purebred: "five_eighths",
    three_quarters: "half",
    five_eighths: "three_eighths",
    half: "three_eighths",
    three_eighths: "quarter",
    quarter: "quarter",
  },
  commercial: {
    fullblood: "half",
    purebred: "half",
    three_quarters: "three_eighths",
    five_eighths: "quarter",
    half: "quarter",
  },
  outside_bull: {
    fullblood: "half",
    purebred: "half",
    three_quarters: "three_eighths",
    five_eighths: "quarter",
    half: "quarter",
  },
};

export interface UpgradeResult {
  /** Undefined when the pairing produces nothing the AMAA will register. */
  readonly progeny?: MaineClass | undefined;
  readonly label: string;
  /** The colour of paper it would be issued on. */
  readonly paper?: MainePaper | undefined;
  /** Conditions the chart attaches to this row. */
  readonly conditions: readonly string[];
}

/**
 * What a pairing produces, per the chart.
 *
 * A combination the chart does not print is not an oversight — it is a
 * pairing that produces an animal under the quarter-Maine floor, and the
 * honest answer is that it registers as nothing.
 */
export function maineProgeny(sire: MaineSireClass, dam: MaineClass): UpgradeResult {
  const progeny = CHART[sire]?.[dam];
  const conditions: string[] = [];

  if (sire === "commercial") {
    conditions.push(
      "A commercial sire needs a commercial number on file with the AMAA before the calf can be registered.",
    );
  }
  if (sire === "outside_bull") {
    conditions.push(
      "A registered bull of another breed needs his pedigree filed with the AMAA — a one-off fee — before the calf can be registered.",
    );
  }
  if (dam === "commercial") {
    conditions.push(
      "An unregistered dam needs a commercial number before the calf can be registered.",
    );
    conditions.push(
      "A calf out of an unregistered dam does not qualify as bred and owned, whatever else it is.",
    );
  }

  if (progeny === undefined) {
    return {
      label: "Not eligible",
      conditions: [
        `The chart prints no row for ${MAINE_CLASS_LABELS[sire]} on ${MAINE_CLASS_LABELS[dam]}. It would fall under the quarter-Maine floor, which is the least the AMAA will register.`,
        ...conditions,
      ],
    };
  }

  return {
    progeny,
    label: MAINE_CLASS_LABELS[progeny],
    paper: mainePaper(progeny),
    conditions,
  };
}

export type MainePaper = "MaineTainer" | "High Maine" | "Maine Angus";

/**
 * Which paper it is issued on.
 *
 * MaineTainer is green and runs 1/4 through 5/8; High Maine is brown and runs
 * 3/4 through Fullblood. Maine Angus is a blue paper covering 3/8 to 5/8 — it
 * is not returned here because a percentage cannot tell you whether an animal
 * qualifies for it, and the AMAA has its own requirements for that. It is
 * named in `MAINE_ANGUS_NOTE` instead.
 */
export function mainePaper(maineClass: MaineClass): MainePaper | undefined {
  if (maineClass === "commercial") return undefined;
  return CLASS_PERCENT[maineClass] >= 75 ? "High Maine" : "MaineTainer";
}

export const MAINE_ANGUS_NOTE =
  "3/8, 1/2 and 5/8 animals may also qualify for Maine Angus (blue) papers, which the AMAA " +
  "judges on more than the fraction. Those papers read MaineTainer in the centre with a Maine " +
  "Angus logo, and may show in MaineTainer classes where no Maine-Angus class is offered.";

/**
 * The class a percentage falls in.
 *
 * Rounds **down** to the class the fraction reaches, because the association
 * issues the class an animal has actually earned. An animal at 70% Maine is a
 * 5/8, not a 3/4, and telling a breeder otherwise costs them a paper.
 */
export function maineClassFor(percent: number): MaineClass {
  const ordered = [...MAINE_CLASSES].reverse();
  // Half a point of slack, so an association's rounding and this farm's agree
  // — 87.49 and 87.5 are the same animal.
  return ordered.find((entry) => percent >= CLASS_PERCENT[entry] - 0.5) ?? "commercial";
}

/** The Maine-Anjou share of a composition. */
export function mainePercent(composition: readonly BreedShare[]): number {
  const wanted = new Set(["ma", "maine", "maine-anjou", "maine anjou"]);
  return composition
    .filter((share) => wanted.has(share.breed.trim().toLowerCase()))
    .reduce((total, share) => total + share.percent, 0);
}

/** Can this be registered at all? A quarter Maine is the floor, steers included. */
export function meetsMaineMinimum(percent: number): boolean {
  return percent >= MAINE_MINIMUM_PERCENT - 0.5;
}
