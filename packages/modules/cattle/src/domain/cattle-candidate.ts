import { z } from "zod";

import { ulidSchema, type PurchaseCandidate, type Ulid } from "@galaxy-farm/core";

import { breedShareSchema, type BreedShare, type ParentRef } from "./cattle-profile.js";

/**
 * Cattle under consideration (spec §5.2, extending §5.1's PurchaseCandidate).
 *
 * The shared aggregate holds status, price, seller, distance, pros and cons.
 * What is added here is what you actually compare cattle on: what she is bred
 * to, whether she is papered, and — the one with a deadline — when the sale is.
 * "Auction lots are a deadline, not a browse."
 */

export const CATTLE_SALE_TYPES = [
  "private",
  "sale_barn",
  "auction",
  "online_sale",
  "production_sale",
] as const;
export type CattleSaleType = (typeof CATTLE_SALE_TYPES)[number];

export interface CattleCandidateDetail {
  readonly candidateId: Ulid;
  readonly breedComposition: readonly BreedShare[];
  readonly sex: "male" | "female" | "steer" | "unknown";
  readonly dob?: Date | undefined;
  /** Months, for a listing that gives an age rather than a date. */
  readonly ageMonths?: number | undefined;
  readonly association?: string | undefined;
  readonly regNumber?: string | undefined;
  /** Explicitly unpapered, as distinct from "we have not asked yet". */
  readonly unpapered: boolean;
  readonly epdSnapshot?: Record<string, number> | undefined;
  /** Resolves against an ExternalAnimal already in a pedigree we hold. */
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
  readonly bred: boolean;
  readonly serviceSire?: ParentRef | undefined;
  readonly dueDate?: Date | undefined;
  readonly saleType: CattleSaleType;
  readonly lotNumber?: string | undefined;
  readonly saleDate?: Date | undefined;
}

export const cattleCandidateSchema = z
  .object({
    candidateId: ulidSchema,
    breedComposition: z.array(breedShareSchema),
    sex: z.enum(["male", "female", "steer", "unknown"]),
    dob: z.coerce.date().optional(),
    ageMonths: z.number().int().min(0).max(360).optional(),
    association: z.string().max(40).optional(),
    regNumber: z.string().max(60).optional(),
    unpapered: z.boolean(),
    epdSnapshot: z.record(z.string(), z.number()).optional(),
    sire: z.object({ kind: z.enum(["animal", "external"]), id: ulidSchema }).optional(),
    dam: z.object({ kind: z.enum(["animal", "external"]), id: ulidSchema }).optional(),
    bred: z.boolean(),
    serviceSire: z.object({ kind: z.enum(["animal", "external"]), id: ulidSchema }).optional(),
    dueDate: z.coerce.date().optional(),
    saleType: z.enum(CATTLE_SALE_TYPES),
    lotNumber: z.string().max(40).optional(),
    saleDate: z.coerce.date().optional(),
  })
  .refine((detail) => !detail.unpapered || detail.regNumber === undefined, {
    // Both at once means somebody ticked the box and then typed a number, and
    // the comparison view would show a registration next to "unpapered".
    message: "An animal is either unpapered or has a registration number",
    path: ["unpapered"],
  })
  .refine((detail) => detail.bred || detail.dueDate === undefined, {
    message: "An open female has no due date",
    path: ["dueDate"],
  })
  .refine((detail) => detail.dob === undefined || detail.ageMonths === undefined, {
    // One or the other. Both invites them to disagree, and the comparison view
    // would have to pick a winner without being able to say which is right.
    message: "Give a date of birth or an age, not both",
    path: ["ageMonths"],
  }) as unknown as z.ZodType<CattleCandidateDetail>;

/** Age at a given date, from a DOB or a stated age. */
export function candidateAgeMonths(
  detail: Pick<CattleCandidateDetail, "dob" | "ageMonths">,
  now: Date,
  listedOn?: Date,
): number | undefined {
  if (detail.dob !== undefined) {
    const months =
      (now.getFullYear() - detail.dob.getFullYear()) * 12 +
      (now.getMonth() - detail.dob.getMonth());
    return Math.max(0, months);
  }
  if (detail.ageMonths === undefined) return undefined;

  // A stated age ages too. "18 months" on a listing from March is 20 months in
  // May, and comparing it against a DOB-derived age without that is comparing
  // two different dates.
  if (listedOn === undefined) return detail.ageMonths;
  const elapsed =
    (now.getFullYear() - listedOn.getFullYear()) * 12 + (now.getMonth() - listedOn.getMonth());
  return detail.ageMonths + Math.max(0, elapsed);
}

/**
 * Sales that are about to happen.
 *
 * A sale barn or auction lot is gone the moment the gavel falls, so this
 * sorts by date and includes only candidates still in play — a candidate
 * already marked `passed` or `gone` does not need a reminder.
 */
export function upcomingSales(
  details: readonly CattleCandidateDetail[],
  candidates: readonly Pick<PurchaseCandidate, "id" | "status">[],
  now: Date,
  leadDays = 14,
): CattleCandidateDetail[] {
  const live = new Set(
    candidates
      .filter((candidate) => !["purchased", "passed", "gone"].includes(candidate.status))
      .map((candidate) => candidate.id),
  );
  const horizon = new Date(now.getTime() + leadDays * 86_400_000);

  return details
    .filter((detail) => live.has(detail.candidateId))
    .filter(
      (detail) =>
        detail.saleDate !== undefined && detail.saleDate >= now && detail.saleDate <= horizon,
    )
    .sort((left, right) => (left.saleDate as Date).getTime() - (right.saleDate as Date).getTime());
}
