import type { Ulid } from "../types/ids.js";

/**
 * Photo bytes waiting for a connection (spec §4.2).
 *
 * The outbox beside it carries *field patches* — small, textual, and cheap to
 * replay. Photograph bytes are neither, so they queue separately: a 300 KB
 * blob does not belong in a structure the engine reads end to end on every
 * heartbeat, and an upload that fails must not count a rejection against the
 * record patch that travelled with it.
 *
 * The port lives here, in the kernel, for the same reason `OutboxStore` does
 * (§4.1): it has two implementers — an IndexedDB one on device and an
 * in-memory one for tests — and a port owned by one adapter would make the
 * other depend on it.
 *
 * The queue is device-local and is never synced. It holds bytes that already
 * exist somewhere else the moment they land in R2; what makes them findable is
 * the `Attachment` record, which *is* synced and which stores the key
 * immediately (§4.2).
 */

export interface QueuedPhoto {
  /**
   * The attachment record's id, deliberately — not an id of its own.
   *
   * One photo is one attachment, so sharing the id means the queue entry and
   * the record it belongs to can each be found from the other without a second
   * field to keep in step, and re-queuing the same photo after an ambiguous
   * failure replaces the entry rather than uploading twice.
   */
  readonly id: Ulid;
  readonly propertyId: Ulid;
  /** Which aggregate this hangs off: `Animal`, `Equipment`, `Pet`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  readonly filename: string;
  readonly contentType: string;
  /**
   * The compressed bytes.
   *
   * A `Uint8Array` rather than a `Blob`: the kernel has no DOM, and this is
   * the one shape IndexedDB, `fetch`, and a test with no browser all accept
   * without conversion.
   */
  readonly body: Uint8Array;
  readonly queuedAt: Date;
  /** How many times the *server* refused it. See `OutboxEntry.attempts`. */
  readonly attempts: number;
  readonly lastError?: string | undefined;
}

export interface PhotoQueue {
  append(photo: QueuedPhoto): Promise<void>;
  /** Oldest first — a ULID id sorts by the moment the photo was taken. */
  pending(limit?: number): Promise<QueuedPhoto[]>;
  /**
   * The bytes are in the bucket. Drop the copy.
   *
   * Named `settle` rather than anything with "delete" in it because nothing
   * here is a user's record: the photo has arrived, and this is the queue
   * letting go of a duplicate it was only holding until it did.
   */
  settle(ids: readonly Ulid[]): Promise<void>;
  /** The server considered it and refused. Counts against the entry. */
  fail(id: Ulid, error: string): Promise<void>;
  /**
   * It could not be delivered at all — no signal, or a 500 on the way out.
   * Records why without counting an attempt, exactly as the outbox does.
   */
  defer(id: Ulid, error: string): Promise<void>;
  size(): Promise<number>;
  /** Entries retired after too many refusals, which a person has to see. */
  stuck(): Promise<QueuedPhoto[]>;
  /** Put a retired entry back in the queue. */
  revive(ids: readonly Ulid[]): Promise<void>;
}
