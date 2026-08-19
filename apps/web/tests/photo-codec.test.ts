// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPRESSED_TYPE } from "@galaxy-farm/core";

import { browserCodec } from "../lib/photos/compress.js";

/**
 * The browser half of shrinking a photograph (spec §4.2).
 *
 * jsdom has no canvas, so both drawing surfaces are stubbed — which is enough,
 * because what is under test is not whether pixels are resampled correctly. It
 * is the three things that decide whether a phone in a barn can attach a photo
 * at all: that the image is drawn at the size `fitWithin` worked out, that a
 * browser without `OffscreenCanvas` still gets there (iOS gained it late, and
 * iOS is the device this runs on), and that the decoded bitmap is released —
 * a morning's photographs left open is tens of megabytes of decoded pixels.
 */

interface Drawn {
  readonly width: number;
  readonly height: number;
  readonly type: string;
  readonly quality: number;
}

const globals = globalThis as unknown as Record<string, unknown>;
const original = {
  createImageBitmap: globals["createImageBitmap"],
  OffscreenCanvas: globals["OffscreenCanvas"],
};

/** A blob whose bytes can actually be read back; jsdom's cannot. */
function blob(bytes: number, type: string): Blob {
  return {
    type,
    size: bytes,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  } as unknown as Blob;
}

function stubBitmap(source: { width: number; height: number }) {
  const closed = { count: 0 };
  globals["createImageBitmap"] = () =>
    Promise.resolve({ ...source, close: () => (closed.count += 1) });
  return closed;
}

function stubOffscreen(drawn: Drawn[], encoded = 120_000) {
  globals["OffscreenCanvas"] = class {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return {
        drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
          drawn.push({ width, height, type: "", quality: 0 });
        },
      };
    }
    convertToBlob(options: { type: string; quality: number }) {
      const last = drawn.pop();
      if (last !== undefined) drawn.push({ ...last, ...options });
      return Promise.resolve(blob(encoded, options.type));
    }
  };
}

afterEach(() => {
  globals["createImageBitmap"] = original.createImageBitmap;
  globals["OffscreenCanvas"] = original.OffscreenCanvas;
  vi.restoreAllMocks();
});

describe("on a browser with OffscreenCanvas", () => {
  it("draws at the size the long-edge limit works out", async () => {
    stubBitmap({ width: 4032, height: 3024 });
    const drawn: Drawn[] = [];
    stubOffscreen(drawn);

    const shrunk = await browserCodec().shrink(blob(4_000_000, "image/jpeg"), {
      maxEdge: 2048,
      type: COMPRESSED_TYPE,
      quality: 0.72,
    });

    expect(drawn[0]).toMatchObject({
      width: 2048,
      height: 1536,
      type: "image/jpeg",
      quality: 0.72,
    });
    expect(shrunk.source).toEqual({ width: 4032, height: 3024 });
    expect(shrunk.drawn).toEqual({ width: 2048, height: 1536 });
    expect(shrunk.body.length).toBe(120_000);
  });

  it("releases the decoded bitmap rather than holding the morning in memory", async () => {
    const closed = stubBitmap({ width: 4032, height: 3024 });
    stubOffscreen([]);

    await browserCodec().shrink(blob(4_000_000, "image/jpeg"), {
      maxEdge: 2048,
      type: COMPRESSED_TYPE,
      quality: 0.72,
    });

    expect(closed.count).toBe(1);
  });

  it("releases it even when the encode fails", async () => {
    const closed = stubBitmap({ width: 4032, height: 3024 });
    globals["OffscreenCanvas"] = class {
      getContext() {
        return null;
      }
    };

    await expect(
      browserCodec().shrink(blob(1, "image/jpeg"), {
        maxEdge: 2048,
        type: COMPRESSED_TYPE,
        quality: 0.72,
      }),
    ).rejects.toThrow("no 2D canvas");
    expect(closed.count).toBe(1);
  });
});

describe("on a browser without it", () => {
  it("falls back to a canvas element", async () => {
    stubBitmap({ width: 3024, height: 4032 });
    globals["OffscreenCanvas"] = undefined;

    const drawn: Drawn[] = [];
    vi.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: (_i: unknown, _x: number, _y: number, width: number, height: number) => {
              drawn.push({ width, height, type: "", quality: 0 });
            },
          }),
          toBlob: (done: (result: Blob) => void, type: string) => done(blob(90_000, type)),
        }) as unknown as HTMLElement,
    );

    const shrunk = await browserCodec().shrink(blob(3_000_000, "image/jpeg"), {
      maxEdge: 2048,
      type: COMPRESSED_TYPE,
      quality: 0.72,
    });

    // Portrait, which is how a phone is actually held.
    expect(drawn[0]).toMatchObject({ width: 1536, height: 2048 });
    expect(shrunk.body.length).toBe(90_000);
  });

  it("says so when there is no 2D context to draw on either", async () => {
    stubBitmap({ width: 100, height: 100 });
    globals["OffscreenCanvas"] = undefined;
    vi.spyOn(document, "createElement").mockImplementation(
      () => ({ getContext: () => null }) as unknown as HTMLElement,
    );

    await expect(
      browserCodec().shrink(blob(1, "image/jpeg"), {
        maxEdge: 2048,
        type: COMPRESSED_TYPE,
        quality: 0.72,
      }),
    ).rejects.toThrow("no 2D canvas");
  });

  it("reports an encode that produced nothing, rather than uploading nothing", async () => {
    stubBitmap({ width: 100, height: 100 });
    globals["OffscreenCanvas"] = undefined;
    vi.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          getContext: () => ({ drawImage: () => {} }),
          toBlob: (done: (result: Blob | null) => void) => done(null),
        }) as unknown as HTMLElement,
    );

    await expect(
      browserCodec().shrink(blob(1, "image/jpeg"), {
        maxEdge: 2048,
        type: COMPRESSED_TYPE,
        quality: 0.72,
      }),
    ).rejects.toThrow("could not be re-encoded");
  });
});
