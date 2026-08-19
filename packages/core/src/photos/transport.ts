import type { PresignedUpload } from "../ports/storage.js";
import type { PresignUploadRequest } from "./presign.js";

/**
 * How a device gets photo bytes into the bucket (spec §4.2).
 *
 * Two steps, both of them the app's to implement: ask our own server to sign
 * an address, then PUT the bytes straight to R2. The uploader that drives them
 * knows neither URL, which is what lets the whole offline-then-sync path be
 * tested against a transport that refuses, stalls, and comes back — the only
 * way to have any confidence in behaviour that misbehaves solely on a bad
 * connection in a metal barn.
 */

export interface PhotoUploadTransport {
  presign(request: PresignUploadRequest): Promise<PresignedUpload>;
  put(upload: PresignedUpload, body: Uint8Array): Promise<void>;
}

/**
 * The server answered, and the answer was no.
 *
 * The same distinction `SyncServerError` draws, for the same reason: a refusal
 * is a verdict on this photo — too large, wrong type, a role that has since
 * changed — and retrying it forever would keep a queue full of work that can
 * never leave. No signal is not a verdict on anything, and a photo taken in a
 * pasture must not be retired for it.
 */
export class PhotoUploadRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PhotoUploadRefused";
  }
}

export function isPhotoUploadRefusal(error: unknown): error is PhotoUploadRefused {
  return error instanceof PhotoUploadRefused;
}
