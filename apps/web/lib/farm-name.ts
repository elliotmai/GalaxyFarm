import { and, eq, isNull } from "drizzle-orm";

import {
  resolveBranding,
  resolveFarmName,
  type BrandingConfig,
  type Ulid,
} from "@galaxy-farm/core";
import { allTables, type Database } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";

/**
 * What this place is called, on the server (spec §5.1).
 *
 * `lib/branding.ts` answers the same question for a screen, from the device.
 * This is the server's copy of it, for the things that have no device to read
 * from: an email, a PDF, a cron job's calendar entry. Same resolution order —
 * the stored config, then `NEXT_PUBLIC_FARM_NAME`, then the neutral fallback —
 * because §5.1 has exactly one place that decides this and it is
 * `resolveFarmName`, in core. This file only fetches the argument.
 *
 * **Never throws.** The farm name is decoration on every caller: an email that
 * could not be sent because Neon was asleep when somebody asked what the farm
 * is called is a worse outcome than an email that goes out under the fallback
 * name. So a database that will not answer degrades to the environment
 * variable, silently and on purpose.
 */
export async function farmName(
  propertyId: Ulid,
  db: Database = database(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  return resolveFarmName(await storedBranding(propertyId, db), env);
}

async function storedBranding(propertyId: Ulid, db: Database): Promise<BrandingConfig | undefined> {
  try {
    const rows = await db
      .select()
      .from(allTables.brandingConfigs)
      .where(
        and(
          eq(allTables.brandingConfigs.propertyId, propertyId),
          isNull(allTables.brandingConfigs.deletedAt),
        ),
      );

    // Through `resolveBranding` rather than taking the first row, because two
    // devices that each named the farm while offline both produce one and the
    // tie is broken by id — the server has to reach the same answer every
    // screen already reaches, or an email disagrees with the nav above it.
    return resolveBranding(rows as unknown as BrandingConfig[]);
  } catch (error) {
    // Logged, because a caller that silently used the fallback name and
    // recorded nothing can only be diagnosed by reproducing it.
    console.error("[branding:server]", error);
    return undefined;
  }
}
