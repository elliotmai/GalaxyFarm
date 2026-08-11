import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  ROLES,
  can,
  canSeeRecord,
  capabilitiesOf,
  isWithinAccessWindow,
  requireCapability,
  type Actor,
  type Role,
} from "../src/auth/capabilities.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Who may do what (spec §4.3).
 *
 * The rule these tests exist to hold is that a permission is a function of the
 * actor, not of which button happens to be rendered. A hidden button is not a
 * check — the route is still there and the API is still there.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const OTHER_ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA2" as Ulid;

const NOW = new Date("2026-11-15T12:00:00Z");

const actor = (role: Role, overrides: Partial<Actor> = {}): Actor => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid,
  role,
  propertyId: PROPERTY,
  ...overrides,
});

describe("the grant table", () => {
  it("gives the owner everything", () => {
    expect([...capabilitiesOf("owner")].sort()).toEqual([...CAPABILITIES].sort());
  });

  it("withholds the four irreversible or gatekeeping powers from members", () => {
    // Purge is the one action §4.5 makes unrecoverable; the other three decide
    // who else gets in. Both of the people using this app day to day are
    // owners, so `member` costs nothing today and matters the first time
    // someone is hired.
    for (const capability of [
      "records.purge",
      "users.manage",
      "devices.manage",
      "billing.manage",
    ] as const) {
      expect(can(actor("member"), capability, NOW), capability).toBe(false);
    }
    expect(can(actor("member"), "records.write", NOW)).toBe(true);
  });

  it("gives a customer nothing but their own records", () => {
    expect(capabilitiesOf("customer")).toEqual(["records.read.own"]);
    expect(can(actor("customer"), "records.read", NOW)).toBe(false);
    expect(can(actor("customer"), "records.write", NOW)).toBe(false);
  });

  it("lets a housesitter tick off chores and read nothing else", () => {
    expect(can(actor("housesitter"), "chores.complete", NOW)).toBe(true);
    expect(can(actor("housesitter"), "care.read", NOW)).toBe(true);
    expect(can(actor("housesitter"), "records.write", NOW)).toBe(false);
    expect(can(actor("housesitter"), "records.read", NOW)).toBe(false);
  });

  it("holds a kiosk to the §4.4 whitelist", () => {
    // A barn screen is unattended and unlocked. It can log what it is for.
    const kiosk = actor("kiosk", { deviceId: "barn-01" });

    expect(can(kiosk, "eggs.log", NOW)).toBe(true);
    expect(can(kiosk, "animals.move", NOW)).toBe(true);
    expect(can(kiosk, "records.write", NOW)).toBe(false);
    expect(can(kiosk, "records.delete", NOW)).toBe(false);
  });

  it("grants no capability nobody declared", () => {
    // A typo in a grant would otherwise be a silently-missing permission.
    for (const role of ROLES) {
      for (const capability of capabilitiesOf(role)) {
        expect(CAPABILITIES).toContain(capability);
      }
    }
  });

  it("lets nobody but the owner purge", () => {
    // §4.5 clause 4: purge is separate, owner-only, and Typed-tier.
    for (const role of ROLES) {
      expect(can(actor(role), "records.purge", NOW), role).toBe(role === "owner");
    }
  });
});

describe("the housesitter's window", () => {
  const window = { from: new Date("2026-11-10T00:00:00Z"), to: new Date("2026-11-20T00:00:00Z") };
  const sitter = actor("housesitter", { accessWindow: window });

  it("lets them in while they are watching the place", () => {
    expect(can(sitter, "care.read", NOW)).toBe(true);
  });

  it("shuts the door when the arrangement ends", () => {
    // Access that quietly outlives the week is the kind of thing nobody
    // notices until it matters.
    const after = new Date("2026-11-21T00:00:00Z");

    expect(isWithinAccessWindow(sitter, after)).toBe(false);
    expect(can(sitter, "care.read", after)).toBe(false);
    expect(can(sitter, "chores.complete", after)).toBe(false);
  });

  it("keeps it shut before the window opens", () => {
    expect(can(sitter, "care.read", new Date("2026-11-01T00:00:00Z"))).toBe(false);
  });

  it("includes both ends of the window", () => {
    expect(isWithinAccessWindow(sitter, window.from)).toBe(true);
    expect(isWithinAccessWindow(sitter, window.to)).toBe(true);
  });

  it("leaves roles without a window alone", () => {
    expect(isWithinAccessWindow(actor("owner"), NOW)).toBe(true);
  });
});

describe("requireCapability", () => {
  it("runs the work and returns its value when allowed", () => {
    const result = requireCapability(actor("owner"), "records.write", NOW, () => "saved");

    expect(result).toEqual({ ok: true, value: "saved" });
  });

  it("refuses with the capability that was missing, not a bare no", () => {
    // The error names what was needed, so a log line is actionable and the UI
    // can say something better than "not allowed".
    const result = requireCapability(actor("housesitter"), "records.write", NOW, () => "saved");

    expect(result).toEqual({
      ok: false,
      error: { kind: "forbidden", capability: "records.write" },
    });
  });

  it("does not run the work at all when refused", () => {
    // Refusing after the fact would leave the side effect behind.
    let ran = false;
    requireCapability(actor("customer"), "records.delete", NOW, () => {
      ran = true;
    });

    expect(ran).toBe(false);
  });
});

describe("canSeeRecord", () => {
  const record = { id: ANIMAL, propertyId: PROPERTY };

  it("scopes everyone to their own property first", () => {
    // §5 puts propertyId on every record so a second location is a filter
    // rather than a migration. This is that filter, and it applies to the
    // owner too.
    expect(canSeeRecord(actor("owner"), { id: ANIMAL, propertyId: OTHER_PROPERTY }, NOW)).toBe(
      false,
    );
  });

  it("shows a customer their own animal and no one else's", () => {
    // The difference between records.read and records.read.own is the whole
    // boarding business's privacy.
    const customer = actor("customer", { ownedAnimalIds: [ANIMAL] });

    expect(canSeeRecord(customer, record, NOW)).toBe(true);
    expect(canSeeRecord(customer, { id: OTHER_ANIMAL, propertyId: PROPERTY }, NOW)).toBe(false);
  });

  it("shows a customer nothing when they own nothing yet", () => {
    expect(canSeeRecord(actor("customer"), record, NOW)).toBe(false);
  });

  it("lets a member see any record on the property", () => {
    expect(canSeeRecord(actor("member"), record, NOW)).toBe(true);
  });

  it("shows a housesitter no records at all", () => {
    // They get the care guide, which is derived and scoped, not the roster.
    expect(canSeeRecord(actor("housesitter"), record, NOW)).toBe(false);
  });

  it("stops showing records the moment a window lapses", () => {
    const kiosk = actor("kiosk", {
      accessWindow: { from: new Date("2026-01-01"), to: new Date("2026-02-01") },
    });

    expect(canSeeRecord(kiosk, record, NOW)).toBe(false);
  });
});
