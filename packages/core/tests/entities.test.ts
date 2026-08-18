import { describe, expect, it } from "vitest";

import { encodeUlid, type Ulid } from "../src/types/ids.js";
import { hasCoordinates, propertySchema } from "../src/entities/property.js";
import {
  FALLBACK_FARM_NAME,
  nameForSignedDocument,
  resolveBranding,
  resolveBusinessName,
  resolveFarmName,
  type BrandingConfig,
} from "../src/entities/branding-config.js";
import {
  describeZoneExtent,
  dividerSchema,
  dividersWithoutWater,
  isOverCapacity,
  standingDividers,
  zoneSchema,
  type Divider,
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

  it("treats a blank variable as absent rather than as a name", () => {
    // `.env.example` ships `NEXT_PUBLIC_BUSINESS_NAME=""`, which is how a file
    // that must mention every variable says "no separate business name yet".
    // `??` disagreed — it steps past null and undefined only, so the empty
    // string counted as an answer and put a blank where the business is named
    // on /book, /account, agreements, and invoices.
    expect(resolveBusinessName({ farmName: "Home Place" }, { NEXT_PUBLIC_BUSINESS_NAME: "" })).toBe(
      "Home Place",
    );
    expect(resolveFarmName(undefined, { NEXT_PUBLIC_FARM_NAME: "" })).toBe(FALLBACK_FARM_NAME);

    // Whitespace is the same mistake with more characters.
    expect(resolveFarmName(undefined, { NEXT_PUBLIC_FARM_NAME: "   " })).toBe(FALLBACK_FARM_NAME);
  });

  describe("resolveBranding — one config per property", () => {
    const config = (id: string, farmName: string, updatedAt: string) =>
      ({ ...base(), id: id as Ulid, farmName, updatedAt: new Date(updatedAt) }) as BrandingConfig;

    it("is undefined when nothing has been saved", () => {
      expect(resolveBranding([])).toBeUndefined();
    });

    it("returns the only one there is", () => {
      const only = config("01B", "Home Place", "2026-01-01");

      expect(resolveBranding([only])?.farmName).toBe("Home Place");
    });

    it("breaks a tie by id, so every device reaches the same answer", () => {
      // Two devices offline, both naming the farm, both rows arriving. The
      // *later edit* is deliberately not what wins: `updatedAt` would make the
      // farm's name depend on whose clock was ahead, and two kiosks could
      // disagree about it indefinitely.
      const first = config("01A", "Chosen", "2026-01-01");
      const second = config("01B", "Also chosen", "2026-06-01");

      expect(resolveBranding([second, first])?.farmName).toBe("Chosen");
      expect(resolveBranding([first, second])?.farmName).toBe("Chosen");
    });

    it("does not reorder the caller's array", () => {
      // The list comes straight from a live query, and sorting it in place
      // would mutate what React is holding.
      const given = [config("01B", "Second", "2026-01-01"), config("01A", "First", "2026-01-01")];

      resolveBranding(given);

      expect(given.map((entry) => entry.farmName)).toEqual(["Second", "First"]);
    });
  });
});

describe("Zone", () => {
  const valid = {
    ...base(),
    name: "North Trap",
    type: "pasture" as const,
    indoor: false,
    baselineSafetyLevel: 1 as const,
    waterSourceIds: [],
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

  it("accepts the working facility type, since the tub holds cattle", () => {
    // Not a pen: nothing lives there, and putting it on the Pen Board as
    // though something did would be wrong on the most-glanced-at screen.
    expect(zoneSchema.safeParse({ ...valid, type: "working_facility" }).success).toBe(true);
  });

  it("reports over-capacity only when a capacity is set", () => {
    expect(isOverCapacity({ capacity: 4 }, 5)).toBe(true);
    expect(isOverCapacity({ capacity: 4 }, 4)).toBe(false);
    expect(isOverCapacity({ capacity: undefined }, 500)).toBe(false);
  });
});

/**
 * Temporary fencing across a zone (see docs/property-layout.md).
 *
 * The Pasture gets sectioned so the cattle can be shut out of the large
 * portion. It goes up and comes down, so what the app needs to know is whether
 * it is standing now — and, because the tank sits on one side of the line,
 * whether the side they were left on has anything to drink.
 */
describe("temporary fencing", () => {
  const tank = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
  const stowed = "01ARZ3NDEKTSV4RRFFQ69G5FA2" as Ulid;

  const fence = (over: Partial<Divider> = {}): Divider => ({
    id: "cross",
    name: "Pasture cross-fence",
    line: [
      { lat: 33.05, lng: -97.47 },
      { lat: 33.051, lng: -97.47 },
    ],
    up: true,
    waterSourceIds: [tank],
    closes: "the big end",
    ...over,
  });

  it("takes a two-point line, since a run between two corners is the usual one", () => {
    expect(dividerSchema.safeParse(fence()).success).toBe(true);
  });

  it("refuses a single point, which is not a fence", () => {
    expect(dividerSchema.safeParse(fence({ line: [{ lat: 33.05, lng: -97.47 }] })).success).toBe(
      false,
    );
  });

  it("counts only the fencing actually standing", () => {
    const zone = { dividers: [fence(), fence({ id: "second", up: false })] };

    expect(standingDividers(zone)).toHaveLength(1);
    expect(standingDividers({ dividers: undefined })).toEqual([]);
  });

  it("says nothing about a zone with no fencing up", () => {
    expect(describeZoneExtent({ name: "Pasture", dividers: [fence({ up: false })] })).toBe(
      "Pasture",
    );
  });

  it("names what the cattle are shut out of, for somebody who does not know", () => {
    // "Pasture" while the fence is standing means a strip of it, and a
    // housesitter reading the board walks the whole field otherwise.
    expect(describeZoneExtent({ name: "Pasture", dividers: [fence()] })).toBe(
      "Pasture — part of it only, shut out of the big end",
    );
  });

  it("catches a fence that shut the cattle away from the tank", () => {
    // The pasture still has a tank and they still have grass. They just
    // cannot reach it, and nothing about that shows from the gate.
    const cutOff = { dividers: [fence({ waterSourceIds: [] })] };

    expect(dividersWithoutWater(cutOff, new Set([tank]))).toHaveLength(1);
  });

  it("is satisfied when the side they kept has the tank on it", () => {
    // Which is how the fence on the sketch is actually run.
    expect(dividersWithoutWater({ dividers: [fence()] }, new Set([tank]))).toEqual([]);
  });

  it("does not count a tank that is stowed for the season", () => {
    // A fence relying on West Pen's static tank in January leaves the same
    // empty field as a fence relying on no tank at all.
    const relyingOnStowed = { dividers: [fence({ waterSourceIds: [stowed] })] };

    expect(dividersWithoutWater(relyingOnStowed, new Set([tank]))).toHaveLength(1);
  });

  it("says nothing about a fence lying on the ground", () => {
    const down = { dividers: [fence({ up: false, waterSourceIds: [] })] };

    expect(dividersWithoutWater(down, new Set([tank]))).toEqual([]);
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
    periodFrom: from,
    ...(to === undefined ? {} : { periodTo: to }),
    slot: "primary",
  });

  it("validates", () => {
    expect(zoneAssignmentSchema.safeParse(assignment(zoneA, jan)).success).toBe(true);
  });

  it("rejects an assignment ending before it starts", () => {
    const bad = { ...assignment(zoneA, jan), periodFrom: mar, periodTo: jan };

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

      expect(result.closed?.periodTo).toEqual(mar);
      expect(result.closed?.zoneId).toBe(zoneA);
      expect(result.opened.zoneId).toBe(zoneB);
      expect(result.opened.periodTo).toBeUndefined();
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
