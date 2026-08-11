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

export const SPECIES = ["cattle", "chicken", "quail", "horse", "dog", "cat"] as const;
export type Species = (typeof SPECIES)[number];

export const SEXES = ["male", "female", "steer", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

export const ANIMAL_STATUSES = [
  "active",
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
  readonly notes?: string | undefined;
}

export const animalSchema = baseRecordSchema
  .extend({
    species: z.enum(SPECIES),
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
    notes: z.string().max(5000).optional(),
  })
  .refine((animal) => animal.ownership !== "client" || animal.ownerId !== undefined, {
    message: "A client animal must name its owner",
    path: ["ownerId"],
  })
  .refine((animal) => animal.name !== undefined || animal.tagNumber !== undefined, {
    message: "An animal needs a name or a tag number to be findable",
    path: ["tagNumber"],
  }) as unknown as z.ZodType<Animal>;

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
