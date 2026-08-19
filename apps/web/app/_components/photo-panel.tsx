"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  EmptyState,
  Modal,
  PhotoCapture,
  PhotoGrid,
  Section,
  TextInput,
  useConfirmDelete,
  useToast,
  type PhotoTile,
} from "@galaxy-farm/ui";
import type { Attachment, Ulid } from "@galaxy-farm/core";

import { useAttachPhotos, usePhotos, type DevicePhoto } from "@/lib/photos/use-photos";

/**
 * Photographs, on any record that has them (spec §4.2, §4.5, §5.1).
 *
 * Built once and shared, because §5.1 hangs photos off four aggregates —
 * `Animal`, `PurchaseCandidate`, `Equipment`, and the pets — and four copies
 * of an upload queue would be four places for the offline path to be subtly
 * wrong. The panel takes the owning entity's name and id and knows nothing
 * else about it.
 *
 * The four clauses of §4.5, in the order they appear there:
 *
 * 1. **Full CRUD.** The grid is the list and the read; the capture control is
 *    the create; the caption is the edit; Delete is the delete. Nothing here
 *    is write-only.
 * 2. **Validated at the boundary.** Everything goes through `attachmentSchema`
 *    — the same schema the presign route re-checks the request against.
 * 3. **Confirmed.** §4.5's table puts a photo at Standard tier: a dialog
 *    naming it, and an undo toast afterwards. Both are here.
 * 4. **Soft.** Deleting writes a tombstone, so the photo leaves the gallery
 *    and waits in Trash. The object in the bucket is deliberately left alone —
 *    purge is the owner-only action that removes bytes (§4.5 clause 4), and if
 *    this deleted them, "restore it from Trash" would hand back a record
 *    pointing at nothing. For the same reason a photo deleted before it
 *    finished uploading keeps uploading: the restore has to be real.
 */

export interface PhotoPanelProps {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Which aggregate: `Animal`, `Equipment`, `PurchaseCandidate`, `Pet`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  /** The owning record, by name — the dialogs and empty state say it aloud. */
  readonly recordName: string;
  readonly title?: string;
}

export function PhotoPanel({
  propertyId,
  actorId,
  ownerEntity,
  ownerId,
  recordName,
  title = "Photos",
}: PhotoPanelProps) {
  const library = usePhotos({ propertyId, actorId, ownerEntity, ownerId });
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [captioning, setCaptioning] = useState<Attachment | undefined>();
  const [caption, setCaption] = useState("");
  const [busyId, setBusyId] = useState<string | undefined>();

  // Keyed by plain string: a tile is a presentation type and carries no
  // branded ids, which is the point — the grid is shared by four screens and
  // knows nothing about ULIDs.
  const byId = new Map<string, DevicePhoto>(
    library.photos.map((photo) => [photo.attachment.id, photo]),
  );

  async function removePhoto(tile: PhotoTile) {
    const photo = byId.get(tile.id);
    if (photo === undefined) return;

    const confirmed = await confirmDelete({
      // §4.5: a photo is an ordinary record — Standard tier, dialog plus undo.
      tier: "standard",
      recordName: photo.attachment.caption ?? photo.attachment.filename,
      entity: "photo",
      dependents: [],
      consequence: photo.pending
        ? "It has not uploaded yet. It will still finish uploading, so it can be restored from Trash with the picture intact."
        : "It stays in Trash, and in storage, until somebody purges it.",
    });
    if (!confirmed) return;

    setBusyId(tile.id);
    try {
      const result = await library.mutations.remove(photo.attachment.id);
      if (!result.ok) {
        show({ message: "Could not delete that photo", tone: "danger" });
        return;
      }

      show({
        message: `${photo.attachment.caption ?? photo.attachment.filename} deleted`,
        action: {
          label: "Undo",
          onAct: () => void library.mutations.restoreRecord(photo.attachment.id),
        },
      });
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveCaption() {
    if (captioning === undefined) return;

    const trimmed = caption.trim();
    setBusyId(captioning.id);
    try {
      // Named as undefined rather than omitted: an absent field is a field
      // nobody asked to change, and emptying the box has to actually clear it.
      const result = await library.mutations.update(captioning.id, {
        caption: trimmed === "" ? undefined : trimmed,
      } as Partial<Attachment>);

      if (!result.ok) {
        show({ message: "Could not save that caption", tone: "danger" });
        return;
      }
      setCaptioning(undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <Section
      title={title}
      actions={
        <PhotoCapture
          onPick={(files) => void library.attach(files)}
          busy={library.busy}
          label="Add photos"
        />
      }
    >
      {library.problem === undefined ? null : (
        <Callout
          tone="danger"
          title="That one could not be added"
          actions={
            <Button variant="ghost" onClick={library.clearProblem}>
              Dismiss
            </Button>
          }
        >
          {library.problem}
        </Callout>
      )}

      <PhotoGrid
        photos={library.photos.map(toTile)}
        onDelete={(tile) => void removePhoto(tile)}
        onCaption={(tile) => {
          const photo = byId.get(tile.id);
          if (photo === undefined) return;
          setCaptioning(photo.attachment);
          setCaption(photo.attachment.caption ?? "");
        }}
        busyId={busyId}
        empty={
          <EmptyState
            title={library.loading ? "Looking…" : `No photos of ${recordName} yet`}
            detail="Add one from the camera or the camera roll. A photo taken with no signal is stored on this device and uploads on its own once there is some."
          />
        }
      />

      {captioning === undefined ? null : (
        <Modal
          title="Caption this photo"
          onClose={() => setCaptioning(undefined)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCaptioning(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveCaption()}>
                Save
              </Button>
            </>
          }
        >
          <TextInput
            label="Caption"
            hint="What this shows — a scar, a brand, how she was standing. Blank removes it."
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </Modal>
      )}
    </Section>
  );
}

function toTile(photo: DevicePhoto): PhotoTile {
  return {
    id: photo.attachment.id,
    filename: photo.attachment.filename,
    caption: photo.attachment.caption,
    src: photo.src,
    pending: photo.pending,
    stuck: photo.stuck,
  };
}

/**
 * The two-tap path (issue #9).
 *
 * "Adding a photo is ≤2 taps from the animal's profile" is an acceptance
 * criterion, and it is only true if the control is on the profile itself: a
 * Photos tab would spend the first tap getting there and the second opening
 * the picker, and the shutter would be the third. So this sits in the page
 * header — tap the camera, take the photo, done, with the queue and the sync
 * loop handling the rest.
 */
export function PhotoQuickCapture({
  propertyId,
  actorId,
  ownerEntity,
  ownerId,
  label = "Photo",
}: Omit<PhotoPanelProps, "recordName" | "title"> & { readonly label?: string }) {
  // The intake half only. A header button has no gallery to draw, and reading
  // one would cost a signed URL per photograph for a list nobody is looking at.
  const intake = useAttachPhotos({ propertyId, actorId, ownerEntity, ownerId });

  return (
    <PhotoCapture
      onPick={(files) => void intake.attach(files)}
      busy={intake.busy}
      camera
      label={label}
    />
  );
}
