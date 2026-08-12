import { z } from "zod";

/**
 * Genetic defects, and the house rule about them (spec §5.2).
 *
 * The three that matter to this farm are **TH**, **PHA** and **DS**, because
 * they are the ones running in Maine-Anjou, Chianina and Shorthorn — the exact
 * three breeds in this herd's composition. They are simple recessives: a
 * carrier is a healthy animal that looks like every other animal, and the only
 * way to find out is a hair test.
 *
 * The rule here is stricter than the genetics require, and deliberately so.
 * Carrier × free produces no affected calves — half carriers, and you could
 * breed that way for years. The owner's rule is that no carrier comes onto the
 * place at all, which removes the bookkeeping that a "manage the carriers"
 * policy demands and removes the day somebody forgets it. So `isHerdClean`
 * fails a carrier, not only an affected animal, and the mating check reports a
 * carrier on either side rather than waiting for both.
 *
 * "Untested" is not "free". Most of the risk here is an untested animal from a
 * carrier line, so the two are held apart everywhere and never collapsed.
 */

/**
 * The defects, with the ones this herd's breeds actually carry first.
 *
 * TH — tibial hemimelia. PHA — pulmonary hypoplasia with anasarca. Both run in
 * Maine-Anjou, Chianina and Shorthorn, and both are lethal.
 * DS — developmental duplication, the polymelia gene, mostly Angus but it
 * crosses in. The rest are the other recessives a commercial bull might carry.
 */
export const GENETIC_DEFECTS = ["TH", "PHA", "DS", "DD", "NH", "AM", "CA", "OS", "MSUD"] as const;
export type GeneticDefect = (typeof GENETIC_DEFECTS)[number];

/** What each abbreviation is, for a screen that should not assume anyone knows. */
export const DEFECT_NAMES: Record<GeneticDefect, string> = {
  TH: "Tibial hemimelia",
  PHA: "Pulmonary hypoplasia with anasarca",
  // Two codes, one condition as far as anyone here is concerned — but they are
  // kept apart because a hair card says one or the other, and merging them
  // would let a "DS free" result silently answer for a DD the lab never ran.
  DS: "Developmental duplication — Shorthorn's code",
  DD: "Developmental duplication — Chianina and Angus's code",
  NH: "Neuropathic hydrocephalus",
  AM: "Arthrogryposis multiplex",
  CA: "Contractural arachnodactyly",
  OS: "Osteopetrosis",
  MSUD: "Maple syrup urine disease",
};

/**
 * The three the house rule covers.
 *
 * Separated from the full list because a bull can be free of these three and
 * untested for the rest, and calling that animal "untested" would bar a bull
 * that meets the rule as written.
 */
export const HOUSE_RULE_DEFECTS: readonly GeneticDefect[] = ["TH", "PHA", "DS"];

/**
 * Test results, in the vocabulary the associations use.
 *
 * `free_by_parentage` is a real status and not a weaker "free": both parents
 * tested free, so the calf cannot carry it. It is kept distinct because it
 * depends on the parentage being right, and a DNA-verified parentage is a
 * different claim from a hair card with this animal's own name on it.
 */
export const DEFECT_STATUSES = [
  "free",
  "free_by_parentage",
  "suspect",
  "carrier",
  "affected",
  "untested",
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

/** How each status reads to somebody who has not memorised the vocabulary. */
export const STATUS_LABELS: Record<DefectStatus, string> = {
  free: "Free — tested",
  free_by_parentage: "Free by parentage",
  suspect: "Possible carrier — not tested",
  carrier: "Carrier",
  affected: "Affected",
  untested: "Untested",
};

/**
 * Known not to have it.
 *
 * The one predicate the house rule turns on, and it is written as a whitelist
 * on purpose. Asking "is it untested?" instead lets every status nobody
 * thought about — `suspect`, and whatever the associations invent next — fall
 * through as clean, which is precisely how a carrier gets bought.
 */
export function isKnownFree(status: DefectStatus): boolean {
  return status === "free" || status === "free_by_parentage";
}

/** Neither a clean result nor a known carrier — the answer is "we don't know". */
export function unresolved(status: DefectStatus): boolean {
  return status === "untested" || status === "suspect";
}

export interface GeneticTest {
  readonly defect: GeneticDefect;
  readonly status: DefectStatus;
  readonly testedOn?: Date | undefined;
  /** Whoever ran it — Neogen, GeneSeek, the association. */
  readonly lab?: string | undefined;
  readonly notes?: string | undefined;
}

export const geneticTestSchema = z.object({
  defect: z.enum(GENETIC_DEFECTS),
  status: z.enum(DEFECT_STATUSES),
  testedOn: z.coerce.date().optional(),
  lab: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

/** Where a defect stands for this animal. Nothing recorded means untested. */
export function statusOf(tests: readonly GeneticTest[], defect: GeneticDefect): DefectStatus {
  return tests.find((test) => test.defect === defect)?.status ?? "untested";
}

/** Carrying it or showing it — the two statuses that pass the gene on. */
export function carries(status: DefectStatus): boolean {
  return status === "carrier" || status === "affected";
}

/** Everything this animal is known to carry. */
export function carriedDefects(tests: readonly GeneticTest[]): GeneticDefect[] {
  return GENETIC_DEFECTS.filter((defect) => carries(statusOf(tests, defect)));
}

/** Everything the house rule covers that nobody has tested for. */
export function untestedDefects(
  tests: readonly GeneticTest[],
  required: readonly GeneticDefect[] = HOUSE_RULE_DEFECTS,
): GeneticDefect[] {
  return required.filter((defect) => statusOf(tests, defect) === "untested");
}

export interface HerdRuleVerdict {
  /** Free or free-by-parentage on every defect the rule covers. */
  readonly clean: boolean;
  readonly carried: readonly GeneticDefect[];
  readonly untested: readonly GeneticDefect[];
}

/**
 * Does this animal meet the house rule?
 *
 * Clean requires a result on every covered defect and no carrier among them.
 * An untested animal is not clean and is not a carrier either — the honest
 * verdict is "we do not know", and a screen that rounded that to "fine" would
 * be how a carrier gets bought.
 */
export function herdRuleVerdict(
  tests: readonly GeneticTest[],
  required: readonly GeneticDefect[] = HOUSE_RULE_DEFECTS,
): HerdRuleVerdict {
  const carried = required.filter((defect) => carries(statusOf(tests, defect)));
  // Everything that is not a clean result and not a carrier: untested, and the
  // association's "possible carrier" — an animal with a tested carrier close
  // behind it. Both mean the same thing to the person deciding: send a hair
  // card before this one comes onto the place.
  const untested = required.filter((defect) => {
    const status = statusOf(tests, defect);
    return !isKnownFree(status) && !carries(status);
  });
  return { clean: carried.length === 0 && untested.length === 0, carried, untested };
}

export interface MatingDefectRisk {
  readonly defect: GeneticDefect;
  readonly sire: DefectStatus;
  readonly dam: DefectStatus;
  /** Chance the calf is affected: a quarter when both sides carry it. */
  readonly affectedChance: number;
  /** Chance the calf carries it, affected or not. */
  readonly carrierChance: number;
  /** True when a side is untested, so the numbers below are a floor. */
  readonly uncertain: boolean;
}

/**
 * What a pairing risks, defect by defect.
 *
 * A simple recessive: carrier × carrier is a quarter affected and a half
 * carrier. Carrier × free is nothing affected and a half carrier — which is
 * the mating a "manage the carriers" policy permits and this farm does not.
 *
 * An affected animal passes the gene every time, so it is modelled at 1 rather
 * than at 0.5. Untested is reported as uncertain rather than assumed free:
 * assuming free is how a defect gets into a herd.
 */
export function matingDefectRisk(
  sireTests: readonly GeneticTest[],
  damTests: readonly GeneticTest[],
  defects: readonly GeneticDefect[] = GENETIC_DEFECTS,
): MatingDefectRisk[] {
  const passRate = (status: DefectStatus): number =>
    status === "affected" ? 1 : status === "carrier" ? 0.5 : 0;

  return defects
    .map((defect) => {
      const sire = statusOf(sireTests, defect);
      const dam = statusOf(damTests, defect);
      const fromSire = passRate(sire);
      const fromDam = passRate(dam);

      return {
        defect,
        sire,
        dam,
        affectedChance: fromSire * fromDam,
        // Either side passing it, less the overlap where both do.
        carrierChance: fromSire + fromDam - fromSire * fromDam,
        // Not "somebody skipped the test" — "the number below is a floor".
        // Carrier × carrier is certain at a quarter; carrier × *unknown* is
        // not, and neither is unknown × unknown.
        uncertain: unresolved(sire) || unresolved(dam),
      };
    })
    .filter((risk) => risk.affectedChance > 0 || risk.carrierChance > 0 || risk.uncertain);
}

/**
 * Should this pairing happen at all, under the house rule?
 *
 * Refused when either side carries a covered defect. Flagged — not refused —
 * when either side is untested for one, because the fix is a hair card rather
 * than a different bull.
 */
export function matingAllowed(
  sireTests: readonly GeneticTest[],
  damTests: readonly GeneticTest[],
  required: readonly GeneticDefect[] = HOUSE_RULE_DEFECTS,
): {
  readonly allowed: boolean;
  readonly carried: readonly GeneticDefect[];
  readonly untested: readonly GeneticDefect[];
} {
  const carried = required.filter(
    (defect) => carries(statusOf(sireTests, defect)) || carries(statusOf(damTests, defect)),
  );
  const untested = required.filter(
    (defect) =>
      statusOf(sireTests, defect) === "untested" || statusOf(damTests, defect) === "untested",
  );

  return { allowed: carried.length === 0, carried, untested };
}
