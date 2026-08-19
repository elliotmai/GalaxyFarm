import { describe, expect, it } from "vitest";

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_EDGE,
  MAX_UPLOAD_BYTES,
  PhotoUploadRefused,
  compressedFilename,
  fitWithin,
  isAcceptedImageType,
  isPhotoUploadRefusal,
  keyBelongsToProperty,
  presignDownloadSchema,
  presignUploadSchema,
  presignedUploadSchema,
  shouldCompress,
  storageKey,
  uploadKeyFor,
  validate,
  type PresignUploadRequest,
  type Ulid,
} from "../src/index.js";

/**
 * The photo pipeline's rules (spec §4.2).
 *
 * Everything here is a decision rather than a pixel, which is exactly why it
 * lives in the kernel: a canvas needs a browser, and none of these answers do.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const ATTACHMENT = "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid;

const request: PresignUploadRequest = {
  ownerEntity: "Animal",
  ownerId: ANIMAL,
  attachmentId: ATTACHMENT,
  filename: "calf.jpg",
  contentType: "image/jpeg",
  bytes: 240_000,
};

describe("what may be attached", () => {
  it.each([...ACCEPTED_IMAGE_TYPES])("accepts %s", (type) => {
    expect(isAcceptedImageType(type)).toBe(true);
  });

  it("accepts a type however the phone capitalised it", () => {
    expect(isAcceptedImageType("IMAGE/JPEG")).toBe(true);
  });

  it("refuses a video, which is what a long press on a shutter produces", () => {
    expect(isAcceptedImageType("video/quicktime")).toBe(false);
  });

  it("refuses a PDF, which belongs on the documents path", () => {
    expect(isAcceptedImageType("application/pdf")).toBe(false);
  });
});

describe("fitting inside the long edge", () => {
  it("leaves an image that already fits alone", () => {
    expect(fitWithin({ width: 1200, height: 900 })).toEqual({ width: 1200, height: 900 });
  });

  it("scales the long edge down and keeps the aspect ratio", () => {
    const fitted = fitWithin({ width: 4032, height: 3024 });

    expect(fitted.width).toBe(MAX_IMAGE_EDGE);
    expect(fitted.height).toBe(1536);
  });

  it("works on a portrait photo, which is how a phone is actually held", () => {
    const fitted = fitWithin({ width: 3024, height: 4032 });

    expect(fitted.height).toBe(MAX_IMAGE_EDGE);
    expect(fitted.width).toBe(1536);
  });

  it("never rounds a panorama's short edge away to nothing", () => {
    // A canvas of zero height throws, and it would throw on the one photo
    // somebody took of the whole pasture.
    const fitted = fitWithin({ width: 8000, height: 200 }, 1024);

    expect(fitted.width).toBe(1024);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});

describe("whether re-encoding is worth it", () => {
  it("compresses anything off a phone camera", () => {
    expect(shouldCompress({ bytes: 4_000_000, source: { width: 4032, height: 3024 } })).toBe(true);
  });

  it("leaves a small thumbnail alone", () => {
    expect(shouldCompress({ bytes: 40_000, source: { width: 640, height: 480 } })).toBe(false);
  });

  it("compresses a small-dimensioned file that is somehow enormous", () => {
    // A 900px PNG screenshot can be several megabytes.
    expect(shouldCompress({ bytes: 3_000_000, source: { width: 900, height: 900 } })).toBe(true);
  });

  it("declines when nothing is known about the dimensions and the file is small", () => {
    expect(shouldCompress({ bytes: 40_000 })).toBe(false);
  });
});

describe("the filename after a re-encode", () => {
  it("follows the format, so a JPEG is not stored as .heic", () => {
    expect(compressedFilename("IMG_0421.HEIC")).toBe("IMG_0421.jpg");
  });

  it("adds an extension to a name that had none", () => {
    expect(compressedFilename("scan")).toBe("scan.jpg");
  });

  it("names a file that is nothing but an extension", () => {
    expect(compressedFilename(".jpeg")).toBe("photo.jpg");
  });

  it("uses the format's own suffix for anything that is not JPEG", () => {
    expect(compressedFilename("calf.png", "image/webp")).toBe("calf.webp");
  });
});

describe("the presign request", () => {
  it("accepts a well-formed one", () => {
    expect(validate(presignUploadSchema, request).ok).toBe(true);
  });

  it("refuses a content type that is not a photograph", () => {
    const parsed = validate(presignUploadSchema, { ...request, contentType: "application/zip" });

    expect(parsed.ok).toBe(false);
  });

  it("refuses more bytes than storage accepts, rather than signing for them", () => {
    // A signed URL is a bearer token; one issued for an arbitrary size is a
    // bucket somebody else can fill.
    const parsed = validate(presignUploadSchema, { ...request, bytes: MAX_UPLOAD_BYTES + 1 });

    expect(parsed.ok).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(validate(presignUploadSchema, { ...request, bytes: 0 }).ok).toBe(false);
  });

  it("refuses an id that is not a ULID", () => {
    expect(validate(presignUploadSchema, { ...request, ownerId: "dolly" }).ok).toBe(false);
  });

  it("has no way to name a key or a property", () => {
    const parsed = validate(presignUploadSchema, {
      ...request,
      key: "somebody-elses/photo.jpg",
      propertyId: OTHER_PROPERTY,
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && "key" in parsed.value).toBe(false);
    expect(parsed.ok && "propertyId" in parsed.value).toBe(false);
  });
});

describe("the key a request is signed for", () => {
  it("is the one the device derived, field for field", () => {
    // The device fills the record's key in offline, with no server to ask, and
    // the route derives it again. A disagreement is a photo at an address
    // nothing will ever look at.
    expect(uploadKeyFor(request, PROPERTY)).toBe(
      storageKey({
        propertyId: PROPERTY,
        entity: "Animal",
        recordId: ANIMAL,
        attachmentId: ATTACHMENT,
        filename: "calf.jpg",
      }),
    );
  });

  it("begins with the caller's own property", () => {
    expect(uploadKeyFor(request, PROPERTY).startsWith(`${PROPERTY}/`)).toBe(true);
  });
});

describe("which property an object belongs to", () => {
  it("accepts a key under the property's own prefix", () => {
    expect(keyBelongsToProperty(uploadKeyFor(request, PROPERTY), PROPERTY)).toBe(true);
  });

  it("refuses another property's", () => {
    expect(keyBelongsToProperty(uploadKeyFor(request, OTHER_PROPERTY), PROPERTY)).toBe(false);
  });

  it("refuses a property whose id merely starts the same way", () => {
    // `startsWith` alone hands one property the other's photographs.
    expect(keyBelongsToProperty(`${PROPERTY}EXTRA/Animal/a/b.jpg`, PROPERTY)).toBe(false);
  });

  it("refuses traversal outright rather than normalising it", () => {
    expect(keyBelongsToProperty(`${PROPERTY}/../${OTHER_PROPERTY}/x.jpg`, PROPERTY)).toBe(false);
  });

  it("refuses an absolute key", () => {
    expect(keyBelongsToProperty(`/${PROPERTY}/x.jpg`, PROPERTY)).toBe(false);
  });
});

describe("the download request", () => {
  it("needs a key", () => {
    expect(validate(presignDownloadSchema, { key: "" }).ok).toBe(false);
  });

  it("carries an optional download filename", () => {
    const parsed = validate(presignDownloadSchema, { key: "a/b.jpg", downloadAs: "calf.jpg" });

    expect(parsed.ok && parsed.value.downloadAs).toBe("calf.jpg");
  });
});

describe("the presign response", () => {
  const answer = {
    url: "https://bucket.example/farm/animal.jpg?X-Amz-Signature=abc",
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    expiresAt: "2026-06-01T10:15:00.000Z",
    key: `${PROPERTY}/Animal/${ANIMAL}/${ATTACHMENT}.jpg`,
  };

  it("revives the expiry as a date rather than leaving a string", () => {
    const parsed = validate(presignedUploadSchema, answer);

    expect(parsed.ok && parsed.value.expiresAt instanceof Date).toBe(true);
  });

  it("refuses an answer with no key, which would strand the photo", () => {
    expect(validate(presignedUploadSchema, { ...answer, key: "" }).ok).toBe(false);
  });

  it("refuses a verb the browser was not told to use", () => {
    expect(validate(presignedUploadSchema, { ...answer, method: "POST" }).ok).toBe(false);
  });
});

describe("telling a refusal from an outage", () => {
  it("recognises a refusal", () => {
    expect(isPhotoUploadRefusal(new PhotoUploadRefused(422, "too large"))).toBe(true);
  });

  it("does not mistake a dropped connection for one", () => {
    // The distinction is the whole retry policy: a refusal retires the photo,
    // an outage must not.
    expect(isPhotoUploadRefusal(new Error("Failed to fetch"))).toBe(false);
  });

  it("keeps the status it was refused with", () => {
    expect(new PhotoUploadRefused(413, "too large").status).toBe(413);
  });
});
