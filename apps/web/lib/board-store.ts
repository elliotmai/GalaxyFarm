import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";
import { bearerToken } from "@galaxy-farm/infra-auth";
import type { Database } from "@galaxy-farm/infra-db";

import { apiTokenDeviceId, authenticateApiToken, type ApiToken } from "@/lib/api-token-store";
import {
  boardChores,
  boardProperty,
  boardSitter,
  resolveBoardChore,
  resolveTimeZone,
  tickKeys,
  todaySheet,
  zonedNoon,
  type BoardResponse,
} from "@/lib/board-api";
import { database } from "@/lib/credential-store";
import { sitterView, tickChore } from "@/lib/sitter-store";
import { propertyFor } from "@/lib/weather-service";

/**
 * The board API's reads and its one write, against Postgres (spec §4.3
 * "Connected apps").
 *
 * Reads go through `sitterView` — the narrow, guide-shaped read `/sitter`
 * already makes — rather than a new query: it is exactly the tables a board
 * needs (chores, plans, zones, the guide and its emergency and vet contacts)
 * and nothing about sales, breeding or the books. The write goes through
 * `tickChore`, the function the kiosk's own `setKioskChoreDone` calls, so it
 * lands through `applyPushAndMark`: field metadata, the sync audit, and the
 * change stamp every device's next pull checks.
 */

/**
 * The live token a request carries, or undefined.
 *
 * `lookup` is injectable so the check itself is testable without Postgres;
 * in the app it is `authenticateApiToken`.
 */
export async function authorizeBoardRequest(
  header: string | null,
  now: Date,
  lookup: (token: string, now: Date) => Promise<ApiToken | undefined> = authenticateApiToken,
): Promise<ApiToken | undefined> {
  const token = bearerToken(header);
  if (token === undefined) return undefined;
  return lookup(token, now);
}

export async function boardSnapshot(
  apiToken: ApiToken,
  now: Date,
  db: Database = database(),
): Promise<BoardResponse> {
  const [property, view] = await Promise.all([
    propertyFor(apiToken.propertyId, db),
    sitterView(apiToken.propertyId, db),
  ]);
  const timeZone = resolveTimeZone(property?.timezone);
  const sheet = todaySheet({ propertyId: apiToken.propertyId, ...view }, now, timeZone);

  return {
    property: boardProperty(property, process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME),
    date: sheet.date,
    chores: boardChores(sheet.entries),
    sitter: boardSitter({ ...view, health: view.petHealth }, now),
  };
}

export type BoardTickOutcome =
  | { readonly kind: "ticked"; readonly done: boolean }
  | { readonly kind: "not_found" }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Tick a chore on today's sheet done or not done, as the kiosk does.
 *
 * Only a chore today's sheet shows can be ticked — the kiosk board has no
 * other day either — and the occurrence is resolved from the farm's own
 * records, never from anything the caller said about it. Attributed to the
 * token: `completedBy` is its id and the audit's device is `app:<id>`, the
 * way a kiosk's writes carry its device id rather than a person's.
 */
export async function tickBoardChore(
  apiToken: ApiToken,
  id: string,
  done: boolean,
  now: Date,
  db: Database = database(),
): Promise<BoardTickOutcome> {
  const [property, view] = await Promise.all([
    propertyFor(apiToken.propertyId, db),
    sitterView(apiToken.propertyId, db),
  ]);
  const timeZone = resolveTimeZone(property?.timezone);
  const sheet = todaySheet({ propertyId: apiToken.propertyId, ...view }, now, timeZone);

  const entry = resolveBoardChore(sheet, id);
  if (entry === undefined) return { kind: "not_found" };

  // An occurrence nobody has written down was never done; un-ticking it is
  // already true, and `tickChore` would call it an error.
  if (!done && entry.taskId === undefined) return { kind: "ticked", done: false };

  const result = await tickChore(
    {
      propertyId: apiToken.propertyId,
      actorId: apiToken.id,
      ...tickKeys(entry),
      date: zonedNoon(sheet.date, timeZone),
      at: now,
      done,
      deviceId: apiTokenDeviceId(apiToken),
    },
    db,
  );

  return result.ok ? { kind: "ticked", done } : { kind: "refused", reason: result.reason };
}
