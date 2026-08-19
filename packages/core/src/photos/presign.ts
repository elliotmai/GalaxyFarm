import { z } from "zod";

import { ulidSchema, type Ulid } from "../types/ids.js";
import { storageKey, type DownloadRequest, type PresignedUpload } from "../ports/storage.js";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, isAcceptedImageType } from "./compression.js";

/**
 * What a device asks for when it wants somewhere to put a photo (spec §4.2).
 *
 * One schema, in the kernel, imported by the client that sends the request and
 * by the route handler that answers it — §4.5 clause 2, and for the reason it
 * gives: two schemas agree until the afternoon somebody changes one of them.
 * Here that afternoon would end with a signed URL whose key does not match the
 * key the record stored, and a photo that uploaded successfully to an address
 * nothing will ever look at.
 *
 * The request deliberately does **not** carry the key or the property. The key
 * is derived on the server from the session's property and the identifiers
 * below, because a client that can name its own key can write into another
 * property's prefix — the same hole `/api/sync/push` closes by taking the
 * property from the session and never from the payload.
 */

export interface PresignUploadRequest {
  /** Which aggregate the photo hangs off: `Animal`, `Equipment`, `Pet`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  /** The attachment record's id — already written locally by the time we ask. */
  readonly attachmentId: Ulid;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: number;
}

/*
 * Declared as an interface and cast, the way the entity schemas are.
 * `ulidSchema` transforms into a branded `Ulid`, and a `ZodEffects` whose
 * input and output differ infers back out of `z.infer` as the *input* — so
 * every id would arrive at `validate` as a plain string and the branding that
 * keeps a zone id out of an animal field would quietly stop meaning anything.
 */
export const presignUploadSchema = z.object({
  /** Which aggregate the photo hangs off: `Animal`, `Equipment`, `Pet`. */
  ownerEntity: z.string().min(1).max(60),
  ownerId: ulidSchema,
  /** The attachment record's id — already written locally by the time we ask. */
  attachmentId: ulidSchema,
  filename: z.string().min(1).max(255),
  contentType: z.string().refine(isAcceptedImageType, {
    message: `A photo has to be one of: ${ACCEPTED_IMAGE_TYPES.join(", ")}`,
  }),
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
}) as unknown as z.ZodType<PresignUploadRequest>;

/**
 * What comes back, parsed by the caller rather than trusted.
 *
 * The response crosses a boundary in the other direction, and the field that
 * matters is `key`: the device writes it onto the record it has already shown
 * somebody, so a malformed answer would leave a photograph pointing nowhere.
 * The route builds its body from the same schema, which is what keeps a
 * renamed field from becoming a runtime `undefined` on the device only.
 */
export const presignedUploadSchema = z.object({
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string()),
  expiresAt: z.coerce.date(),
  key: z.string().min(1),
}) as unknown as z.ZodType<PresignedUpload>;

/** Reading one back: a private bucket needs a signed URL for that too. */
export const presignDownloadSchema = z.object({
  key: z.string().min(1).max(1024),
  /** Sets a download filename rather than rendering in the browser. */
  downloadAs: z.string().min(1).max(255).optional(),
}) as unknown as z.ZodType<DownloadRequest>;

/**
 * The key a request will be signed for.
 *
 * Derived from the caller's own property, never taken from the body — see the
 * note above. Sharing the derivation with `storageKey` rather than formatting
 * a path here means the bucket layout is stated once.
 */
export function uploadKeyFor(request: PresignUploadRequest, propertyId: string): string {
  return storageKey({
    propertyId,
    entity: request.ownerEntity,
    recordId: request.ownerId,
    attachmentId: request.attachmentId,
    filename: request.filename,
  });
}

/**
 * May this property read this object?
 *
 * Keys begin with the property id (`storageKey`), so ownership is readable off
 * the key itself with no lookup — which matters because this runs on the read
 * path, in front of every photo tile on a screen.
 *
 * The check is on the whole first segment, not a prefix match: `01ABC/…` and
 * `01ABCDEF/…` share a prefix and are different properties, and `startsWith`
 * alone would hand the first one the second one's photographs. Traversal is
 * refused outright rather than normalised, because there is no legitimate key
 * containing `..` and quietly accepting one is how a bucket-wide read appears.
 */
export function keyBelongsToProperty(key: string, propertyId: string): boolean {
  if (key.includes("..") || key.startsWith("/")) return false;
  return key.split("/")[0] === propertyId;
}
