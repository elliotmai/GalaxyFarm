import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor, Role, Ulid } from "@galaxy-farm/core";

/**
 * `/api/storage/upload` — the photo's bytes, relayed to the bucket
 * (spec §4.2, decision 43).
 *
 * The same rules as naming the key: only a writer, only under the caller's own
 * property, only a photograph of a size storage accepts. And a bucket refusal
 * stays a refusal, so the device sets the photo aside rather than retrying it
 * forever.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const KEY = `${PROPERTY}/Animal/01ARZ3NDEKTSV4RRFFQ69G5FA1/01ARZ3NDEKTSV4RRFFQ69G5FB1.jpg`;

const session = vi.hoisted(() => ({ actor: undefined as Actor | undefined }));
const bucket = vi.hoisted(() => ({
  configured: true,
  answer: 200,
  puts: [] as { url: string; type: string | null; bytes: number }[],
}));

vi.mock("@/lib/auth", () => ({ currentActor: async () => session.actor }));

vi.mock("@/lib/storage", () => ({
  storageConfig: () =>
    bucket.configured ? { ok: true } : { ok: false, reason: "R2_BUCKET is not set" },
  fileStorage: () =>
    bucket.configured
      ? {
          name: "cloudflare-r2",
          presignUpload: async (request: { key: string; contentType: string }) => ({
            url: `https://bucket.example/${request.key}?X-Amz-Signature=abc`,
            method: "PUT" as const,
            headers: { "Content-Type": request.contentType },
            expiresAt: new Date("2026-06-01T10:15:00Z"),
            key: request.key,
          }),
          presignDownload: async () => "",
          delete: async () => {},
        }
      : undefined,
}));

const { PUT } = await import("../app/api/storage/upload/route.js");

const actor = (role: Role): Actor =>
  ({ id: "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid, role, propertyId: PROPERTY }) as Actor;

const put = (key: string, type = "image/jpeg", bytes = new Uint8Array([1, 2, 3, 4])) =>
  PUT(
    new Request(`https://farm.example/api/storage/upload?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": type },
      body: bytes,
    }),
  );

beforeEach(() => {
  session.actor = actor("owner");
  bucket.configured = true;
  bucket.answer = 200;
  bucket.puts = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    bucket.puts.push({
      url,
      type: headers.get("content-type"),
      bytes: (init.body as Uint8Array).byteLength,
    });
    return new Response("", { status: bucket.answer });
  });
});

describe("relaying a photo", () => {
  it("forwards the bytes to the bucket, signed for the same key", async () => {
    const response = await put(KEY);

    expect(response.status).toBe(200);
    expect(bucket.puts).toEqual([
      {
        url: expect.stringContaining(`https://bucket.example/${KEY}`),
        type: "image/jpeg",
        bytes: 4,
      },
    ]);
  });

  it("will not write under another property's prefix", async () => {
    const response = await put(KEY.replace(PROPERTY, OTHER));
    expect(response.status).toBe(404);
    expect(bucket.puts).toHaveLength(0);
  });

  it("refuses anyone who cannot write", async () => {
    session.actor = actor("kiosk");
    expect((await put(KEY)).status).toBe(403);
    session.actor = undefined;
    expect((await put(KEY)).status).toBe(401);
    expect(bucket.puts).toHaveLength(0);
  });

  it("refuses something that is not a photograph", async () => {
    expect((await put(KEY, "application/pdf")).status).toBe(415);
  });

  it("keeps a bucket refusal a refusal, and an outage an outage", async () => {
    bucket.answer = 403;
    expect((await put(KEY)).status).toBe(403);
    bucket.answer = 500;
    expect((await put(KEY)).status).toBe(502);
  });

  it("says storage is not configured rather than pretending", async () => {
    bucket.configured = false;
    const response = await put(KEY);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain("R2_BUCKET");
  });
});
