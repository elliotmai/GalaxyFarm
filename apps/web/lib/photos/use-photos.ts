"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  attachmentSchema,
  encodeUlid,
  isStuck,
  type Attachment,
  type Ulid,
} from "@galaxy-farm/core";

import { useSyncEngine } from "@/app/_components/sync-provider";
import { useMutations, type Mutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";
import { photoAttachment, photosOf, queuedPhoto } from "@/lib/photos/attachments";
import { compressPhoto, type CompressOptions } from "@/lib/photos/compress";

/**
 * One record's photographs, from the device's point of view (spec §4.2).
 *
 * Everything a screen needs to show and add photos, so that no screen has to
 * know how any of it works: an animal, a piece of equipment, a purchase
 * candidate and a pet all call these with their own entity name and id.
 *
 * Two hooks rather than one, and the split earns its keep. Adding a photo and
 * looking at photos are separate jobs on the same screen — the profile header
 * carries the camera and the Photos tab carries the gallery — and reading is
 * the expensive half: it subscribes to the attachment table, mints an object
 * URL per queued photo, and asks the server to sign a URL for every photo that
 * has landed. A camera button doing all of that to render one control would be
 * a request per photograph for a list nobody is looking at.
 */

export interface DevicePhoto {
  readonly attachment: Attachment;
  /** A signed URL, or a local preview of bytes still on the device. */
  readonly src: string | undefined;
  /** True until the bytes have reached storage. */
  readonly pending: boolean;
  /** True when the upload has been refused often enough to be set aside. */
  readonly stuck: boolean;
}

export interface PhotoIntake {
  /** Set while a picked photo is being shrunk and queued. */
  readonly busy: boolean;
  /** What went wrong with the last thing somebody picked, in their words. */
  readonly problem: string | undefined;
  /** Shrink, queue, and record — the whole of "add a photo". */
  attach(files: readonly File[]): Promise<void>;
  clearProblem(): void;
  /**
   * The attachment's CRUD, handed back rather than wrapped.
   *
   * Deleting one is a destructive action, and §4.5 clause 3 puts the
   * confirmation at the call site — so the screen that has the dialog is the
   * screen that calls `remove`, and this file never does.
   */
  readonly mutations: Mutations<Attachment>;
}

export interface PhotoLibrary extends PhotoIntake {
  readonly photos: readonly DevicePhoto[];
  readonly loading: boolean;
}

export interface PhotoLibraryOptions {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Which aggregate: `Animal`, `Equipment`, `PurchaseCandidate`, `Pet`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  /** Overridden in tests, where there is no canvas to shrink anything with. */
  readonly compression?: CompressOptions;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Adding one, and nothing else.
 *
 * What the two-tap capture control on a profile header needs: no subscription,
 * no previews, no signing — just the path from a picked file to a record and a
 * queue entry.
 */
export function useAttachPhotos(options: PhotoLibraryOptions): PhotoIntake {
  const { store: local, syncNow } = useSyncEngine();
  const mutations = useMutations<Attachment>(
    "attachments",
    "attachments",
    attachmentSchema,
    options.propertyId,
    options.actorId,
  );

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const attach = useCallback<PhotoIntake["attach"]>(
    async (files) => {
      if (local === undefined) return;

      setBusy(true);
      setProblem(undefined);

      try {
        for (const file of files) {
          const shrunk = await compressPhoto(file, options.compression ?? {});
          if (!shrunk.ok) {
            setProblem(shrunk.error.message);
            continue;
          }

          const at = new Date();
          const id = encodeUlid(at.getTime()) as Ulid;
          const photo = {
            id,
            propertyId: options.propertyId,
            ownerEntity: options.ownerEntity,
            ownerId: options.ownerId,
            photo: shrunk.value,
            at,
          };

          /*
           * Bytes first, then the record.
           *
           * The other order has a failure mode with no way back: a record
           * saying a photograph exists, with the only copy of it gone, is a
           * broken tile for the rest of the animal's life. This way round the
           * worst case is bytes in a queue with nothing pointing at them,
           * which the uploader settles and forgets.
           */
          await local.photoQueue.append(queuedPhoto(photo));

          const created = await mutations.create(photoAttachment(photo));
          if (!created.ok) {
            await local.photoQueue.settle([id]);
            setProblem(`${file.name} could not be attached.`);
          }
        }
      } finally {
        setBusy(false);
      }

      // Prod the loop rather than wait on it. If there is signal the photo is
      // gone within the second; if there is not, it goes on the next heartbeat
      // after there is, with nobody doing anything.
      void syncNow();
    },
    [
      local,
      mutations,
      options.compression,
      options.ownerEntity,
      options.ownerId,
      options.propertyId,
      syncNow,
    ],
  );

  const clearProblem = useCallback(() => setProblem(undefined), []);

  return { busy, problem, attach, clearProblem, mutations };
}

/**
 * Adding one, and showing them all.
 *
 * Three sources are folded into one list here, which is the whole reason this
 * exists:
 *
 * - the `Attachment` records, which sync like every other record and are the
 *   answer to "does this animal have photographs";
 * - the upload queue, which holds the bytes of the ones that have not gone
 *   yet — read back so a photo taken in a pen still *shows*, after a reload,
 *   with no signal, rather than being a grey box for the rest of the day;
 * - signed URLs for the ones that have landed, since the bucket is private.
 */
export function usePhotos(options: PhotoLibraryOptions): PhotoLibrary {
  const { store: local } = useSyncEngine();
  const intake = useAttachPhotos(options);

  const { records, loading } = useRecords<Attachment>("attachments", {
    propertyId: options.propertyId,
  });

  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({});
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(new Set());
  const [signed, setSigned] = useState<Readonly<Record<string, string>>>({});

  const mine = useMemo(
    () => photosOf(records, options.ownerEntity, options.ownerId),
    [records, options.ownerEntity, options.ownerId],
  );

  // The two effects below re-run on these rather than on the arrays, which are
  // new objects on every render even when nothing about them has changed.
  const waitingKey = mine
    .filter((photo) => !photo.uploaded)
    .map((photo) => photo.id)
    .join(",");
  const landedKey = mine
    .filter((photo) => photo.uploaded)
    .map((photo) => photo.key)
    .join(",");

  /** Local previews for anything still queued. */
  useEffect(() => {
    if (local === undefined) return;

    let live = true;
    const minted: string[] = [];

    void (async () => {
      const queued = await local.photoQueue.pending();
      if (!live) return;

      const urls: Record<string, string> = {};
      const retired = new Set<string>();

      for (const entry of queued) {
        // `.slice()` rather than the view itself: bytes read back out of
        // IndexedDB can sit on a larger backing buffer, and a Blob built on
        // that would carry the whole of it.
        const url = URL.createObjectURL(
          new Blob([entry.body.slice().buffer as ArrayBuffer], { type: entry.contentType }),
        );
        minted.push(url);
        urls[entry.id] = url;
        if (isStuck(entry)) retired.add(entry.id);
      }

      setPreviews(urls);
      setSetAside(retired);
    })();

    return () => {
      live = false;
      // Object URLs pin their blob in memory until they are released, and a
      // morning's photographs is tens of megabytes to leave behind.
      for (const url of minted) URL.revokeObjectURL(url);
    };
  }, [local, waitingKey]);

  /**
   * Signed URLs for anything that has landed.
   *
   * Resolved once per mount. They expire in fifteen minutes, which is far
   * longer than anybody looks at one screen, and re-signing on a timer would
   * mean a background request per photo forever on a barn screen that is never
   * closed. Reopening the screen signs them again.
   */
  useEffect(() => {
    if (landedKey === "") return;

    const call = options.fetch ?? globalThis.fetch.bind(globalThis);
    let live = true;

    void (async () => {
      const resolved: Record<string, string> = {};

      for (const key of landedKey.split(",")) {
        try {
          const response = await call(`/api/storage/presign?key=${encodeURIComponent(key)}`);
          if (!response.ok) continue;
          const body = (await response.json()) as { url?: string };
          if (typeof body.url === "string") resolved[key] = body.url;
        } catch {
          // No signal. The tile shows its placeholder, which is the truth:
          // the photo is in the bucket and this device cannot reach it.
        }
      }

      if (live) setSigned((held) => ({ ...held, ...resolved }));
    })();

    return () => {
      live = false;
    };
  }, [landedKey, options.fetch]);

  const photos = useMemo<DevicePhoto[]>(
    () =>
      mine.map((attachment) => ({
        attachment,
        src: attachment.uploaded ? signed[attachment.key] : previews[attachment.id],
        pending: !attachment.uploaded,
        stuck: setAside.has(attachment.id),
      })),
    [mine, previews, signed, setAside],
  );

  return { ...intake, photos, loading };
}
