"use client";

import type { ReactNode } from "react";

/**
 * A record's photographs (spec §4.2, §8).
 *
 * Presentational, like everything else in this package: it is handed tiles and
 * three callbacks and knows nothing about attachments, queues, or R2. That is
 * what lets the same grid serve an animal, a piece of equipment, a purchase
 * candidate and a pet rather than being written four times — §4.1's boundary
 * rule, but also just the thing that keeps four screens looking alike.
 *
 * The state worth designing for is the one in the middle. A photograph taken
 * in a pen exists on the device long before it exists in the bucket, so a tile
 * says so plainly — and still shows the picture, read back out of the upload
 * queue, because "your photo is safe, it just has not gone yet" is a much
 * better thing to see than a grey box where the calf should be.
 */

export interface PhotoTile {
  readonly id: string;
  readonly filename: string;
  readonly caption?: string | undefined;
  /**
   * Something to draw right now: a signed URL for a photo that has landed, or
   * a local preview of bytes still queued. Absent while either is being
   * resolved, which is when the placeholder does its job.
   */
  readonly src?: string | undefined;
  /** True until the bytes have reached storage. */
  readonly pending: boolean;
  /** Set when the upload has been refused often enough to be set aside. */
  readonly stuck?: boolean | undefined;
}

export interface PhotoGridProps {
  readonly photos: readonly PhotoTile[];
  /** Routed through a confirmation by the caller — never wired to one tap. */
  readonly onDelete?: ((photo: PhotoTile) => void) | undefined;
  readonly onCaption?: ((photo: PhotoTile) => void) | undefined;
  /** What to say when there are none yet. */
  readonly empty?: ReactNode;
  /** The tile with an action in flight. */
  readonly busyId?: string | undefined;
}

export function PhotoGrid({ photos, onDelete, onCaption, empty, busyId }: PhotoGridProps) {
  if (photos.length === 0) return <>{empty}</>;

  return (
    <ul className="grid list-none grid-cols-2 gap-density p-0 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo) => (
        <li key={photo.id} className="flex flex-col gap-2">
          <figure className="m-0 flex flex-col gap-2">
            <div className="relative aspect-square overflow-hidden rounded-density border border-rule bg-canvas">
              {photo.src === undefined ? (
                <span className="flex h-full w-full items-center justify-center px-2 text-center text-sm text-muted">
                  {photo.pending ? "Waiting for signal" : "Loading…"}
                </span>
              ) : (
                /*
                 * A plain <img>. Next's image component optimises through a
                 * server route, and these are private objects behind
                 * short-lived signed URLs — routing them through an optimiser
                 * would either fail or cache a URL that expires in fifteen
                 * minutes.
                 */
                <img
                  src={photo.src}
                  alt={photo.caption ?? photo.filename}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}

              {photo.pending ? (
                <span
                  className={[
                    "absolute left-2 top-2 rounded-density border px-2 py-1 text-xs",
                    "bg-panel",
                    photo.stuck === true ? "border-danger text-danger" : "border-edge text-muted",
                  ].join(" ")}
                >
                  {photo.stuck === true ? "Not sent" : "On this device"}
                </span>
              ) : null}
            </div>

            <figcaption className="text-sm text-muted">
              {photo.caption ?? photo.filename}
            </figcaption>
          </figure>

          {onCaption === undefined && onDelete === undefined ? null : (
            <div className="flex flex-wrap items-center gap-3">
              {onCaption === undefined ? null : (
                <button
                  type="button"
                  onClick={() => onCaption(photo)}
                  disabled={busyId === photo.id}
                  className="min-h-target text-sm text-action underline underline-offset-4 disabled:opacity-50"
                >
                  Caption
                </button>
              )}
              {onDelete === undefined ? null : (
                <button
                  type="button"
                  onClick={() => onDelete(photo)}
                  disabled={busyId === photo.id}
                  className="min-h-target text-sm text-danger underline underline-offset-4 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
