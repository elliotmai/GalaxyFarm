import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The place. Everything else hangs off `propertyId`, so a second location later
 * is a query filter rather than a migration (spec §5).
 */

export interface Property extends BaseRecord {
  readonly name: string;
  readonly address?: string | undefined;
  readonly timezone: string;
  /** USDA hardiness zone. Auto-suggested from ZIP, always editable (§5.1). */
  readonly growingZone?: string | undefined;
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
  /** R2 key for the cached NAIP aerial used offline and on kiosks (§8). */
  readonly offlineImageryKey?: string | undefined;
}

export const propertySchema = baseRecordSchema.extend({
  name: z.string().min(1, "A property needs a name").max(120),
  address: z.string().max(300).optional(),
  timezone: z.string().min(1),
  growingZone: z
    .string()
    .regex(/^\d{1,2}[ab]?$/i, "Growing zone looks like 8b")
    .optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  offlineImageryKey: z.string().optional(),
}) as unknown as z.ZodType<Property>;

/** Weather and calving watch need coordinates; nothing else does (§6). */
export function hasCoordinates(
  property: Pick<Property, "latitude" | "longitude">,
): property is Pick<Property, "latitude" | "longitude"> & { latitude: number; longitude: number } {
  return property.latitude !== undefined && property.longitude !== undefined;
}
