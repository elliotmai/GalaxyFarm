import { and, asc, eq } from "drizzle-orm";

import { encodeUlid, type Ulid } from "@galaxy-farm/core";
import { pushSubscriptions, type Database } from "@galaxy-farm/infra-db";
import type { PushSubscriptionRecord } from "@galaxy-farm/infra-push";

import { database } from "@/lib/credential-store";
import { findUserByEmail } from "@/lib/user-store";

/**
 * Push subscriptions, in Postgres (spec §4.1, §6).
 *
 * The same exception `user-store.ts` and `device-store.ts` document, for the
 * same reason: a subscription carries the keys a payload is encrypted to, so
 * the table never reaches a local store and the screen that manages it reads
 * on the server and writes through server actions.
 *
 * **One row per browser, not per person.** A phone and a laptop are two
 * subscriptions, and the endpoint is the identity because the push service
 * already guarantees it is unique. That is what makes "revoke this one" mean
 * one device rather than all of them — and it is why re-subscribing an
 * existing browser updates its row instead of adding a second: a browser that
 * renews its subscription hands back the same endpoint, and treating that as a
 * new device would leave a list nobody could read.
 *
 * Nothing here hands the keys to a screen. `listDevices` returns what a person
 * needs to recognise and revoke a device; only `subscriptionsFor`, which the
 * notifier calls on the server, returns anything that could decrypt a message.
 */

/** A subscribed device, as the settings screen sees it. */
export interface PushDevice {
  readonly id: Ulid;
  readonly deviceLabel: string;
  readonly createdAt: Date;
  readonly lastSentAt?: Date | undefined;
  /**
   * Whether this is the browser asking.
   *
   * Filled in by the screen, which asks `deviceIdForEndpoint` about the
   * endpoint its own `pushManager` reports — never by the database, which has
   * no way of knowing which device is reading the page.
   */
  readonly current?: boolean;
}

export interface NewSubscription {
  readonly propertyId: Ulid;
  readonly userId: Ulid;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly deviceLabel: string;
}

export async function listDevices(userId: Ulid, db: Database = database()): Promise<PushDevice[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.createdAt));

  return rows.map((row) => ({
    id: row.id as Ulid,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
    ...(row.lastSentAt === null ? {} : { lastSentAt: row.lastSentAt }),
  }));
}

/**
 * Which of a person's devices an endpoint is.
 *
 * The one thing the browser knows that the server does not: which row it is
 * looking at. Answered this way round — endpoint in, id out — so the list a
 * screen renders never has to carry every endpoint down to it.
 */
export async function deviceIdForEndpoint(
  endpoint: string,
  userId: Ulid,
  db: Database = database(),
): Promise<Ulid | undefined> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .limit(1);

  return row === undefined ? undefined : (row.id as Ulid);
}

/**
 * Subscribe a browser, or update the one it already had.
 *
 * The conflict target is the endpoint rather than the id, because the browser
 * decides identity here: a renewed subscription arrives with the same URL and
 * fresh keys, and inserting it would mean sending every notification twice to
 * one phone with one of the two failing.
 */
export async function saveSubscription(
  input: NewSubscription,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      id: encodeUlid(now.getTime()),
      propertyId: input.propertyId,
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      authSecret: input.auth,
      deviceLabel: input.deviceLabel,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // The keys are rotated by the browser on renewal, and the row is
        // reassigned outright when somebody else signs in on this device —
        // otherwise the previous person would keep receiving on it.
        userId: input.userId,
        propertyId: input.propertyId,
        p256dh: input.p256dh,
        authSecret: input.auth,
        deviceLabel: input.deviceLabel,
        updatedAt: now,
      },
    });
}

/** Revoke one device, by the id the screen shows. Scoped to its owner. */
export async function deleteDevice(
  id: Ulid,
  userId: Ulid,
  db: Database = database(),
): Promise<boolean> {
  const deleted = await db
    // crud-guard: allow-unconfirmed — the screen confirms first, §4.5 Standard tier
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });

  return deleted.length > 0;
}

/**
 * Forget a subscription by its endpoint.
 *
 * Two callers, and the second is the one that matters: a browser unsubscribing
 * itself, and the notifier pruning a subscription a push service has answered
 * 404 or 410 for. Deleted outright rather than tombstoned — §4.5's exception
 * list covers system-owned rows, and a tombstone exists to replicate a
 * deletion to devices that never held the row in the first place.
 */
export async function forgetEndpoint(endpoint: string, db: Database = database()): Promise<void> {
  // crud-guard: allow-unconfirmed — a push service saying 410, nobody in the loop to ask
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * The same, scoped to whoever is asking.
 *
 * What a browser unsubscribing itself calls. An endpoint is a capability URL
 * rather than a secret this app controls, so the action that takes one from a
 * person deletes only their own row — the pruning path above is server-side
 * and has no actor to scope by.
 */
export async function forgetEndpointFor(
  endpoint: string,
  userId: Ulid,
  db: Database = database(),
): Promise<void> {
  await db
    // crud-guard: allow-unconfirmed — a browser turning its own notifications off, reversibly
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
}

/** Every subscription belonging to one person, keys included. Server-side only. */
export async function subscriptionsFor(
  userId: Ulid,
  db: Database = database(),
): Promise<PushSubscriptionRecord[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  return rows.map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.authSecret },
  }));
}

/**
 * Every subscription for an address. What the web-push adapter is handed.
 *
 * A `NotificationMessage` names its recipient the way email does, because that
 * is what every caller already has, so push has to make the join itself.
 * `findUserByEmail` does the looking; an address nobody on the farm holds gets
 * no subscriptions rather than an error, because a notifier is not the place
 * to discover that a contact's email is out of date.
 */
export async function subscriptionsForEmail(
  email: string,
  db: Database = database(),
): Promise<PushSubscriptionRecord[]> {
  const user = await findUserByEmail(email, db);
  return user === undefined ? [] : subscriptionsFor(user.id, db);
}
