import { describe, expect, it } from "vitest";

import {
  storageKey,
  validate,
  attachmentSchema,
  type Attachment,
  type Ulid,
} from "@galaxy-farm/core";

import { coverPhoto, photoAttachment, photosOf, queuedPhoto } from "../lib/photos/attachments.js";

/**
 * The record half of a photograph (spec §4.2).
 *
 * The property under test is the one that makes the offline path work at all:
 * a device with no server to ask still knows the key, because the key is
 * derived rather than issued — and the presign route derives the same one.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const OTHER_ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA2" as Ulid;
const at = new Date("2026-06-01T10:00:00Z");

const input = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid,
  propertyId: PROPERTY,
  ownerEntity: "Animal",
  ownerId: ANIMAL,
  photo: {
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    filename: "calf.jpg",
  },
  at,
};

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  ...photoAttachment(input),
  ...overrides,
});

describe("the attachment a photograph produces", () => {
  it("is valid against the shared schema, so it can be created offline", () => {
    expect(validate(attachmentSchema, photoAttachment(input)).ok).toBe(true);
  });

  it("carries the key from the moment the shutter closes", () => {
    expect(photoAttachment(input).key).toBe(
      storageKey({
        propertyId: PROPERTY,
        entity: "Animal",
        recordId: ANIMAL,
        attachmentId: input.id,
        filename: "calf.jpg",
      }),
    );
  });

  it("starts unuploaded, which is what puts a placeholder on the screen", () => {
    expect(photoAttachment(input).uploaded).toBe(false);
  });

  it("records the size of what will actually be sent", () => {
    expect(photoAttachment(input).bytes).toBe(3);
  });
});

describe("the queue entry beside it", () => {
  it("shares the record's id, so each is findable from the other", () => {
    expect(queuedPhoto(input).id).toBe(photoAttachment(input).id);
  });

  it("holds the bytes, and starts with no attempts against it", () => {
    const queued = queuedPhoto(input);

    expect([...queued.body]).toEqual([1, 2, 3]);
    expect(queued.attempts).toBe(0);
    expect(queued.queuedAt).toEqual(at);
  });
});

describe("one record's photographs", () => {
  const mine = attachment({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid });
  const alsoMine = attachment({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB2" as Ulid, uploaded: true });
  const somebodyElses = attachment({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB3" as Ulid,
    ownerId: OTHER_ANIMAL,
  });
  const paperwork = attachment({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB4" as Ulid,
    contentType: "application/pdf",
    filename: "registration.pdf",
  });
  const equipment = attachment({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB5" as Ulid,
    ownerEntity: "Equipment",
  });

  it("is only this record's", () => {
    const found = photosOf([mine, somebodyElses], "Animal", ANIMAL);

    expect(found.map((photo) => photo.id)).toEqual([mine.id]);
  });

  it("does not cross aggregates that happen to share an id", () => {
    const found = photosOf([mine, equipment], "Animal", ANIMAL);

    expect(found.map((photo) => photo.id)).toEqual([mine.id]);
  });

  it("leaves the paperwork out of the gallery", () => {
    // Attachment is polymorphic — registration papers and receipts hang off the
    // same animal, and none of them belongs in a grid of photos.
    expect(photosOf([mine, paperwork], "Animal", ANIMAL).map((p) => p.id)).toEqual([mine.id]);
  });

  it("is ordered by when each was taken, not by when it finished uploading", () => {
    // Ordering by `updatedAt` reshuffles the grid as uploads land, so the tiles
    // move under somebody's thumb.
    const found = photosOf([alsoMine, mine], "Animal", ANIMAL);

    expect(found.map((photo) => photo.id)).toEqual([mine.id, alsoMine.id]);
  });
});

describe("the cover", () => {
  const queued = attachment({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid });
  const landed = attachment({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB2" as Ulid, uploaded: true });

  it("prefers one that has actually arrived", () => {
    expect(coverPhoto([queued, landed])?.id).toBe(landed.id);
  });

  it("falls back to the placeholder rather than showing nothing", () => {
    expect(coverPhoto([queued])?.id).toBe(queued.id);
  });

  it("is nothing at all when there are no photos", () => {
    expect(coverPhoto([])).toBeUndefined();
  });
});
