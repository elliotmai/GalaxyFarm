import type { Animal, Ulid } from "@galaxy-farm/core";

import { predictColour, readExtension, readRoan, type CoatGenotype } from "./coat-colour.js";
import type { BreedingRecord } from "./breeding-record.js";
import type { CalvingRecord } from "./calving-record.js";
import type { CattleProfile } from "./cattle-profile.js";
import type { HealthRecord } from "./health-record.js";

/**
 * The things worth being told about without asking (spec §5.2).
 *
 * Every check here is a question a good cattleman already asks, and the point
 * of the page is that nobody asks all eight of them about all forty head every
 * month. A cow that has not calved in two years is obvious about one cow and
 * invisible across a herd.
 *
 * Two rules run through the whole file. First, a risk names the animal and
 * says what to do — "Andromeda has not calved since March 2024" beats "1 open
 * cow". Second, **thin records never produce a risk**: an animal with nothing
 * recorded is not a problem animal, it is an animal nobody has written
 * anything about, and a page that cried wolf over those would be closed by
 * February and never opened again.
 */

export const RISK_KINDS = [
  "not_calved",
  "rebreeds",
  "premature",
  "calf_deaths",
  "impossible_colour",
  "frequent_treatment",
  "assisted_births",
  "missing_vaccination",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export type RiskSeverity = "watch" | "concern" | "serious";

export interface Risk {
  readonly kind: RiskKind;
  readonly animalId: Ulid;
  readonly severity: RiskSeverity;
  /** One line, naming the animal's own facts rather than a category. */
  readonly detail: string;
  /** What it is measured against, so the threshold is arguable. */
  readonly measure?: string | undefined;
}

export interface RiskInput {
  readonly animals: readonly Animal[];
  readonly profiles: readonly CattleProfile[];
  readonly breedings: readonly BreedingRecord[];
  readonly calvings: readonly CalvingRecord[];
  readonly health: readonly HealthRecord[];
  readonly now: Date;
}

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);

/* ----------------------------------------------------- the eight checks */

/** Two years since her last calf, on a cow old enough to have had one. */
export const OPEN_TOO_LONG_DAYS = 730;

/**
 * Breeding-age females who have not calved in two years.
 *
 * Measured from her last calving, not from her last breeding: a cow bred four
 * times and still open is the same problem as a cow nobody put a bull with,
 * and both show up here.
 *
 * A heifer who has never calved is only a risk once she is old enough that she
 * should have — two years plus a gestation. Before that she is a heifer.
 */
export function notCalvedRecently(input: RiskInput): Risk[] {
  const risks: Risk[] = [];

  for (const animal of input.animals) {
    if (animal.sex !== "female" || animal.status !== "active") continue;

    const hers = input.calvings
      .filter((record) => record.damId === animal.id)
      .sort((left, right) => right.date.getTime() - left.date.getTime());
    const last = hers[0];

    if (last === undefined) {
      // Never calved. Only a question once she is past the age at which a
      // first calf was the plan — roughly three years old.
      if (animal.dob === undefined) continue;
      const age = days(animal.dob, input.now);
      if (age < 3 * 365) continue;

      risks.push({
        kind: "not_calved",
        animalId: animal.id,
        severity: "concern",
        detail: `Has never calved, and she is ${Math.floor(age / 365)} years old.`,
        measure: "First calf is usually at two.",
      });
      continue;
    }

    const since = days(last.date, input.now);
    if (since < OPEN_TOO_LONG_DAYS) continue;

    risks.push({
      kind: "not_calved",
      animalId: animal.id,
      severity: since >= OPEN_TOO_LONG_DAYS * 1.5 ? "serious" : "concern",
      detail: `Has not calved since ${last.date.toLocaleDateString()} — ${Math.floor(since / 30)} months.`,
      measure: `Two years is ${OPEN_TOO_LONG_DAYS} days.`,
    });
  }

  return risks;
}

/**
 * Services per calf, averaged.
 *
 * A cow taking three services to settle costs a straw, a sync protocol and
 * sixty days each time, and she does it every year. Two is the line the owner
 * set; the figure is per calving cycle rather than per lifetime, so a cow with
 * one bad year and four good ones is not condemned by the average.
 */
export const REBREED_LIMIT = 2;

export function averageRebreeds(
  breedings: readonly BreedingRecord[],
  calvings: readonly CalvingRecord[],
  animalId: Ulid,
): number | undefined {
  const hers = breedings.filter((record) => record.damId === animalId);
  const calved = calvings.filter((record) => record.damId === animalId);

  // No calves means no completed cycle to average over. A heifer bred twice
  // and now carrying is not a rebreeder, she is a cow in calf.
  if (calved.length === 0 || hers.length === 0) return undefined;
  return hers.length / calved.length;
}

export function highRebreeds(input: RiskInput): Risk[] {
  return input.animals
    .filter((animal) => animal.sex === "female" && animal.status === "active")
    .flatMap((animal) => {
      const average = averageRebreeds(input.breedings, input.calvings, animal.id);
      if (average === undefined || average < REBREED_LIMIT) return [];

      return [
        {
          kind: "rebreeds" as const,
          animalId: animal.id,
          severity: average >= 3 ? ("serious" as const) : ("concern" as const),
          detail: `Takes ${average.toFixed(1)} services per calf.`,
          measure: `${REBREED_LIMIT} is the line.`,
        },
      ];
    });
}

/** Two premature calves is a pattern rather than a bad year. */
export function prematureCalves(input: RiskInput): Risk[] {
  const counts = new Map<Ulid, number>();
  for (const record of input.calvings) {
    if (record.premature !== true) continue;
    counts.set(record.damId, (counts.get(record.damId) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, count]) => count >= 2)
    .map(([animalId, count]) => ({
      kind: "premature" as const,
      animalId,
      severity: count >= 3 ? ("serious" as const) : ("concern" as const),
      detail: `${count} calves born early.`,
      measure: "Two is a pattern rather than a bad year.",
    }));
}

/** A month. Past it, a calf that dies is usually not about the dam. */
export const CALF_DEATH_WINDOW_DAYS = 30;

/**
 * Calves lost inside a month, by dam.
 *
 * The window matters: a calf lost at three days is about the calving, the
 * colostrum, or the cow. A calf lost at four months is about a fence, a snake,
 * or luck, and hanging that on the dam would be unfair to her and useless to
 * whoever reads it.
 *
 * A stillbirth counts. It is the same conversation about the same cow.
 */
export function earlyCalfDeaths(input: RiskInput): Risk[] {
  const byId = new Map(input.animals.map((animal) => [animal.id, animal]));
  const counts = new Map<Ulid, number>();

  const note = (damId: Ulid) => counts.set(damId, (counts.get(damId) ?? 0) + 1);

  for (const record of input.calvings) {
    if (record.vigour === "stillborn") {
      note(record.damId);
      continue;
    }

    const calf = record.calfAnimalId === undefined ? undefined : byId.get(record.calfAnimalId);
    if (calf?.diedOn === undefined) continue;
    if (days(record.date, calf.diedOn) > CALF_DEATH_WINDOW_DAYS) continue;
    note(record.damId);
  }

  return [...counts].map(([animalId, count]) => ({
    kind: "calf_deaths" as const,
    animalId,
    severity: count >= 2 ? ("serious" as const) : ("watch" as const),
    detail:
      count === 1
        ? "Lost a calf inside its first month."
        : `Has lost ${count} calves inside their first month.`,
    measure: `Counted within ${CALF_DEATH_WINDOW_DAYS} days of calving.`,
  }));
}

/**
 * A calf whose colour its parents could not have produced.
 *
 * Which means one of three things, in descending order of likelihood: the
 * colour was typed wrong, the sire on the record is not the sire, or a genotype
 * is wrong. All three are worth knowing, and the second is worth knowing a
 * great deal.
 *
 * Only runs where both parents have a genotype on file *and* the calf has one
 * — a colour typed as free text cannot be checked against a Punnett square
 * without guessing what "roan" meant, and guessing here would accuse somebody
 * of a mis-sired calf on the strength of a spelling.
 */
export function impossibleColours(input: RiskInput): Risk[] {
  const profileByAnimal = new Map(input.profiles.map((profile) => [profile.animalId, profile]));
  const risks: Risk[] = [];

  for (const record of input.calvings) {
    if (record.calfAnimalId === undefined) continue;

    const calf = profileByAnimal.get(record.calfAnimalId);
    const dam = profileByAnimal.get(record.damId);
    if (calf?.coatGenotype === undefined || dam?.coatGenotype === undefined) continue;

    // The sire of the *calf* comes off the calf's own profile, not the dam's.
    const sire =
      calf.sire === undefined
        ? undefined
        : calf.sire.kind === "animal"
          ? profileByAnimal.get(calf.sire.id)
          : undefined;
    if (sire?.coatGenotype === undefined) continue;

    const possible = new Set(
      predictColour(sire.coatGenotype, dam.coatGenotype).outcomes.flatMap(
        (outcome) => outcome.genotypes,
      ),
    );
    const actual = writeGenotype(calf.coatGenotype);
    if (actual === undefined || possible.size === 0) continue;
    if (possible.has(actual)) continue;

    risks.push({
      kind: "impossible_colour",
      animalId: record.calfAnimalId,
      severity: "serious",
      detail: `Her genotype is ${actual}, which this sire and dam cannot produce.`,
      measure: "Either a colour is typed wrong, or the sire on the record is not the sire.",
    });
  }

  return risks;
}

/** The joint genotype string, in the same spelling `predictColour` returns. */
function writeGenotype(genotype: CoatGenotype): string | undefined {
  if (genotype.extension === undefined || genotype.roan === undefined) return undefined;
  const extension = readExtension(genotype.extension.join("/"));
  const roan = readRoan(genotype.roan.join("/"));
  if (extension === undefined || roan === undefined) return undefined;
  return `${[...extension].sort().reverse().join("/")} · ${[...roan].sort().reverse().join("/")}`;
}

/** Four treatments in a year is an animal with something wrong with it. */
export const TREATMENT_LIMIT = 4;
export const TREATMENT_WINDOW_DAYS = 365;

export function frequentTreatment(input: RiskInput): Risk[] {
  const counts = new Map<Ulid, number>();

  for (const record of input.health) {
    // Vaccinations are the healthy animals, not the sick ones. Counting them
    // would put the whole herd on this list every spring.
    if (record.type === "vaccination") continue;
    if (days(record.date, input.now) > TREATMENT_WINDOW_DAYS) continue;
    counts.set(record.animalId, (counts.get(record.animalId) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, count]) => count >= TREATMENT_LIMIT)
    .map(([animalId, count]) => ({
      kind: "frequent_treatment" as const,
      animalId,
      severity: count >= TREATMENT_LIMIT * 2 ? ("serious" as const) : ("concern" as const),
      detail: `${count} treatments in the last year.`,
      measure: `${TREATMENT_LIMIT} is the line. Vaccinations are not counted.`,
    }));
}

/** Any birth that needed a hand. One is worth knowing; two is a decision. */
export function assistedBirths(input: RiskInput): Risk[] {
  const counts = new Map<Ulid, { pulled: number; sections: number }>();

  for (const record of input.calvings) {
    const natural = record.birthType === "natural" && !record.assisted;
    if (natural) continue;

    const entry = counts.get(record.damId) ?? { pulled: 0, sections: 0 };
    if (record.birthType === "c_section") entry.sections += 1;
    else entry.pulled += 1;
    counts.set(record.damId, entry);
  }

  return [...counts].map(([animalId, entry]) => {
    const total = entry.pulled + entry.sections;
    return {
      kind: "assisted_births" as const,
      animalId,
      // A C-section is a different order of fact from a chain, and it stays
      // that way however many times it has or has not happened.
      severity:
        entry.sections > 0
          ? ("serious" as const)
          : total >= 2
            ? ("concern" as const)
            : ("watch" as const),
      detail:
        entry.sections > 0
          ? `${entry.sections} C-section${entry.sections === 1 ? "" : "s"}${entry.pulled > 0 ? ` and ${entry.pulled} pulled` : ""}.`
          : `${entry.pulled} calf${entry.pulled === 1 ? "" : "s"} pulled.`,
      measure: "Any birth that needed somebody there.",
    };
  });
}

/**
 * Vaccinations that are overdue.
 *
 * Driven by the booster date on the record itself rather than by a schedule
 * this file invents, because the interval belongs to the product and the
 * product is on the record. Nothing recorded produces nothing: an animal with
 * no vaccination history is not overdue, it is unrecorded, and the two need
 * different work.
 */
export function missingVaccinations(input: RiskInput): Risk[] {
  const risks: Risk[] = [];

  for (const record of input.health) {
    if (record.boosterDueOn === undefined) continue;
    if (record.boosterDueOn > input.now) continue;

    // Given after it was due? Then it has been done.
    const followed = input.health.some(
      (later) =>
        later.animalId === record.animalId &&
        later.id !== record.id &&
        later.date >= (record.boosterDueOn as Date),
    );
    if (followed) continue;

    const overdue = days(record.boosterDueOn, input.now);
    risks.push({
      kind: "missing_vaccination",
      animalId: record.animalId,
      severity: overdue > 60 ? "serious" : "concern",
      detail: `${record.product ?? record.type} booster was due ${record.boosterDueOn.toLocaleDateString()} — ${overdue} days ago.`,
      measure: "From the booster date on the treatment itself.",
    });
  }

  return risks;
}

/* ------------------------------------------------------------- the page */

export interface RiskReport {
  readonly risks: readonly Risk[];
  readonly byAnimal: ReadonlyMap<Ulid, readonly Risk[]>;
  readonly counts: Readonly<Record<RiskKind, number>>;
}

const CHECKS: readonly ((input: RiskInput) => Risk[])[] = [
  notCalvedRecently,
  highRebreeds,
  prematureCalves,
  earlyCalfDeaths,
  impossibleColours,
  frequentTreatment,
  assistedBirths,
  missingVaccinations,
];

const SEVERITY_ORDER: Record<RiskSeverity, number> = { serious: 0, concern: 1, watch: 2 };

/** Every check, most serious first. */
export function assessRisks(input: RiskInput): RiskReport {
  const risks = CHECKS.flatMap((check) => check(input)).sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  const byAnimal = new Map<Ulid, Risk[]>();
  for (const risk of risks) {
    byAnimal.set(risk.animalId, [...(byAnimal.get(risk.animalId) ?? []), risk]);
  }

  const counts = Object.fromEntries(
    RISK_KINDS.map((kind) => [kind, risks.filter((risk) => risk.kind === kind).length]),
  ) as Record<RiskKind, number>;

  return { risks, byAnimal, counts };
}

/** What each check is looking for, for a page that explains itself. */
export const RISK_LABELS: Record<RiskKind, string> = {
  not_calved: "Not calved in two years",
  rebreeds: "Takes more than two services",
  premature: "Two or more premature calves",
  calf_deaths: "Calves lost inside a month",
  impossible_colour: "Colour the parents cannot produce",
  frequent_treatment: "Treated more than most",
  assisted_births: "Births that needed help",
  missing_vaccination: "Booster overdue",
};
