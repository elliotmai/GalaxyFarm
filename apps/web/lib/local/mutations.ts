"use client";

import { useCallback } from "react";
import type { z } from "zod";

import {
  encodeUlid,
  restore,
  softDelete,
  validate,
  type BaseRecord,
  type CrudError,
  type OutboxOperation,
  type Result,
  type Ulid,
} from "@galaxy-farm/core";

import { useSyncEngine } from "@/app/_components/sync-provider";
import { commitRecord } from "@/lib/local/commit";
import type { LocalStoreName } from "@/lib/local/store";

/**
 * Writing, on device (spec §4.2, §4.5).
 *
 * The order is the whole point and is not negotiable: **validate, write
 * locally, queue the patch, then try to sync.** The screen is already showing
 * the new value before anything touches the network. A write that waited for
 * the server would make the app unusable in the barn, which is the one place
 * it has to work.
 *
 * The patch is a diff, not the record. Two people editing different fields of
 * the same animal both keep their edits, and that only holds if what travels
 * is the fields that changed (§4.2).
 */

export interface Mutations<T extends BaseRecord> {
  create(input: Omit<T, keyof BaseRecord> & Partial<BaseRecord>): Promise<Result<T, CrudError>>;
  update(id: Ulid, patch: Partial<T>): Promise<Result<T, CrudError>>;
  /** Soft delete — a tombstone, never a DELETE (§4.5 clause 4). */
  remove(id: Ulid, reason?: string): Promise<Result<T, CrudError>>;
  /** Bring one back from Trash. */
  restoreRecord(id: Ulid): Promise<Result<T, CrudError>>;
}

export function useMutations<T extends BaseRecord>(
  store: LocalStoreName,
  entity: string,
  schema: z.ZodType<T>,
  propertyId: Ulid,
  actorId: Ulid,
): Mutations<T> {
  const { store: local, syncNow } = useSyncEngine();

  const commit = useCallback(
    async (before: T | undefined, after: T, operation: OutboxOperation): Promise<void> => {
      if (local === undefined) throw new Error("The local store is not ready yet");

      // Local first, then the outbox. The UI is already showing this by the
      // time the engine hears about it — see `commit.ts`, which the photo
      // uploader shares so a flipped attachment travels the same way.
      await commitRecord(local, { store, entity, before, after, operation });

      // Fire and forget. A failed sync leaves the outbox intact and backs off;
      // awaiting it here would put the network back in front of the person.
      void syncNow();
    },
    [local, store, entity, syncNow],
  );

  const create = useCallback<Mutations<T>["create"]>(
    async (input) => {
      const now = new Date();
      const candidate = {
        id: encodeUlid(now.getTime()),
        createdAt: now,
        ...input,
        // After the spread, deliberately. A form that could name its own
        // property would write into one it cannot see — the same hole the
        // push handler closes on the server, and it has to be closed here
        // too, because a patch built from this record is what travels.
        propertyId,
        updatedAt: now,
      };

      // §4.5 clause 2: validated at the boundary, with the same schema the
      // server will use. Catching it here means the error lands on the field
      // rather than in a sync rejection nobody sees.
      const parsed = validate(schema, candidate);
      if (!parsed.ok) return parsed;

      await commit(undefined, parsed.value, "create");
      return parsed;
    },
    [commit, propertyId, schema],
  );

  const update = useCallback<Mutations<T>["update"]>(
    async (id, patch) => {
      if (local === undefined) throw new Error("The local store is not ready yet");

      const before = await local.repository<T>(store).findById(id);
      if (before === undefined) return { ok: false, error: { kind: "not-found", entity, id } };

      const parsed = validate(schema, { ...before, ...patch, updatedAt: new Date() });
      if (!parsed.ok) return parsed;

      await commit(before, parsed.value, "update");
      return parsed;
    },
    [commit, entity, local, schema, store],
  );

  const remove = useCallback<Mutations<T>["remove"]>(
    async (id, reason) => {
      if (local === undefined) throw new Error("The local store is not ready yet");

      const before = await local.repository<T>(store).findById(id);
      if (before === undefined) return { ok: false, error: { kind: "not-found", entity, id } };

      // A tombstone, not a DELETE. It is what makes the confirmation honest —
      // the answer to "what if I misclick" is always "restore it" — and it is
      // what lets the deletion reach the kiosk instead of the record
      // reappearing on its next pull.
      const tombstoned = softDelete(before, new Date(), actorId, reason);
      await commit(before, tombstoned, "delete");
      return { ok: true, value: tombstoned };
    },
    [actorId, commit, entity, local, store],
  );

  const restoreRecord = useCallback<Mutations<T>["restoreRecord"]>(
    async (id) => {
      if (local === undefined) throw new Error("The local store is not ready yet");

      const before = await local.repository<T>(store).findById(id);
      if (before === undefined) return { ok: false, error: { kind: "not-found", entity, id } };

      const revived = restore(before, new Date());
      await commit(before, revived, "update");
      return { ok: true, value: revived };
    },
    [commit, entity, local, store],
  );

  return { create, update, remove, restoreRecord };
}
