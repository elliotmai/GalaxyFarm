import type { FieldChange, FieldValue, Patch } from "../ports/sync.js";

/**
 * Patch *operations* (spec §4.2).
 *
 * The shapes are ports (`ports/sync.ts`); this is the logic that acts on them —
 * computing a diff, applying one, deciding whether two values are the same.
 *
 * It lives in the kernel rather than in the sync adapter because it has three
 * callers on two sides of the wire: the engine on device, the IndexedDB store,
 * and the push handler on the server. Adapters may not import each other
 * (§4.1), and there is nothing infrastructural in here to justify the
 * duplication that would otherwise follow.
 */

export type { FieldChange, FieldValue, Patch };

/**
 * Fields the sync engine manages itself and never accepts from a patch.
 *
 * Exported because the server enforces the same list: `propertyId` in
 * particular is taken from the authenticated session, never from the payload,
 * or a device could write into a property it cannot see.
 */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(["id", "propertyId", "createdAt"]);

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
