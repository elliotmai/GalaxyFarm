/**
 * Photos and documents (spec §3, §4.2).
 *
 * Cloudflare R2 today, a NAS or MinIO at the farm later. §2's portability rule
 * makes that a swap of the adapter, which only holds if nothing above this port
 * knows what R2 is.
 *
 * Presigned URLs rather than proxying bytes through the app: §4.2 has photos
 * "compressed client-side, queued, uploaded to R2 via presigned URLs when
 * online", and a phone in a barn uploading through a serverless function would
 * pay for the round trip twice.
 */

export interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
  /** The key the record stores immediately, before the bytes arrive (§4.2). */
  readonly key: string;
}

export interface UploadRequest {
  readonly key: string;
  readonly contentType: string;
  readonly bytes?: number;
  /** Seconds. Short by default — a signed URL is a bearer token. */
  readonly expiresIn?: number;
}

export interface DownloadRequest {
  readonly key: string;
  readonly expiresIn?: number;
  /** Sets a download filename rather than rendering in the browser. */
  readonly downloadAs?: string;
}

export interface FileStorage {
  readonly name: string;
  /** A URL the client can PUT to directly. */
  presignUpload(request: UploadRequest): Promise<PresignedUpload>;
  /** A URL that reads one object, for a private bucket. */
  presignDownload(request: DownloadRequest): Promise<string>;
  delete(key: string): Promise<void>;
}

/**
 * Where an attachment's bytes live.
 *
 * Keys are derived rather than random so an object can be traced back to the
 * record that owns it from the bucket alone — which matters the first time
 * somebody is looking at storage costs and wants to know what all of it is.
 */
export function storageKey(input: {
  readonly propertyId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly attachmentId: string;
  readonly filename: string;
}): string {
  const extension = input.filename.includes(".")
    ? `.${input.filename.split(".").pop()?.toLowerCase() ?? ""}`
    : "";
  return `${input.propertyId}/${input.entity}/${input.recordId}/${input.attachmentId}${extension}`;
}
