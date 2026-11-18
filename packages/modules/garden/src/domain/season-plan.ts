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
        bedId?: Ulid;
        varietyId: Ulid;
        method: PlantingMethod;
        indoorStartedOn?: Date;
        plantedOn?: Date;
        status: "started" | "growing";
        quantity?: number;
      };
    }
  | { ok: false; reason: string } {
  if (planned.planStatus !== "open") {
    return { ok: false, reason: "That planting has already been closed out" };
  }

  const bed = bedId ?? planned.bedId;

  // A tray of seed started indoors is a seedling, not a planting in the
  // ground: it has a start date and no bed yet, and its harden-off and
  // transplant dates follow from the start.
  if (planned.method === "indoor_start") {
    return {
      ok: true,
      draft: {
        propertyId: planned.propertyId,
        ...(bed === undefined ? {} : { bedId: bed }),
        varietyId: planned.varietyId,
        method: planned.method,
        indoorStartedOn: at,
        status: "started",
        ...(planned.quantity === undefined ? {} : { quantity: planned.quantity }),
      },
    };
  }

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
    "3a": { lastSpring: "05-30", firstFall: "09-08" },
    "3b": { lastSpring: "05-22", firstFall: "09-15" },
    "4a": { lastSpring: "05-15", firstFall: "09-20" },
    "4b": { lastSpring: "05-08", firstFall: "09-28" },
    "5a": { lastSpring: "05-01", firstFall: "10-05" },
    "5b": { lastSpring: "04-25", firstFall: "10-10" },
    "6a": { lastSpring: "04-22", firstFall: "10-15" },
    "6b": { lastSpring: "04-18", firstFall: "10-20" },
    "7a": { lastSpring: "04-15", firstFall: "10-15" },
    "7b": { lastSpring: "04-05", firstFall: "10-25" },
    "8a": { lastSpring: "03-25", firstFall: "11-10" },
    "8b": { lastSpring: "03-15", firstFall: "11-20" },
    "9a": { lastSpring: "02-25", firstFall: "12-05" },
    "9b": { lastSpring: "02-10", firstFall: "12-15" },
    "10a": { lastSpring: "01-30", firstFall: "12-20" },
    "10b": { lastSpring: "01-15", firstFall: "12-28" },
    // Frost-free on average. Dates at the ends of the year keep every
    // schedule arithmetic working: "two weeks after the last frost" is the
    // middle of January, which is when a 11a garden plants tomatoes anyway.
    "11a": { lastSpring: "01-01", firstFall: "12-31" },
    "11b": { lastSpring: "01-01", firstFall: "12-31" },
  };

export interface FrostDates {
  readonly lastSpringFrost: Date;
  readonly firstFallFrost: Date;
  readonly growingDays: number;
}

/** A frost date the farm has written for itself, "MM-DD". */
export const FROST_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * The season's shape for a property: its own frost dates where it has
 * written them, else its zone's averages.
 *
 * The zone is a winter-minimum band, not a frost calendar, so the averages are
 * a starting point — a farm that has kept a thermometer for three springs
 * knows its own last frost, and every planting date follows from it.
 */
export function frostDatesFor(
  growingZone: string | undefined,
  year: number,
  own: { readonly lastFrost?: string | undefined; readonly firstFrost?: string | undefined } = {},
): FrostDates | undefined {
  const zone = ZONE_FROST_DATES[growingZone?.toLowerCase() ?? ""];
  const lastSpring =
    own.lastFrost !== undefined && FROST_DAY.test(own.lastFrost) ? own.lastFrost : zone?.lastSpring;
  const firstFall =
    own.firstFrost !== undefined && FROST_DAY.test(own.firstFrost)
      ? own.firstFrost
      : zone?.firstFall;
  if (lastSpring === undefined || firstFall === undefined) return undefined;

  const lastSpringFrost = new Date(`${year}-${lastSpring}T00:00:00Z`);
  const firstFallFrost = new Date(`${year}-${firstFall}T00:00:00Z`);

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
