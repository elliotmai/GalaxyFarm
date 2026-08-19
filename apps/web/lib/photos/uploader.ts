import {
  systemClock,
  type Attachment,
  type PhotoUploadTransport,
  type QueuedPhoto,
} from "@galaxy-farm/core";
import { PhotoUploader } from "@galaxy-farm/infra-sync";

import { commitRecord } from "@/lib/local/commit";
import type { LocalStore } from "@/lib/local/store";
import { httpPhotoTransport } from "@/lib/photos/transport";

/**
 * The photo queue, wired to this app (spec §4.1, §4.2).
 *
 * The uploader itself lives in `infrastructure/sync` and knows no URLs; this
 * is the composition-root half — the transport it talks through, and what
 * happens to the record when bytes land.
 *
 * That last part is the interesting one. The upload finishing is a *change to
 * a record*, so it travels the way every other change does: written to the
 * local store, diffed into a field patch, queued in the outbox, pushed on the
 * next sync. Which means the kiosk in the barn stops showing the placeholder
 * without anybody touching it, and it means a device that uploads the bytes
 * and then loses signal still has the flip waiting in its outbox.
 */

export interface PhotoUploaderOptions {
  readonly transport?: PhotoUploadTransport;
}

export function photoUploader(
  store: LocalStore,
  options: PhotoUploaderOptions = {},
): PhotoUploader {
  return new PhotoUploader({
    queue: store.photoQueue,
    transport: options.transport ?? httpPhotoTransport(),
    clock: systemClock(),
    onUploaded: (photo, key) => markUploaded(store, photo, key),
  });
}

/**
 * "A photograph exists" becomes "and here it is".
 *
 * Two fields move: `uploaded`, and the key — which the device derived offline
 * and the server derived again when it signed the URL. They agree, because
 * both come from `storageKey`; taking the server's is what keeps them agreeing
 * if that derivation is ever changed on one side only.
 *
 * An attachment that is no longer there is not an error. It was deleted while
 * its bytes were still queued, which is an ordinary thing to do to a photo
 * that came out blurry, and the uploader settles the entry either way — §4.5's
 * purge is what removes the object itself, not this.
 */
async function markUploaded(store: LocalStore, photo: QueuedPhoto, key: string): Promise<void> {
  const before = await store.repository<Attachment>("attachments").findById(photo.id);
  if (before === undefined) return;

  const after: Attachment = { ...before, key, uploaded: true, updatedAt: new Date() };
  await commitRecord(store, {
    store: "attachments",
    entity: "attachments",
    before,
    after,
    operation: "update",
  });
}
