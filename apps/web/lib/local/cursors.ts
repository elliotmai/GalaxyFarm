import type { CursorSet } from "@galaxy-farm/core";

/**
 * Pull cursors, kept across restarts.
 *
 * Without this a device re-pulls the entire farm every time the tab is closed
 * and reopened. That is correct and wasteful on a laptop; on a phone with one
 * bar in a barn it is the difference between a sync that finishes and one that
 * does not.
 *
 * `localStorage` rather than IndexedDB: it is a handful of timestamps, and the
 * synchronous read means the engine can be handed its cursors before the first
 * pull rather than after it.
 */

const KEY = "galaxy-farm:cursors";

/**
 * Bumped when a device's copy has to be re-read from the server.
 *
 * Cursors are what stop a device pulling the whole farm every time it opens,
 * and that is exactly what makes a *fixed* pull unable to fix anything: a
 * record already on the device is never sent again, because nothing about it
 * changed. When the bug was in how records were read off the wire, every
 * device is holding the wrong shape and no amount of syncing corrects it.
 *
 * So a revision that does not match drops the cursors, which costs one full
 * pull — the same cost as clearing site data, which this file already calls
 * recoverable — and the records come back through the current reviving code.
 *
 * 2: timestamps inside JSON blobs (a hair card's `testedOn`, a breeding's
 * `pregCheck.date`) were left as strings by `reviveRecord`, and a screen that
 * formatted one crashed the app.
 */
const REVISION_KEY = "galaxy-farm:cursors:revision";
export const CURSOR_REVISION = "2";

export function loadCursors(storage: Storage | undefined = globalThis.localStorage): CursorSet {
  // Stamped here rather than on save, so a device that never manages a full
  // sync still only re-pulls once per revision.
  const revision = storage?.getItem(REVISION_KEY);
  if (revision !== CURSOR_REVISION) {
    try {
      storage?.setItem(REVISION_KEY, CURSOR_REVISION);
      storage?.removeItem(KEY);
    } catch {
      // Out of quota. One extra full pull next time is the whole cost.
    }
    return {};
  }

  const raw = storage?.getItem(KEY);
  if (raw === null || raw === undefined || raw === "") return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, { updatedAt: string; lastId: string }>;
    const cursors: Record<string, CursorSet[string]> = {};

    for (const [entity, cursor] of Object.entries(parsed)) {
      const updatedAt = new Date(cursor.updatedAt);
      // A cursor that became an Invalid Date would compare false against
      // everything and quietly pull nothing, forever. Dropping it means one
      // full re-pull, which is recoverable.
      if (Number.isNaN(updatedAt.getTime())) continue;
      cursors[entity] = { entity, updatedAt, lastId: cursor.lastId };
    }

    return cursors;
  } catch {
    // Corrupt storage costs one full pull, not a broken app.
    return {};
  }
}

export function saveCursors(
  cursors: CursorSet,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(cursors));
  } catch {
    // A full quota is not worth failing a sync over — the cost is re-pulling
    // next time, and the pull already succeeded.
  }
}
