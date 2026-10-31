import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

import { LIFECYCLES, SEASONS, SOWING_METHODS, SUN_NEEDS, type GrowingFacts } from "./growing.js";

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

/**
 * A crop also carries how it is grown (`GrowingFacts`): typical days to
 * maturity and spacing, cool or warm season, sun, sowing, lifecycle and depth.
 * Filled in from the plant search and editable; a new variety starts from the
 * crop's days and spacing, then keeps its own off the packet.
 */
export interface Crop extends BaseRecord, GrowingFacts {
  readonly name: string;
  /**
   * Botanical family, which is the field the rotation guard runs on.
   *
   * Tomatoes and peppers are both nightshades, and a rotation that only looked
   * at the crop name would happily follow one with the other — which is the
   * exact mistake rotation exists to prevent.
   *
   * Optional, because it is inferred: absent means "work it out from the name"
   * (`cropFamily` in `families.ts`), and nobody is asked to know that a tomato
   * is a Solanaceae. Stored when somebody overrides the inference or picks the
   * crop from the plant search, and then it wins.
   */
  readonly family?: string | undefined;
  /** "Solanum lycopersicum" — from the plant search, and a second clue to the family. */
  readonly scientificName?: string | undefined;
  readonly notes?: string | undefined;
}

export const cropSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A crop needs a name").max(80),
  family: z.string().max(80).optional(),
  scientificName: z.string().max(160).optional(),
  notes: z.string().max(2000).optional(),
  daysToMaturity: z.number().int().positive().max(1000).optional(),
  spacingInches: z.number().positive().max(240).optional(),
  season: z.enum(SEASONS).optional(),
  lifecycle: z.enum(LIFECYCLES).optional(),
  sun: z.enum(SUN_NEEDS).optional(),
  sowing: z.enum(SOWING_METHODS).optional(),
  depthInches: z.number().positive().max(24).optional(),
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
  /** Optional: a packet whose count nobody knows is still in the box. */
  readonly quantity?: number | undefined;
  readonly unit: "packet" | "gram" | "ounce" | "seed";
  readonly packedForYear?: number | undefined;
  readonly source?: string | undefined;
  readonly germinationNotes?: string | undefined;
}

export const seedInventorySchema = baseRecordSchema.extend({
  varietyId: ulidSchema,
  quantity: z.number().min(0).optional(),
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
