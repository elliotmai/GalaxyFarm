/**
 * The offline-first sync engine (spec §4.2).
 *
 * Reads never come through here — the UI always reads from the local store, so
 * it works with zero bars in the barn. This is only the reconciliation path.
 */

// Patch and merge are domain rules and live in the kernel — the server runs
// the same merge as the device. Re-exported so a caller of the sync adapter
// still gets one coherent surface.
export {
  diff,
  applyPatch,
  isEqual,
  winner,
  mergePatch,
  materialise,
  initialState,
  changesToState,
  cursorFor,
  advance,
  since,
  isTombstone,
} from "@galaxy-farm/core";
export type {
  FieldChange,
  FieldValue,
  Patch,
  FieldState,
  RecordState,
  AuditEntry,
  MergeResult,
  Cursor,
  CursorSet,
  Tombstone,
  PushResult,
  PushRejection,
  PullPage,
  SyncTransport,
} from "@galaxy-farm/core";
export * from "./outbox.js";
export * from "./engine.js";
export * from "./photo-uploader.js";
