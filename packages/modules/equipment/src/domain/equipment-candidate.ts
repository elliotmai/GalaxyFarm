import { z } from "zod";

import {
  totalAcquisitionCost,
  ulidSchema,
  type Money,
  type PurchaseCandidate,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Equipment under consideration (spec §5.6, extending §5.1's PurchaseCandidate).
 *
 * §5.6 names the reason this extension exists: "where both mileage and hours
 * are known the comparison view shows price per mile and per hour, which is the
 * only honest way to compare a low-hour expensive unit against a high-hour
 * cheap one."
 *
 * Both rates divide *total acquisition cost*, not asking price — §5.1 is
 * explicit that the sticker price "is the one number that never decides
 * anything", and a truck two states away with a $900 haul is not the cheap one.
 */

export const TITLE_STATUSES = ["clean", "rebuilt", "lien", "bill_of_sale_only"] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const CONDITIONS = ["excellent", "good", "fair", "rough", "parts"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface EquipmentCandidateDetail {
  readonly candidateId: Ulid;
  readonly category: "vehicle" | "trailer" | "implement" | "tool";
  readonly make?: string | undefined;
  readonly model?: string | undefined;
  readonly year?: number | undefined;
  readonly mileage?: number | undefined;
  readonly engineHours?: number | undefined;
  readonly vin?: string | undefined;
  readonly condition?: Condition | undefined;
  readonly titleStatus?: TitleStatus | undefined;
  readonly serviceHistoryAvailable: boolean;
  readonly warrantyRemaining?: string | undefined;
  readonly knownFaults?: string | undefined;
  /** Tyres, tracks, or the implement's wear surfaces, where it matters. */
  readonly wearCondition?: string | undefined;
}

export const equipmentCandidateSchema = z.object({
  candidateId: ulidSchema,
  category: z.enum(["vehicle", "trailer", "implement", "tool"]),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  mileage: z.number().min(0).max(2_000_000).optional(),
  engineHours: z.number().min(0).max(100_000).optional(),
  vin: z.string().max(40).optional(),
  condition: z.enum(CONDITIONS).optional(),
  titleStatus: z.enum(TITLE_STATUSES).optional(),
  serviceHistoryAvailable: z.boolean(),
  warrantyRemaining: z.string().max(160).optional(),
  knownFaults: z.string().max(2000).optional(),
  wearCondition: z.string().max(500).optional(),
}) as unknown as z.ZodType<EquipmentCandidateDetail>;

/**
 * Cost per mile, in cents.
 *
 * Divides total acquisition cost, not the asking price. Undefined at zero
 * miles: a new truck's price per mile is not infinite, it is a question that
 * does not apply.
 */
export function pricePerMile(
  candidate: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
  detail: Pick<EquipmentCandidateDetail, "mileage">,
): Money | undefined {
  if (detail.mileage === undefined || detail.mileage <= 0) return undefined;
  return { cents: totalAcquisitionCost(candidate).cents / detail.mileage };
}

export function pricePerHour(
  candidate: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts">,
  detail: Pick<EquipmentCandidateDetail, "engineHours">,
): Money | undefined {
  if (detail.engineHours === undefined || detail.engineHours <= 0) return undefined;
  return { cents: totalAcquisitionCost(candidate).cents / detail.engineHours };
}

/**
 * Things worth being told before handing over money.
 *
 * Not a score. §5.1's comparison view is for a decision made away from the
 * screen, and a single number would flatten exactly the things somebody needs
 * to weigh themselves.
 */
export function concerns(detail: EquipmentCandidateDetail): string[] {
  const found: string[] = [];

  if (detail.titleStatus === "lien") found.push("There is a lien on the title");
  if (detail.titleStatus === "bill_of_sale_only") found.push("Bill of sale only — no title");
  if (detail.titleStatus === "rebuilt") found.push("Rebuilt title");
  if (!detail.serviceHistoryAvailable) found.push("No service history");
  if (detail.knownFaults !== undefined && detail.knownFaults.trim() !== "") {
    found.push(`Known faults: ${detail.knownFaults.trim()}`);
  }
  if (detail.condition === "rough" || detail.condition === "parts") {
    found.push(`Condition listed as ${detail.condition}`);
  }

  return found;
}
