import { describe, expect, it } from "vitest";

import { MAX_ORIGINAL_BYTES, MAX_UPLOAD_BYTES } from "@galaxy-farm/core";

import { compressPhoto, type ImageCodec, type ShrunkImage } from "../lib/photos/compress.js";

/**
 * Shrinking a photograph before it goes anywhere (spec §4.2).
 *
 * The canvas is injected, so what is under test here is every decision around
 * it: what is refused, when the original is kept, and — the one that matters
 * on a phone — what happens when the browser cannot decode the format the
 * camera produced.
 */

function file(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A codec that always produces `size` bytes at the dimensions it is told. */
function codec(
  source: { width: number; height: number },
  size: number,
): ImageCodec & { calls: number } {
  const stub = {
    calls: 0,
    async shrink(_file: Blob, request: { maxEdge: number }): Promise<ShrunkImage> {
      stub.calls += 1;
      const longest = Math.max(source.width, source.height);
      const scale = longest > request.maxEdge ? request.maxEdge / longest : 1;
      return {
        body: new Uint8Array(size),
        source,
        drawn: {
          width: Math.round(source.width * scale),
          height: Math.round(source.height * scale),
        },
      };
    },
  };
  return stub;
}

const broken: ImageCodec = {
  shrink: () => Promise.reject(new Error("The source image format is not supported")),
};

describe("what is refused before anything is decoded", () => {
  it("refuses a video, and says so about that file by name", async () => {
    const result = await compressPhoto(file("barn.mov", "video/quicktime", 10), {
      codec: codec({ width: 100, height: 100 }, 10),
    });

    expect(result.ok).toBe(false);
    expect(result.ok || result.error.kind).toBe("unsupported-type");
    expect(result.ok || result.error.message).toContain("barn.mov");
  });

  it("says something useful about a file with no type at all", async () => {
    const result = await compressPhoto(file("scan", "", 10), {});

    expect(result.ok || result.error.message).toContain("unknown type");
  });

  it("refuses something far larger than a camera produces", async () => {
    const result = await compressPhoto(file("raw.jpg", "image/jpeg", MAX_ORIGINAL_BYTES + 1), {
      codec: codec({ width: 8000, height: 6000 }, 100),
    });

    expect(result.ok || result.error.kind).toBe("too-large");
  });
});

describe("shrinking what a phone actually produces", () => {
  it("re-encodes a camera photo and keeps the smaller copy", async () => {
    const result = await compressPhoto(file("IMG_0421.jpg", "image/jpeg", 4_000_000), {
      codec: codec({ width: 4032, height: 3024 }, 280_000),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.body.length).toBe(280_000);
    expect(result.ok && result.value.contentType).toBe("image/jpeg");
  });

  it("renames a HEIC to match the JPEG it has become", async () => {
    // `storageKey` derives the object's extension from the filename, so a JPEG
    // stored as `.heic` renders as a broken tile everywhere.
    const result = await compressPhoto(file("IMG_0421.HEIC", "image/heic", 3_000_000), {
      codec: codec({ width: 4032, height: 3024 }, 250_000),
    });

    expect(result.ok && result.value.filename).toBe("IMG_0421.jpg");
    expect(result.ok && result.value.contentType).toBe("image/jpeg");
  });

  it("leaves a small photo alone rather than spending quality on it", async () => {
    const shrink = codec({ width: 640, height: 480 }, 20_000);

    const result = await compressPhoto(file("thumb.jpg", "image/jpeg", 40_000), { codec: shrink });

    expect(result.ok && result.value.body.length).toBe(40_000);
    expect(result.ok && result.value.filename).toBe("thumb.jpg");
  });

  it("keeps the original when the re-encode came out bigger", async () => {
    // Small PNG line art does this reliably, and the JPEG copy would be worse
    // *and* heavier.
    const result = await compressPhoto(file("chart.png", "image/png", 600_000), {
      codec: codec({ width: 900, height: 900 }, 900_000),
    });

    expect(result.ok && result.value.body.length).toBe(600_000);
    expect(result.ok && result.value.contentType).toBe("image/png");
  });

  it("refuses a photo still too big for storage after shrinking", async () => {
    const result = await compressPhoto(file("huge.jpg", "image/jpeg", 40_000_000), {
      codec: codec({ width: 12000, height: 9000 }, MAX_UPLOAD_BYTES + 1),
    });

    expect(result.ok || result.error.kind).toBe("too-large");
    expect(result.ok || result.error.message).toContain("after shrinking");
  });
});

describe("when the browser cannot decode it", () => {
  it("keeps the original rather than losing the photograph", async () => {
    // A HEIC opened somewhere that is not Safari. An original that uploads is
    // worth more than a shot somebody has to walk back out and take again.
    const result = await compressPhoto(file("IMG_0500.HEIC", "image/heic", 2_000_000), {
      codec: broken,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.contentType).toBe("image/heic");
    expect(result.ok && result.value.body.length).toBe(2_000_000);
  });

  it("still refuses one that is over the storage limit undecoded", async () => {
    const result = await compressPhoto(file("IMG_0500.HEIC", "image/heic", MAX_UPLOAD_BYTES + 1), {
      codec: broken,
    });

    expect(result.ok || result.error.kind).toBe("too-large");
  });
});
