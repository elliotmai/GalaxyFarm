import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The farm name and the business name are global variables, never string
 * literals in code (spec §5.1).
 *
 * Both are undecided today. They are injected into every page title, header,
 * email, PDF, kiosk board, and portal page, so landing on a name later is one
 * settings edit rather than a search-and-replace across the codebase.
 */

export interface BrandingConfig extends BaseRecord {
  readonly farmName: string;
  readonly businessName?: string | undefined;
  readonly tagline?: string | undefined;
  readonly logoKey?: string | undefined;
}

export const brandingConfigSchema = baseRecordSchema.extend({
  farmName: z.string().min(1).max(80),
  businessName: z.string().min(1).max(80).optional(),
  tagline: z.string().max(160).optional(),
  logoKey: z.string().optional(),
}) as unknown as z.ZodType<BrandingConfig>;

export const FALLBACK_FARM_NAME = "Flying Double M";

/**
 * Resolve the farm name from config, then environment, then a neutral fallback.
 * Exactly one place decides this.
 */
export function resolveFarmName(
  config: Pick<BrandingConfig, "farmName"> | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  return config?.farmName ?? env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;
}

export function resolveBusinessName(
  config: Pick<BrandingConfig, "businessName" | "farmName"> | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  return (
    config?.businessName ??
    env["NEXT_PUBLIC_BUSINESS_NAME"] ??
    config?.farmName ??
    FALLBACK_FARM_NAME
  );
}

/**
 * Signed liability PDFs keep the business name as it read at signing, because
 * those are immutable legal records — the one deliberate exception to branding
 * propagation (§5.1, §4.5).
 */
export function nameForSignedDocument(snapshotName: string): string {
  return snapshotName;
}
