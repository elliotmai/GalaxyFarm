import { drainableNow, isPhotoUploadRefusal } from "@galaxy-farm/core";
import type { Clock, PhotoQueue, PhotoUploadTransport, QueuedPhoto, Ulid } from "@galaxy-farm/core";

/**
 * Photo bytes, drained (spec §4.2).
 *
 * The acceptance criterion this exists for is the one that matters most on
 * this issue: *a photo taken in the barn with no signal uploads later, with
 * the user doing nothing.* So there is no upload button anywhere, nothing to
 * retry by hand, and no screen that waits on this. Somebody points a phone at
 * a calf; the record is written and the bytes are queued; this runs on the
 * same heartbeat the sync engine does and empties the queue whenever there is
 * signal to empty it into.
 *
 * It owns no transport, for the reason the engine does not either: the whole
 * point is behaviour under a connection that fails halfway, and a fake
 * transport is the only way to reproduce that on purpose.
 */

export interface PhotoUploaderOptions {
  readonly queue: PhotoQueue;
  readonly transport: PhotoUploadTransport;
  /**
   * Run once the bytes are in the bucket, before the queue lets go of them.
   *
   * Awaited deliberately. It is what flips the record from "a photograph
   * exists" to "and here it is" — and if that write fails, the entry has to
   * stay queued, because a settled queue plus an unflipped record is a photo
   * that renders as a placeholder forever.
   */
  readonly onUploaded: (photo: QueuedPhoto, key: string) => Promise<void>;
  readonly clock: Clock;
  /** How many photos to send per drain. Bytes, so smaller than a push batch. */
  readonly batchSize?: number;
}

export interface UploadOutcome {
  readonly uploaded: number;
  /** Photos the server considered and refused. Each counts an attempt. */
  readonly refused: number;
  /** Set when the server could not be reached at all. */
  readonly offline: boolean;
  /** What the server said, when it answered and said no. */
  readonly problem?: string | undefined;
}

const DEFAULT_BATCH = 3;

export class PhotoUploader {
  private lastAttemptAt: Date | undefined;

  constructor(private readonly options: PhotoUploaderOptions) {}

  /** Photos still waiting, including any set aside. */
  async pendingCount(): Promise<number> {
    return this.options.queue.size();
  }

  async stuckCount(): Promise<number> {
    return (await this.options.queue.stuck()).length;
  }

  /** Put the set-aside photos back in the queue. */
  async retryStuck(): Promise<void> {
    const retired = await this.options.queue.stuck();
    await this.options.queue.revive(retired.map((photo) => photo.id));
  }

  async drain(): Promise<UploadOutcome> {
    const now = this.options.clock.now();
    const waiting = await this.options.queue.pending();
    const ready = drainableNow(waiting, now, this.lastAttemptAt).slice(
      0,
      this.options.batchSize ?? DEFAULT_BATCH,
    );

    if (ready.length === 0) return { uploaded: 0, refused: 0, offline: false };

    const settled: Ulid[] = [];
    let refused = 0;
    let problem: string | undefined;

    for (const photo of ready) {
      try {
        const upload = await this.options.transport.presign({
          ownerEntity: photo.ownerEntity,
          ownerId: photo.ownerId,
          attachmentId: photo.id,
          filename: photo.filename,
          contentType: photo.contentType,
          bytes: photo.body.length,
        });

        await this.options.transport.put(upload, photo.body);

        // The server's key, not the one the device derived. The two agree —
        // both come from `storageKey` — and taking the server's is what keeps
        // them agreeing if the derivation is ever changed on one side only.
        await this.options.onUploaded(photo, upload.key);
        settled.push(photo.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isPhotoUploadRefusal(error)) {
          // A verdict on this photograph: too large, an unsupported type, a
          // role that changed since it was taken. Counted, so it is retired
          // into the stuck list rather than retried until the sun burns out.
          await this.options.queue.fail(photo.id, message);
          refused += 1;
          problem ??= message;
          continue;
        }

        // No signal. Not this photo's fault, so it keeps its attempt count —
        // and the rest of the batch is abandoned, because the next one is
        // going to fail the same way and each attempt is a wasted radio wake.
        await this.options.queue.defer(photo.id, message);
        this.lastAttemptAt = now;
        await this.options.queue.settle(settled);
        return { uploaded: settled.length, refused, offline: true, problem };
      }
    }

    this.lastAttemptAt = now;
    await this.options.queue.settle(settled);
    return { uploaded: settled.length, refused, offline: false, problem };
  }
}
