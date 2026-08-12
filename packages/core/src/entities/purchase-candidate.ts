import { z } from "zod";

import { addMoney, money, moneySchema, sumMoney, type Money } from "../value-objects/money.js";
import { daysBetween } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";
import type { PlanStatus, PlannedRecord } from "../crud/planned-actual.js";

/**
 * The specific thing you are actually looking at (spec §5.1, added v1.1).
 *
 * A roadmap wishlist item says "truck, need, ASAP". A candidate is "2018 F-250,
 * 96k miles, $34,500, listed here". Many candidates hang off one wishlist item,
 * and the point of the aggregate is to line them up next to each other at the
 * moment a large amount of money is about to move.
 */

export const CANDIDATE_STATUSES = [
  "watching",
  "contacted",
  "inspected",
  "offer_made",
  "purchased",
  "passed",
  "gone",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** A cost that only shows up after you say yes. */
export interface AdditionalCost {
  readonly label: string;
  readonly amount: Money;
}

export interface PurchaseCandidate extends BaseRecord, PlannedRecord {
  readonly domain: "cattle" | "horses" | "equipment";
  /**
   * The domain-specific half, opaque here.
   *
   * §5.9's comparison view is shared — status, price, seller, distance, pros
   * and cons are the same question whether it is a heifer or a baler. What
   * differs is what you actually compare *on*, and that belongs to the module:
   * cattle validates this with `cattleCandidateSchema`, equipment will
   * validate its own. The kernel holding a typed union of every domain's
   * fields would be the kernel knowing about cattle, which §4.1 forbids and
   * which would need editing every time a module is added.
   *
   * One field rather than a child table, because the detail changes as a unit
   * and the field-level merge (§4.2) wants exactly that.
   */
  readonly domainDetail?: Record<string, unknown> | undefined;
  /** The want this would satisfy, if any. */
  readonly roadmapItemId?: Ulid | undefined;
  readonly title: string;
  readonly status: CandidateStatus;
  readonly askingPrice: Money;
  /** Hauling, inspection, immediate repairs, commission. */
  readonly additionalCosts: readonly AdditionalCost[];
  readonly listingUrl?: string | undefined;
  readonly sellerId?: Ulid | undefined;
  readonly location?: string | undefined;
  readonly distanceMiles?: number | undefined;
  readonly listedDate?: Date | undefined;
  readonly firstSeen: Date;
  /** Listing expiry, or the sale/auction date — a lot is a deadline. */
  readonly expiresAt?: Date | undefined;
  readonly photoKeys: readonly string[];
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly notes?: string | undefined;
}

const additionalCostSchema = z.object({
  label: z.string().min(1, "A cost needs a label").max(80),
  amount: moneySchema,
});

export const purchaseCandidateSchema = baseRecordSchema.extend({
  domain: z.enum(["cattle", "horses", "equipment"]),
  // Unvalidated here on purpose: the owning module validates its own shape,
  // and a `z.unknown()` record is what lets that stay the module's business.
  domainDetail: z.record(z.string(), z.unknown()).optional(),
  roadmapItemId: ulidSchema.optional(),
  title: z.string().min(1, "A candidate needs a title").max(160),
  status: z.enum(CANDIDATE_STATUSES),
  askingPrice: moneySchema,
  additionalCosts: z.array(additionalCostSchema),
  listingUrl: z.string().url("That does not look like a link").optional(),
  sellerId: ulidSchema.optional(),
  location: z.string().max(160).optional(),
  distanceMiles: z.number().nonnegative().optional(),
  listedDate: z.coerce.date().optional(),
  firstSeen: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  photoKeys: z.array(z.string()),
  pros: z.array(z.string().max(200)),
  cons: z.array(z.string().max(200)),
  notes: z.string().max(5000).optional(),
  planStatus: z.enum(["open", "realised", "abandoned"]) as z.ZodType<PlanStatus>,
  realisedAs: ulidSchema.optional(),
  realisedAt: z.coerce.date().optional(),
  abandonedReason: z.string().max(1000).optional(),
}) as unknown as z.ZodType<PurchaseCandidate>;

/**
 * The number that decides things.
 *
 * The sticker price is the one figure that never settles a purchase — hauling a
 * tractor 300 miles and replacing its tyres is real money. Derived, never
 * stored, so editing a line item moves it (§2).
 */
export function totalAcquisitionCost(
  candidate: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
): Money {
  return addMoney(
    candidate.askingPrice,
    sumMoney(candidate.additionalCosts.map((cost) => cost.amount)),
  );
}

export interface BudgetComparison {
  readonly budget: Money;
  readonly total: Money;
  /** Positive means over budget. */
  readonly difference: Money;
  readonly overBudget: boolean;
}

export function compareToBudget(
  candidate: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
  budget: Money,
): BudgetComparison {
  const total = totalAcquisitionCost(candidate);
  const difference = money(total.cents - budget.cents);
  return { budget, total, difference, overBudget: difference.cents > 0 };
}

/** How long it has been sitting. A stale listing is a negotiating position. */
export function daysOnMarket(
  candidate: Pick<PurchaseCandidate, "listedDate" | "firstSeen">,
  now: Date,
): number {
  return daysBetween(candidate.listedDate ?? candidate.firstSeen, now);
}

/** Still worth looking at — not bought, not passed on, not sold to someone else. */
export function isActive(candidate: Pick<PurchaseCandidate, "status">): boolean {
  return (
    candidate.status !== "purchased" && candidate.status !== "passed" && candidate.status !== "gone"
  );
}

export function isExpiring(
  candidate: Pick<PurchaseCandidate, "expiresAt" | "status">,
  now: Date,
  withinDays = 3,
): boolean {
  if (!isActive(candidate) || candidate.expiresAt === undefined) return false;
  const remaining = daysBetween(now, candidate.expiresAt);
  return remaining >= 0 && remaining <= withinDays;
}

/**
 * Rank candidates cheapest-first on true cost.
 *
 * Sorting is a pure function returning a new array — the comparison view is a
 * read model, and mutating the caller's list would be a surprise.
 */
export function byTotalCost(
  left: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
  right: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
): number {
  return totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents;
}

export function rankByTotalCost<
  T extends Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
>(candidates: readonly T[]): T[] {
  return [...candidates].sort(byTotalCost);
}
