/**
 * How long the sync loop waits before its next heartbeat.
 *
 * It used to be a flat minute, on every device, at every hour, whatever the
 * server was saying back — so a barn screen asked 1,440 times a day, and when
 * Neon ran out of quota it went on asking a refusing server once a minute for
 * weeks. Three things now stretch the wait:
 *
 * - **Overnight on a kiosk.** Nobody is ticking chores at 2 a.m., and the
 *   board only needs to be right by the time somebody walks into the barn.
 *   Every 30 minutes between 9 p.m. and 5 a.m., device time.
 * - **A server that keeps refusing.** Each refusal in a row doubles the wait,
 *   up to 30 minutes. One success puts it back to normal. "Offline" does not
 *   count: no signal fixes itself, and coming back into signal already fires a
 *   sync of its own.
 * - **A hidden tab** — handled by the provider, which skips the heartbeat and
 *   syncs the moment the tab is shown again.
 *
 * Pull-to-refresh and the badge's "sync now" ignore all of this; they call the
 * engine directly.
 */

export const HEARTBEAT_MS = 60_000;
export const QUIET_HEARTBEAT_MS = 30 * 60_000;
export const MAX_BACKOFF_MS = 30 * 60_000;

/** 9 p.m. to 5 a.m., device local time. */
export function isQuietHour(at: Date): boolean {
  const hour = at.getHours();
  return hour >= 21 || hour < 5;
}

export function nextSyncDelay(input: {
  readonly at: Date;
  /** The kiosk surface: unattended, so it may slow down overnight. */
  readonly quietOvernight: boolean;
  /** Server refusals in a row; 0 after any success. */
  readonly refusals: number;
}): number {
  const base = input.quietOvernight && isQuietHour(input.at) ? QUIET_HEARTBEAT_MS : HEARTBEAT_MS;
  if (input.refusals <= 0) return base;
  const backoff = Math.min(HEARTBEAT_MS * 2 ** input.refusals, MAX_BACKOFF_MS);
  return Math.max(base, backoff);
}
