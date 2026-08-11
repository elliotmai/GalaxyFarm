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
  /**
   * How many times the *server* has rejected this entry.
   *
   * Not "how many times a sync failed". A server that was down is not a
   * verdict on the entry, and counting it as one is how a whole outbox went
   * permanently stuck during an outage that lasted eight minutes.
   */
  readonly attempts: number;
  readonly lastError?: string | undefined;
}

export interface OutboxStore {
  append(entry: OutboxEntry): Promise<void>;
  /** Oldest first. */
  pending(limit?: number): Promise<OutboxEntry[]>;
  /** Remove entries the server has accepted. */
  ack(ids: readonly Ulid[]): Promise<void>;
  /**
   * The server considered this entry and refused it. Bumps the attempt count.
   */
  fail(id: Ulid, error: string): Promise<void>;
  /**
   * The entry could not be delivered at all — no signal, or a server that
   * answered 500 to the whole batch.
   *
   * Records why, and deliberately does *not* count as an attempt: the entry
   * did nothing wrong and must not be retired for somebody else's outage.
   */
  defer(id: Ulid, error: string): Promise<void>;
  size(): Promise<number>;
  /** Entries retired after too many rejections, which a person has to see. */
  stuck(): Promise<OutboxEntry[]>;
  /** Put a retired entry back in the queue. */
  revive(ids: readonly Ulid[]): Promise<void>;
}
