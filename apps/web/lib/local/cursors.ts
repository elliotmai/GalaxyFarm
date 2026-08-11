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

export function loadCursors(storage: Storage | undefined = globalThis.localStorage): CursorSet {
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
