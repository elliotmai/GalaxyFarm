import { getStore } from "@netlify/blobs";

import type { OutboxEntry, PushResult } from "@galaxy-farm/core";
import { applyPush, type Database, type PushContext } from "@galaxy-farm/infra-db";

/**
 * "Has anything changed since you last looked?" — answered without Postgres.
 *
 * Every device pulls on a heartbeat, and a barn screen does it around the
 * clock. Each of those pulls used to be a Neon query, so the database never
 * went a quiet minute and never got to scale to zero: one wall-mounted tablet
 * kept the compute awake every hour of the month, which is what ran the
 * project through its quota and turned every pull and every sign-in into a
 * 500 for weeks. Almost all of those pulls found nothing, too — the farm
 * changes a few dozen times a day, not 1,440.
 *
 * So the server keeps one stamp per property in Netlify Blobs, replaced
 * whenever something a device would pull is written. A device sends back the
 * stamp it last caught up to; if it still matches, the pull answers "nothing
 * new" without opening a connection, and Neon stays asleep.
 *
 * **This is a deliberate exception to "speak only standard Postgres"**
 * (README, spec §2), taken on purpose for the bill. It holds nothing that
 * matters: lose the store, or move off Netlify, and `currentStamp` comes back
 * undefined, every pull is a real one again, and the app behaves exactly as it
 * did before this file existed. Nothing is ever *read* from here — the records
 * still only come from Postgres.
 *
 * Ordering is what makes the skip safe. A writer replaces the stamp *after*
 * its write commits; a pull reads the stamp *before* it queries. A write that
 * lands after the pull's query therefore changes the stamp after the pull read
 * it, so the device's next check sees a different stamp and pulls again.
 */

const STORE_NAME = "sync-stamps";

function stamps() {
  // Strong consistency: an eventually-consistent read could hand back the
  // stamp from before a write, and the device would skip the pull that would
  // have brought it.
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function freshStamp(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

/**
 * The property's current stamp, minting one if there is none yet.
 *
 * Undefined when Blobs is unreachable — local dev, tests, an outage — which
 * the pull route treats as "always do the real pull".
 */
export async function currentStamp(propertyId: string): Promise<string | undefined> {
  try {
    const store = stamps();
    const existing = await store.get(propertyId);
    if (typeof existing === "string" && existing !== "") return existing;
    // First pull after this shipped. Minting here is safe for the same reason
    // writes are: the caller queries Postgres after this returns.
    const minted = freshStamp();
    await store.set(propertyId, minted);
    return minted;
  } catch {
    return undefined;
  }
}

/**
 * Something a device would pull just changed. Call after the write commits.
 *
 * Never throws: the write already happened, and failing the request over a
 * missed hint would be worse than the hint. A missed one costs a device at
 * most `STAMP_MAX_AGE_MS` (see `transport.ts`) before its next real pull.
 */
export async function markChanged(propertyId: string): Promise<void> {
  try {
    await stamps().set(propertyId, freshStamp());
  } catch (error) {
    console.error("[sync:stamp] could not mark change", error);
  }
}

/**
 * `applyPush`, then mark the property changed if anything was accepted.
 *
 * Every server-side writer of synced records goes through this rather than
 * `applyPush` directly — the push route, the kiosk and sitter actions, the
 * Wander trip writer — so none of them can forget the stamp.
 */
export async function applyPushAndMark(
  db: Database,
  entries: readonly OutboxEntry[],
  context: PushContext,
): Promise<PushResult> {
  const result = await applyPush(db, entries, context);
  if (result.accepted.length > 0) await markChanged(context.propertyId);
  return result;
}
