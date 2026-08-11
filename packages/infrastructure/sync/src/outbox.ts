import type { Ulid } from "@galaxy-farm/core";

import type { Patch } from "./patch.js";

/**
 * The outbox (spec §4.2).
 *
 * Every mutation is written to the local store *and* here, atomically. When
 * signal returns the outbox drains in order. Two properties matter more than
 * anything else: it survives a full app restart before ever syncing, and
 * replaying a push does not double-apply.
 */

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

export class InMemoryOutbox implements OutboxStore {
  private readonly entries = new Map<string, OutboxEntry>();

  async append(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async pending(limit?: number): Promise<OutboxEntry[]> {
    // ULIDs sort lexicographically by creation time, so this is chronological
    // without storing a separate sequence number.
    const sorted = [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  async ack(ids: readonly Ulid[]): Promise<void> {
    for (const id of ids) this.entries.delete(id);
  }

  async fail(id: Ulid, error: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.entries.set(id, { ...entry, attempts: entry.attempts + 1, lastError: error });
  }

  async size(): Promise<number> {
    return this.entries.size;
  }
}

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Exponential backoff, capped.
 *
 * A flaky barn connection must not turn into a hot loop, and it must not back
 * off so far that a device which regains signal sits idle for an hour.
 */
export function backoffDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

/** Entries that have failed too often are surfaced rather than retried forever. */
export function isStuck(entry: Pick<OutboxEntry, "attempts">): boolean {
  return entry.attempts >= MAX_ATTEMPTS;
}

export function drainableNow(
  entries: readonly OutboxEntry[],
  now: Date,
  lastAttemptAt?: Date,
): OutboxEntry[] {
  return entries.filter((entry) => {
    if (isStuck(entry)) return false;
    if (entry.attempts === 0 || lastAttemptAt === undefined) return true;
    return now.getTime() - lastAttemptAt.getTime() >= backoffDelayMs(entry.attempts);
  });
}
