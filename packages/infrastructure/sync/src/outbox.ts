import {
  isStuck,
  type OutboxEntry,
  type OutboxOperation,
  type OutboxStore,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The retry policy moved to the kernel (§12 decision 28): the device store has
 * to agree with the engine about what "stuck" means, and adapters may not
 * import each other. Re-exported here so existing call sites keep working.
 */
export { backoffDelayMs, drainableNow, isStuck, MAX_ATTEMPTS } from "@galaxy-farm/core";

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

  async defer(id: Ulid, error: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    // The error is recorded; the attempt count is not touched.
    this.entries.set(id, { ...entry, lastError: error });
  }

  async stuck(): Promise<OutboxEntry[]> {
    return [...this.entries.values()].filter(isStuck);
  }

  async revive(ids: readonly Ulid[]): Promise<void> {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry === undefined) continue;
      this.entries.set(id, { ...entry, attempts: 0 });
    }
  }

  async size(): Promise<number> {
    return this.entries.size;
  }
}
