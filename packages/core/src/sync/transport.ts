import type { BaseRecord } from "../entities/record.js";
import type { OutboxEntry } from "../ports/sync.js";
import type { Ulid } from "../types/ids.js";
import type { AuditEntry } from "./merge.js";
import type { CursorSet } from "./cursors.js";

/**
 * What crosses the wire between a device and the server (spec §4.2).
 *
 * Stated once, in the kernel, because both ends implement it: the engine on
 * device expects these shapes back, and the push and pull handlers on the
 * server produce them. Declared twice, they would agree right up until the
 * afternoon somebody changed one of them.
 */

export interface PushRejection {
  readonly id: Ulid;
  readonly reason: string;
}

export interface PushResult {
  /** Entries the server durably accepted; safe to drop from the outbox. */
  readonly accepted: readonly Ulid[];
  /** Entries the server rejected, with the reason. */
  readonly rejected: readonly PushRejection[];
  /** Field-level resolutions the server performed while applying. */
  readonly audit: readonly AuditEntry[];
}

export interface PullPage<T extends BaseRecord = BaseRecord> {
  readonly entity: string;
  /** Live records and tombstones alike — a deletion travels as a record. */
  readonly records: readonly T[];
  /**
   * True when the page hit its limit and more is waiting. A device that stops
   * pulling on a full page would sit one page behind forever.
   */
  readonly hasMore: boolean;
}

export interface SyncTransport<T extends BaseRecord> {
  push(entries: readonly OutboxEntry[]): Promise<PushResult>;
  pull(cursors: CursorSet, entities: readonly string[]): Promise<readonly PullPage<T>[]>;
}
