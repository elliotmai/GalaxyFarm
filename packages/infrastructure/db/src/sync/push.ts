import { and, eq, sql } from "drizzle-orm";

import {
  RESERVED_FIELDS,
  materialise,
  mergePatch,
  type AuditEntry,
  type BaseRecord,
  type Clock,
  type FieldChange,
  type FieldState,
  type IdGenerator,
  type OutboxEntry,
  type PushRejection,
  type PushResult,
  type RecordState,
  type Ulid,
} from "@galaxy-farm/core";

import { PostgresRepository, type Database } from "../repositories/postgres-repository.js";
import { syncAudit, syncFieldMeta } from "../schema/index.js";
import { columnsFor, dateFieldsOf, tableFor } from "./entities.js";

/**
 * Applying a push (spec §4.2).
 *
 * The server merges; the device takes what the server says on the next pull.
 * That is why the merge itself lives in the kernel and is called from here —
 * one implementation of who-wins, running in one place, rather than two that
 * agree until they do not.
 */

export interface PushContext {
  /**
   * From the authenticated session, never from the payload. A device may only
   * write into the property it is signed in to, and `propertyId` is a reserved
   * field precisely so a patch cannot argue otherwise.
   */
  readonly propertyId: Ulid;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function applyPush(
  db: Database,
  entries: readonly OutboxEntry[],
  context: PushContext,
): Promise<PushResult> {
  const accepted: Ulid[] = [];
  const rejected: PushRejection[] = [];
  const audit: AuditEntry[] = [];

  for (const entry of entries) {
    try {
      // One transaction per entry, not per batch: a single malformed patch
      // must not roll back the twenty good ones queued behind it on a device
      // that has been offline all week.
      audit.push(...(await applyEntry(db, entry, context)));
      accepted.push(entry.id);
    } catch (error) {
      rejected.push({
        id: entry.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { accepted, rejected, audit };
}

/**
 * A timestamp that crossed the wire as a string, made a `Date` again.
 *
 * Only for columns the schema says are timestamps, and only for strings — a
 * value that is already a `Date` (the in-process path, and the tests that use
 * it) is left alone. An unparseable string is passed through untouched so it
 * fails loudly at the driver rather than being silently written as an Invalid
 * Date, which would store `NULL` and look like the field was never sent.
 */
function reviveTimestamp(change: FieldChange, dateFields: ReadonlySet<string>): FieldChange {
  if (!dateFields.has(change.field) || typeof change.value !== "string") return change;

  const parsed = new Date(change.value);
  return Number.isNaN(parsed.getTime()) ? change : { ...change, value: parsed as never };
}

async function applyEntry(
  db: Database,
  entry: OutboxEntry,
  context: PushContext,
): Promise<readonly AuditEntry[]> {
  const { entity, recordId } = entry.patch;

  const table = tableFor(entity);
  if (table === undefined) throw new Error(`Unknown entity "${entity}"`);
  const columns = columnsFor(table);
  const dateFields = dateFieldsOf(table);

  // A patch may not invent columns, and may not restate the fields the server
  // owns. Both are dropped rather than refused — an older device that still
  // sends a field this deploy removed should not have its whole batch stick.
  const changes = entry.patch.changes
    .filter((change) => change.field in columns && !RESERVED_FIELDS.has(change.field))
    .map((change) => reviveTimestamp(change, dateFields));
  if (changes.length === 0) return [];

  const now = context.clock.now();

  return db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(table).where(eq(table.id, recordId)).for("update").limit(1)
    )[0] as Record<string, unknown> | undefined;

    if (existing !== undefined && existing["propertyId"] !== context.propertyId) {
      throw new Error(`Record ${recordId} belongs to another property`);
    }

    const current = await currentState(tx as Database, entity, recordId, existing, columns);
    const merged = mergePatch(current, { entity, recordId, changes }, now);

    const record = {
      ...materialise(merged.state),
      id: recordId,
      propertyId: context.propertyId,
      createdAt: (existing?.["createdAt"] as Date | undefined) ?? now,
      // Server arrival time, not the device's edit time. `updatedAt` is the
      // pull cursor: stamped with a past timestamp, a record would land behind
      // cursors other devices already hold and they would never see it.
      updatedAt: now,
    } as unknown as BaseRecord;

    await new PostgresRepository(tx as Database, table).save(record);
    await writeFieldMeta(
      tx as Database,
      entity,
      recordId,
      context.propertyId,
      merged.state,
      changes,
    );
    await writeAudit(tx as Database, context, merged.audit);

    return merged.audit;
  });
}

/**
 * What the server currently believes about each field, and when it was written.
 *
 * Three cases, and the third is the one that matters:
 *
 * - A field with a recorded write carries that device and timestamp.
 * - A field holding a value but no record of who wrote it — seeded or imported
 *   data — falls back to the record's `createdAt`. It has been that way since
 *   the record existed, so any later edit wins and any earlier one loses.
 * - A field that has never been written and holds nothing is **absent**, not
 *   empty-at-createdAt. An incoming write to it is uncontested and must win
 *   outright; giving it a timestamp would let it lose a tie to a value that
 *   was never there. That is the phone-in-a-pocket case — an observation typed
 *   in the barn on Monday, pushed Wednesday — and losing it silently is the
 *   worst failure this system can have.
 *
 * Deliberately not `updatedAt`: the row's timestamp is the time of the *last*
 * change to *any* field, so using it would let a rename on Tuesday reject an
 * uncontested note written on Monday.
 */
async function currentState(
  db: Database,
  entity: string,
  recordId: Ulid,
  existing: Record<string, unknown> | undefined,
  columns: Record<string, unknown>,
): Promise<RecordState> {
  if (existing === undefined) return {};

  const createdAt = (existing["createdAt"] as Date | undefined) ?? new Date(0);
  const state: Record<string, FieldState> = {};

  for (const field of Object.keys(columns)) {
    if (RESERVED_FIELDS.has(field)) continue;
    const value = existing[field];
    if (value === null || value === undefined) continue;
    state[field] = { value, at: createdAt, deviceId: "server" };
  }

  const meta = await db
    .select()
    .from(syncFieldMeta)
    .where(and(eq(syncFieldMeta.entity, entity), eq(syncFieldMeta.recordId, recordId)));

  for (const row of meta) {
    // A field with meta but no value was deliberately cleared. It still holds
    // its place, or an older write would bring the cleared value back.
    const value = existing[row.field];
    state[row.field] = {
      value: value === null ? undefined : value,
      at: row.writtenAt,
      deviceId: row.writtenBy,
    };
  }

  return state;
}

async function writeFieldMeta(
  db: Database,
  entity: string,
  recordId: Ulid,
  propertyId: Ulid,
  state: RecordState,
  changes: readonly { readonly field: string }[],
): Promise<void> {
  // Only the fields this patch touched. The winner may be the value already
  // held — writing it back is a no-op that keeps the two consistent.
  const rows = changes
    .map((change) => ({ field: change.field, winner: state[change.field] }))
    .filter((entry): entry is { field: string; winner: FieldState } => entry.winner !== undefined)
    .map(({ field, winner }) => ({
      entity,
      recordId,
      field,
      propertyId,
      writtenAt: winner.at,
      writtenBy: winner.deviceId,
    }));

  if (rows.length === 0) return;

  await db
    .insert(syncFieldMeta)
    .values(rows)
    .onConflictDoUpdate({
      target: [syncFieldMeta.entity, syncFieldMeta.recordId, syncFieldMeta.field],
      set: {
        writtenAt: sqlExcluded("written_at"),
        writtenBy: sqlExcluded("written_by"),
        propertyId: sqlExcluded("property_id"),
      },
    });
}

/**
 * Every superseded value, written down (§4.2, decision 23).
 *
 * A change log rather than a conflict log: given only timestamps there is no
 * way to tell a sequential edit from a concurrent one, so rather than guess,
 * the loser is always recorded and a genuine conflict stays recoverable.
 */
async function writeAudit(
  db: Database,
  context: PushContext,
  entries: readonly AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  await db.insert(syncAudit).values(
    entries.map((entry) => ({
      id: context.ids.next(),
      propertyId: context.propertyId,
      entity: entry.entity,
      recordId: entry.recordId,
      field: entry.field,
      winnerValue: entry.winner.value ?? null,
      winnerAt: entry.winner.at,
      winnerDeviceId: entry.winner.deviceId,
      loserValue: entry.loser.value ?? null,
      loserAt: entry.loser.at,
      loserDeviceId: entry.loser.deviceId,
      resolvedAt: entry.resolvedAt,
    })),
  );
}

/** Take the incoming row's value on conflict. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
