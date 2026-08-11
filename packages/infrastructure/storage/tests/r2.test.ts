import { describe, expect, it } from "vitest";

import { storageKey } from "@galaxy-farm/core";

import { amzDate, encodeKey, presign, r2Storage, rfc3986 } from "../src/r2.js";

/**
 * R2 presigning (spec §3, §4.2).
 *
 * The failure mode of a signer is a 403 hours later, from a phone in a barn
 * with a photo it cannot upload. So the signature is checked against fixed
 * inputs here rather than being discovered in production.
 */

const OPTIONS = {
  accountId: "acct",
  bucket: "galaxy-farm",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretexamplekey",
  now: () => new Date("2026-08-11T12:00:00Z"),
};

describe("amzDate", () => {
  it("uses SigV4's basic format", () => {
    expect(amzDate(new Date("2026-08-11T12:00:00.123Z"))).toBe("20260811T120000Z");
  });
});

describe("rfc3986", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    // `!'()*` are unreserved to encodeURIComponent and reserved to SigV4. A
    // filename with a bracket would sign one way and be sent another, and the
    // 403 looks like a credentials problem.
    expect(rfc3986("a(b)c!")).toBe("a%28b%29c%21");
  });

  it("leaves the genuinely unreserved set alone", () => {
    expect(rfc3986("abc-123_x.y~z")).toBe("abc-123_x.y~z");
  });
});

describe("encodeKey", () => {
  it("encodes segments but not the separators", () => {
    // A slash-encoded key addresses a different object entirely.
    expect(encodeKey("prop/animals/rec/my photo.jpg")).toBe("prop/animals/rec/my%20photo.jpg");
  });
});

describe("presign", () => {
  const request = {
    method: "PUT" as const,
    host: "acct.r2.cloudflarestorage.com",
    path: "/galaxy-farm/a/b.jpg",
    region: "auto",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secretexamplekey",
    at: new Date("2026-08-11T12:00:00Z"),
    expiresIn: 900,
  };

  it("produces the same signature for the same inputs", () => {
    expect(presign(request)).toBe(presign(request));
  });

  it("carries every parameter the server will check", () => {
    const url = presign(request);

    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Credential=AKIAEXAMPLE%2F20260811%2Fauto%2Fs3%2Faws4_request");
    expect(url).toContain("X-Amz-Date=20260811T120000Z");
    expect(url).toContain("X-Amz-Expires=900");
    expect(url).toContain("X-Amz-SignedHeaders=host");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("sorts the query, because the order is part of what is signed", () => {
    const url = presign({
      ...request,
      extraQuery: { "response-content-disposition": "attachment" },
    });
    const query = url
      .slice(url.indexOf("?") + 1)
      .split("&")
      .map((pair) => pair.split("=")[0]);
    const signed = query.filter((key) => key !== "X-Amz-Signature");

    expect(signed).toEqual([...signed].sort());
  });

  it("signs a different signature for a different key", () => {
    const other = presign({ ...request, path: "/galaxy-farm/a/c.jpg" });
    expect(other).not.toBe(presign(request));
  });

  it("signs a different signature for a different method", () => {
    // Otherwise an upload URL would also delete.
    expect(presign({ ...request, method: "DELETE" })).not.toBe(presign(request));
  });

  it("signs a different signature under a different secret", () => {
    expect(presign({ ...request, secretAccessKey: "other" })).not.toBe(presign(request));
  });
});

describe("r2Storage", () => {
  it("returns a PUT URL and the key the record stores immediately", async () => {
    // §4.2: the record holds the key before the bytes arrive and renders a
    // placeholder until they do.
    const upload = await r2Storage(OPTIONS).presignUpload({
      key: "prop/animals/rec/photo.jpg",
      contentType: "image/jpeg",
    });

    expect(upload.method).toBe("PUT");
    expect(upload.key).toBe("prop/animals/rec/photo.jpg");
    expect(upload.url).toContain("/galaxy-farm/prop/animals/rec/photo.jpg?");
    expect(upload.expiresAt).toEqual(new Date("2026-08-11T12:15:00Z"));
  });

  it("sends the content type without signing it", () => {
    // A browser that normalises the header differently would otherwise get a
    // 403 it cannot explain.
    return r2Storage(OPTIONS)
      .presignUpload({ key: "a.jpg", contentType: "image/jpeg" })
      .then((upload) => {
        expect(upload.headers["Content-Type"]).toBe("image/jpeg");
        expect(upload.url).not.toContain("content-type");
      });
  });

  it("honours a shorter expiry, since a signed URL is a bearer token", async () => {
    const upload = await r2Storage(OPTIONS).presignUpload({
      key: "a.jpg",
      contentType: "image/jpeg",
      expiresIn: 60,
    });

    expect(upload.url).toContain("X-Amz-Expires=60");
    expect(upload.expiresAt).toEqual(new Date("2026-08-11T12:01:00Z"));
  });

  it("adds a download disposition when a filename is asked for", async () => {
    const url = await r2Storage(OPTIONS).presignDownload({
      key: "a.pdf",
      downloadAs: "Liability form.pdf",
    });

    expect(url).toContain("response-content-disposition=");
    expect(decodeURIComponent(url)).toContain('attachment; filename="Liability form.pdf"');
  });

  it("points at a different endpoint when one is given, for MinIO later", async () => {
    // §10's move home. If this needed a code change it would not be a move.
    const url = await r2Storage({ ...OPTIONS, endpoint: "https://nas.local:9000" }).presignDownload(
      {
        key: "a.jpg",
      },
    );

    expect(url.startsWith("https://nas.local:9000/galaxy-farm/a.jpg?")).toBe(true);
  });
});

describe("storageKey", () => {
  it("traces an object back to the record that owns it", () => {
    // Which matters the first time somebody is looking at a storage bill and
    // wants to know what all of it is.
    expect(
      storageKey({
        propertyId: "P1",
        entity: "animals",
        recordId: "A1",
        attachmentId: "T1",
        filename: "Andromeda.JPEG",
      }),
    ).toBe("P1/animals/A1/T1.jpeg");
  });

  it("copes with a filename that has no extension", () => {
    expect(
      storageKey({
        propertyId: "P1",
        entity: "animals",
        recordId: "A1",
        attachmentId: "T1",
        filename: "scan",
      }),
    ).toBe("P1/animals/A1/T1");
  });
});
