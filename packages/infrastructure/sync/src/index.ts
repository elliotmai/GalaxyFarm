/**
 * The offline-first sync engine (spec §4.2).
 *
 * Reads never come through here — the UI always reads from the local store, so
 * it works with zero bars in the barn. This is only the reconciliation path.
 */

export * from "./patch.js";
export * from "./outbox.js";
export * from "./merge.js";
export * from "./cursors.js";
export * from "./engine.js";
