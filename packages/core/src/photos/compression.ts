/**
 * What a photo is allowed to be, and what it should be shrunk to (spec §4.2).
 *
 * §4.2 says photos are "compressed client-side, queued, and uploaded to R2 via
 * presigned URLs". The compressing itself needs a canvas and therefore a
 * browser; the *decisions* — is this a photo at all, is it worth re-encoding,
 * how big should the result be — need neither, so they live here where they
 * can be tested without one and where the presign route can apply the same
 * limits the client does.
 *
 * The numbers are chosen for the job rather than for image quality in the
 * abstract. A phone photograph of a calf is 3–8 MB straight off the camera and
 * is looked at on a phone, a laptop, or a barn screen — never printed. 2048px
 * on the long edge at JPEG quality 0.72 is around 300 KB, which is the
 * difference between an upload that finishes over one bar of signal on the way
 * back to the house and one that does not.
 */

/** What a file input will accept, and what the presign route will sign for. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Longest edge of the stored image, in pixels. */
export const MAX_IMAGE_EDGE = 2048;

/** JPEG quality for the re-encode. */
export const IMAGE_QUALITY = 0.72;

/** What everything is re-encoded to: the one format every surface can show. */
export const COMPRESSED_TYPE = "image/jpeg";

/**
 * The ceiling on what may be *picked*, before compression.
 *
 * Generous, because it is a guard against a video or a RAW file arriving
 * through a file input rather than a judgement about photographs — a 50 MB
 * original still compresses to something an upload can carry.
 */
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;

/**
 * The ceiling on what may be *stored*, after compression.
 *
 * Enforced at the presign route as well as on the client, because §4.5 clause
 * 2 does not trust a payload for having come from our own client, and because
 * a signed URL is a bearer token — one issued for an arbitrary number of bytes
 * is a bucket somebody else can fill.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isAcceptedImageType(contentType: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * The image scaled to fit inside a square of `maxEdge`, aspect ratio kept.
 *
 * Rounded rather than floored, and never below one pixel: a panorama 6000px
 * wide and 400px tall floors to a height of 136, and one 8000×200 floors to
 * zero — a canvas of zero height throws, and it would throw on the one photo
 * somebody took of a whole pasture rather than on anything a test would think
 * to try.
 */
export function fitWithin(source: Dimensions, maxEdge: number = MAX_IMAGE_EDGE): Dimensions {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge) return { width: source.width, height: source.height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Is re-encoding this worth doing?
 *
 * No, when the image is already inside the size limit *and* already small
 * enough on disk: re-encoding a 90 KB JPEG that is 800px wide costs quality
 * and saves nothing. Anything a phone camera produces fails both halves and is
 * compressed.
 */
export function shouldCompress(input: {
  readonly bytes: number;
  readonly source?: Dimensions | undefined;
  readonly maxEdge?: number | undefined;
  readonly ceilingBytes?: number | undefined;
}): boolean {
  const maxEdge = input.maxEdge ?? MAX_IMAGE_EDGE;
  const ceiling = input.ceilingBytes ?? 512 * 1024;

  if (input.bytes > ceiling) return true;
  if (input.source === undefined) return false;
  return Math.max(input.source.width, input.source.height) > maxEdge;
}

/**
 * The filename a compressed copy is stored under.
 *
 * The extension has to follow the re-encode, because `storageKey` derives the
 * object's extension from the filename and a JPEG stored as `.heic` is one no
 * browser will render — an image that uploaded perfectly and shows as a broken
 * tile, which is the worst way for this to fail.
 */
export function compressedFilename(filename: string, type: string = COMPRESSED_TYPE): string {
  const extension = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "bin");
  const stem = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  return `${stem === "" ? "photo" : stem}.${extension}`;
}
