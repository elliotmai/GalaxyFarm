import { z } from "zod";

import {
  baseRecordSchema,
  ulidSchema,
  type Animal,
  type BaseRecord,
  type SafetyLevel,
  type Sex,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Calving (spec §5.2).
 *
 * The record does two jobs: it is the history of how she calved, and it is
 * what brings the calf into existence. §5.2 is explicit — a calving record
 * "creates the calf as a new Animal with pedigree pre-wired to dam + service
 * sire" — so nobody types a birth date, a dam, or a sire that the app already
 * knows.
 */

/** The industry 1–5 scale: 1 unassisted, 5 caesarean. */
export const CALVING_EASE = [1, 2, 3, 4, 5] as const;
export type CalvingEase = (typeof CALVING_EASE)[number];

export const CALF_VIGOUR = ["vigorous", "slow", "weak", "stillborn"] as const;
export type CalfVigour = (typeof CALF_VIGOUR)[number];

export interface CalvingRecord extends BaseRecord {
  readonly damId: Ulid;
  /** The breeding this calving answers, so the sire resolves without asking. */
  readonly breedingRecordId?: Ulid | undefined;
  readonly date: Date;
  readonly calvingEase: CalvingEase;
  readonly vigour: CalfVigour;
  readonly calfSex?: Sex | undefined;
  /** Pounds. The reliable weight — everything later is a scale and a guess. */
  readonly birthWeightLb?: number | undefined;
  readonly assisted: boolean;
  readonly assistDetail?: string | undefined;
  /** Set once the calf record exists, so a second run cannot create it twice. */
  readonly calfAnimalId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export const calvingRecordSchema = baseRecordSchema
  .extend({
    damId: ulidSchema,
    breedingRecordId: ulidSchema.optional(),
    date: z.coerce.date(),
    calvingEase: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    vigour: z.enum(CALF_VIGOUR),
    calfSex: z.enum(["male", "female", "steer", "unknown"]).optional(),
    birthWeightLb: z.number().positive().max(200, "That is not a birth weight").optional(),
    assisted: z.boolean(),
    assistDetail: z.string().max(2000).optional(),
    calfAnimalId: ulidSchema.optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((record) => !record.assisted || record.calvingEase > 1, {
    // Ease 1 means unassisted by definition. The two fields disagreeing is a
    // mis-tap, and it would skew any calving-ease summary built on either.
    message: "An assisted calving cannot be ease 1",
    path: ["calvingEase"],
  }) as unknown as z.ZodType<CalvingRecord>;

/**
 * A calving that produced a live calf.
 *
 * Stillbirths are recorded — they matter to the dam's history and to any
 * decision about keeping her — but they do not create an Animal.
 */
export function producedLiveCalf(record: Pick<CalvingRecord, "vigour">): boolean {
  return record.vigour !== "stillborn";
}

/**
 * The tag to put in the calf's ear, suggested.
 *
 * `calfFromCalving` used to leave the calf with neither a name nor a tag, on
 * the reasoning that a tag goes on at working and forcing a name at birth
 * produces a herd of "Calf 3"s nobody renames. That reasoning is right about
 * names and wrong about the consequence: `animalSchema` requires one or the
 * other — "An animal needs a name or a tag number to be findable" — so the
 * draft was unsaveable, and the first real calving would have been the thing
 * that discovered it.
 *
 * Dam plus year is what actually gets written on the tag, so that is what this
 * suggests. It is a starting value in a field somebody can overwrite before
 * saving, not a decision made on their behalf.
 */
export function suggestedCalfTag(
  dam: Pick<Animal, "tagNumber" | "name"> | undefined,
  bornOn: Date,
): string {
  const year = String(bornOn.getFullYear()).slice(2);
  const stem = dam?.tagNumber ?? dam?.name;
  return stem === undefined ? `Calf ${bornOn.toISOString().slice(0, 10)}` : `${stem}-${year}`;
}

export interface CalfDraft {
  readonly animal: Omit<Animal, "id" | "createdAt" | "updatedAt">;
  /** Pedigree to wire once the animal has an id. */
  readonly pedigree: {
    readonly damId: Ulid;
    readonly sireAnimalId?: Ulid | undefined;
    readonly sireExternalId?: Ulid | undefined;
  };
  /** Written as a WeightRecord in the birth context, when it was taken. */
  readonly birthWeightLb?: number | undefined;
}

/**
 * The calf this calving created, ready to be saved.
 *
 * Returns a draft rather than performing the write: this is domain code and
 * §4.1 keeps it clear of repositories. The id and timestamps are the caller's,
 * which is also what makes the function testable without a clock.
 *
 * The dam's safety level is *not* inherited. §5.1 says the opposite thing and
 * says it about the dam: she is auto-suggested an elevated level from calving
 * until cleared, because a quiet cow gets protective with a calf at side. The
 * calf itself starts at level 1.
 */
export function calfFromCalving(
  record: Pick<
    CalvingRecord,
    "damId" | "date" | "calfSex" | "birthWeightLb" | "vigour" | "calfAnimalId"
  >,
  sire: { readonly animalId?: Ulid; readonly externalId?: Ulid },
  context: {
    readonly propertyId: Ulid;
    readonly ownership: "own" | "client";
    readonly ownerId?: Ulid;
    /** What goes in the ear. `suggestedCalfTag` prefills the field. */
    readonly tagNumber: string;
  },
): CalfDraft | undefined {
  if (!producedLiveCalf(record)) return undefined;
  // Already created. Running the calving flow twice must not produce twins.
  if (record.calfAnimalId !== undefined) return undefined;

  const animal: Omit<Animal, "id" | "createdAt" | "updatedAt"> = {
    propertyId: context.propertyId,
    species: "cattle",
    // Tagged, not named. A name at birth produces a herd of "Calf 3"s nobody
    // renames; a tag is what is actually written in the ear, and `animalSchema`
    // requires one or the other for the calf to be findable at all.
    tagNumber: context.tagNumber,
    sex: record.calfSex ?? "unknown",
    dob: record.date,
    dobIsEstimate: false,
    status: "active",
    ownership: context.ownership,
    ...(context.ownerId === undefined ? {} : { ownerId: context.ownerId }),
    safetyLevel: 1 as SafetyLevel,
    photoKeys: [],
  };

  return {
    animal,
    pedigree: {
      damId: record.damId,
      ...(sire.animalId === undefined ? {} : { sireAnimalId: sire.animalId }),
      ...(sire.externalId === undefined ? {} : { sireExternalId: sire.externalId }),
    },
    ...(record.birthWeightLb === undefined ? {} : { birthWeightLb: record.birthWeightLb }),
  };
}

/**
 * The dam's suggested safety level after calving (§5.1).
 *
 * Re-exported through the cattle module because this is where the event that
 * triggers it lives, and because a caller holding a CalvingRecord should not
 * have to know the rule is spelled out in the kernel.
 */
export { suggestedLevelAfterCalving } from "@galaxy-farm/core";

/** Every calving for one dam, most recent first. */
export function calvingsFor(records: readonly CalvingRecord[], damId: Ulid): CalvingRecord[] {
  return records
    .filter((record) => record.damId === damId)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

/**
 * Days between her last two calvings — the number that says whether she is
 * holding a yearly interval or slipping.
 */
export function calvingInterval(
  records: readonly CalvingRecord[],
  damId: Ulid,
): number | undefined {
  const [latest, previous] = calvingsFor(records, damId);
  if (latest === undefined || previous === undefined) return undefined;
  return Math.round((latest.date.getTime() - previous.date.getTime()) / 86_400_000);
}
