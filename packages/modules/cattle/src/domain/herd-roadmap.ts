import { z } from "zod";

import {
  baseRecordSchema,
  ulidSchema,
  type BaseRecord,
  type PlanStatus,
  type Ulid,
} from "@galaxy-farm/core";

import { BREEDING_METHODS, type BreedingMethod, type BreedingRecord } from "./breeding-record.js";

/**
 * Where the herd is going (spec §5.2).
 *
 * The generic `Roadmap` in the kernel carries goals, milestones and wishlist
 * items for cattle, horses and equipment alike. Two things are specific enough
 * to cattle to live here: a genetic goal, which is a direction rather than a
 * date, and a planned mating, which becomes a real breeding record in one tap.
 */

export const GENETIC_DIRECTIONS = ["increase", "decrease", "maintain"] as const;
export type GeneticDirection = (typeof GENETIC_DIRECTIONS)[number];

export interface GeneticGoal extends BaseRecord {
  /** Free text: "calving ease", "rib shape", "docility" — not a fixed list. */
  readonly trait: string;
  readonly direction: GeneticDirection;
  readonly rationale?: string | undefined;
  readonly active: boolean;
}

export const geneticGoalSchema = baseRecordSchema.extend({
  trait: z.string().min(1, "Name the trait").max(120),
  direction: z.enum(GENETIC_DIRECTIONS),
  rationale: z.string().max(2000).optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<GeneticGoal>;

export interface PlannedMating extends BaseRecord {
  /** A specific cow, or criteria if the dam is not decided yet. */
  readonly damId?: Ulid | undefined;
  readonly damCriteria?: string | undefined;
  readonly method: BreedingMethod;
  readonly semenInventoryId?: Ulid | undefined;
  readonly bullId?: Ulid | undefined;
  readonly sireExternalId?: Ulid | undefined;
  /** "Spring 2027" — a season, because that is how breeding is planned. */
  readonly targetSeason?: string | undefined;
  readonly targetDate?: Date | undefined;
  readonly rationale?: string | undefined;
  readonly planStatus: PlanStatus;
  /** The BreedingRecord this became. */
  readonly realisedAs?: Ulid | undefined;
  readonly realisedAt?: Date | undefined;
  readonly abandonedReason?: string | undefined;
}

export const plannedMatingSchema = baseRecordSchema
  .extend({
    damId: ulidSchema.optional(),
    damCriteria: z.string().max(500).optional(),
    method: z.enum(BREEDING_METHODS),
    semenInventoryId: ulidSchema.optional(),
    bullId: ulidSchema.optional(),
    sireExternalId: ulidSchema.optional(),
    targetSeason: z.string().max(60).optional(),
    targetDate: z.coerce.date().optional(),
    rationale: z.string().max(2000).optional(),
    planStatus: z.enum(["open", "realised", "abandoned"]) as z.ZodType<PlanStatus>,
    realisedAs: ulidSchema.optional(),
    realisedAt: z.coerce.date().optional(),
    abandonedReason: z.string().max(1000).optional(),
  })
  .refine((plan) => plan.damId !== undefined || plan.damCriteria !== undefined, {
    // A plan naming neither is a plan about nothing. Criteria are enough —
    // "the two heifers, whichever settle" is a real plan.
    message: "Name a dam, or the criteria for choosing one",
    path: ["damId"],
  }) as unknown as z.ZodType<PlannedMating>;

/**
 * The breeding record this plan becomes.
 *
 * §5.2's "one tap converts a planned mating into a real BreedingRecord", and
 * the same planned→actual shape used by PurchaseCandidate and PlannedPlanting.
 * Returns a draft rather than writing: the id, timestamps and the actual
 * breeding date belong to the caller, who knows what day it is.
 *
 * Refuses a plan with no specific dam. Criteria are enough to *plan* with and
 * not enough to *breed* with — somebody has to say which cow walked into the
 * chute.
 */
export function matingToBreeding(
  plan: PlannedMating,
  at: Date,
  overrides: { readonly damId?: Ulid; readonly technicianId?: Ulid } = {},
):
  | { ok: true; draft: Omit<BreedingRecord, "id" | "createdAt" | "updatedAt"> }
  | { ok: false; reason: string } {
  if (plan.planStatus !== "open") {
    return { ok: false, reason: "That mating has already been closed out" };
  }

  const damId = overrides.damId ?? plan.damId;
  if (damId === undefined) {
    return { ok: false, reason: "Say which cow this is before recording the breeding" };
  }

  return {
    ok: true,
    draft: {
      propertyId: plan.propertyId,
      damId,
      method: plan.method,
      ...(plan.bullId === undefined ? {} : { bullId: plan.bullId }),
      ...(plan.semenInventoryId === undefined ? {} : { semenInventoryId: plan.semenInventoryId }),
      ...(plan.sireExternalId === undefined ? {} : { sireExternalId: plan.sireExternalId }),
      date: at,
      ...(overrides.technicianId === undefined ? {} : { technicianId: overrides.technicianId }),
      ...(plan.rationale === undefined ? {} : { notes: plan.rationale }),
    },
  };
}

export interface HerdSizeTarget {
  readonly year: number;
  readonly target: number;
}

/**
 * §5.2's "target herd-size milestones by year (1 → 20 over 5 years)".
 *
 * Stored as Roadmap milestones rather than a table of its own; this reads them
 * back as a curve so the herd-growth report can plot actual against target.
 */
export function herdSizeProgress(
  targets: readonly HerdSizeTarget[],
  actualByYear: ReadonlyMap<number, number>,
): Array<HerdSizeTarget & { readonly actual?: number; readonly onTrack?: boolean }> {
  return [...targets]
    .sort((left, right) => left.year - right.year)
    .map((target) => {
      const actual = actualByYear.get(target.year);
      return {
        ...target,
        ...(actual === undefined ? {} : { actual, onTrack: actual >= target.target }),
      };
    });
}
