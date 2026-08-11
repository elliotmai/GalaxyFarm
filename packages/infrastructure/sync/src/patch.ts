import type { FieldChange, FieldValue, Patch } from "@galaxy-farm/core";

/**
 * Patch *operations* (spec §4.2).
 *
 * The shapes themselves are ports and live in the shared kernel, because both
 * this adapter and the local-store adapter need them. What lives here is the
 * logic: computing a diff, applying one, and deciding whether two values are
 * the same.
 */

export type { FieldChange, FieldValue, Patch };

/** Fields the sync engine manages itself and never accepts from a patch. */
const RESERVED_FIELDS = new Set(["id", "propertyId", "createdAt"]);

/**
 * Compute the fields that actually changed.
 *
 * Comparing before writing keeps the outbox honest: opening a form and saving
 * it unchanged should not produce a patch, and a patch of no fields should not
 * exist at all.
 */
export function diff(
  before: Readonly<Record<string, FieldValue>>,
  after: Readonly<Record<string, FieldValue>>,
  meta: { readonly at: Date; readonly deviceId: string },
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, value] of Object.entries(after)) {
    if (RESERVED_FIELDS.has(field)) continue;
    if (isEqual(before[field], value)) continue;
    changes.push({ field, value, at: meta.at, deviceId: meta.deviceId });
  }

  return changes;
}

export function applyPatch<T extends Record<string, FieldValue>>(record: T, patch: Patch): T {
  const next = { ...record } as Record<string, FieldValue>;
  for (const change of patch.changes) {
    if (RESERVED_FIELDS.has(change.field)) continue;
    next[change.field] = change.value;
  }
  return next as T;
}

/**
 * Structural equality, enough for the shapes that cross the wire: primitives,
 * dates, arrays, and plain objects. Deliberately not a general deep-equal —
 * anything richer than this has no business being a synced field.
 */
export function isEqual(left: FieldValue, right: FieldValue): boolean {
  if (left === right) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left === null || right === null || left === undefined || right === undefined) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => isEqual(item, right[i]));
  }

  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) =>
    isEqual((left as Record<string, FieldValue>)[key], (right as Record<string, FieldValue>)[key]),
  );
}
