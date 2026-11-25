import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";

import type { OutboxEntry } from "@galaxy-farm/core";
import {
  eggDispositions,
  eggLogs,
  kitchenEggLinks,
  kitchenEggSends,
  properties,
  type Database,
} from "@galaxy-farm/infra-db";

import {
  KITCHEN_BATCH_SIZE,
  kitchenEggConfig,
  parseKitchenEggResponse,
  settledIds,
  toKitchenRecord,
  touchesEggs,
  type EggEntity,
  type KitchenEggConfig,
  type KitchenEggResponse,
  type PendingEggRecord,
} from "@/lib/kitchen-eggs";

/**
 * Eggs to the kitchen — the sending half (spec §4.3 "Connected apps").
 *
 * Called from `applyPushAndMark`, after the farm write has committed, so it
 * sees every server-side writer of egg records — the sync push, the kiosk's
 * Egg Quick-Entry, anything later — and can never make one of them fail.
 *
 * **The egg records are the outbox.** A record is waiting while its
 * `updated_at` is newer than the version KitchenHub last acknowledged
 * (`kitchen_egg_sends`). Nothing is queued anywhere that could be lost: a send
 * that fails or is cut short leaves the records waiting, `last_error` says so,
 * and the next push to the property tries again. Sending the same version
 * twice is harmless — KitchenHub keys every change by record id and version.
 */

/** Long enough for a cold function, short enough not to hold a push hostage. */
const SEND_TIMEOUT_MS = 6_000;
/** Batches per flush; anything left waits for the next push. */
const MAX_BATCHES = 3;

export interface FlushOptions {
  readonly config?: KitchenEggConfig | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface FlushResult {
  readonly sent: number;
  readonly settled: number;
  readonly error?: string;
}

/**
 * When this property started feeding the kitchen, made the first time it is
 * asked. Records created before then are never sent.
 */
export async function kitchenEggLink(
  db: Database,
  propertyId: string,
  now: Date,
): Promise<typeof kitchenEggLinks.$inferSelect> {
  await db
    .insert(kitchenEggLinks)
    .values({ propertyId, startedAt: now })
    .onConflictDoNothing({ target: kitchenEggLinks.propertyId });
  const [row] = await db
    .select()
    .from(kitchenEggLinks)
    .where(eq(kitchenEggLinks.propertyId, propertyId))
    .limit(1);
  if (row === undefined) throw new Error("kitchen_egg_links row vanished");
  return row;
}

/** Egg logs and dispositions KitchenHub has not acknowledged at their current version. */
export async function pendingEggRecords(
  db: Database,
  propertyId: string,
  since: Date,
  limit: number = KITCHEN_BATCH_SIZE,
): Promise<PendingEggRecord[]> {
  const sentFor = (entity: EggEntity, id: typeof eggLogs.id | typeof eggDispositions.id) =>
    and(eq(kitchenEggSends.entity, entity), eq(kitchenEggSends.recordId, id));
  const waiting = (updatedAt: typeof eggLogs.updatedAt | typeof eggDispositions.updatedAt) =>
    or(isNull(kitchenEggSends.version), lt(kitchenEggSends.version, updatedAt));

  const logs = await db
    .select({
      id: eggLogs.id,
      updatedAt: eggLogs.updatedAt,
      deletedAt: eggLogs.deletedAt,
      on: eggLogs.collectedOn,
      quantity: eggLogs.total,
    })
    .from(eggLogs)
    .leftJoin(kitchenEggSends, sentFor("eggLogs", eggLogs.id))
    .where(
      and(
        eq(eggLogs.propertyId, propertyId),
        gte(eggLogs.createdAt, since),
        waiting(eggLogs.updatedAt),
      ),
    )
    .orderBy(asc(eggLogs.updatedAt))
    .limit(limit);

  const dispositions = await db
    .select({
      id: eggDispositions.id,
      updatedAt: eggDispositions.updatedAt,
      deletedAt: eggDispositions.deletedAt,
      on: eggDispositions.disposedOn,
      quantity: eggDispositions.quantity,
      kind: eggDispositions.kind,
    })
    .from(eggDispositions)
    .leftJoin(kitchenEggSends, sentFor("eggDispositions", eggDispositions.id))
    .where(
      and(
        eq(eggDispositions.propertyId, propertyId),
        gte(eggDispositions.createdAt, since),
        waiting(eggDispositions.updatedAt),
      ),
    )
    .orderBy(asc(eggDispositions.updatedAt))
    .limit(limit);

  return [
    ...logs.map((row) => ({ entity: "eggLogs" as const, kind: null, ...row })),
    ...dispositions.map((row) => ({ entity: "eggDispositions" as const, ...row })),
  ]
    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
    .slice(0, limit);
}

/** Record that KitchenHub has these records at these versions. Never moves a version back. */
export async function markEggsSent(
  db: Database,
  propertyId: string,
  records: readonly PendingEggRecord[],
  now: Date,
): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(kitchenEggSends)
    .values(
      records.map((record) => ({
        entity: record.entity,
        recordId: record.id,
        propertyId,
        version: record.updatedAt,
        sentAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [kitchenEggSends.entity, kitchenEggSends.recordId],
      set: {
        version: sql`greatest(${kitchenEggSends.version}, excluded."version")`,
        sentAt: sql`excluded."sent_at"`,
      },
    });
}

async function propertyTimeZone(db: Database, propertyId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: properties.timezone })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row?.timezone || "UTC";
}

async function post(
  config: KitchenEggConfig,
  body: unknown,
  doFetch: typeof fetch,
): Promise<KitchenEggResponse> {
  const response = await doFetch(config.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    // KitchenHub's words, without anything of ours: the token is never echoed.
    throw new Error(`KitchenHub answered ${response.status}: ${text.slice(0, 200)}`);
  }
  return parseKitchenEggResponse(JSON.parse(text));
}

/**
 * Send whatever is waiting for this property, if it is the one configured to
 * feed the kitchen. Never throws: the farm write is already done.
 */
export async function flushKitchenEggs(
  db: Database,
  propertyId: string,
  options: FlushOptions = {},
): Promise<FlushResult | undefined> {
  const config = "config" in options ? options.config : kitchenEggConfig();
  if (config === undefined || config.propertyId !== propertyId) return undefined;
  const now = options.now ?? (() => new Date());
  const doFetch = options.fetch ?? fetch;

  let sent = 0;
  let settled = 0;
  try {
    const link = await kitchenEggLink(db, propertyId, now());
    const timeZone = await propertyTimeZone(db, propertyId);

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const pending = await pendingEggRecords(db, propertyId, link.startedAt);
      if (pending.length === 0) break;

      const answer = await post(
        config,
        { timeZone, records: pending.map((record) => toKitchenRecord(record, timeZone)) },
        doFetch,
      );
      const done = settledIds(answer);
      const acknowledged = pending.filter((record) => done.has(record.id));
      await markEggsSent(db, propertyId, acknowledged, now());
      sent += pending.length;
      settled += acknowledged.length;

      // Something KitchenHub did not answer for would be sent again forever
      // within this flush; leave it for the next push instead.
      if (acknowledged.length < pending.length || pending.length < KITCHEN_BATCH_SIZE) break;
    }

    await db
      .update(kitchenEggLinks)
      .set({ lastSentAt: now(), lastError: null })
      .where(eq(kitchenEggLinks.propertyId, propertyId));
    return { sent, settled };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[kitchen-eggs] send failed; the records stay waiting", message);
    try {
      await db
        .update(kitchenEggLinks)
        .set({ lastError: message.slice(0, 500) })
        .where(eq(kitchenEggLinks.propertyId, propertyId));
    } catch {
      // The database being the problem is already in the log above.
    }
    return { sent, settled, error: message };
  }
}

/**
 * After a push: send if it touched eggs, or if the last send failed and this
 * is the next chance to retry it. Any other push costs nothing here.
 */
export async function afterFarmWrite(
  db: Database,
  propertyId: string,
  entries: readonly OutboxEntry[],
  options: FlushOptions = {},
): Promise<FlushResult | undefined> {
  const config = "config" in options ? options.config : kitchenEggConfig();
  if (config === undefined || config.propertyId !== propertyId) return undefined;
  if (!touchesEggs(entries)) {
    try {
      const [link] = await db
        .select({ lastError: kitchenEggLinks.lastError })
        .from(kitchenEggLinks)
        .where(eq(kitchenEggLinks.propertyId, propertyId))
        .limit(1);
      if (link === undefined || link.lastError === null) return undefined;
    } catch {
      return undefined;
    }
  }
  return flushKitchenEggs(db, propertyId, { ...options, config });
}
