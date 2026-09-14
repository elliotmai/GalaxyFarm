import { eq } from "drizzle-orm";

import type { Ulid } from "@galaxy-farm/core";
import { wanderConnections } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";

/**
 * The link to Wander, in Postgres (spec §5.10, §4.1).
 *
 * The same exception `push-store.ts` and `device-store.ts` document, made on
 * the strongest grounds of the three: this token reads *every* trip its owner
 * is on in another app, so the table never reaches a local store and the
 * screen that manages it reads on the server and writes through server
 * actions.
 *
 * **Nothing here returns the token to a screen.** `connectionFor` is what the
 * admin screen sees and deliberately has no `token` field; only
 * `tokenFor`, which the server-side client calls, returns the secret. That
 * split is the whole reason both functions exist rather than one.
 */

/** The connection as the settings screen sees it — without the credential. */
export interface WanderConnection {
  readonly functionsBaseUrl: string;
  /** Absent until a trip has been picked. */
  readonly tripId?: string | undefined;
  readonly tripName?: string | undefined;
  readonly connectedAt: Date;
  readonly lastPulledAt?: Date | undefined;
  readonly lastError?: string | undefined;
}

export async function connectionFor(propertyId: Ulid): Promise<WanderConnection | undefined> {
  const db = await database();
  const [row] = await db
    .select()
    .from(wanderConnections)
    .where(eq(wanderConnections.propertyId, propertyId))
    .limit(1);

  if (row === undefined) return undefined;

  return {
    functionsBaseUrl: row.functionsBaseUrl,
    ...(row.tripId === null ? {} : { tripId: row.tripId }),
    ...(row.tripName === null ? {} : { tripName: row.tripName }),
    connectedAt: row.connectedAt,
    ...(row.lastPulledAt === null ? {} : { lastPulledAt: row.lastPulledAt }),
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
  };
}

/**
 * The credential itself. Server-side callers only.
 *
 * Separated from `connectionFor` rather than being an extra field on it,
 * because a field is something a screen can accidentally spread into a prop
 * and a function is something you have to mean to call.
 */
export async function tokenFor(
  propertyId: Ulid,
): Promise<{ token: string; functionsBaseUrl: string; tripId?: string } | undefined> {
  const db = await database();
  const [row] = await db
    .select()
    .from(wanderConnections)
    .where(eq(wanderConnections.propertyId, propertyId))
    .limit(1);

  if (row === undefined) return undefined;

  return {
    token: row.token,
    functionsBaseUrl: row.functionsBaseUrl,
    ...(row.tripId === null ? {} : { tripId: row.tripId }),
  };
}

/** Save a token, replacing whatever was there. Picking a trip comes after. */
export async function saveConnection(
  propertyId: Ulid,
  token: string,
  functionsBaseUrl: string,
): Promise<void> {
  const db = await database();
  await db
    .insert(wanderConnections)
    .values({
      propertyId,
      token,
      functionsBaseUrl,
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: wanderConnections.propertyId,
      set: {
        token,
        functionsBaseUrl,
        connectedAt: new Date(),
        // A new token is a new connection: whatever trip the old one followed
        // may not even be readable with this one, and a stale `trip_id` here
        // would make the next pull fail in a way that reads like a bug.
        tripId: null,
        tripName: null,
        lastPulledAt: null,
        lastError: null,
      },
    });
}

/** Remember which trip the farm follows. */
export async function setLinkedTrip(
  propertyId: Ulid,
  tripId: string,
  tripName: string,
): Promise<void> {
  const db = await database();
  await db
    .update(wanderConnections)
    .set({ tripId, tripName, lastError: null })
    .where(eq(wanderConnections.propertyId, propertyId));
}

/** Record the outcome of a pull, so the screen can say when and whether. */
export async function recordPull(propertyId: Ulid, error?: string): Promise<void> {
  const db = await database();
  await db
    .update(wanderConnections)
    .set({
      ...(error === undefined
        ? { lastPulledAt: new Date(), lastError: null }
        : { lastError: error }),
    })
    .where(eq(wanderConnections.propertyId, propertyId));
}

/**
 * Forget the token entirely.
 *
 * Deleted outright rather than tombstoned: a tombstone exists so a deletion
 * can replicate, and this row never replicated anywhere. The `trips` rows it
 * pulled are left alone — they are the farm's records now, and a sitter
 * standing at the board mid-trip should not watch it empty because somebody
 * tidied up a credential.
 */
export async function disconnect(propertyId: Ulid): Promise<void> {
  const db = await database();
  await db
    // crud-guard: allow-unconfirmed — `wander-panel.tsx` confirms first, §4.5 Standard tier
    .delete(wanderConnections)
    .where(eq(wanderConnections.propertyId, propertyId));
}
