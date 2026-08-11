import type { Ulid } from "../types/ids.js";

/**
 * The sync contract (spec §4.2), defined here rather than in the sync adapter.
 *
 * §4.1 is explicit that infrastructure implements ports defined by the domain.
 * The outbox has two implementers — an in-memory one for tests and server use,
 * and an IndexedDB one on device — and if the port lived in the sync adapter,
 * the local-store adapter would have to depend on it. Adapters depending on
 * each other is exactly the tangle the composition-root rule exists to prevent.
 */

export type FieldValue = unknown;

export interface FieldChange {
  readonly field: string;
  /** When the field changed on the originating device. */
  readonly at: Date;
  readonly value: FieldValue;
  readonly deviceId: string;
}

/**
 * The unit of sync is a changed field, not a changed record — which is what
 * lets two people edit the same animal from the house and the barn and both
 * keep their edits.
 */
export interface Patch {
  readonly entity: string;
  readonly recordId: Ulid;
  readonly changes: readonly FieldChange[];
}

export type OutboxOperation = "create" | "update" | "delete";

export interface OutboxEntry {
  /** ULID — sorts by creation time, which is the drain order. */
  readonly id: Ulid;
  readonly operation: OutboxOperation;
  readonly patch: Patch;
  readonly queuedAt: Date;
  readonly deviceId: string;
  /** Incremented on each failed drain; drives backoff. */
  readonly attempts: number;
  readonly lastError?: string | undefined;
}

export interface OutboxStore {
  append(entry: OutboxEntry): Promise<void>;
  /** Oldest first. */
  pending(limit?: number): Promise<OutboxEntry[]>;
  /** Remove entries the server has accepted. */
  ack(ids: readonly Ulid[]): Promise<void>;
  /** Record a failure and bump the attempt count. */
  fail(id: Ulid, error: string): Promise<void>;
  size(): Promise<number>;
}
