import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  ulidSchema,
  type BaseRecord,
  type Ulid,
} from "@galaxy-farm/core";

import type { Variety } from "./beds.js";

/**
 * Plantings, care, harvest and the rotation guard (spec §5.5).
 *
 * The expected harvest date derives from the variety's days-to-maturity rather
 * than being typed, per §2 — correcting a planting date has to move the
 * harvest window with it.
 */

export const PLANTING_METHODS = ["direct_sow", "transplant", "indoor_start"] as const;
export type PlantingMethod = (typeof PLANTING_METHODS)[number];

export const PLANTING_STATUSES = [
  "planned",
  "started",
  "growing",
  "harvesting",
  "finished",
  "failed",
] as const;
export type PlantingStatus = (typeof PLANTING_STATUSES)[number];

export interface Planting extends BaseRecord {
  readonly bedId: Ulid;
  readonly varietyId: Ulid;
  readonly method: PlantingMethod;
  readonly indoorStartedOn?: Date | undefined;
  readonly plantedOn?: Date | undefined;
  readonly status: PlantingStatus;
  readonly quantity?: number | undefined;
  readonly notes?: string | undefined;
}

export const plantingSchema = baseRecordSchema
  .extend({
    bedId: ulidSchema,
    varietyId: ulidSchema,
    method: z.enum(PLANTING_METHODS),
    indoorStartedOn: z.coerce.date().optional(),
    plantedOn: z.coerce.date().optional(),
    status: z.enum(PLANTING_STATUSES),
    quantity: z.number().positive().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (planting) =>
      planting.indoorStartedOn === undefined ||
      planting.plantedOn === undefined ||
      planting.plantedOn >= planting.indoorStartedOn,
    { message: "Transplanted before it was started", path: ["plantedOn"] },
  ) as unknown as z.ZodType<Planting>;

export const GARDEN_CARE_ACTIONS = [
  "fertilize",
  "water",
  "weed",
  "pest_treatment",
  "amend",
] as const;
export type GardenCareAction = (typeof GARDEN_CARE_ACTIONS)[number];

export interface GardenCareLog extends BaseRecord {
  readonly bedId?: Ulid | undefined;
  readonly plantingId?: Ulid | undefined;
  readonly action: GardenCareAction;
  readonly performedOn: Date;
  readonly product?: string | undefined;
  readonly notes?: string | undefined;
}

export const gardenCareLogSchema = baseRecordSchema
  .extend({
    bedId: ulidSchema.optional(),
    plantingId: ulidSchema.optional(),
    action: z.enum(GARDEN_CARE_ACTIONS),
    performedOn: z.coerce.date(),
    product: z.string().max(160).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((log) => log.bedId !== undefined || log.plantingId !== undefined, {
    message: "Say which bed or planting this was",
    path: ["bedId"],
  }) as unknown as z.ZodType<GardenCareLog>;

export interface HarvestLog extends BaseRecord {
  readonly plantingId: Ulid;
  readonly harvestedOn: Date;
  readonly quantity: number;
  readonly unit: "lb" | "oz" | "each" | "bunch" | "quart";
  readonly notes?: string | undefined;
}

export const harvestLogSchema = baseRecordSchema.extend({
  plantingId: ulidSchema,
  harvestedOn: z.coerce.date(),
  quantity: z.number().positive(),
  unit: z.enum(["lb", "oz", "each", "bunch", "quart"]),
  notes: z.string().max(1000).optional(),
}) as unknown as z.ZodType<HarvestLog>;

export const PRESERVATION_METHODS = ["canned", "frozen", "dried", "fermented"] as const;
export type PreservationMethod = (typeof PRESERVATION_METHODS)[number];

export interface PreservationLog extends BaseRecord {
  readonly harvestLogId?: Ulid | undefined;
  readonly label: string;
  readonly method: PreservationMethod;
  readonly quantity: number;
  readonly unit: "jar" | "quart" | "pint" | "bag" | "lb";
  readonly preservedOn: Date;
  readonly storageLocation?: string | undefined;
  readonly notes?: string | undefined;
}

export const preservationLogSchema = baseRecordSchema.extend({
  harvestLogId: ulidSchema.optional(),
  label: z.string().min(1, "Label the jar").max(120),
  method: z.enum(PRESERVATION_METHODS),
  quantity: z.number().positive(),
  unit: z.enum(["jar", "quart", "pint", "bag", "lb"]),
  preservedOn: z.coerce.date(),
  storageLocation: z.string().max(160).optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<PreservationLog>;

/**
 * When to expect a harvest.
 *
 * Counted from transplant or direct sow, not from an indoor start: days to
 * maturity on a packet is measured from the plant going in the ground for a
 * transplanted crop, and counting from the seed tray would put tomatoes six
 * weeks early.
 */
export function expectedHarvestDate(
  planting: Pick<Planting, "plantedOn" | "method" | "indoorStartedOn">,
  variety: Pick<Variety, "daysToMaturity">,
): Date | undefined {
  if (variety.daysToMaturity === undefined) return undefined;
  const from =
    planting.plantedOn ?? (planting.method === "direct_sow" ? planting.indoorStartedOn : undefined);
  if (from === undefined) return undefined;
  return addDays(from, variety.daysToMaturity);
}

export const DEFAULT_ROTATION_YEARS = 3;

export interface RotationWarning {
  readonly bedId: Ulid;
  readonly family: string;
  readonly lastPlantedOn: Date;
  readonly yearsSince: number;
}

/**
 * Would planting this family here break the rotation?
 *
 * Checked on the botanical family, not the crop: tomatoes following peppers is
 * the mistake, and the two share nothing but a family. §5.5 asks for a visible
 * warning in the designer rather than a block — a gardener who knows they are
 * breaking rotation and is doing it anyway is not making a mistake.
 */
export function rotationWarning(
  bedId: Ulid,
  family: string,
  history: ReadonlyArray<{ bedId: Ulid; family: string; plantedOn: Date }>,
  now: Date,
  years: number = DEFAULT_ROTATION_YEARS,
): RotationWarning | undefined {
  const previous = history
    .filter((entry) => entry.bedId === bedId && entry.family === family)
    .sort((left, right) => right.plantedOn.getTime() - left.plantedOn.getTime())[0];

  if (previous === undefined) return undefined;

  const yearsSince = (now.getTime() - previous.plantedOn.getTime()) / (365.25 * 86_400_000);
  if (yearsSince >= years) return undefined;

  return { bedId, family, lastPlantedOn: previous.plantedOn, yearsSince };
}

/** Everything harvested from one planting, which is the yield picture. */
export function totalHarvest(
  logs: readonly HarvestLog[],
  plantingId: Ulid,
): Map<HarvestLog["unit"], number> {
  const totals = new Map<HarvestLog["unit"], number>();

  for (const log of logs) {
    if (log.plantingId !== plantingId) continue;
    totals.set(log.unit, (totals.get(log.unit) ?? 0) + log.quantity);
  }

  return totals;
}
