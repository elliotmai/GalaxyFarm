import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The farm name and the business name are global variables, never string
 * literals in code (spec §5.1).
 *
 * The farm name is decided: **Flying Double M**. It reached that through the
 * seam this file exists for — settings, then environment, then the fallback
 * below — so naming the farm cost one edit rather than a search-and-replace,
 * which is the whole point of keeping it a variable through Phase 0.
 *
 * The business name is deliberately not set separately, so the show-calf
 * boarding operation currently trades under the farm name. That is a real
 * default rather than a gap: `resolveBusinessName` falls back to the farm name,
 * and giving the business its own identity later is again one settings edit.
 *
 * Both are injected into every page title, header, email, PDF, kiosk board, and
 * portal page. The one place that does not follow a rename is a signed
 * liability PDF — see `nameForSignedDocument`.
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
 * The one branding config for a property, out of however many exist.
 *
 * There should only ever be one, and the app writes it that way. But the store
 * is local-first: two devices that both go to name the farm while offline each
 * create a row, and both rows arrive. Nothing about that is an error worth
 * showing somebody — it is two people agreeing to do the same thing.
 *
 * So the tie is broken by id rather than by `updatedAt`. Ids are ULIDs, which
 * sort by creation time and never collide, and the point is that every device
 * reaches the same answer without talking to the others. `updatedAt` would
 * make the farm's name depend on who edited last on which clock, and two
 * kiosks could disagree about it indefinitely.
 */
export function resolveBranding(configs: readonly BrandingConfig[]): BrandingConfig | undefined {
  return [...configs].sort((left, right) => left.id.localeCompare(right.id))[0];
}

/**
 * A branding variable that is present but blank is not an answer.
 *
 * `.env.example` ships `NEXT_PUBLIC_BUSINESS_NAME=""`, which is how you say
 * "the business has no name of its own yet" in a file that has to mention every
 * variable. `??` disagrees: it only steps past null and undefined, so an empty
 * string counts as a decision and stops the chain dead. That put an empty
 * business name on `/book`, `/account`, agreements, and invoices — the
 * customer-facing surfaces, and the ones where a blank is least survivable.
 *
 * So blank-is-absent, and trimmed, because a name that is only spaces is the
 * same mistake with more characters.
 */
function named(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * Resolve the farm name from config, then environment, then the fallback.
 * Exactly one place decides this.
 */
export function resolveFarmName(
  config: Pick<BrandingConfig, "farmName"> | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  return named(config?.farmName) ?? named(env["NEXT_PUBLIC_FARM_NAME"]) ?? FALLBACK_FARM_NAME;
}

/**
 * The business name, falling back to the farm name.
 *
 * Today that fallback is the live answer rather than a safety net — the farm
 * name is Flying Double M and the business has not been given one of its own.
 */
export function resolveBusinessName(
  config: Pick<BrandingConfig, "businessName" | "farmName"> | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  return (
    named(config?.businessName) ??
    named(env["NEXT_PUBLIC_BUSINESS_NAME"]) ??
    named(config?.farmName) ??
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
