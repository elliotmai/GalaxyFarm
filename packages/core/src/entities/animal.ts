import { z } from "zod";

import { safetyLevelSchema, type SafetyLevel } from "../value-objects/safety-level.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * One Animal model, many species (spec §2).
 *
 * Cattle, flocks, pets, client calves, and future horses share this kernel and
 * extend it per species. The boarding business reuses it with an owner attached
 * — there is no parallel system for client animals, which is what makes a
 * client calf and an own calf run through the identical program pipeline.
 */

export const SPECIES = ["cattle", "chicken", "quail", "horse", "dog", "cat", "reptile"] as const;
export type Species = (typeof SPECIES)[number];

/**
 * Pet or livestock — the household or the operation.
 *
 * It decides what a species is fed and from what (a bowl, not a bunk), where
 * (the kitchen, not a pen), and which pages and sitter-guide sections it
 * belongs to. Declared per species so a new one has to say which it is.
 */
export const AUDIENCES = ["livestock", "pet"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const SPECIES_AUDIENCE: Readonly<Record<Species, Audience>> = {
  cattle: "livestock",
  chicken: "livestock",
  quail: "livestock",
  horse: "livestock",
  dog: "pet",
  cat: "pet",
  reptile: "pet",
};

export function audienceOf(species: Species): Audience {
  return SPECIES_AUDIENCE[species];
}

export const SPECIES_LABELS: Readonly<Record<Species, string>> = {
  cattle: "Cattle",
  chicken: "Chickens",
  quail: "Quail",
  horse: "Horses",
  dog: "Dogs",
  cat: "Cats",
  reptile: "Reptiles",
};

/**
 * The kind within a species, for the species broad enough to need one.
 *
 * "Reptile" covers a leopard gecko and a ball python, which share a heat lamp
 * and a feeder-insect order and almost nothing else, so a reptile always says
 * which it is. One list per species rather than a species per animal: a snake
 * becomes one more word here, not a new species with its own pages, nav entry
 * and routes. Species without a list carry no kind at all — a cow is a cow,
 * and breed lives on its registration papers.
 */
export const REPTILE_KINDS = ["gecko"] as const;
export type ReptileKind = (typeof REPTILE_KINDS)[number];

export const SPECIES_KINDS: Readonly<Partial<Record<Species, readonly string[]>>> = {
  reptile: REPTILE_KINDS,
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  gecko: "Gecko",
};

/** The kinds a species can be, or an empty list when it has none. */
export function kindsOf(species: Species): readonly string[] {
  return SPECIES_KINDS[species] ?? [];
}

export const SEXES = ["male", "female", "steer", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

export const ANIMAL_STATUSES = [
  "active",
  // Still here and still fed, but out of the breeding or show programme. A
  // retired cow is not a sold one and not a dead one, and rolling her into
  // "active" hides her from every question about who is actually working.
  "retired",
  "sold",
  "deceased",
  "processed",
  "boarding",
  "departed",
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export const OWNERSHIP = ["own", "client"] as const;
export type Ownership = (typeof OWNERSHIP)[number];

export interface Animal extends BaseRecord {
  readonly species: Species;
  /** Which kind of reptile (or of any species in `SPECIES_KINDS`). */
  readonly kind?: string | undefined;
  readonly name?: string | undefined;
  readonly tagNumber?: string | undefined;
  readonly sex: Sex;
  readonly dob?: Date | undefined;
  /** True when `dob` is a best guess — affects every age-based rule (§5.7). */
  readonly dobIsEstimate: boolean;
  readonly status: AnimalStatus;
  readonly ownership: Ownership;
  readonly ownerId?: Ulid | undefined;
  readonly safetyLevel: SafetyLevel;
  /** Why. "Kicks when cornered." Required by the guide to be useful (§5.1). */
  readonly safetyNotes?: string | undefined;
  readonly photoKeys: readonly string[];
  readonly customInstructions?: string | undefined;
  /**
   * When she died, and of what.
   *
   * Separate from `status`, because "deceased" is a state and these are the
   * facts about how it happened — and the cause is the field that turns a herd
   * of individual losses into a pattern somebody can act on.
   */
  readonly diedOn?: Date | undefined;
  readonly causeOfDeath?: string | undefined;
  readonly notes?: string | undefined;
}

export const animalSchema = baseRecordSchema
  .extend({
    species: z.enum(SPECIES),
    kind: z.string().max(40).optional(),
    name: z.string().max(80).optional(),
    tagNumber: z.string().max(40).optional(),
    sex: z.enum(SEXES),
    dob: z.coerce.date().optional(),
    dobIsEstimate: z.boolean(),
    status: z.enum(ANIMAL_STATUSES),
    ownership: z.enum(OWNERSHIP),
    ownerId: ulidSchema.optional(),
    safetyLevel: safetyLevelSchema,
    safetyNotes: z.string().max(1000).optional(),
    photoKeys: z.array(z.string()),
    customInstructions: z.string().max(5000).optional(),
    diedOn: z.coerce.date().optional(),
    causeOfDeath: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine(
    (animal) => {
      const kinds = kindsOf(animal.species);
      return kinds.length === 0
        ? animal.kind === undefined
        : animal.kind !== undefined && kinds.includes(animal.kind);
    },
    {
      // A gecko and a python are fed and housed nothing alike, so a reptile
      // with no kind is a record nobody can look after from.
      message: "Choose which kind",
      path: ["kind"],
    },
  )
  .refine((animal) => animal.ownership !== "client" || animal.ownerId !== undefined, {
    message: "A client animal must name its owner",
    path: ["ownerId"],
  })
  .refine((animal) => animal.name !== undefined || animal.tagNumber !== undefined, {
    message: "An animal needs a name or a tag number to be findable",
    path: ["tagNumber"],
  })
  .refine(
    // A date of death on a living animal is a status somebody forgot to
    // change, and it is the sort of mistake that quietly keeps a dead cow in
    // the breeding rotation.
    (animal) =>
      animal.diedOn === undefined || animal.status === "deceased" || animal.status === "processed",
    {
      message: "An animal with a date of death has to be marked deceased or processed",
      path: ["status"],
    },
  ) as unknown as z.ZodType<Animal>;

/** Age in whole days, or undefined when the birth date is unknown. */
export function ageInDays(animal: Pick<Animal, "dob">, now: Date): number | undefined {
  if (animal.dob === undefined) return undefined;
  return Math.floor((now.getTime() - animal.dob.getTime()) / 86_400_000);
}

export function ageInMonths(animal: Pick<Animal, "dob">, now: Date): number | undefined {
  const days = ageInDays(animal, now);
  return days === undefined ? undefined : Math.floor(days / 30.437);
}

/** Animals on the place right now — what the Pen Board and rosters count. */
export function isOnFarm(animal: Pick<Animal, "status">): boolean {
  return animal.status === "active" || animal.status === "boarding";
}

export function displayName(animal: Pick<Animal, "name" | "tagNumber">): string {
  if (animal.name !== undefined && animal.tagNumber !== undefined) {
    return `${animal.name} (${animal.tagNumber})`;
  }
  return animal.name ?? animal.tagNumber ?? "Unnamed";
}
