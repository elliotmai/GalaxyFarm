import { describe, expect, it } from "vitest";

import { isPhotoUploadRefusal, type PresignUploadRequest, type Ulid } from "@galaxy-farm/core";

import { httpPhotoTransport } from "../lib/photos/transport.js";

/**
 * Carrying the bytes, and classifying what came back (spec §4.2).
 *
 * The classification is the whole of this file's judgement, and getting it
 * wrong is expensive in both directions: treat a 422 as an outage and the photo
 * is retried until the sun burns out; treat a 503 as a refusal and a morning's
 * work is retired because somebody had a variable unset.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const ATTACHMENT = "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid;

const request: PresignUploadRequest = {
  ownerEntity: "Animal",
  ownerId: ANIMAL,
  attachmentId: ATTACHMENT,
  filename: "calf.jpg",
  contentType: "image/jpeg",
  bytes: 3,
};

const signed = {
  url: "https://bucket.example/object?X-Amz-Signature=abc",
  method: "PUT",
  headers: { "Content-Type": "image/jpeg" },
  expiresAt: "2026-06-01T10:15:00.000Z",
  key: `${PROPERTY}/Animal/${ANIMAL}/${ATTACHMENT}.jpg`,
};

function answering(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init))) as unknown as typeof globalThis.fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("asking for somewhere to put a photo", () => {
  it("posts the request and revives the answer", async () => {
    let sent: unknown;
    const transport = httpPhotoTransport({
      fetch: answering((_url, init) => {
        sent = JSON.parse(String(init?.body));
        return json(signed);
      }),
    });

    const upload = await transport.presign(request);

    expect(sent).toEqual(request);
    expect(upload.key).toBe(signed.key);
    expect(upload.expiresAt).toBeInstanceOf(Date);
  });

  it("goes to the presign route by default", async () => {
    let asked = "";
    const transport = httpPhotoTransport({
      fetch: answering((url) => {
        asked = url;
        return json(signed);
      }),
    });

    await transport.presign(request);

    expect(asked).toBe("/api/storage/presign");
  });

  it("treats a 422 as a verdict on the photograph", async () => {
    const transport = httpPhotoTransport({
      fetch: answering(() => json({ error: "That is not something we can store" }, 422)),
    });

    await expect(transport.presign(request)).rejects.toSatisfy(isPhotoUploadRefusal);
  });

  it("repeats what the server said, rather than inventing an apology", async () => {
    const transport = httpPhotoTransport({
      fetch: answering(() => json({ error: "R2_BUCKET is not set" }, 400)),
    });

    await expect(transport.presign(request)).rejects.toThrow("R2_BUCKET is not set");
  });

  it("treats a 503 as something to try again later, not as a refusal", async () => {
    // An unconfigured bucket is somebody's afternoon, not this photo's fault.
    const transport = httpPhotoTransport({
      fetch: answering(() => json({ error: "Storage is unavailable" }, 503)),
    });

    await expect(transport.presign(request)).rejects.not.toSatisfy(isPhotoUploadRefusal);
  });

  it("still says something when the error body is not JSON", async () => {
    const transport = httpPhotoTransport({
      fetch: answering(() => new Response("<html>gateway</html>", { status: 502 })),
    });

    await expect(transport.presign(request)).rejects.toThrow("502");
  });

  it("refuses an answer that is not shaped like a signed upload", async () => {
    // The key on the way back is written onto a record somebody is looking at.
    const transport = httpPhotoTransport({
      fetch: answering(() => json({ url: signed.url })),
    });

    await expect(transport.presign(request)).rejects.toSatisfy(isPhotoUploadRefusal);
  });

  it("lets a dropped connection through as itself", async () => {
    const transport = httpPhotoTransport({
      fetch: (() => Promise.reject(new Error("Failed to fetch"))) as typeof globalThis.fetch,
    });

    await expect(transport.presign(request)).rejects.toThrow("Failed to fetch");
  });
});

describe("putting the bytes in the bucket", () => {
  const upload = {
    url: signed.url,
    method: "PUT" as const,
    headers: { "Content-Type": "image/jpeg" },
    expiresAt: new Date(signed.expiresAt),
    key: signed.key,
  };

  it("PUTs them straight to the signed address, not through the app", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const transport = httpPhotoTransport({
      fetch: answering((url, init) => {
        seen = { url, ...(init === undefined ? {} : { init }) };
        return new Response(null, { status: 200 });
      }),
    });

    await transport.put(upload, new Uint8Array([1, 2, 3]));

    expect(seen?.url).toBe(signed.url);
    expect(seen?.init?.method).toBe("PUT");
    expect((seen?.init?.body as ArrayBuffer).byteLength).toBe(3);
  });

  it("sends only the photo's own bytes, not the buffer behind them", async () => {
    // Bytes read back out of IndexedDB can sit on a larger backing buffer.
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = backing.subarray(2, 5);
    let sent = -1;
    const transport = httpPhotoTransport({
      fetch: answering((_url, init) => {
        sent = (init?.body as ArrayBuffer).byteLength;
        return new Response(null, { status: 200 });
      }),
    });

    await transport.put(upload, view);

    expect(sent).toBe(3);
  });

  it("counts a 403 from the bucket against the photo", async () => {
    const transport = httpPhotoTransport({
      fetch: answering(() => new Response(null, { status: 403 })),
    });

    await expect(transport.put(upload, new Uint8Array([1]))).rejects.toSatisfy(
      isPhotoUploadRefusal,
    );
  });

  it("does not count a 500 from the bucket against it", async () => {
    const transport = httpPhotoTransport({
      fetch: answering(() => new Response(null, { status: 500 })),
    });

    await expect(transport.put(upload, new Uint8Array([1]))).rejects.not.toSatisfy(
      isPhotoUploadRefusal,
    );
  });
});
