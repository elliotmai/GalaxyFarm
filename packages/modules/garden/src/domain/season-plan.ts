import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  ulidSchema,
  type BaseRecord,
  type PlanStatus,
  type Ulid,
} from "@galaxy-farm/core";

import type { PlantingMethod } from "./planting.js";

/**
 * The season plan, and the notifications it drives (spec §5.5, §12 decision 8).
 *
 * §5.5 is precise about the scope: notifications fire "only for what's *in the
 * plan*, not the whole seed catalog", and the general planting calendar stays
 * browseable for everything else. That distinction is the whole feature — an
 * app that told you every crop's window every week would be an app with
 * notifications turned off.
 */

export interface SeasonPlan extends BaseRecord {
  readonly name: string;
  readonly year: number;
  readonly notes?: string | undefined;
  readonly active: boolean;
}

export const seasonPlanSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A season plan needs a name").max(120),
  year: z.number().int().min(1900).max(2100),
  notes: z.string().max(5000).optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<SeasonPlan>;

export interface PlannedPlanting extends BaseRecord {
  readonly seasonPlanId: Ulid;
  readonly varietyId: Ulid;
  readonly method: PlantingMethod;
  readonly bedId?: Ulid | undefined;
  readonly windowFrom: Date;
  readonly windowTo: Date;
  readonly quantity?: number | undefined;
  readonly planStatus: PlanStatus;
  /** The Planting this became. */
  readonly realisedAs?: Ulid | undefined;
  readonly realisedAt?: Date | undefined;
  readonly abandonedReason?: string | undefined;
  readonly notes?: string | undefined;
}

export const plannedPlantingSchema = baseRecordSchema
  .extend({
    seasonPlanId: ulidSchema,
    varietyId: ulidSchema,
    method: z.enum(["direct_sow", "transplant", "indoor_start"]),
    bedId: ulidSchema.optional(),
    windowFrom: z.coerce.date(),
    windowTo: z.coerce.date(),
    quantity: z.number().positive().optional(),
    planStatus: z.enum(["open", "realised", "abandoned"]) as z.ZodType<PlanStatus>,
    realisedAs: ulidSchema.optional(),
    realisedAt: z.coerce.date().optional(),
    abandonedReason: z.string().max(1000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((planned) => planned.windowTo >= planned.windowFrom, {
    message: "A planting window cannot close before it opens",
    path: ["windowTo"],
  }) as unknown as z.ZodType<PlannedPlanting>;

export interface OpeningWindow {
  readonly planned: PlannedPlanting;
  readonly opensOn: Date;
  readonly open: boolean;
  readonly closingSoon: boolean;
}

/**
 * Windows opening inside the lead time, and ones about to close.
 *
 * Only open plans: one already realised or abandoned raises nothing, which is
 * what keeps the notification list short enough to be read.
 */
export function plantingWindows(
  planned: readonly PlannedPlanting[],
  now: Date,
  leadDays = 7,
): OpeningWindow[] {
  const horizon = addDays(now, leadDays);

  return planned
    .filter((entry) => entry.planStatus === "open")
    .filter((entry) => entry.windowFrom <= horizon && entry.windowTo >= now)
    .map((entry) => ({
      planned: entry,
      opensOn: entry.windowFrom,
      open: entry.windowFrom <= now,
      closingSoon: entry.windowTo <= horizon,
    }))
    .sort((left, right) => left.opensOn.getTime() - right.opensOn.getTime());
}

/**
 * The planting a plan becomes — §5.5's "one tap converts the plan into a real
 * Planting record", the same shape as PlannedMating and PurchaseCandidate.
 */
export function plantingToActual(
  planned: PlannedPlanting,
  at: Date,
  bedId?: Ulid,
):
  | {
      ok: true;
      draft: {
        propertyId: Ulid;
        bedId: Ulid;
        varietyId: Ulid;
        method: PlantingMethod;
        plantedOn: Date;
        status: "growing";
        quantity?: number;
      };
    }
  | { ok: false; reason: string } {
  if (planned.planStatus !== "open") {
    return { ok: false, reason: "That planting has already been closed out" };
  }

  const bed = bedId ?? planned.bedId;
  if (bed === undefined) return { ok: false, reason: "Say which bed it went in" };

  return {
    ok: true,
    draft: {
      propertyId: planned.propertyId,
      bedId: bed,
      varietyId: planned.varietyId,
      method: planned.method,
      plantedOn: at,
      status: "growing",
      ...(planned.quantity === undefined ? {} : { quantity: planned.quantity }),
    },
  };
}

/**
 * Average frost dates for a USDA hardiness zone.
 *
 * Approximate by construction — the zone is a winter-minimum band, not a frost
 * calendar — so these are a starting point a property setting overrides. Wise
 * County reads 8a, which is the value `docs/property-layout.md` flags for
 * confirmation.
 */
export const ZONE_FROST_DATES: Readonly<Record<string, { lastSpring: string; firstFall: string }>> =
  {
    "7a": { lastSpring: "04-15", firstFall: "10-15" },
    "7b": { lastSpring: "04-05", firstFall: "10-25" },
    "8a": { lastSpring: "03-25", firstFall: "11-10" },
    "8b": { lastSpring: "03-15", firstFall: "11-20" },
    "9a": { lastSpring: "02-25", firstFall: "12-05" },
  };

export interface FrostDates {
  readonly lastSpringFrost: Date;
  readonly firstFallFrost: Date;
  readonly growingDays: number;
}

/** The season's shape for a property, from its growing zone. */
export function frostDatesFor(
  growingZone: string | undefined,
  year: number,
): FrostDates | undefined {
  const dates = ZONE_FROST_DATES[growingZone?.toLowerCase() ?? ""];
  if (dates === undefined) return undefined;

  const lastSpringFrost = new Date(`${year}-${dates.lastSpring}T00:00:00Z`);
  const firstFallFrost = new Date(`${year}-${dates.firstFall}T00:00:00Z`);

  return {
    lastSpringFrost,
    firstFallFrost,
    growingDays: Math.round((firstFallFrost.getTime() - lastSpringFrost.getTime()) / 86_400_000),
  };
}

/** Is the garden inside its growing season? Frost warnings fire only then (§6). */
export function isInGrowingSeason(dates: FrostDates | undefined, at: Date): boolean {
  if (dates === undefined) return true;
  return at >= dates.lastSpringFrost && at <= dates.firstFallFrost;
}
