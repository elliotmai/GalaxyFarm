import type { OutboxEntry } from "../ports/sync.js";

export type { OutboxEntry };

/**
 * When a queued entry is tried again, and when it is set aside (spec §4.2).
 *
 * In the kernel rather than the sync adapter, for §12 decision 28's reason:
 * the outbox contract is part of the sync model, and the device store has to
 * agree with the engine about what "stuck" means. Two implementations of that
 * would agree right up until the afternoon somebody changed one.
 */

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

/**
 * The entries a push may send right now.
 *
 * Callers must filter *before* taking a batch, not after. Slicing the oldest N
 * and then filtering is head-of-line blocking: a few retired entries at the
 * front of the queue hide every fresh edit behind them, and the count on
 * screen climbs forever while nothing is ever sent.
 *
 * Generic over the entry, because the photo queue (§4.2) backs off on exactly
 * the same terms as the outbox and there is no reason for two answers to
 * "may this be tried again yet".
 */
export function drainableNow<T extends Pick<OutboxEntry, "attempts">>(
  entries: readonly T[],
  now: Date,
  lastAttemptAt?: Date,
): T[] {
  return entries.filter((entry) => {
    if (isStuck(entry)) return false;
    if (entry.attempts === 0 || lastAttemptAt === undefined) return true;
    return now.getTime() - lastAttemptAt.getTime() >= backoffDelayMs(entry.attempts);
  });
}
