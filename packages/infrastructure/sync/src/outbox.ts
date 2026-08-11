import type { OutboxEntry, OutboxOperation, OutboxStore, Ulid } from "@galaxy-farm/core";

/**
 * Outbox implementations and retry policy (spec §4.2).
 *
 * The port itself is in the shared kernel — the device-persisted
 * implementation lives in the local-store adapter, and adapters must not
 * depend on each other. What lives here is the in-memory implementation used
 * by tests and by the server, plus the backoff policy.
 */

export type { OutboxEntry, OutboxOperation, OutboxStore };

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
