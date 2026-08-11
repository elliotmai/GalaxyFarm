import type { BaseRecord } from "../entities/record.js";
import { err, ok, type Result } from "../types/result.js";
import type { Ulid } from "../types/ids.js";

/**
 * Planned becomes actual, once.
 *
 * Three features need this and it would otherwise be written three times:
 * PlannedMating → BreedingRecord (§5.2), PlannedPlanting → Planting (§5.5), and
 * PurchaseCandidate → Equipment or Animal (§5.1). In every case the plan is
 * kept rather than consumed — what you intended is worth reading next season
 * alongside what actually happened.
 */

export type PlanStatus = "open" | "realised" | "abandoned";

export interface PlannedRecord extends BaseRecord {
  readonly planStatus: PlanStatus;
  /** Set once realised — the record this plan became. */
  readonly realisedAs?: Ulid | undefined;
  readonly realisedAt?: Date | undefined;
  /** Set when abandoned. The reason is required; "why not" is the useful part. */
  readonly abandonedReason?: string | undefined;
}

export type ConversionError =
  | { readonly kind: "already-realised"; readonly realisedAs: Ulid }
  | { readonly kind: "abandoned" }
  | { readonly kind: "invariant"; readonly message: string };

export interface Conversion<TPlan extends PlannedRecord, TActual extends BaseRecord> {
  readonly plan: TPlan;
  readonly actual: TActual;
}

/**
 * Convert a plan into the real record.
 *
 * `build` carries the plan's data across — price, seller, photos, rationale —
 * so nothing is typed twice. The returned plan is updated, not deleted.
 */
export function realise<TPlan extends PlannedRecord, TActual extends BaseRecord>(
  plan: TPlan,
  at: Date,
  build: (plan: TPlan) => TActual,
): Result<Conversion<TPlan, TActual>, ConversionError> {
  if (plan.planStatus === "realised" && plan.realisedAs !== undefined) {
    return err({ kind: "already-realised", realisedAs: plan.realisedAs });
  }
  if (plan.planStatus === "abandoned") {
    return err({ kind: "abandoned" });
  }

  const actual = build(plan);
  const realisedPlan: TPlan = {
    ...plan,
    planStatus: "realised",
    realisedAs: actual.id,
    realisedAt: at,
    updatedAt: at,
  };

  return ok({ plan: realisedPlan, actual });
}

/**
 * Abandon a plan, keeping it. A reason is required — the record of what you
 * turned down and why is worth as much as the record of what you chose.
 */
export function abandon<TPlan extends PlannedRecord>(
  plan: TPlan,
  at: Date,
  reason: string,
): Result<TPlan, ConversionError> {
  if (plan.planStatus === "realised" && plan.realisedAs !== undefined) {
    return err({ kind: "already-realised", realisedAs: plan.realisedAs });
  }
  if (reason.trim() === "") {
    return err({ kind: "invariant", message: "Abandoning a plan requires a reason" });
  }

  return ok({ ...plan, planStatus: "abandoned", abandonedReason: reason.trim(), updatedAt: at });
}

export function isPlanOpen(plan: Pick<PlannedRecord, "planStatus">): boolean {
  return plan.planStatus === "open";
}
