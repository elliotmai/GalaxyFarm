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
 * The year letters, and the four the system leaves out (§5.2).
 *
 * The international beef letter system skips **I, O, Q and V** — I and O
 * because they are unreadable as 1 and 0 on a tag at arm's length in a chute,
 * Q because it is a smudged O, and V because it is a bent U. That leaves 22
 * letters and a 22-year cycle.
 *
 * Anchored on A = 2013, which puts 2026 at P. The anchor is what makes this
 * checkable: change it by one and every tag on the farm is wrong by a year,
 * so it is stated once and asserted in a test against a year somebody knows.
 */
export const YEAR_LETTERS = "ABCDEFGHJKLMNPRSTUWXYZ";
const LETTER_EPOCH = 2013;

export function yearLetter(year: number): string {
  const index =
    (((year - LETTER_EPOCH) % YEAR_LETTERS.length) + YEAR_LETTERS.length) % YEAR_LETTERS.length;
  return YEAR_LETTERS[index] as string;
}

/**
 * A tag in this farm's own format: `601P`.
 *
 * Last digit of the year, then the calf's number within the year as two
 * digits, then the year letter. The year appears twice on purpose — the digit
 * reads at a glance from across a pen, and the letter is the part that is
 * unambiguous when the digit has worn off.
 */
export function calfTag(year: number, sequence: number): string {
  return `${String(year).slice(-1)}${String(sequence).padStart(2, "0")}${yearLetter(year)}`;
}

/** Every tag already issued for a year, as its sequence number. */
export function calfSequencesIn(tags: readonly (string | undefined)[], year: number): number[] {
  const digit = String(year).slice(-1);
  const letter = yearLetter(year);
  const pattern = new RegExp(`^${digit}(\\d{2,})${letter}$`, "i");

  return tags
    .map((tag) => pattern.exec(tag?.trim() ?? "")?.[1])
    .filter((sequence): sequence is string => sequence !== undefined)
    .map(Number);
}

/**
 * The next number in the year, which is one past the highest already used.
 *
 * Highest-plus-one rather than count-plus-one. A calf that died and was
 * removed, or a tag entered out of order, would make a count reuse a number
 * that is already in an ear — and two animals wearing 603P is a problem that
 * surfaces months later at weaning, when nobody can tell which weight belongs
 * to which calf.
 */
export function nextCalfSequence(tags: readonly (string | undefined)[], year: number): number {
  const used = calfSequencesIn(tags, year);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
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
 * The format is the farm's own and not negotiable by this code: year digit,
 * calf number, year letter. The first calf of 2026 is `601P`. It is still a
 * starting value in a field somebody can overwrite — a calf bought in wears
 * whatever tag it arrived in.
 */
export function suggestedCalfTag(
  existingTags: readonly (string | undefined)[],
  bornOn: Date,
): string {
  const year = bornOn.getFullYear();
  return calfTag(year, nextCalfSequence(existingTags, year));
}

/**
 * The farm's herd prefix (§5.2).
 *
 * Every association wants a registered name, and every registered name on this
 * place starts the same way — a herd prefix is how a buyer three states away
 * knows two animals came from the same programme. `GLXY` is short enough to
 * survive the character limits the associations impose on a registered name,
 * which longer prefixes do not.
 */
export const HERD_PREFIX = "GLXY";

/**
 * The registration number to put on the papers, suggested.
 *
 * `GLXY` and the ear tag, so the number on the certificate and the number in
 * the ear are the same number twice. That is worth more than it sounds: at a
 * show or a sale barn, somebody is reading a tag off an animal and looking for
 * her paperwork, and every step between those two is a chance to get the wrong
 * heifer's papers.
 *
 * A suggestion, not a rule. An animal registered by somebody else arrives with
 * whatever number they used.
 */
export function suggestedRegistrationNumber(tagNumber: string): string {
  return `${HERD_PREFIX}${tagNumber.trim()}`;
}

/**
 * The registered name, suggested.
 *
 * `GLXY <name> <tag>` — prefix, the name she is actually called, and the tag.
 * The tag on the end is what makes the name unique when two good heifers four
 * years apart both end up called Andromeda, which is the thing associations
 * reject a registration for.
 *
 * A calf with no barn name yet gets `GLXY 601P`, and the space where the name
 * would go simply is not there rather than being filled with a placeholder.
 */
export function suggestedRegisteredName(name: string | undefined, tagNumber: string): string {
  return [HERD_PREFIX, name?.trim(), tagNumber.trim()]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
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
