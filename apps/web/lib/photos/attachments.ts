import {
  isImage,
  storageKey,
  type Attachment,
  type QueuedPhoto,
  type Ulid,
} from "@galaxy-farm/core";

import type { CompressedPhoto } from "@/lib/photos/compress";

/**
 * The record half of a photograph (spec §4.2, §5.1).
 *
 * `Attachment` is the record; the bytes are a device-local queue entry beside
 * it. The two share an id, and the record carries the key from the moment the
 * shutter closes — §4.2's "records store the key immediately and render a
 * placeholder until synced" is exactly this, and it is what makes a photograph
 * taken at the chute with no signal a thing that exists rather than a thing
 * that might.
 *
 * **The key is derived on both sides, never sent.** The device fills it in
 * here, offline, with no server to ask; the presign route derives it again
 * from the session's property when the bytes finally go. Both call
 * `storageKey`, so they agree — and if they ever did not, the photo would land
 * at an address nothing looks at, which is why there is one function rather
 * than two spellings of the same path.
 *
 * The gallery reads `Attachment` rows rather than an array of keys on the
 * animal. Under field-level last-write-wins (§4.2) an array is a single field:
 * two people each adding a photograph from different ends of the property
 * would produce two arrays, and the later one would win whole — losing a
 * photograph that had uploaded perfectly. Two rows merge; one array does not.
 */

export interface NewPhoto {
  readonly id: Ulid;
  readonly propertyId: Ulid;
  /** Which aggregate it hangs off: `Animal`, `Equipment`, `PurchaseCandidate`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  readonly photo: CompressedPhoto;
  readonly at: Date;
}

/** The record, as it looks before the bytes have gone anywhere. */
export function photoAttachment(input: NewPhoto): Attachment {
  return {
    id: input.id,
    propertyId: input.propertyId,
    createdAt: input.at,
    updatedAt: input.at,
    ownerEntity: input.ownerEntity,
    ownerId: input.ownerId,
    key: storageKey({
      propertyId: input.propertyId,
      entity: input.ownerEntity,
      recordId: input.ownerId,
      attachmentId: input.id,
      filename: input.photo.filename,
    }),
    filename: input.photo.filename,
    contentType: input.photo.contentType,
    bytes: input.photo.body.length,
    uploaded: false,
  };
}

/** The queue entry, holding the only copy of the bytes there is. */
export function queuedPhoto(input: NewPhoto): QueuedPhoto {
  return {
    id: input.id,
    propertyId: input.propertyId,
    ownerEntity: input.ownerEntity,
    ownerId: input.ownerId,
    filename: input.photo.filename,
    contentType: input.photo.contentType,
    body: input.photo.body,
    queuedAt: input.at,
    attempts: 0,
  };
}

/**
 * One record's photographs, oldest first.
 *
 * Ordered by id, which is a ULID and therefore by the moment each was taken.
 * Ordering by `updatedAt` would reshuffle the gallery every time an upload
 * finished, so the tiles would move under somebody's thumb.
 */
export function photosOf(
  attachments: readonly Attachment[],
  ownerEntity: string,
  ownerId: Ulid,
): Attachment[] {
  return attachments
    .filter(
      (attachment) =>
        attachment.ownerEntity === ownerEntity &&
        attachment.ownerId === ownerId &&
        isImage(attachment),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The one to show when there is room for exactly one — a herd row, a chip.
 *
 * The oldest *uploaded* photograph rather than simply the oldest: a tile that
 * has not arrived yet is a placeholder, and a placeholder is not a cover.
 * Falls back to the oldest of any, so a record whose only photo is still
 * queued shows the placeholder rather than nothing at all.
 */
export function coverPhoto(photos: readonly Attachment[]): Attachment | undefined {
  return photos.find((photo) => photo.uploaded) ?? photos[0];
}
