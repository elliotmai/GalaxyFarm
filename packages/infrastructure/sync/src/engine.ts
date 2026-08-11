import { advance, backoffDelayMs, cursorFor, drainableNow, isServerError } from "@galaxy-farm/core";
import type {
  AuditEntry,
  BaseRecord,
  Clock,
  CursorSet,
  IdGenerator,
  Patch,
  PullPage,
  PushResult,
  Repository,
  SyncTransport,
} from "@galaxy-farm/core";

import { type OutboxEntry, type OutboxOperation, type OutboxStore } from "./outbox.js";

/**
 * The engine that drives push and pull (spec §4.2).
 *
 * It deliberately owns no transport of its own. The server is reached through
 * a port, so the whole reconciliation loop can be tested against a fake that
 * fails, delays, and reorders — which is the only way to have any confidence in
 * behaviour that only ever misbehaves on a bad connection in a metal barn.
 */

/**
 * A ceiling on pull rounds per sync. Reached only by a device that has been
 * offline for a very long time, which then catches up on the next sync rather
 * than holding this one open indefinitely.
 */
const MAX_PULL_ROUNDS = 20;

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
  /**
   * Set when the *server* refused, as opposed to not being reachable.
   *
   * The two need telling apart on screen: no signal in a pasture is normal and
   * self-correcting, a 500 is a fault somebody has to fix. Reported as the
   * message the server gave, because "sync failed" is not actionable.
   */
  readonly problem?: string | undefined;
}

export class SyncEngine<T extends BaseRecord> {
  private cursors: CursorSet = {};
  private lastAttemptAt: Date | undefined;

  /**
   * Consecutive failures to reach the server at all.
   *
   * Backoff belongs to the connection, not to the entries waiting on it. A
   * server that is down is not a verdict on what somebody typed, so the delay
   * is tracked here and every queued entry keeps its attempt count of zero.
   */
  private transportFailures = 0;
  private lastFailureAt: Date | undefined;

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

  /** Entries the server has rejected often enough to be set aside (§4.2). */
  async stuckCount(): Promise<number> {
    return (await this.options.outbox.stuck()).length;
  }

  /**
   * Put every retired entry back in the queue.
   *
   * Offered rather than automatic. An entry the server keeps refusing usually
   * needs a person to look at what it is trying to write; retrying it on a
   * timer forever would just hide that.
   */
  async retryStuck(): Promise<number> {
    const stuck = await this.options.outbox.stuck();
    await this.options.outbox.revive(stuck.map((entry) => entry.id));
    // Cleared so the revived entries are eligible immediately rather than
    // waiting out a backoff earned before they were set aside.
    this.lastAttemptAt = undefined;
    this.transportFailures = 0;
    this.lastFailureAt = undefined;
    return stuck.length;
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

    // Still cooling off from a server that could not be reached. Returning
    // early rather than hammering a dead endpoint every time the tab regains
    // focus; the entries themselves are untouched and stay eligible.
    if (
      this.lastFailureAt !== undefined &&
      now.getTime() - this.lastFailureAt.getTime() < backoffDelayMs(this.transportFailures)
    ) {
      return { pushed: 0, rejected: 0, audit: [], offline: this.transportFailures > 0 };
    }

    // The whole queue, then filter, then take a batch — in that order.
    //
    // Taking the oldest N and *then* filtering is head-of-line blocking: a
    // handful of retired entries at the front of the queue makes every fresh
    // edit behind them invisible to this method, and the count on screen goes
    // up forever while nothing is ever sent. That is exactly what happened.
    const queued = await this.options.outbox.pending();
    const ready = drainableNow(queued, now, this.lastAttemptAt).slice(
      0,
      this.options.batchSize ?? 50,
    );

    if (ready.length === 0) {
      return { pushed: 0, rejected: 0, audit: [], offline: false };
    }

    this.lastAttemptAt = now;

    let result: PushResult;
    try {
      result = await this.options.transport.push(ready);
    } catch (error) {
      // Server unreachable *or* refusing: either way keep every entry and let
      // backoff space out the retries. Nothing is lost, which is the entire
      // point of the outbox — but a refusal is reported so it can be shown as
      // a fault rather than as ordinary offline.
      const reason = error instanceof Error ? error.message : String(error);
      // `defer`, not `fail`. Nothing here was rejected — the batch never
      // arrived — and counting an outage against each entry is what retires a
      // whole outbox eight minutes into a server being down.
      for (const entry of ready) await this.options.outbox.defer(entry.id, reason);

      this.transportFailures += 1;
      this.lastFailureAt = now;

      return isServerError(error)
        ? { pushed: 0, rejected: 0, audit: [], offline: false, problem: reason }
        : { pushed: 0, rejected: 0, audit: [], offline: true };
    }

    // Reached the server: the connection backoff resets whatever the server
    // then had to say about individual entries.
    this.transportFailures = 0;
    this.lastFailureAt = undefined;

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

  /**
   * Pull until the server has nothing more.
   *
   * The server pages, and a device that stopped after one full page would sit
   * permanently one page behind — worst on the device that has been off
   * longest, which is exactly the one that needs to catch up. Each round
   * advances the cursors, so a round that returns nothing new terminates it.
   */
  async pull(): Promise<{
    readonly pulled: number;
    readonly offline: boolean;
    readonly problem?: string | undefined;
  }> {
    const entities = [...this.options.repositories.keys()];
    if (entities.length === 0) return { pulled: 0, offline: false };

    let pulled = 0;

    for (let round = 0; round < MAX_PULL_ROUNDS; round += 1) {
      let pages: readonly PullPage<T>[];
      try {
        pages = await this.options.transport.pull(this.cursors, entities);
      } catch (error) {
        // Whatever earlier rounds wrote is kept — the cursors moved with it,
        // so the next sync resumes rather than starting over.
        return isServerError(error)
          ? { pulled, offline: false, problem: error.message }
          : { pulled, offline: true };
      }

      let written = 0;
      for (const page of pages) {
        const repository = this.options.repositories.get(page.entity);
        if (repository === undefined || page.records.length === 0) continue;

        // Tombstones are saved like any other record. Writing them rather than
        // deleting locally is what stops a record resurrecting on the next pull
        // from a device that missed the deletion.
        await repository.saveMany(page.records);
        this.cursors = advance(this.cursors, page.entity, page.records);
        written += page.records.length;
      }

      pulled += written;

      // Stop when the server says there is no more, or when a round wrote
      // nothing — the second guard is what stops a server that always claims
      // more from spinning this loop forever.
      if (!pages.some((page) => page.hasMore) || written === 0) break;
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

    const problem = pushed.problem ?? pulled.problem;

    return {
      ...pushed,
      pulled: pulled.pulled,
      offline: pushed.offline || pulled.offline,
      ...(problem === undefined ? {} : { problem }),
    };
  }

  /** Cursor for one entity, for diagnostics and for persisting across restarts. */
  cursorForEntity(entity: string) {
    return cursorFor(this.cursors, entity);
  }
}
