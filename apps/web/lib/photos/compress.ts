import {
  COMPRESSED_TYPE,
  IMAGE_QUALITY,
  MAX_IMAGE_EDGE,
  MAX_ORIGINAL_BYTES,
  MAX_UPLOAD_BYTES,
  compressedFilename,
  fitWithin,
  isAcceptedImageType,
  shouldCompress,
  type Dimensions,
  type Result,
} from "@galaxy-farm/core";

/**
 * Shrinking a photograph before it goes anywhere (spec §4.2).
 *
 * §4.2 asks for photos "compressed client-side", and the reason is bandwidth
 * that does not exist: a phone camera produces 3–8 MB per shot, and the upload
 * happens over whatever signal the barn has, on a battery, in the background.
 * At 2048px and quality 0.72 the same photograph is about 300 KB and looks
 * identical on every screen this app is ever shown on.
 *
 * The decisions live in the kernel (`core/photos/compression.ts`) and the
 * drawing lives behind `ImageCodec`, which is injected. That split is what
 * makes this testable: a canvas needs a browser, jsdom has none, and the parts
 * worth testing — what is refused, when the original is kept, what happens
 * when a phone hands over a format the browser cannot decode — are all
 * decisions rather than pixels.
 */

export interface ShrunkImage {
  readonly body: Uint8Array;
  /** How big the image was before anything was done to it. */
  readonly source: Dimensions;
  /** How big the re-encoded copy is. */
  readonly drawn: Dimensions;
}

export interface ShrinkRequest {
  readonly maxEdge: number;
  readonly type: string;
  readonly quality: number;
}

export interface ImageCodec {
  shrink(file: Blob, request: ShrinkRequest): Promise<ShrunkImage>;
}

export interface CompressedPhoto {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

export interface PhotoProblem {
  readonly kind: "unsupported-type" | "too-large" | "unreadable";
  /** Said to the person holding the phone, so it names the file. */
  readonly message: string;
}

export interface CompressOptions {
  readonly codec?: ImageCodec;
  readonly maxEdge?: number;
  readonly quality?: number;
}

/**
 * `createImageBitmap` plus a canvas — the whole of the browser half.
 *
 * `OffscreenCanvas` where it exists, an element where it does not: iOS only
 * gained the former recently and a phone in a barn is the device this has to
 * work on, not the one it is developed on.
 */
export function browserCodec(): ImageCodec {
  return {
    async shrink(file, request) {
      const bitmap = await createImageBitmap(file);
      const source: Dimensions = { width: bitmap.width, height: bitmap.height };
      const drawn = fitWithin(source, request.maxEdge);

      try {
        const blob = await draw(bitmap, drawn, request);
        return { body: new Uint8Array(await blob.arrayBuffer()), source, drawn };
      } finally {
        // Bitmaps hold decoded pixels — several megabytes each — until they
        // are closed. A morning's photographs would otherwise sit in memory
        // until the tab was reloaded.
        bitmap.close();
      }
    },
  };
}

async function draw(
  bitmap: ImageBitmap,
  target: Dimensions,
  request: ShrinkRequest,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser has no 2D canvas to shrink photos with");

    context.drawImage(bitmap, 0, 0, target.width, target.height);
    return canvas.convertToBlob({ type: request.type, quality: request.quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext("2d");
  if (context === null) throw new Error("This browser has no 2D canvas to shrink photos with");
  context.drawImage(bitmap, 0, 0, target.width, target.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error("The photo could not be re-encoded")) : resolve(blob),
      request.type,
      request.quality,
    );
  });
}

/**
 * A picked file, ready to queue.
 *
 * Refusals are returned rather than thrown: every one of them is something to
 * say on screen next to the file it is about, and an exception here would
 * surface as "something went wrong" beside a photograph somebody has just
 * walked across a pasture to take.
 */
export async function compressPhoto(
  file: File,
  options: CompressOptions = {},
): Promise<Result<CompressedPhoto, PhotoProblem>> {
  if (!isAcceptedImageType(file.type)) {
    return {
      ok: false,
      error: {
        kind: "unsupported-type",
        message: `${file.name} is a ${file.type === "" ? "file of unknown type" : file.type}, and only photographs can be attached here.`,
      },
    };
  }

  if (file.size > MAX_ORIGINAL_BYTES) {
    return {
      ok: false,
      error: {
        kind: "too-large",
        message: `${file.name} is ${megabytes(file.size)} MB, which is larger than anything a camera produces. Attach the photo rather than the original file.`,
      },
    };
  }

  const original: CompressedPhoto = {
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    filename: file.name,
  };

  const codec = options.codec ?? browserCodec();
  const maxEdge = options.maxEdge ?? MAX_IMAGE_EDGE;

  let shrunk: ShrunkImage;
  try {
    shrunk = await codec.shrink(file, {
      maxEdge,
      type: COMPRESSED_TYPE,
      quality: options.quality ?? IMAGE_QUALITY,
    });
  } catch {
    /*
     * The browser could not decode it — in practice a HEIC from an iPhone
     * opened somewhere that is not Safari.
     *
     * The original is kept rather than the photograph refused. Safari, which
     * is what is actually held in the barn, decodes HEIC and re-encodes to
     * JPEG here like everything else; anywhere it cannot, an original that
     * uploads is worth more than a shot somebody has to take again, and the
     * bytes are already in hand.
     */
    return withinCeiling(original);
  }

  // Already small, in both senses. Re-encoding a 90 KB photograph that is
  // 800px wide spends quality and saves nothing.
  if (!shouldCompress({ bytes: file.size, source: shrunk.source, maxEdge })) {
    return withinCeiling(original);
  }

  // Compression that made it bigger is not compression. Small PNG line art
  // does this reliably, and the JPEG copy would be worse *and* heavier.
  if (shrunk.body.length >= original.body.length) return withinCeiling(original);

  return withinCeiling({
    body: shrunk.body,
    contentType: COMPRESSED_TYPE,
    // The extension follows the re-encode, or `storageKey` derives `.heic`
    // for a JPEG and every browser renders a broken tile for a file that
    // uploaded perfectly.
    filename: compressedFilename(file.name),
  });
}

/**
 * The last gate, applied to whichever copy won.
 *
 * The presign route enforces this too (§4.5 clause 2 does not trust our own
 * client), so failing here is what turns a server 422 nobody would see into a
 * sentence beside the photograph.
 */
function withinCeiling(photo: CompressedPhoto): Result<CompressedPhoto, PhotoProblem> {
  if (photo.body.length <= MAX_UPLOAD_BYTES) return { ok: true, value: photo };

  return {
    ok: false,
    error: {
      kind: "too-large",
      message: `${photo.filename} is still ${megabytes(photo.body.length)} MB after shrinking, which is more than storage accepts. Take the photo at a lower resolution.`,
    },
  };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
