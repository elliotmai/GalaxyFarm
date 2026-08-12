import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * What makes a cattle animal a *cattle* animal (spec §5.2).
 *
 * A sidecar on Animal rather than a fatter Animal, because §2 says one animal
 * model across species and a chicken has no breed percentages. The kernel keeps
 * identity, location, photos, instructions and safety; this keeps papers and
 * breeding.
 */

export const ASSOCIATIONS = ["AMAA", "ACA", "ASA", "other"] as const;
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
  readonly breedComposition: readonly BreedShare[];
  readonly hornStatus?: HornStatus | undefined;
  readonly colour?: string | undefined;
  readonly markings?: string | undefined;
  readonly registrations: readonly Registration[];
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
}

export const breedShareSchema = z.object({
  breed: z.string().min(1, "Name the breed").max(80),
  percent: z.number().min(0).max(100),
});

export const registrationSchema = z.object({
  association: z.enum(ASSOCIATIONS),
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
    breedComposition: z.array(breedShareSchema),
    hornStatus: z.enum(HORN_STATUSES).optional(),
    colour: z.string().max(120).optional(),
    markings: z.string().max(500).optional(),
    registrations: z.array(registrationSchema),
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
