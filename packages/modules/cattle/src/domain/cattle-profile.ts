import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

import { coatGenotypeSchema, type CoatGenotype } from "./coat-colour.js";
import { geneticTestSchema, type GeneticTest } from "./genetics.js";
import { registryCode } from "./registries.js";

/**
 * What makes a cattle animal a *cattle* animal (spec §5.2).
 *
 * A sidecar on Animal rather than a fatter Animal, because §2 says one animal
 * model across species and a chicken has no breed percentages. The kernel keeps
 * identity, location, photos, instructions and safety; this keeps papers and
 * breeding.
 */

/**
 * The registries an animal here can be papered with, named by their breed.
 *
 * Not by the association's initials, which is how this started: `ASA` is the
 * American Shorthorn Association on this farm's papers and the American
 * Simmental Association elsewhere, so a registration filed under it did not say
 * which herdbook it came from. Every registry here keeps one breed's herdbook,
 * so the breed names it unambiguously. `registries.ts` holds the association
 * names themselves, and reads the old initials for records written before this.
 *
 * Angus is on the list because an Angus page is one this app can read, and a
 * registration read off one had nowhere valid to be filed until now.
 */
export const ASSOCIATIONS = ["Maine-Anjou", "Chianina", "Shorthorn", "Angus", "other"] as const;
export type Association = (typeof ASSOCIATIONS)[number];

export const HORN_STATUSES = ["polled", "horned", "scurred", "dehorned"] as const;
export type HornStatus = (typeof HORN_STATUSES)[number];

/**
 * One line of a breed makeup.
 *
 * Percentages, not fractions, because "½ Maine ¼ Chi ¼ Shorthorn" is written
 * as 50/25/25 on every paper this farm will ever handle, and because a
 * three-way split with a third in it has no exact fractional form either.
 */
export interface BreedShare {
  readonly breed: string;
  readonly percent: number;
}

export interface Registration {
  readonly association: Association;
  readonly regNumber: string;
  readonly registeredName?: string | undefined;
  readonly tattoo?: string | undefined;
  /**
   * EPDs as published on the day they were captured, not a live figure. They
   * are re-run by the association several times a year, and a number quoted to
   * a buyer needs to be the number that was true when it was quoted.
   */
  readonly epdSnapshot?: Record<string, number> | undefined;
  readonly epdCapturedOn?: Date | undefined;
}

/** Which parent, and whether it is a record here or an outside animal. */
export interface ParentRef {
  readonly kind: "animal" | "external";
  readonly id: Ulid;
}

export interface CattleProfile extends BaseRecord {
  readonly animalId: Ulid;
  /**
   * What breed this animal is, in words.
   *
   * A list, because a crossbred animal is more than one and a record that has
   * to pick one picks wrong every time. Left unset on most animals and derived
   * from the makeup — see `breedsOf` — so the two cannot drift apart; set by
   * hand on a commercial cow who has a breed and will never have papers.
   */
  readonly breed?: readonly string[] | undefined;
  readonly breedComposition: readonly BreedShare[];
  /**
   * Hair-card results, one per defect tested.
   *
   * Held here rather than on `Animal` because they are a cattle fact — the
   * kernel has no business knowing what tibial hemimelia is (§4.1).
   */
  readonly geneticTests: readonly GeneticTest[];
  /** What the coat-colour test came back as, for predicting a calf's colour. */
  readonly coatGenotype?: CoatGenotype | undefined;
  readonly hornStatus?: HornStatus | undefined;
  readonly colour?: string | undefined;
  readonly markings?: string | undefined;
  readonly registrations: readonly Registration[];
  /**
   * The day this calf came off its dam.
   *
   * A date rather than a flag, because "when" is the question asked afterwards
   * — a weaning weight is only interpretable against it, and the weaning watch
   * needs somewhere to record that the job is done. Recorded here rather than
   * inferred from a weight labelled "weaning": a calf weighed the week before
   * it is separated would read as weaned, and a calf weaned without being
   * weighed would never clear the alert. An alert that doing the work cannot
   * dismiss is one people learn to ignore.
   */
  readonly weanedOn?: Date | undefined;
  /**
   * The cow actually raising this calf, when she is not the one who calved it.
   *
   * Grafting: a calf whose dam died or would not take it, put onto another cow.
   * Nothing else on file can say that — it happens after the birth, so the
   * calving record still names the cow who calved, and the pedigree still names
   * the genetic dam. Both are right and neither is the pen this calf stands in.
   *
   * Embryo transfer needs no field here. The recipient is the cow who calved, so
   * `CalvingRecord.damId` already names her, and `BreedingRecord.embryoDonorId`
   * already names the donor the pedigree comes from.
   */
  readonly raisedById?: Ulid | undefined;
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
}

export const breedShareSchema = z.object({
  breed: z.string().min(1, "Name the breed").max(80),
  percent: z.number().min(0).max(100),
});

/**
 * A registry named however the record spelled it, narrowed to how we file it.
 *
 * Every registration written before registries were named by breed holds the
 * association's initials. Those records are rewritten in the database by
 * migration 0019, but a device that has been offline since is still holding the
 * old spelling, and it has to be able to save an edit when it comes back — a
 * validator that rejects what the device already has would strand exactly the
 * work this app exists to keep.
 */
const associationSchema = z.preprocess(
  (value) => (typeof value === "string" ? registryCode(value) : value),
  z.enum(ASSOCIATIONS),
);

export const registrationSchema = z.object({
  association: associationSchema,
  regNumber: z.string().min(1, "A registration needs its number").max(60),
  registeredName: z.string().max(160).optional(),
  tattoo: z.string().max(40).optional(),
  epdSnapshot: z.record(z.string(), z.number()).optional(),
  epdCapturedOn: z.coerce.date().optional(),
});

export const parentRefSchema = z.object({
  kind: z.enum(["animal", "external"]),
  id: ulidSchema,
});

/**
 * Composition tolerance.
 *
 * Half a point, so 33/33/34 and 33.3/33.3/33.4 both pass while a genuine
 * mistake — a missing quarter, a doubled half — does not.
 */
export const COMPOSITION_TOLERANCE = 0.5;

/** What a composition adds up to. */
export function compositionTotal(composition: readonly BreedShare[]): number {
  return composition.reduce((sum, share) => sum + share.percent, 0);
}

/**
 * Does it add up?
 *
 * Exported so the editor and the validator answer identically. The editor
 * saying "adds to 100%" on strict equality while the schema accepts 99.7 —
 * or worse, the other way round — is a form that refuses to save while
 * insisting everything is fine.
 *
 * An empty composition is complete: plenty of commercial cattle arrive with
 * nobody's idea of what they are, and that is different from a half-filled one.
 */
export function isCompositionComplete(composition: readonly BreedShare[]): boolean {
  if (composition.length === 0) return true;
  return Math.abs(compositionTotal(composition) - 100) <= COMPOSITION_TOLERANCE;
}

export const cattleProfileSchema = baseRecordSchema
  .extend({
    animalId: ulidSchema,
    breed: z.array(z.string().min(1).max(60)).max(12).optional(),
    breedComposition: z.array(breedShareSchema),
    // Defaulted rather than optional: a profile with no `geneticTests` and one
    // with an empty array both mean "nothing tested", and two spellings of
    // that would each need handling everywhere the list is read.
    geneticTests: z.array(geneticTestSchema).default([]),
    coatGenotype: coatGenotypeSchema.optional(),
    hornStatus: z.enum(HORN_STATUSES).optional(),
    colour: z.string().max(120).optional(),
    markings: z.string().max(500).optional(),
    registrations: z.array(registrationSchema),
    weanedOn: z.coerce.date().optional(),
    raisedById: ulidSchema.optional(),
    sire: parentRefSchema.optional(),
    dam: parentRefSchema.optional(),
  })
  .refine(
    // The same function the editor shows its running total from. Two
    // implementations of "does this add up" would agree until the afternoon
    // somebody changed one, and the symptom would be a form that refuses to
    // save while insisting everything is fine.
    (profile) => isCompositionComplete(profile.breedComposition),
    { message: "Breed composition has to add up to 100%", path: ["breedComposition"] },
  )
  .refine(
    (profile) =>
      new Set(profile.registrations.map((r) => `${r.association}:${r.regNumber}`)).size ===
      profile.registrations.length,
    { message: "The same registration is listed twice", path: ["registrations"] },
  ) as unknown as z.ZodType<CattleProfile>;

/** "½ Maine-Anjou · ¼ Chi · ¼ Shorthorn", as it would be said out loud. */
export function describeComposition(composition: readonly BreedShare[]): string {
  if (composition.length === 0) return "Unknown breeding";
  return [...composition]
    .sort((left, right) => right.percent - left.percent)
    .map((share) => `${formatShare(share.percent)} ${share.breed}`)
    .join(" · ");
}

/** The common show-cattle fractions, written the way papers write them. */
function formatShare(percent: number): string {
  const fractions: ReadonlyArray<readonly [number, string]> = [
    [50, "½"],
    [25, "¼"],
    [75, "¾"],
    [12.5, "⅛"],
    [37.5, "⅜"],
    [62.5, "⅝"],
    [87.5, "⅞"],
    [100, "Purebred"],
  ];
  const match = fractions.find(([value]) => Math.abs(value - percent) < 0.01);
  return match?.[1] ?? `${Number(percent.toFixed(1))}%`;
}

/** Is this animal purebred in any single breed? */
export function isPurebred(composition: readonly BreedShare[]): boolean {
  return composition.some((share) => share.percent >= 100 - COMPOSITION_TOLERANCE);
}

export function registrationIn(
  profile: Pick<CattleProfile, "registrations">,
  association: Association,
): Registration | undefined {
  return profile.registrations.find((registration) => registration.association === association);
}

/** §12 decision 1: registries are entered by hand, so "papered" is a fact we hold. */
export function isPapered(profile: Pick<CattleProfile, "registrations">): boolean {
  return profile.registrations.length > 0;
}
