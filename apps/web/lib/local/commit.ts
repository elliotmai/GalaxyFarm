import { diff, type BaseRecord, type FieldValue, type OutboxOperation } from "@galaxy-farm/core";

import { deviceId } from "@/lib/local/device-id";
import type { LocalStore, LocalStoreName } from "@/lib/local/store";

/**
 * Write a record change to the device and queue the patch (spec §4.2).
 *
 * The order is the whole point and is not negotiable: **write locally, then
 * queue.** The screen is already showing the new value before anything touches
 * the network.
 *
 * A plain function rather than part of `useMutations`, because two callers
 * need it and only one of them is a component. The other is the photo uploader
 * (`lib/photos/uploader.ts`), which runs on the sync heartbeat with nobody
 * looking at it and has to flip an attachment to `uploaded` through exactly the
 * same path a person's edit takes — same local write, same field-level patch,
 * same outbox. A second implementation of that would agree with this one right
 * up until the afternoon somebody changed one of them.
 */

export interface Commit<T extends BaseRecord> {
  readonly store: LocalStoreName;
  /** The entity name a `Patch` carries — the local store's name for it. */
  readonly entity: string;
  /** Absent for a create: there is nothing to diff against. */
  readonly before: T | undefined;
  readonly after: T;
  readonly operation: OutboxOperation;
}

export async function commitRecord<T extends BaseRecord>(
  local: LocalStore,
  change: Commit<T>,
): Promise<void> {
  await local.repository<T>(change.store).save(change.after);

  // The patch is a diff, not the record. Two people editing different fields
  // of the same animal both keep their edits, and that only holds if what
  // travels is the fields that changed (§4.2).
  const changes = diff(
    (change.before ?? {}) as unknown as Record<string, FieldValue>,
    change.after as unknown as Record<string, FieldValue>,
    { at: change.after.updatedAt, deviceId: deviceId() },
  );

  if (changes.length > 0) {
    await local.engine.enqueue(change.operation, {
      entity: change.entity,
      recordId: change.after.id,
      changes,
    });
  }
}
