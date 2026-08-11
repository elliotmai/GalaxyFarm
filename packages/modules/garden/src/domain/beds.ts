import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * Beds, crops and seed (spec §5.5).
 *
 * A Bed is a child of a garden Zone rather than a Zone itself: §5.1's Zone is
 * "the universal place" and the Pen Board would otherwise render forty raised
 * beds alongside the pens. The shape and position come from the layout
 * designer, which §8 says is the same SVG component as the property map with a
 * different skin.
 */

export const BED_TYPES = ["raised_bed", "row", "container", "in_ground"] as const;
export type BedType = (typeof BED_TYPES)[number];

export interface Bed extends BaseRecord {
  /** The garden Zone this sits in. */
  readonly zoneId: Ulid;
  readonly name: string;
  readonly type: BedType;
  readonly lengthFt?: number | undefined;
  readonly widthFt?: number | undefined;
  /** Grid position from the designer — screen space here, unlike §8's pens. */
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly soilNotes?: string | undefined;
  readonly active: boolean;
}

export const bedSchema = baseRecordSchema.extend({
  zoneId: ulidSchema,
  name: z.string().min(1, "A bed needs a name").max(80),
  type: z.enum(BED_TYPES),
  lengthFt: z.number().positive().max(1000).optional(),
  widthFt: z.number().positive().max(1000).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  soilNotes: z.string().max(2000).optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<Bed>;

export function bedAreaSqFt(bed: Pick<Bed, "lengthFt" | "widthFt">): number | undefined {
  if (bed.lengthFt === undefined || bed.widthFt === undefined) return undefined;
  return bed.lengthFt * bed.widthFt;
}

export interface Crop extends BaseRecord {
  readonly name: string;
  /**
   * Botanical family, which is the field the rotation guard runs on.
   *
   * Tomatoes and peppers are both nightshades, and a rotation that only looked
   * at the crop name would happily follow one with the other — which is the
   * exact mistake rotation exists to prevent.
   */
  readonly family: string;
  readonly notes?: string | undefined;
}

export const cropSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A crop needs a name").max(80),
  family: z.string().min(1, "The family is what rotation is checked on").max(80),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<Crop>;

export interface Variety extends BaseRecord {
  readonly cropId: Ulid;
  readonly name: string;
  readonly daysToMaturity?: number | undefined;
  readonly spacingInches?: number | undefined;
  readonly source?: string | undefined;
  readonly notes?: string | undefined;
}

export const varietySchema = baseRecordSchema.extend({
  cropId: ulidSchema,
  name: z.string().min(1, "A variety needs a name").max(120),
  daysToMaturity: z.number().int().positive().max(400).optional(),
  spacingInches: z.number().positive().max(240).optional(),
  source: z.string().max(160).optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<Variety>;

export interface SeedInventory extends BaseRecord {
  readonly varietyId: Ulid;
  readonly quantity: number;
  readonly unit: "packet" | "gram" | "ounce" | "seed";
  readonly packedForYear?: number | undefined;
  readonly source?: string | undefined;
  readonly germinationNotes?: string | undefined;
}

export const seedInventorySchema = baseRecordSchema.extend({
  varietyId: ulidSchema,
  quantity: z.number().min(0),
  unit: z.enum(["packet", "gram", "ounce", "seed"]),
  packedForYear: z.number().int().min(1900).max(2100).optional(),
  source: z.string().max(160).optional(),
  germinationNotes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<SeedInventory>;

/**
 * Seed old enough that germination is worth testing first.
 *
 * Two seasons past its packed-for year. Not a hard expiry — most seed keeps
 * far longer than the packet suggests — which is why this reports rather than
 * hides anything.
 */
export function isStaleSeed(
  seed: Pick<SeedInventory, "packedForYear">,
  now: Date,
  seasons = 2,
): boolean {
  return seed.packedForYear !== undefined && now.getFullYear() - seed.packedForYear > seasons;
}
