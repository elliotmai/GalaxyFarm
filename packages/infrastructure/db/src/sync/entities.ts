import type { PgColumn } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

import { allTables } from "../schema/index.js";
import type { RecordTable } from "../repositories/postgres-repository.js";

/**
 * Which entity names a patch may name.
 *
 * The entity in a patch is a string off the wire, so it is resolved against
 * this closed list rather than used to index anything.
 */

/**
 * Tables that never sync, and why.
 *
 * Two kinds, and the second matters more than it looks:
 *
 * - **Bookkeeping.** `syncAudit` is the append-only change log and
 *   `syncFieldMeta` holds per-field write times. A patch naming either would
 *   be a device writing its own audit trail.
 * - **Credentials.** `users` carries a password hash and `kioskDevices`
 *   carries a device token hash. Sync copies rows to every device, and an
 *   IndexedDB store on a phone in a barn is not where either belongs — a lost
 *   phone would be a copy of every credential on the property. Users are
 *   administered through the server, not replicated to it.
 */
const NOT_SYNCED = new Set(["syncAudit", "syncFieldMeta", "users", "kioskDevices"]);

/** Tables that are not entities at all — no CRUD, no repository, no search. */
export const BOOKKEEPING_TABLES: readonly string[] = ["syncAudit", "syncFieldMeta"];

/**
 * Tables a migration creates that `allTables` never names — the SQL name, not
 * the camelCase key, because these are checked against `pg_tables` directly.
 *
 * Three of them (spec §4.3, §4.4, §6). Every other table in this schema is
 * reachable as a `Repository` and carries the §5 base columns —
 * `id`, `propertyId`, the soft-delete trio — because every other table is a
 * record something on the farm did. This one is not: a single scrypt hash per
 * property, gating one Elevated-tier action. Giving it `id`/tombstone columns
 * it would never use, or a `Repository` nothing would ever call, would be
 * machinery for machinery's sake — and worse, it would put the hash one
 * `repositoryFor` typo away from being handed to a device. Kept off
 * `allTables` entirely is what makes that impossible rather than merely
 * unlikely, at the cost of being invisible to the checks that assume every
 * live table is an entity — `tests/migrations.test.ts` names this list
 * explicitly rather than silently passing an empty one.
 *
 * `push_subscriptions` and `notification_settings` joined it with web push
 * (§6). The first holds the keys a push payload is encrypted to, which is the
 * same argument `kiosk_pins` makes and just as final: a subscription
 * replicated to a barn screen is the owner's notifications readable from the
 * barn. The second is not secret at all — it is simply read on the server at
 * the moment something is sent, by a screen that sends nothing, so a copy on
 * every device would be one person's preferences on everybody's phone.
 */
export const UNTRACKED_TABLES: readonly string[] = [
  "kiosk_pins",
  "push_subscriptions",
  "notification_settings",
];

export const SYNCED_ENTITIES: readonly string[] = Object.keys(allTables).filter(
  (name) => !NOT_SYNCED.has(name),
);

/** Everything a repository exists for — everything except pure bookkeeping. */
export const REPOSITORY_TABLES: readonly string[] = Object.keys(allTables).filter(
  (name) => !BOOKKEEPING_TABLES.includes(name),
);

export function tableFor(entity: string): RecordTable | undefined {
  if (!SYNCED_ENTITIES.includes(entity)) return undefined;
  return allTables[entity as keyof typeof allTables] as RecordTable;
}

export function columnsFor(table: RecordTable): Record<string, PgColumn> {
  return getTableColumns(table) as Record<string, PgColumn>;
}

/**
 * Which of a table's fields are timestamps, asked of the schema.
 *
 * Not guessed from the name. A patch arrives as JSON, where a `Date` is a
 * string, and drizzle's `timestamp({ mode: "date" })` writer calls
 * `value.toISOString()` — so a string reaching it throws
 * `value.toISOString is not a function`, the entry is rejected, and it is
 * rejected again on every retry because the next attempt sends the same
 * string. The queue grows and nothing ever leaves the device.
 *
 * That is exactly what happened. The client revived by field name, on a stated
 * convention that "every timestamp column is `*_at` or `*Date`" — and the
 * schema has `date`, `dob`, `performed_on`, `period_from` and `period_to`,
 * none of which match. Reading `dataType` off the column instead cannot drift
 * from the schema, because it *is* the schema.
 */
export function dateFieldsOf(table: RecordTable): Set<string> {
  return new Set(
    Object.entries(columnsFor(table))
      .filter(([, column]) => column.dataType === "date")
      .map(([field]) => field),
  );
}
