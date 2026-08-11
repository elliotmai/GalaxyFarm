import { describe, expect, it } from "vitest";

import { encodeUlid, type Ulid } from "../src/types/ids.js";
import { hasCoordinates, propertySchema } from "../src/entities/property.js";
import {
  FALLBACK_FARM_NAME,
  nameForSignedDocument,
  resolveBusinessName,
  resolveFarmName,
} from "../src/entities/branding-config.js";
import {
  isOverCapacity,
  zoneSchema,
  zonesNeedingFreezeCheck,
  type Zone,
} from "../src/entities/zone.js";
import {
  ageInDays,
  ageInMonths,
  animalSchema,
  displayName,
  isOnFarm,
} from "../src/entities/animal.js";
import {
  currentAssignment,
  isCurrent,
  move,
  occupantsOf,
  zoneAssignmentSchema,
  type ZoneAssignment,
} from "../src/entities/zone-assignment.js";
import { emergencyContacts, hasTag, primaryPhone, contactSchema } from "../src/entities/contact.js";
import { attachmentSchema, isImage, pendingUploads } from "../src/entities/attachment.js";
import { dateRange } from "../src/value-objects/date-range.js";

let counter = 0;
const nextId = (): Ulid => encodeUlid(1_000 + counter++, () => 0.5);

const propertyId = nextId();
const base = () => ({
  id: nextId(),
  propertyId,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("Property", () => {
  const valid = { ...base(), name: "Home Place", timezone: "America/Chicago" };

  it("accepts a minimal property", () => {
    expect(propertySchema.safeParse(valid).success).toBe(true);
  });

  it("requires a name", () => {
    expect(propertySchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("accepts a USDA zone and rejects nonsense", () => {
    expect(propertySchema.safeParse({ ...valid, growingZone: "8b" }).success).toBe(true);
    expect(propertySchema.safeParse({ ...valid, growingZone: "zone eight" }).success).toBe(false);
  });

  it("knows whether it can be given to the weather service", () => {
    expect(hasCoordinates({ latitude: 32.7, longitude: -97.3 })).toBe(true);
    expect(hasCoordinates({ latitude: 32.7, longitude: undefined })).toBe(false);
    expect(hasCoordinates({ latitude: undefined, longitude: undefined })).toBe(false);
  });
});

describe("BrandingConfig — spec §5.1", () => {
  it("prefers stored config over environment over fallback", () => {
    expect(resolveFarmName({ farmName: "Stored" }, { NEXT_PUBLIC_FARM_NAME: "Env" })).toBe(
      "Stored",
    );
    expect(resolveFarmName(undefined, { NEXT_PUBLIC_FARM_NAME: "Env" })).toBe("Env");
    expect(resolveFarmName(undefined, {})).toBe(FALLBACK_FARM_NAME);
  });

  it("falls back to the farm name when no business name is set", () => {
    // The business is unnamed until it launches; the farm name is a sane stand-in.
    expect(resolveBusinessName({ farmName: "Home Place" }, {})).toBe("Home Place");
    expect(resolveBusinessName({ farmName: "Home Place", businessName: "Show Cattle" }, {})).toBe(
      "Show Cattle",
    );
  });
});

describe("Zone", () => {
  const valid = {
    ...base(),
    name: "North Trap",
    type: "pasture" as const,
    indoor: false,
    baselineSafetyLevel: 1 as const,
    hasWaterTank: true,
    hasTankHeater: false,
    resting: false,
    active: true,
  };

  it("accepts a valid zone", () => {
    expect(zoneSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a boundary with fewer than three points", () => {
    const twoPoints = [
      { lat: 32.7, lng: -97.3 },
      { lat: 32.8, lng: -97.4 },
    ];

    expect(zoneSchema.safeParse({ ...valid, boundary: twoPoints }).success).toBe(false);
  });

  it("finds the zones needing an ice-breaking chore, naming the heaterless ones", () => {
    // Spec §6: zones without a heater are called out by name as vulnerable.
    const zones = [
      { ...valid, hasWaterTank: true, hasTankHeater: false } as unknown as Zone,
      { ...valid, hasWaterTank: true, hasTankHeater: true } as unknown as Zone,
      { ...valid, hasWaterTank: false, hasTankHeater: false } as unknown as Zone,
      { ...valid, hasWaterTank: true, hasTankHeater: false, active: false } as unknown as Zone,
    ];
    const result = zonesNeedingFreezeCheck(zones);

    expect(result.all).toHaveLength(2);
    expect(result.withoutHeater).toHaveLength(1);
  });

  it("reports over-capacity only when a capacity is set", () => {
    expect(isOverCapacity({ capacity: 4 }, 5)).toBe(true);
    expect(isOverCapacity({ capacity: 4 }, 4)).toBe(false);
    expect(isOverCapacity({ capacity: undefined }, 500)).toBe(false);
  });
});

describe("Animal", () => {
  const valid = {
    ...base(),
    species: "cattle" as const,
    tagNumber: "42",
    sex: "female" as const,
    dobIsEstimate: false,
    status: "active" as const,
    ownership: "own" as const,
    safetyLevel: 2 as const,
    photoKeys: [],
  };

  it("accepts an animal identified by tag alone", () => {
    expect(animalSchema.safeParse(valid).success).toBe(true);
  });

  it("insists on a name or a tag, so it can be found", () => {
    const { tagNumber: _tag, ...noIdentity } = valid;

    expect(animalSchema.safeParse(noIdentity).success).toBe(false);
    expect(animalSchema.safeParse({ ...noIdentity, name: "Dolly" }).success).toBe(true);
  });

  it("insists a client animal names its owner", () => {
    // Spec §5.7: client calves reuse the same entity with an owner attached.
    expect(animalSchema.safeParse({ ...valid, ownership: "client" }).success).toBe(false);
    expect(
      animalSchema.safeParse({ ...valid, ownership: "client", ownerId: nextId() }).success,
    ).toBe(true);
  });

  it("computes age, and admits when it cannot", () => {
    const dob = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-07-01T00:00:00Z");

    expect(ageInDays({ dob }, now)).toBe(181);
    expect(ageInMonths({ dob }, now)).toBe(5);
    expect(ageInDays({ dob: undefined }, now)).toBeUndefined();
    expect(ageInMonths({ dob: undefined }, now)).toBeUndefined();
  });

  it("counts boarding animals as on the farm, because they occupy a pen", () => {
    expect(isOnFarm({ status: "active" })).toBe(true);
    expect(isOnFarm({ status: "boarding" })).toBe(true);
    expect(isOnFarm({ status: "sold" })).toBe(false);
    expect(isOnFarm({ status: "departed" })).toBe(false);
  });

  it("builds a display name from whatever it has", () => {
    expect(displayName({ name: "Dolly", tagNumber: "42" })).toBe("Dolly (42)");
    expect(displayName({ name: "Dolly", tagNumber: undefined })).toBe("Dolly");
    expect(displayName({ name: undefined, tagNumber: "42" })).toBe("42");
    expect(displayName({ name: undefined, tagNumber: undefined })).toBe("Unnamed");
  });
});

describe("ZoneAssignment", () => {
  const zoneA = nextId();
  const zoneB = nextId();
  const animalId = nextId();
  const jan = new Date("2026-01-01T00:00:00Z");
  const mar = new Date("2026-03-01T00:00:00Z");

  const assignment = (zoneId: Ulid, from: Date, to?: Date): ZoneAssignment => ({
    ...base(),
    animalId,
    zoneId,
    period: dateRange(from, to),
    slot: "primary",
  });

  it("validates", () => {
    expect(zoneAssignmentSchema.safeParse(assignment(zoneA, jan)).success).toBe(true);
  });

  it("rejects an assignment ending before it starts", () => {
    const bad = { ...assignment(zoneA, jan), period: { from: mar, to: jan } };

    expect(zoneAssignmentSchema.safeParse(bad).success).toBe(false);
  });

  it("treats the open assignment as current", () => {
    expect(isCurrent(assignment(zoneA, jan))).toBe(true);
    expect(isCurrent(assignment(zoneA, jan, mar))).toBe(false);
  });

  it("finds the current assignment for a slot", () => {
    const history = [assignment(zoneA, jan, mar), assignment(zoneB, mar)];

    expect(currentAssignment(history)?.zoneId).toBe(zoneB);
    expect(currentAssignment([assignment(zoneA, jan, mar)])).toBeUndefined();
  });

  describe("move", () => {
    it("closes the old assignment and opens a new one, preserving history", () => {
      // Spec §5.1: history is free because nothing is overwritten.
      const from = assignment(zoneA, jan);
      const result = move(from, { ...base(), animalId, zoneId: zoneB, slot: "primary", at: mar });

      expect(result.closed?.period.to).toEqual(mar);
      expect(result.closed?.zoneId).toBe(zoneA);
      expect(result.opened.zoneId).toBe(zoneB);
      expect(result.opened.period.to).toBeUndefined();
    });

    it("handles an animal that was nowhere before", () => {
      const result = move(undefined, {
        ...base(),
        animalId,
        zoneId: zoneA,
        slot: "primary",
        at: jan,
      });

      expect(result.closed).toBeUndefined();
      expect(result.opened.zoneId).toBe(zoneA);
    });
  });

  it("lists occupants at a moment in time", () => {
    const assignments = [assignment(zoneA, jan, mar), assignment(zoneB, mar)];

    expect(occupantsOf(assignments, zoneA, new Date("2026-02-01T00:00:00Z"))).toEqual([animalId]);
    expect(occupantsOf(assignments, zoneA, new Date("2026-04-01T00:00:00Z"))).toEqual([]);
    expect(occupantsOf(assignments, zoneB, new Date("2026-04-01T00:00:00Z"))).toEqual([animalId]);
  });
});

describe("Contact", () => {
  const valid = {
    ...base(),
    name: "Dr. Reyes",
    tags: ["vet" as const, "emergency" as const],
    phones: [{ label: "mobile", number: "555-0100" }],
    emails: [],
  };

  it("validates and rejects a bad email", () => {
    expect(contactSchema.safeParse(valid).success).toBe(true);
    expect(
      contactSchema.safeParse({ ...valid, emails: [{ label: "work", address: "nope" }] }).success,
    ).toBe(false);
  });

  it("filters the emergency subset that populates the housesitter guide", () => {
    const other = { ...valid, id: nextId(), tags: ["feed_vendor" as const] };

    expect(emergencyContacts([valid, other] as never)).toHaveLength(1);
  });

  it("answers tag and phone lookups", () => {
    expect(hasTag(valid, "vet")).toBe(true);
    expect(hasTag(valid, "hauler")).toBe(false);
    expect(primaryPhone(valid)).toBe("555-0100");
    expect(primaryPhone({ phones: [] })).toBeUndefined();
  });
});

describe("Attachment", () => {
  const valid = {
    ...base(),
    ownerEntity: "Animal",
    ownerId: nextId(),
    key: "photos/abc.jpg",
    filename: "abc.jpg",
    contentType: "image/jpeg",
    bytes: 1024,
    uploaded: false,
  };

  it("validates", () => {
    expect(attachmentSchema.safeParse(valid).success).toBe(true);
  });

  it("recognises images", () => {
    expect(isImage({ contentType: "image/jpeg" })).toBe(true);
    expect(isImage({ contentType: "application/pdf" })).toBe(false);
  });

  it("lists what still needs uploading when signal returns", () => {
    // Photographing a calf in the barn with no bars has to work (§4.2).
    const uploaded = { ...valid, uploaded: true };

    expect(pendingUploads([valid, uploaded] as never)).toHaveLength(1);
  });
});

describe("signed documents keep their as-signed name", () => {
  it("returns the snapshot verbatim, ignoring any current branding", () => {
    // Spec §4.5 / §5.1: the one deliberate exception to branding propagation.
    // A signed liability PDF is an immutable legal record, so it must not
    // silently re-render with a name the business adopted afterwards.
    expect(nameForSignedDocument("Old Business Name LLC")).toBe("Old Business Name LLC");
  });
});
