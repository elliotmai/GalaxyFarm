import type { BaseRecord, Clock, IdGenerator, Repository, Ulid } from "@galaxy-farm/core";

import { advance, cursorFor, type CursorSet } from "./cursors.js";
import {
  drainableNow,
  type OutboxEntry,
  type OutboxOperation,
  type OutboxStore,
} from "./outbox.js";
import type { AuditEntry } from "./merge.js";
import type { Patch } from "./patch.js";

/**
 * The engine that drives push and pull (spec §4.2).
 *
 * It deliberately owns no transport of its own. The server is reached through
 * a port, so the whole reconciliation loop can be tested against a fake that
 * fails, delays, and reorders — which is the only way to have any confidence in
 * behaviour that only ever misbehaves on a bad connection in a metal barn.
 */

export interface PushResult {
  /** Entries the server durably accepted; safe to drop from the outbox. */
  readonly accepted: readonly Ulid[];
  /** Entries the server rejected, with the reason. */
  readonly rejected: readonly { readonly id: Ulid; readonly reason: string }[];
  /** Field-level resolutions the server performed while applying. */
  readonly audit: readonly AuditEntry[];
}

export interface PullPage<T extends BaseRecord> {
  readonly entity: string;
  /** Live records and tombstones alike — a deletion travels as a record. */
  readonly records: readonly T[];
}

export interface SyncTransport<T extends BaseRecord> {
  push(entries: readonly OutboxEntry[]): Promise<PushResult>;
  pull(cursors: CursorSet, entities: readonly string[]): Promise<readonly PullPage<T>[]>;
}

export interface SyncEngineOptions<T extends BaseRecord> {
  readonly outbox: OutboxStore;
  readonly transport: SyncTransport<T>;
  /** Local stores to apply pulled records into, keyed by entity name. */
  readonly repositories: ReadonlyMap<string, Repository<T>>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly deviceId: string;
  /** How many outbox entries to send per push. */
  readonly batchSize?: number;
}

export interface SyncOutcome {
  readonly pushed: number;
  readonly rejected: number;
  readonly pulled: number;
  readonly audit: readonly AuditEntry[];
  /** Set when the engine could not reach the server at all. */
  readonly offline: boolean;
}

export class SyncEngine<T extends BaseRecord> {
  private cursors: CursorSet = {};
  private lastAttemptAt: Date | undefined;

  constructor(private readonly options: SyncEngineOptions<T>) {}

  /**
   * Record a local mutation.
   *
   * Called after the local store has been written, never instead of it — the
   * UI must already be showing the new value before this runs.
   */
  async enqueue(operation: OutboxOperation, patch: Patch): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      id: this.options.ids.next(),
      operation,
      patch,
      queuedAt: this.options.clock.now(),
      deviceId: this.options.deviceId,
      attempts: 0,
    };
    await this.options.outbox.append(entry);
    return entry;
  }

  async pendingCount(): Promise<number> {
    return this.options.outbox.size();
  }

  cursorState(): CursorSet {
    return this.cursors;
  }

  /** Restore cursors after a restart, so a pull does not start from scratch. */
  restoreCursors(cursors: CursorSet): void {
    this.cursors = cursors;
  }

  async push(): Promise<Omit<SyncOutcome, "pulled">> {
    const now = this.options.clock.now();
    const queued = await this.options.outbox.pending(this.options.batchSize ?? 50);
    const ready = drainableNow(queued, now, this.lastAttemptAt);

    if (ready.length === 0) {
      return { pushed: 0, rejected: 0, audit: [], offline: false };
    }

    this.lastAttemptAt = now;

    let result: PushResult;
    try {
      result = await this.options.transport.push(ready);
    } catch (error) {
      // Unreachable server: keep every entry and let backoff space out the
      // retries. Nothing is lost, which is the entire point of the outbox.
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of ready) await this.options.outbox.fail(entry.id, reason);
      return { pushed: 0, rejected: 0, audit: [], offline: true };
    }

    await this.options.outbox.ack(result.accepted);
    for (const rejection of result.rejected) {
      await this.options.outbox.fail(rejection.id, rejection.reason);
    }

    return {
      pushed: result.accepted.length,
      rejected: result.rejected.length,
      audit: result.audit,
      offline: false,
    };
  }

  async pull(): Promise<{ readonly pulled: number; readonly offline: boolean }> {
    const entities = [...this.options.repositories.keys()];
    if (entities.length === 0) return { pulled: 0, offline: false };

    let pages: readonly PullPage<T>[];
    try {
      pages = await this.options.transport.pull(this.cursors, entities);
    } catch {
      return { pulled: 0, offline: true };
    }

    let pulled = 0;
    for (const page of pages) {
      const repository = this.options.repositories.get(page.entity);
      if (repository === undefined || page.records.length === 0) continue;

      // Tombstones are saved like any other record. Writing them rather than
      // deleting locally is what stops a record resurrecting on the next pull
      // from a device that missed the deletion.
      await repository.saveMany(page.records);
      this.cursors = advance(this.cursors, page.entity, page.records);
      pulled += page.records.length;
    }

    return { pulled, offline: false };
  }

  /**
   * Push before pull.
   *
   * Sending local work first means the server has already seen it when the
   * pull response is built, so a device does not immediately receive a stale
   * version of the row it just changed.
   */
  async sync(): Promise<SyncOutcome> {
    const pushed = await this.push();
    const pulled = await this.pull();

    return { ...pushed, pulled: pulled.pulled, offline: pushed.offline || pulled.offline };
  }

  /** Cursor for one entity, for diagnostics and for persisting across restarts. */
  cursorForEntity(entity: string) {
    return cursorFor(this.cursors, entity);
  }
}
