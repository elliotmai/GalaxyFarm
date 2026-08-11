import type { Ulid } from "../types/ids.js";
import type { FieldChange, FieldValue, Patch } from "../ports/sync.js";
import { isEqual } from "./patch.js";

/**
 * Field-level last-write-wins, with an audit log (spec §4.2).
 *
 * The conflict reality here is two writers plus a few kiosks, mostly appending
 * records — genuine conflicts will be vanishingly rare. LWW-per-field plus an
 * audit trail is the right amount of machinery; anything more would be
 * speculative.
 *
 * The audit is a **field-level change log**, not a conflict-only log. Given
 * only timestamps there is no way to tell a sequential edit from a concurrent
 * one, so rather than guess, every superseded value is written down. That
 * makes a genuine conflict recoverable — which is the point (§4.2) — and has
 * the side benefit that any field's history can be reconstructed. Writing only
 * "real" conflicts would mean inventing a concurrency signal the data does not
 * carry.
 */

export interface FieldState {
  readonly value: FieldValue;
  readonly at: Date;
  readonly deviceId: string;
}

export type RecordState = Readonly<Record<string, FieldState>>;

export interface AuditEntry {
  readonly entity: string;
  readonly recordId: Ulid;
  readonly field: string;
  readonly winner: FieldState;
  readonly loser: FieldState;
  readonly resolvedAt: Date;
}

export interface MergeResult {
  readonly state: RecordState;
  /** Non-empty only when two devices wrote the same field. */
  readonly audit: readonly AuditEntry[];
}

/**
 * Decide between two writes to one field.
 *
 * Later wins. On an identical timestamp — which happens with a coarse clock or
 * a replayed batch — the higher device id wins. Arbitrary, but *deterministic*,
 * and that matters far more: every device must reach the same answer without
 * talking to the others.
 */
export function winner(left: FieldState, right: FieldState): FieldState {
  const delta = left.at.getTime() - right.at.getTime();
  if (delta !== 0) return delta > 0 ? left : right;
  return left.deviceId >= right.deviceId ? left : right;
}

export function mergePatch(current: RecordState, patch: Patch, resolvedAt: Date): MergeResult {
  const state: Record<string, FieldState> = { ...current };
  const audit: AuditEntry[] = [];

  for (const change of patch.changes) {
    const incoming: FieldState = {
      value: change.value,
      at: change.at,
      deviceId: change.deviceId,
    };
    const existing = state[change.field];

    if (existing === undefined) {
      state[change.field] = incoming;
      continue;
    }

    const chosen = winner(existing, incoming);
    state[change.field] = chosen;

    // Only a genuine disagreement is worth recording. Two devices writing the
    // same value is not a conflict, and logging it would bury the real ones.
    if (chosen !== existing && !isEqual(existing.value, incoming.value)) {
      audit.push({
        entity: patch.entity,
        recordId: patch.recordId,
        field: change.field,
        winner: chosen,
        loser: existing,
        resolvedAt,
      });
    } else if (chosen === existing && !isEqual(existing.value, incoming.value)) {
      audit.push({
        entity: patch.entity,
        recordId: patch.recordId,
        field: change.field,
        winner: existing,
        loser: incoming,
        resolvedAt,
      });
    }
  }

  return { state, audit };
}

/** Collapse field states back into a plain record. */
export function materialise(state: RecordState): Record<string, FieldValue> {
  return Object.fromEntries(Object.entries(state).map(([field, s]) => [field, s.value]));
}

/** Build the initial field state for a record created on this device. */
export function initialState(
  record: Readonly<Record<string, FieldValue>>,
  meta: { readonly at: Date; readonly deviceId: string },
): RecordState {
  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => [
      field,
      { value, at: meta.at, deviceId: meta.deviceId },
    ]),
  );
}

export function changesToState(changes: readonly FieldChange[]): RecordState {
  return Object.fromEntries(
    changes.map((c) => [c.field, { value: c.value, at: c.at, deviceId: c.deviceId }]),
  );
}
