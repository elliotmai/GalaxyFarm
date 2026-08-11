import type { CursorSet, FieldChange, OutboxEntry, Patch, Ulid } from "@galaxy-farm/core";

/**
 * Reading a sync payload off the wire (spec §4.2, §4.5 clause 2).
 *
 * Two jobs, and the second is the one that bites.
 *
 * **Dates do not survive JSON.** Every timestamp arrives as a string, and the
 * merge compares them with `getTime()`. A string where a Date is expected does
 * not throw — it produces `NaN`, every comparison with it is false, and the
 * incoming write silently loses. That is a data-loss bug with no error
 * attached to it, so the revival is explicit and rejects what it cannot parse.
 *
 * **The body is not trusted.** §4.5 clause 2 says validate at every boundary,
 * and specifically that data is not trusted just because it came from our own
 * client. A push is the one place a device writes directly into the farm's
 * database.
 */

function fail(what: string): never {
  throw new Error(`Malformed sync payload: ${what}`);
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(what);
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") fail(what);
  return value;
}

/** An ISO string back to a Date, refusing anything that would become NaN. */
export function reviveDate(value: unknown, what: string): Date {
  if (value instanceof Date) return value;
  if (typeof value !== "string") fail(`${what} is not a date`);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${what} is not a date`);
  return date;
}

function reviveChange(raw: unknown, index: number): FieldChange {
  const change = asObject(raw, `changes[${index}]`);
  return {
    field: asString(change["field"], `changes[${index}].field`),
    // The value is deliberately untouched: it is whatever the field holds, and
    // the schema for that lives with the entity. What matters here is that the
    // *metadata* the merge runs on is real.
    value: change["value"],
    at: reviveDate(change["at"], `changes[${index}].at`),
    deviceId: asString(change["deviceId"], `changes[${index}].deviceId`),
  };
}

function revivePatch(raw: unknown): Patch {
  const patch = asObject(raw, "patch");
  const changes = patch["changes"];
  if (!Array.isArray(changes)) fail("patch.changes is not an array");

  return {
    entity: asString(patch["entity"], "patch.entity"),
    recordId: asString(patch["recordId"], "patch.recordId") as Ulid,
    changes: changes.map(reviveChange),
  };
}

const OPERATIONS = new Set(["create", "update", "delete"]);

export function reviveOutboxEntries(raw: unknown): OutboxEntry[] {
  const body = asObject(raw, "body");
  const entries = body["entries"];
  if (!Array.isArray(entries)) fail("entries is not an array");

  // A generous ceiling — a device offline for a fortnight is well under it —
  // and a hard stop on a body that would hold the connection open all day.
  if (entries.length > 1_000) fail("too many entries in one push");

  return entries.map((raw, index) => {
    const entry = asObject(raw, `entries[${index}]`);
    const operation = asString(entry["operation"], `entries[${index}].operation`);
    if (!OPERATIONS.has(operation)) fail(`entries[${index}].operation is not an operation`);

    return {
      id: asString(entry["id"], `entries[${index}].id`) as Ulid,
      operation: operation as OutboxEntry["operation"],
      patch: revivePatch(entry["patch"]),
      queuedAt: reviveDate(entry["queuedAt"], `entries[${index}].queuedAt`),
      deviceId: asString(entry["deviceId"], `entries[${index}].deviceId`),
      attempts: typeof entry["attempts"] === "number" ? entry["attempts"] : 0,
    };
  });
}

export function reviveCursors(raw: unknown): CursorSet {
  // No cursors at all is a first sync, not an error.
  if (raw === undefined || raw === null) return {};

  const cursors = asObject(raw, "cursors");
  const revived: Record<string, CursorSet[string]> = {};

  for (const [entity, value] of Object.entries(cursors)) {
    const cursor = asObject(value, `cursors.${entity}`);
    revived[entity] = {
      entity,
      updatedAt: reviveDate(cursor["updatedAt"], `cursors.${entity}.updatedAt`),
      lastId: asString(cursor["lastId"], `cursors.${entity}.lastId`),
    };
  }

  return revived;
}
