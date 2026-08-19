import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageKey, type Actor, type Role, type Ulid } from "@galaxy-farm/core";

/**
 * `/api/storage/presign` (spec §4.2, §4.3, §4.5).
 *
 * Three things are being held here, and all three are the kind that fail
 * quietly rather than loudly:
 *
 * - the property comes from the session and never from the payload, so one
 *   property cannot write into another's prefix;
 * - the same rule applies to reading, where the key alone says who owns it;
 * - a bucket nobody has configured answers with the sentence naming the unset
 *   variables, not a 500 that reads as a broken upload path.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const ATTACHMENT = "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid;

const session = vi.hoisted(() => ({
  actor: undefined as Actor | undefined,
}));
const bucket = vi.hoisted(() => ({
  configured: true,
  signed: [] as { key: string; contentType: string }[],
  downloads: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  currentActor: async () => session.actor,
}));

vi.mock("@/lib/storage", () => ({
  storageConfig: () =>
    bucket.configured ? { ok: true } : { ok: false, reason: "R2_BUCKET is not set" },
  fileStorage: () =>
    bucket.configured
      ? {
          name: "cloudflare-r2",
          presignUpload: async (request: { key: string; contentType: string }) => {
            bucket.signed.push(request);
            return {
              url: `https://bucket.example/${request.key}?X-Amz-Signature=abc`,
              method: "PUT" as const,
              headers: { "Content-Type": request.contentType },
              expiresAt: new Date("2026-06-01T10:15:00Z"),
              key: request.key,
            };
          },
          presignDownload: async (request: { key: string }) => {
            bucket.downloads.push(request.key);
            return `https://bucket.example/${request.key}?X-Amz-Signature=def`;
          },
          delete: async () => {},
        }
      : undefined,
}));

const { GET, POST } = await import("../app/api/storage/presign/route.js");

const actor = (role: Role, propertyId: Ulid = PROPERTY): Actor =>
  ({ id: "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid, role, propertyId }) as Actor;

const body = {
  ownerEntity: "Animal",
  ownerId: ANIMAL,
  attachmentId: ATTACHMENT,
  filename: "calf.jpg",
  contentType: "image/jpeg",
  bytes: 240_000,
};

const post = (payload: unknown) =>
  POST(
    new Request("https://farm.example/api/storage/presign", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );

const get = (query: string) =>
  GET(new Request(`https://farm.example/api/storage/presign?${query}`));

beforeEach(() => {
  session.actor = actor("owner");
  bucket.configured = true;
  bucket.signed = [];
  bucket.downloads = [];
});

describe("who may ask for somewhere to put a photo", () => {
  it("refuses a caller with no session", async () => {
    session.actor = undefined;

    expect((await post(body)).status).toBe(401);
  });

  it("refuses a kiosk, whose writes are three whitelisted actions", async () => {
    session.actor = actor("kiosk");

    expect((await post(body)).status).toBe(403);
  });

  it("refuses a housesitter", async () => {
    session.actor = actor("housesitter");

    expect((await post(body)).status).toBe(403);
  });

  it("allows a member", async () => {
    session.actor = actor("member");

    expect((await post(body)).status).toBe(200);
  });
});

describe("the key it signs for", () => {
  it("derives it from the session's property, not from anything sent", async () => {
    await post({ ...body, key: `${OTHER}/anything.jpg`, propertyId: OTHER });

    expect(bucket.signed[0]?.key).toBe(
      storageKey({
        propertyId: PROPERTY,
        entity: "Animal",
        recordId: ANIMAL,
        attachmentId: ATTACHMENT,
        filename: "calf.jpg",
      }),
    );
  });

  it("hands back the key, so the record can be corrected to match", async () => {
    const response = await post(body);
    const answer = (await response.json()) as { key: string; method: string };

    expect(answer.key).toBe(bucket.signed[0]?.key);
    expect(answer.method).toBe("PUT");
  });
});

describe("what it refuses to sign", () => {
  it("refuses a file that is not a photograph", async () => {
    const response = await post({ ...body, contentType: "application/zip" });

    expect(response.status).toBe(422);
    expect(bucket.signed).toEqual([]);
  });

  it("refuses more bytes than storage accepts, however the client validated", async () => {
    // §4.5 clause 2: data is not trusted for having come from our own client,
    // and a signed URL for an arbitrary size is a bucket somebody can fill.
    const response = await post({ ...body, bytes: 900 * 1024 * 1024 });

    expect(response.status).toBe(422);
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await POST(
      new Request("https://farm.example/api/storage/presign", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("with no bucket configured", () => {
  it("says which variables are unset, and does not pretend to have signed", async () => {
    bucket.configured = false;

    const response = await post(body);
    const answer = (await response.json()) as { error: string; kind: string };

    expect(response.status).toBe(503);
    expect(answer.error).toContain("R2_BUCKET");
    expect(answer.kind).toBe("storage-unconfigured");
  });

  it("answers a read the same way", async () => {
    bucket.configured = false;

    expect((await get(`key=${PROPERTY}/Animal/x.jpg`)).status).toBe(503);
  });
});

describe("reading one back", () => {
  it("signs a URL for an object in the caller's own property", async () => {
    const key = `${PROPERTY}/Animal/${ANIMAL}/${ATTACHMENT}.jpg`;

    const response = await get(`key=${encodeURIComponent(key)}`);

    expect(response.status).toBe(200);
    expect(bucket.downloads).toEqual([key]);
  });

  it("refuses a session-less reader", async () => {
    session.actor = undefined;

    expect((await get("key=a/b.jpg")).status).toBe(401);
  });

  it("lets a housesitter see a photo, because the pen board shows them", async () => {
    session.actor = actor("housesitter");

    expect((await get(`key=${PROPERTY}/Animal/x.jpg`)).status).toBe(200);
  });

  it("will not read another property's object, and does not confirm it exists", async () => {
    const response = await get(`key=${OTHER}/Animal/x.jpg`);

    expect(response.status).toBe(404);
    expect(bucket.downloads).toEqual([]);
  });

  it("refuses a key that tries to climb out of its own prefix", async () => {
    const response = await get(`key=${encodeURIComponent(`${PROPERTY}/../${OTHER}/x.jpg`)}`);

    expect(response.status).toBe(404);
  });

  it("asks for a key rather than signing an empty one", async () => {
    expect((await get("")).status).toBe(422);
  });

  it("passes a download filename through when one is asked for", async () => {
    const response = await get(`key=${PROPERTY}/Animal/x.jpg&downloadAs=calf.jpg`);

    expect(response.status).toBe(200);
  });
});
